import {
  createSdkMcpServer,
  query,
  type SdkMcpToolDefinition,
} from '@anthropic-ai/claude-agent-sdk';
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
  // MCP tools use the `mcp__<server>__<tool>` form the SDK auto-generates.
  const mcpToolNames = tools.map(
    (t) => `mcp__${MCP_SERVER_NAME}__${t.name}`
  );
  const allowedTools = [...builtInTools, ...mcpToolNames];

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
      mcpServers: { [MCP_SERVER_NAME]: mcpServer },
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
