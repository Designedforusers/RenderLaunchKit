import {
  createSdkMcpServer,
  query,
  type McpServerConfig,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
import { env } from '../env.js';
import { projectProgressPublisher } from './project-progress-publisher.js';

/**
 * Heterogeneous tool list type. `SdkMcpToolDefinition` is generic over
 * its Zod input schema, so an array of tools with different schemas
 * cannot be typed as the bare `SdkMcpToolDefinition[]` (TypeScript would
 * try to unify the schemas and fail). The Agent SDK itself uses
 * `Array<SdkMcpToolDefinition<any>>` internally for the same reason —
 * the variance is a known limitation, not a bug we should be working
 * around. Re-export the alias here so callers don't have to repeat the
 * `any` and the intent is documented in one place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentToolDefinition = SdkMcpToolDefinition<any>;

/**
 * Thin runner around the Claude Agent SDK's `query()` for backend agentic
 * loops. This is the single entry point every agent in the worker uses
 * when it needs the agentic loop, custom tools, and Anthropic's built-in
 * server tools (WebSearch, WebFetch) in one place.
 *
 * Deployment shape
 * ----------------
 *
 * The Agent SDK is a wrapper around the Claude Code CLI subprocess, but
 * the binary ships INSIDE the npm package — see
 * `node_modules/@anthropic-ai/claude-agent-sdk/manifest.json` for the
 * per-platform builds (darwin-arm64, darwin-x64, linux-arm64, linux-x64,
 * Alpine variants). `npm ci` is enough to land it on the worker; no
 * global install or extra build step is required, and `render.yaml`
 * stays as a plain `npm ci && npm run build`. `pathToClaudeCodeExecutable`
 * is left at its default (the bundled binary). Each `query()` call
 * forks the binary for the duration of the run; for our workload
 * (research runs that take 10–60 seconds end-to-end) the ~200 ms
 * subprocess startup is invisible against the LLM latency.
 *
 * Why the Agent SDK and not `client.beta.messages.toolRunner`
 * -----------------------------------------------------------
 *
 * LaunchKit's roadmap is a chat-based content studio (Higgsfield-style)
 * with two entry points: hook-driven runs (Render/GitHub deploy events)
 * and on-demand chat runs from the dashboard. Both entry points need:
 *
 *   - Multi-turn session continuity (`resume: sessionId`)
 *   - Rich event streaming for the chat UI (tool_use_summary, task_progress)
 *   - Subagent fan-out for parallel research
 *   - Approval gates for destructive actions (post to LinkedIn, etc.)
 *   - MCP server federation (Render, GitHub, Slack, Linear)
 *
 * All five are first-class in the Agent SDK and would otherwise be ~1k
 * lines of bespoke infrastructure on top of `messages.toolRunner`.
 *
 * Progress publishing
 * -------------------
 *
 * The runner translates SDK message events into the existing
 * `projectProgressPublisher` channel shape so the dashboard's SSE
 * consumers do not need to change in this PR. Specifically:
 *
 *   - `system.subtype === 'init'`     → captures `session_id` for callers
 *                                       that want to persist it
 *   - `assistant` messages with text  → `statusUpdate`
 *   - tool_use blocks                 → `toolCall`
 *   - `result.subtype === 'success'`  → returned to the caller
 *
 * The runner does not directly emit `phase_start` / `phase_complete` —
 * those are still owned by the calling processor, which knows the
 * pipeline phase name (`researching`, `strategizing`, etc.) the run
 * belongs to.
 */

export interface AgentRunInput<TResult> {
  /**
   * System prompt for the agent. Steers the agent's behaviour and tells
   * it which tools to prefer.
   */
  systemPrompt: string;

  /**
   * The first user message that kicks off the run.
   */
  prompt: string;

  /**
   * Custom in-process tools that should be available alongside the
   * built-in WebSearch/WebFetch. Created via `tool()` from the Agent
   * SDK; the runner wraps them in an `SdkMcpServer` automatically.
   */
  tools: AgentToolDefinition[];

  /**
   * Optional external MCP servers to federate into the agent. Each
   * key becomes the MCP namespace and each value is an `McpServerConfig`
   * the Agent SDK understands (stdio / http / sse / sdk). Example:
   *
   * ```ts
   * externalMcpServers: {
   *   exa: { type: 'http', url: 'https://mcp.exa.ai/mcp?exaApiKey=...' },
   * }
   * ```
   *
   * The runner merges these with the in-process `launchkit` server and
   * the SDK routes every tool call to the right namespace. Callers
   * that need to whitelist specific tools from an external server
   * should add them to `allowedExternalMcpTools` — otherwise the
   * runner rejects every external tool by default, matching the
   * existing least-privilege posture for built-in tools.
   */
  externalMcpServers?: Record<string, McpServerConfig>;

  /**
   * Fully-qualified names of external MCP tools to allow. Format is
   * `mcp__<server>__<tool>` exactly as the SDK emits them. Any tool
   * not listed here is rejected even if the corresponding MCP server
   * is federated — the runner stays least-privilege by default and
   * forces the caller to opt into every external surface explicitly.
   */
  allowedExternalMcpTools?: string[];

  /**
   * Built-in Agent SDK tools to enable. Defaults to `['WebSearch',
   * 'WebFetch']` which is the standard for research agents. Pass `[]`
   * to disable all built-in tools.
   */
  builtInTools?: string[];

  /**
   * Maximum agentic turns before the runner aborts the run. Prevents
   * runaway loops on a stuck model. Defaults to 25.
   */
  maxTurns?: number;

  /**
   * Effort level passed to Opus 4.6. `'max'` = highest correctness,
   * `'high'` = default, `'medium'` = balanced cost/quality. Defaults
   * to `'high'`.
   */
  effort?: 'low' | 'medium' | 'high' | 'max';

  /**
   * Optional session ID to resume. When set, the agent continues a
   * previous conversation instead of starting fresh. Used by the chat
   * entry point to maintain multi-turn context across user messages.
   */
  resumeSessionId?: string;

  /**
   * Project ID for progress publishing. When set, the runner emits
   * `toolCall` and `statusUpdate` events to the project's SSE channel
   * as the agent works.
   */
  projectId?: string;

  /**
   * Phase name attached to progress events. Required when `projectId`
   * is set so the dashboard knows which timeline column to update.
   */
  phase?: string;

  /**
   * Extracts the typed result from the final assistant message text.
   * Called once at the end of a successful run.
   *
   * `finalText` may be `undefined` if the agent ended its turn without
   * producing a trailing text block — common when the agent uses a
   * "terminal" tool whose handler captures the result via a closure
   * and instructs the model to stop immediately. Callers that rely on
   * the closure pattern should ignore `finalText` and read from their
   * own state; callers that rely on the assistant text should throw
   * inside this callback when `finalText` is missing or malformed.
   */
  parseResult: (finalText: string | undefined) => TResult;
}

export interface AgentRunOutput<TResult> {
  result: TResult;
  /**
   * Session ID for resumption. `undefined` if the SDK did not emit a
   * `system.init` event during the run — surfacing the absence of a
   * resumable session at the type level prevents callers from silently
   * persisting an empty string and getting a confusing 404 the next
   * time they try to resume.
   */
  sessionId: string | undefined;
  totalCostUsd: number;
  durationMs: number;
  turnCount: number;
}

const MCP_SERVER_NAME = 'launchkit';

/**
 * Bridge a heterogeneous Zod-typed tool array to the
 * `Parameters<typeof runAgent>[0]['tools']` shape the SDK accepts.
 *
 * Every agent in the worker (`launch-research-agent.ts`,
 * `trending-signals-agent.ts`, …) declares its tool surface via
 * `tool('name', 'desc', ZodInputShape, handler)`
 * calls. Each call returns an `SdkMcpToolDefinition` parameterised by
 * the specific Zod input shape, so the resulting array's element type
 * is a union of those parameterisations. The Agent SDK accepts the
 * array as `SdkMcpToolDefinition<any>[]` internally — TypeScript
 * cannot narrow the heterogeneous union to that `any`-bound shape
 * without erasing the per-tool input types we just declared.
 *
 * This helper centralises the `as unknown as` bridge so every agent
 * shares one cast instead of repeating it. Counted as one of the
 * documented `as unknown as` casts in `CLAUDE.md`. Any new agent that
 * declares a tool surface and calls `runAgent()` MUST go through this
 * helper rather than inlining the cast at the call site.
 */
export function asAgentSdkTools(
  tools: readonly unknown[]
): Parameters<typeof runAgent>[0]['tools'] {
  return tools as unknown as Parameters<typeof runAgent>[0]['tools'];
}

/**
 * Run an agent through the Claude Agent SDK. Returns the parsed result
 * plus session metadata for resumption.
 */
export async function runAgent<TResult>(
  input: AgentRunInput<TResult>
): Promise<AgentRunOutput<TResult>> {
  const {
    systemPrompt,
    prompt,
    tools,
    externalMcpServers,
    allowedExternalMcpTools = [],
    builtInTools = ['WebSearch', 'WebFetch'],
    maxTurns = 25,
    effort = 'high',
    resumeSessionId,
    projectId,
    phase,
    parseResult,
  } = input;

  // Wrap our in-process tools in an MCP server so the SDK can route to
  // them. The `name` here becomes the prefix on the model-visible tool
  // names — `mcp__launchkit__search_github`, etc.
  const mcpServer = createSdkMcpServer({
    name: MCP_SERVER_NAME,
    version: '1.0.0',
    tools,
  });

  // Compose the allowed tool list. Built-in tools use their bare names;
  // in-process MCP tools use the `mcp__<server>__<tool>` form the SDK
  // auto-generates; external MCP tools must be whitelisted by the
  // caller in `allowedExternalMcpTools` so every external surface is
  // opted into explicitly rather than inherited by default.
  const mcpToolNames = tools.map(
    (t) => `mcp__${MCP_SERVER_NAME}__${t.name}`
  );
  const allowedTools = [
    ...builtInTools,
    ...mcpToolNames,
    ...allowedExternalMcpTools,
  ];

  // Federate the caller-provided external MCP servers alongside the
  // in-process `launchkit` server. An empty `externalMcpServers` leaves
  // the map shaped exactly the way it was before this field existed,
  // which keeps the existing research agent behavior byte-identical.
  const mcpServers: Record<string, McpServerConfig> = {
    [MCP_SERVER_NAME]: mcpServer,
    ...(externalMcpServers ?? {}),
  };

  let sessionId: string | undefined = resumeSessionId;
  let finalText = '';
  let totalCostUsd = 0;
  let durationMs = 0;
  let turnCount = 0;

  const queryHandle = query({
    prompt,
    options: {
      model: 'claude-opus-4-6',
      systemPrompt,
      mcpServers,
      allowedTools,
      maxTurns,
      // Backend service: never prompt for permission, never read
      // CLAUDE.md from the repo, never load project settings.
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      // Opus 4.6: adaptive thinking + configurable effort. The Agent
      // SDK exposes both as top-level Options fields rather than nesting
      // effort under `output_config` like the raw Messages API does.
      thinking: { type: 'adaptive' },
      effort,
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    },
  });

  for await (const message of queryHandle) {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          sessionId = message.session_id;
        }
        break;

      case 'assistant': {
        // Capture the latest assistant text and surface tool calls as
        // progress events. The Agent SDK delivers tool_use blocks
        // inline with the assistant message rather than as a separate
        // event type.
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            finalText = block.text;
            // Stream the model's narration into the project's SSE
            // channel so the dashboard can display it as the agent
            // works. Truncated to a reasonable length so a chatty
            // model doesn't flood the channel. Uses the dedicated
            // `narration` helper rather than `statusUpdate` so the
            // model text lands in `data.narration` (the primary
            // field) instead of `data.detail` (the secondary field
            // that's used for human context on state changes).
            if (projectId && phase) {
              await projectProgressPublisher.narration(
                projectId,
                phase,
                block.text.length > 280
                  ? `${block.text.slice(0, 280)}…`
                  : block.text
              );
            }
          }
          if (block.type === 'tool_use' && projectId && phase) {
            await projectProgressPublisher.toolCall(
              projectId,
              phase,
              block.name,
              (block.input ?? {}) as Record<string, unknown>
            );
          }
        }
        break;
      }

      case 'result': {
        if (message.subtype === 'success') {
          totalCostUsd = message.total_cost_usd;
          durationMs = message.duration_ms;
          turnCount = message.num_turns;
          if (typeof message.result === 'string' && message.result.length > 0) {
            finalText = message.result;
          }
        } else {
          throw new Error(
            `Agent run failed: ${
              'error' in message
                ? String((message as { error?: unknown }).error)
                : 'unknown error'
            }`
          );
        }
        break;
      }

      default:
        // task_started, task_progress, partial_assistant, hook events,
        // etc. — not consumed in this PR. The chat UI will subscribe
        // directly to these in a future PR for richer in-flight UX.
        break;
    }
  }

  // Pass `finalText` to the caller's parser even if it is empty. The
  // caller knows whether it relies on the assistant text or on a tool
  // closure; the runner does not, so it cannot enforce a non-empty
  // text contract here without false positives.
  const result = parseResult(finalText.length > 0 ? finalText : undefined);

  return {
    result,
    sessionId,
    totalCostUsd,
    durationMs,
    turnCount,
  };
}

// ── External MCP server factories ─────────────────────────────────

/**
 * Fully-qualified Exa MCP tool names. Exposed here so callers can
 * whitelist exactly the tools they rely on without hard-coding the
 * `mcp__exa__` prefix at every call site. The list mirrors the
 * public Exa MCP server's tool surface — if Exa adds new tools we
 * opt into them explicitly rather than picking them up by accident.
 */
export const EXA_MCP_TOOL_NAMES = {
  webSearch: 'mcp__exa__web_search_exa',
  companyResearch: 'mcp__exa__company_research_exa',
  crawling: 'mcp__exa__crawling_exa',
  linkedinSearch: 'mcp__exa__linkedin_search_exa',
  deepResearcherStart: 'mcp__exa__deep_researcher_start',
  deepResearcherCheck: 'mcp__exa__deep_researcher_check',
} as const;

/**
 * Build the Agent SDK config entry for the hosted Exa MCP server.
 *
 * Returns `null` when `EXA_API_KEY` is not set so callers can
 * conditionally spread the result into their `externalMcpServers`
 * map — the trending-signals agent degrades gracefully to the
 * built-in Anthropic WebSearch when Exa is unavailable.
 *
 * Exa's hosted MCP endpoint accepts the API key as a query
 * parameter; passing it via the URL keeps the transport stateless
 * and avoids shipping per-request headers through the Agent SDK's
 * MCP bridge.
 */
export function createExaMcpServerConfig(): McpServerConfig | null {
  const apiKey = env.EXA_API_KEY;
  if (!apiKey) return null;
  return {
    type: 'http',
    url: `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(apiKey)}`,
  };
}
