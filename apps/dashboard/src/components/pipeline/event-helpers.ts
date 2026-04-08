/**
 * Type-safe extractors for `ProgressEvent.data`.
 *
 * The worker publishes progress events with a deliberately loose
 * `data: Record<string, unknown>` payload (see
 * `packages/shared/src/schemas/progress-event.ts` for the rationale),
 * so the dashboard has to narrow values before reading them. These
 * helpers exist to keep the pipeline components free of inline
 * `typeof x === 'string'` guards, which would otherwise repeat on
 * every render. They also compose with `noUncheckedIndexedAccess`
 * cleanly — every return type is explicitly `... | null`, which
 * forces call sites to handle the missing case.
 */

import type { ProgressEvent } from '@launchkit/shared';

export const PIPELINE_PHASES = [
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
] as const;

export type PipelinePhase = (typeof PIPELINE_PHASES)[number];

export interface PipelinePhaseMeta {
  key: PipelinePhase;
  label: string;
  shortLabel: string;
  description: string;
  /** Numeric index used as the visual stage number in the strip. */
  index: number;
}

export const PIPELINE_PHASE_META: Record<PipelinePhase, PipelinePhaseMeta> = {
  analyzing: {
    key: 'analyzing',
    label: 'Analyze Repo',
    shortLabel: 'Analyze',
    description: 'Reading the codebase, README, and commit history',
    index: 1,
  },
  researching: {
    key: 'researching',
    label: 'Research Market',
    shortLabel: 'Research',
    description: 'Searching GitHub, the web, and HN for context',
    index: 2,
  },
  strategizing: {
    key: 'strategizing',
    label: 'Craft Strategy',
    shortLabel: 'Strategize',
    description: 'Picking channels, tone, and asset types',
    index: 3,
  },
  generating: {
    key: 'generating',
    label: 'Generate Kit',
    shortLabel: 'Generate',
    description: 'Writing copy, rendering images, composing video',
    index: 4,
  },
  reviewing: {
    key: 'reviewing',
    label: 'Creative Review',
    shortLabel: 'Review',
    description: 'Scoring every asset, requesting revisions',
    index: 5,
  },
};

/**
 * Return the canonical phase key a raw project-status string maps to.
 *
 * The API status vocabulary is richer than the 5-phase pipeline —
 * `revising`, for example, is a sub-state of `reviewing`. We collapse
 * those here so the strip component does not need to know about the
 * API-level states.
 */
export function phaseFromStatus(status: string): PipelinePhase | null {
  if ((PIPELINE_PHASES as readonly string[]).includes(status)) {
    return status as PipelinePhase;
  }
  if (status === 'revising') return 'reviewing';
  return null;
}

export function getStringField(
  data: Record<string, unknown>,
  key: string
): string | null {
  const value = data[key];
  return typeof value === 'string' ? value : null;
}

export function getNumberField(
  data: Record<string, unknown>,
  key: string
): number | null {
  const value = data[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface ToolCallEntry {
  id: string;
  toolName: string;
  detail: string | null;
  phase: PipelinePhase | null;
  timestamp: number;
}

/**
 * Extract the ordered list of tool-call entries from the SSE stream.
 *
 * The worker emits a `tool_call` event whenever the research agent or
 * one of the generation agents invokes a tool. The dashboard uses
 * this to render a live log — watching the research agent reach out
 * to GitHub, HN, and the web in real time is the "show, don't tell"
 * moment the prompt is asking for.
 */
export function toolCallsFromEvents(events: ProgressEvent[]): ToolCallEntry[] {
  const out: ToolCallEntry[] = [];
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (!event || event.type !== 'tool_call') continue;
    const toolName = getStringField(event.data, 'toolName');
    if (!toolName) continue;
    const detail =
      getStringField(event.data, 'detail') ??
      getStringField(event.data, 'query') ??
      getStringField(event.data, 'url') ??
      null;
    const phase = event.phase ? phaseFromStatus(event.phase) : null;
    out.push({
      id: `${String(event.timestamp)}-${String(i)}-${toolName}`,
      toolName,
      detail,
      phase,
      timestamp: event.timestamp,
    });
  }
  return out;
}

export interface LatestPhaseDetail {
  phase: PipelinePhase;
  detail: string | null;
}

/**
 * Return the most recent `detail` string seen for each phase, folded
 * into a single object so the stage strip can show a live caption
 * under each pill without re-filtering on every render.
 */
export function latestDetailByPhase(
  events: ProgressEvent[]
): Record<PipelinePhase, string | null> {
  const out: Record<PipelinePhase, string | null> = {
    analyzing: null,
    researching: null,
    strategizing: null,
    generating: null,
    reviewing: null,
  };
  for (const event of events) {
    if (!event.phase) continue;
    const phase = phaseFromStatus(event.phase);
    if (!phase) continue;
    const detail =
      getStringField(event.data, 'detail') ??
      getStringField(event.data, 'toolName');
    if (detail) out[phase] = detail;
  }
  return out;
}
