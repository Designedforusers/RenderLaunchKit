import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { expensiveRouteRateLimit } from '../middleware/rate-limit.js';
import { eq } from 'drizzle-orm';
import Anthropic from '@anthropic-ai/sdk';
import {
  projects,
  assets as assetsTable,
  parseJsonbColumn,
  RepoAnalysisSchema,
  StrategyBriefSchema,
  ResearchResultSchema,
} from '@launchkit/shared';
import { z } from 'zod';
import { database } from '../lib/database.js';
import { parseUuidParam, invalidUuidResponse } from '../lib/validate-uuid.js';
import { env } from '../env.js';

/**
 * Streaming chat route for the dashboard's agent chat UI.
 *
 * `POST /api/projects/:projectId/chat` accepts a JSON body with
 * `messages` (the conversation history) and returns an SSE stream
 * of Claude's response. The response includes both text deltas
 * and tool-use events so the dashboard can render tool calls
 * inline in the chat.
 *
 * Architecture
 * ------------
 *
 * The web service calls Anthropic DIRECTLY via `messages.create({
 * stream: true })` — no BullMQ queue, no worker hop. Chat is
 * synchronous from the user's perspective: they type, they see
 * tokens stream in. A queue would add latency without adding
 * value here because:
 *
 *   1. The user is staring at the chat waiting for a response.
 *      A queue delay (even 100 ms) would feel like lag.
 *   2. Chat requests are stateless — if the web service crashes
 *      mid-stream, the user refreshes and resends. No durability
 *      requirement.
 *   3. The web dyno already handles SSE streams for the project
 *      event feed without issues.
 *
 * System prompt
 * -------------
 *
 * Loaded from the project's DB state at request time: repo
 * analysis, research, strategy, and existing assets. The prompt
 * gives Claude full project context so it can answer questions
 * about the product AND generate assets that are consistent with
 * the launch strategy the strategist agent already produced.
 *
 * Tools
 * -----
 *
 * Claude has access to tools for generating written content,
 * reading project state, and searching the web. Tool results
 * are streamed back as SSE events so the dashboard can render
 * them inline in the chat.
 */

const chatRoutes = new Hono();

const ALLOWED_MODELS = [
  'claude-sonnet-4-6',
  'claude-opus-4-6',
  'claude-haiku-4-5-20251001',
] as const;

const ChatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string().min(1).max(100_000),
    })
  ).max(200),
  // Optional model override — defaults to the env ANTHROPIC_MODEL
  // (claude-sonnet-4-6) when absent. The dashboard's model
  // selector sends this field with every request so switching
  // mid-conversation takes effect immediately.
  model: z.enum(ALLOWED_MODELS).optional(),
});

// ── Tool definitions ─────────────────────────────────────────────
//
// Uses Anthropic.Messages.ToolUnion (not Anthropic.Tool) because
// it includes both custom tools and server-managed tools like
// web_search_20250305. ToolUnion is the type messages.stream()
// actually accepts — no cast needed.

const TOOLS: Anthropic.Messages.ToolUnion[] = [
  {
    name: 'generate_written_content',
    description:
      'Generate marketing content for the project. Use this when the user asks for a blog post, tweet thread, LinkedIn post, HN post, FAQ, changelog, or any other written marketing asset. Returns the generated content as markdown.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content_type: {
          type: 'string',
          enum: [
            'blog_post',
            'twitter_thread',
            'linkedin_post',
            'hacker_news_post',
            'product_hunt_description',
            'faq',
            'changelog_entry',
            'tips',
          ],
          description: 'The type of content to generate',
        },
        instructions: {
          type: 'string',
          description:
            'Specific instructions for the content (tone, angle, audience, length, etc.)',
        },
      },
      required: ['content_type', 'instructions'],
    },
  },
  {
    name: 'get_project_info',
    description:
      'Get detailed information about the current project including repo analysis, research findings, launch strategy, and generated assets. Use this when you need to reference specific facts about the project.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_project_assets',
    description:
      'List all marketing assets that have been generated for the current project, including their status, type, and a preview of the content.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  // Server-managed web search — Claude handles search execution
  // internally via the Anthropic API. No API key needed, results
  // are injected into the response content blocks and Claude uses
  // them to compose its answer. The agentic loop skips these
  // because server tools produce 'server_tool_use' blocks, not
  // 'tool_use' blocks, so they never hit executeToolCall.
  {
    type: 'web_search_20250305',
    name: 'web_search',
  },
];

// ── Chat endpoint ────────────────────────────────────────────────

chatRoutes.post('/:projectId/chat', expensiveRouteRateLimit, async (c) => {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json(
      {
        error:
          'ANTHROPIC_API_KEY is not configured. Set it in your .env to enable the chat.',
      },
      503
    );
  }

  const projectId = parseUuidParam(c, 'projectId');
  if (!projectId) return invalidUuidResponse(c);

  const rawBody: unknown = await c.req.json().catch(() => ({}));
  const parsed = ChatRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', issues: parsed.error.issues }, 400);
  }

  const project = await database.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });
  if (!project) {
    return c.json({ error: 'Project not found' }, 404);
  }

  const projectAssets = await database
    .select()
    .from(assetsTable)
    .where(eq(assetsTable.projectId, projectId));

  const systemPrompt = buildChatSystemPrompt(project, projectAssets);

  const anthropic = new Anthropic({ apiKey });

  // Convert the simplified message format to Anthropic's format.
  // The dashboard sends {role, content: string} but Anthropic
  // wants {role, content: string | ContentBlock[]}.
  const anthropicMessages: Anthropic.MessageParam[] = parsed.data.messages.map(
    (m) => ({
      role: m.role,
      content: m.content,
    })
  );

  const selectedModel = parsed.data.model ?? env.ANTHROPIC_MODEL;

  return streamSSE(c, async (stream) => {
    try {
      // ── Agentic loop ──────────────────────────────────────
      //
      // Instead of nesting a second `messages.stream()` inside
      // the first's tool_use handler (which caused the SSE
      // stream to freeze after the follow-up), we run a LOOP:
      //
      //   1. Stream a response, forwarding text deltas to SSE
      //   2. Await finalMessage to get the complete content
      //   3. If the response contains tool_use blocks, execute
      //      the tools, append tool results to the message
      //      history, and LOOP BACK to step 1
      //   4. If no tool_use blocks, we're done — send the
      //      `done` event and close
      //
      // This handles multi-turn tool chains (Claude calls tool
      // A, reads the result, decides to call tool B, etc.)
      // without ever nesting streams. Each iteration is a
      // clean stream → finalMessage → check → decide cycle.
      //
      // Max 5 iterations to prevent runaway tool chains.

      const loopMessages: Anthropic.MessageParam[] = [...anthropicMessages];
      const MAX_TOOL_ROUNDS = 5;

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = anthropic.messages.stream({
          model: selectedModel,
          max_tokens: 4096,
          system: systemPrompt,
          messages: loopMessages,
          tools: TOOLS,
        });

        // Forward text deltas to SSE as they arrive.
        response.on('text', (text) => {
          void stream.writeSSE({
            event: 'text_delta',
            data: JSON.stringify({ text }),
          });
        });

        const finalMessage = await response.finalMessage();

        // Collect tool_use blocks from the response.
        // Server tool blocks (web_search) have type
        // 'server_tool_use' and are handled by the API
        // internally — they do not appear here.
        const toolUseBlocks = finalMessage.content.filter(
          (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
            b.type === 'tool_use'
        );

        // If no tool calls, we're done.
        if (toolUseBlocks.length === 0) {
          break;
        }

        // Execute each tool and build tool_result messages.
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          void stream.writeSSE({
            event: 'tool_call',
            data: JSON.stringify({
              id: block.id,
              name: block.name,
              input: block.input,
            }),
          });

          // Notify the dashboard that this tool is actively executing.
          void stream.writeSSE({
            event: 'tool_progress',
            data: JSON.stringify({
              id: block.id,
              name: block.name,
              status: 'executing',
            }),
          });

          const result = executeToolCall(
            block.name,
            block.input as Record<string, unknown>,
            projectId,
            project,
            projectAssets
          );

          // Truncate large results so the follow-up context
          // window isn't overwhelmed (especially on Haiku).
          const resultStr =
            typeof result === 'string'
              ? result
              : JSON.stringify(result);
          const truncated =
            resultStr.length > 8000
              ? `${resultStr.slice(0, 8000)}\n\n[...truncated, ${String(resultStr.length - 8000)} chars omitted]`
              : resultStr;

          void stream.writeSSE({
            event: 'tool_result',
            data: JSON.stringify({
              id: block.id,
              name: block.name,
              result,
            }),
          });

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: truncated,
          });
        }

        // Append the assistant's response + tool results to
        // the message history for the next iteration.
        loopMessages.push({
          role: 'assistant',
          content: finalMessage.content,
        });
        loopMessages.push({
          role: 'user',
          content: toolResults,
        });

        // Loop back — the next iteration streams Claude's
        // response to the tool results.
      }

      void stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ status: 'complete' }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[Chat] streaming error:', message);
      void stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ error: message }),
      });
    }
  });
});

// ── Tool execution ───────────────────────────────────────────────

function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  _projectId: string,
  project: typeof projects.$inferSelect,
  projectAssets: (typeof assetsTable.$inferSelect)[]
): unknown {
  switch (toolName) {
    case 'get_project_info': {
      const info: Record<string, unknown> = {
        repoUrl: project.repoUrl,
        repoOwner: project.repoOwner,
        repoName: project.repoName,
        status: project.status,
      };
      try {
        info['repoAnalysis'] = parseJsonbColumn(
          RepoAnalysisSchema,
          project.repoAnalysis,
          'project.repo_analysis'
        );
      } catch {
        info['repoAnalysis'] = null;
      }
      try {
        info['strategy'] = parseJsonbColumn(
          StrategyBriefSchema,
          project.strategy,
          'project.strategy'
        );
      } catch {
        info['strategy'] = null;
      }
      try {
        info['research'] = parseJsonbColumn(
          ResearchResultSchema,
          project.research,
          'project.research'
        );
      } catch {
        info['research'] = null;
      }
      return info;
    }

    case 'list_project_assets': {
      return projectAssets.map((asset) => ({
        type: asset.type,
        status: asset.status,
        content: asset.content
          ? asset.content.length > 500
            ? `${asset.content.slice(0, 500)}...`
            : asset.content
          : null,
        qualityScore: asset.qualityScore,
      }));
    }

    case 'generate_written_content': {
      // For now, return a structured instruction that Claude can
      // use to generate inline. In a full implementation, this
      // would call the asset-generators package.
      const contentType = typeof input['content_type'] === 'string'
        ? input['content_type']
        : 'unknown';
      const instructions = typeof input['instructions'] === 'string'
        ? input['instructions']
        : '';
      return {
        status: 'generated_inline',
        content_type: contentType,
        instructions,
        note: 'Content generated directly by Claude in the follow-up response based on project context and these instructions.',
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ── System prompt builder ────────────────────────────────────────

function buildChatSystemPrompt(
  project: typeof projects.$inferSelect,
  projectAssets: (typeof assetsTable.$inferSelect)[]
): string {
  const sections: string[] = [];

  sections.push(
    `You are Bufo, LaunchKit's AI go-to-market teammate. You're helping the user with their project "${project.repoOwner}/${project.repoName}".` +
      `\n\nYou can:` +
      `\n- Answer questions about the project (repo analysis, research, strategy, assets)` +
      `\n- Generate marketing content (blog posts, tweets, LinkedIn posts, etc.)` +
      `\n- Help refine and iterate on existing assets` +
      `\n- Search the web for current information (competitor news, market trends, recent events)` +
      `\n\nBe conversational, specific, and use real details from the project context. Keep responses focused and actionable. When generating content, make it publication-ready.` +
      `\n\nFormatting rules: write plain text only. No markdown — no asterisks, no bold, no headings, no bullet lists. Write like you're texting a friend. Use line breaks to separate thoughts.`
  );

  // Add project context.
  try {
    const analysis = parseJsonbColumn(
      RepoAnalysisSchema,
      project.repoAnalysis,
      'repo_analysis'
    );
    sections.push(
      `Project: ${analysis.description}\n` +
        `Language: ${analysis.language}\n` +
        `Tech stack: ${analysis.techStack.join(', ')}\n` +
        `Stars: ${String(analysis.stars)} / Forks: ${String(analysis.forks)}`
    );
  } catch {
    // No analysis yet.
  }

  try {
    const strategy = parseJsonbColumn(
      StrategyBriefSchema,
      project.strategy,
      'strategy'
    );
    sections.push(
      `Positioning: ${strategy.positioning}\n` +
        `Tone: ${strategy.tone}\n` +
        `Key messages:\n${strategy.keyMessages.map((m) => `${m}`).join('\n')}`
    );
  } catch {
    // No strategy yet.
  }

  if (projectAssets.length > 0) {
    const assetSummary = projectAssets
      .slice(0, 10)
      .map((a) => `- ${a.type} (${a.status})`)
      .join('\n');
    sections.push(`**Existing assets:**\n${assetSummary}`);
  }

  return sections.join('\n\n');
}

export default chatRoutes;
