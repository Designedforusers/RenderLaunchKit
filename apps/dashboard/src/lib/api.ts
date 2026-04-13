import { z } from 'zod';
import {
  AssetResponseSchema,
  CreateProjectResponseSchema,
  PikaInviteResponseSchema,
  PikaMeetingSessionDetailResponseSchema,
  PikaMeetingSessionListResponseSchema,
  ProjectCostsResponseSchema,
  ProjectResponseSchema,
  ProjectStatusSchema,
} from '@launchkit/shared';
import type {
  AssetResponse,
  PikaMeetingSessionRow,
  ProjectCostsResponse,
} from '@launchkit/shared';

const API_BASE = '/api';

/**
 * Type-safe fetch wrapper that validates the server response against
 * a Zod schema before returning.
 *
 * Replaces the previous `request<T>(path)` helper which trusted the
 * server's response shape blindly via `as T`. The schema-validated
 * version produces actionable errors when the server is on a newer
 * version with an incompatible response shape, instead of crashing
 * downstream React components with `undefined is not an object`.
 */
async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  options?: RequestInit
): Promise<z.infer<S>> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = (await response
      .json()
      .catch(() => ({ error: 'Request failed' }))) as { error?: string };
    throw new Error(error.error ?? `HTTP ${response.status}`);
  }

  const json: unknown = await response.json();
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '<root>';
        return `${path}: ${issue.message}`;
      })
      .join('; ');
    throw new Error(
      `Server response did not match expected shape: ${formatted}`
    );
  }
  return parsed.data;
}

// ── Dashboard-specific response shapes ──────────────────────────────
//
// The list endpoint returns a different shape than the detail
// endpoint (it omits the heavy jsonb fields and adds derived counts),
// so it gets its own dashboard-local schema. Same for the embedded
// job summary on a project detail response.

const ProjectSummarySchema = z.object({
  id: z.string(),
  repoUrl: z.string(),
  repoOwner: z.string(),
  repoName: z.string(),
  status: ProjectStatusSchema,
  reviewScore: z.number().nullable(),
  revisionCount: z.number(),
  webhookEnabled: z.boolean(),
  assetCount: z.number(),
  completedAssets: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const JobSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  attempts: z.number(),
  duration: z.number().nullable(),
  error: z.string().nullable(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  createdAt: z.string(),
});

// The detail response embeds an array of jobs alongside the canonical
// project shape. We extend the shared `ProjectResponseSchema` with
// the dashboard-specific embedded jobs list rather than redefining
// the whole shape locally.
const DashboardProjectDetailSchema = ProjectResponseSchema.extend({
  jobs: z.array(JobSummarySchema),
});

// ── Re-exports for component imports ────────────────────────────────
//
// The dashboard previously declared its own `ProjectSummary`,
// `ProjectDetail`, `Asset`, and `Job` interfaces with `any` for the
// jsonb fields. Those interfaces are gone — every consumer now
// imports the structurally-correct types from `@launchkit/shared`
// (canonical) or from this file (dashboard-extended), all of which
// derive from the same Zod schemas the server uses to validate its
// responses.

export type Asset = AssetResponse;
export type ProjectDetail = z.infer<typeof DashboardProjectDetailSchema>;
export type ProjectSummary = z.infer<typeof ProjectSummarySchema>;
export type Job = z.infer<typeof JobSummarySchema>;
export type ProjectCosts = ProjectCostsResponse;
export type PikaMeetingSession = PikaMeetingSessionRow;

// Small helpers for the few endpoints that return a custom envelope
// shape rather than a documented domain object.
const ProjectIdEnvelopeSchema = z.object({
  id: z.string(),
  status: z.string().optional(),
});
const HealthSchema = z.object({ status: z.string() });
const AssetIdEnvelopeSchema = z.object({
  id: z.string(),
  userApproved: z.boolean().optional(),
  userEdited: z.boolean().optional(),
  status: z.string().optional(),
  webhookEnabled: z.boolean().optional(),
});
const OkSchema = z.object({ ok: z.boolean(), id: z.string().optional() });

const TrendItemSchema = z.object({
  id: z.string(),
  source: z.string(),
  topic: z.string(),
  headline: z.string(),
  url: z.string().nullable(),
  velocityScore: z.number(),
  category: z.string().nullable(),
  ingestedAt: z.string(),
});

const TrendsResponseSchema = z.object({
  trends: z.array(TrendItemSchema),
});

export type TrendItem = z.infer<typeof TrendItemSchema>;

// ── Trend search (aggregated Google Trends + Exa + signals) ──────

const InterestPointSchema = z.object({
  date: z.string(),
  value: z.number(),
});

const RelatedQuerySchema = z.object({
  query: z.string(),
  value: z.number(),
});

const GoogleTrendsDataSchema = z.object({
  interestOverTime: z.array(InterestPointSchema),
  risingQueries: z.array(RelatedQuerySchema),
  topQueries: z.array(RelatedQuerySchema),
}).nullable();

const ExaResultSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publishedDate: z.string().nullable(),
  score: z.number(),
});

const TrendSearchResponseSchema = z.object({
  query: z.string(),
  googleTrends: GoogleTrendsDataSchema,
  exaResults: z.array(ExaResultSchema),
  matchedSignals: z.array(TrendItemSchema),
});

export type TrendSearchResponse = z.infer<typeof TrendSearchResponseSchema>;
export type InterestPoint = z.infer<typeof InterestPointSchema>;
export type RelatedQuery = z.infer<typeof RelatedQuerySchema>;
export type ExaResult = z.infer<typeof ExaResultSchema>;

// ── Discover (broad trending topics) ─────────────────────────────

const DiscoverItemSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  publishedDate: z.string().nullable(),
});

const DiscoverResponseSchema = z.object({
  items: z.array(DiscoverItemSchema),
});

export type DiscoverItem = z.infer<typeof DiscoverItemSchema>;

export const api = {
  // Projects
  listProjects: () =>
    request(z.array(ProjectSummarySchema), '/projects'),

  getProject: (id: string) =>
    request(DashboardProjectDetailSchema, `/projects/${id}`),

  // Project-level cost aggregation for the "Generated for $X.XX"
  // chip on the detail page and the eventual per-provider
  // breakdown modal. The server-side handler aggregates
  // `asset_cost_events` by provider and validates the response
  // against the same Zod schema we use here — single source of
  // truth across server and client.
  getProjectCosts: (id: string) =>
    request(ProjectCostsResponseSchema, `/projects/${id}/costs`),

  createProject: (repoUrl: string, githubToken?: string) =>
    request(CreateProjectResponseSchema, '/projects', {
      method: 'POST',
      // Only include `githubToken` in the body when the user
      // actually provided one — an empty string or `undefined` would
      // be rejected by the server-side schema's `.min(1)`, and the
      // default public-repo path must continue to work with a bare
      // `{ repoUrl }` body.
      body: JSON.stringify(
        githubToken && githubToken.length > 0
          ? { repoUrl, githubToken }
          : { repoUrl }
      ),
    }),

  deleteProject: (id: string) =>
    request(OkSchema, `/projects/${id}`, { method: 'DELETE' }),

  toggleWebhook: (id: string, enabled: boolean) =>
    request(AssetIdEnvelopeSchema, `/projects/${id}/webhook`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  // Assets
  getAsset: (id: string) => request(AssetResponseSchema, `/assets/${id}`),

  approveAsset: (id: string) =>
    request(AssetIdEnvelopeSchema, `/assets/${id}/approve`, {
      method: 'POST',
    }),

  rejectAsset: (id: string) =>
    request(AssetIdEnvelopeSchema, `/assets/${id}/reject`, {
      method: 'POST',
    }),

  editAsset: (id: string, content: string) =>
    request(AssetIdEnvelopeSchema, `/assets/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  regenerateAsset: (
    id: string,
    options?: {
      instructions?: string;
      modelPreferences?: {
        imageModel?: 'auto' | 'flux-pro-ultra' | 'nano-banana-pro';
        videoModel?: 'auto' | 'kling-v3' | 'seedance-2';
      };
    }
  ) =>
    request(ProjectIdEnvelopeSchema, `/assets/${id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({
        ...(options?.instructions !== undefined
          ? { instructions: options.instructions }
          : {}),
        ...(options?.modelPreferences !== undefined
          ? { modelPreferences: options.modelPreferences }
          : {}),
      }),
    }),

  // Pika video meeting sessions
  //
  // The four endpoints map 1:1 to the worker + web surface:
  //
  //   listProjectMeetings  → GET    /projects/:id/meetings
  //   getProjectMeeting    → GET    /projects/:id/meetings/:sessionId
  //   createProjectMeeting → POST   /projects/:id/meetings
  //   endProjectMeeting    → POST   /projects/:id/meetings/:sessionId/leave
  //
  // All four go through the schema-validated `request()` helper so
  // a server-side schema drift surfaces here rather than crashing
  // downstream React components.
  listProjectMeetings: (projectId: string) =>
    request(
      PikaMeetingSessionListResponseSchema,
      `/projects/${projectId}/meetings`
    ),

  getProjectMeeting: (projectId: string, sessionRowId: string) =>
    request(
      PikaMeetingSessionDetailResponseSchema,
      `/projects/${projectId}/meetings/${sessionRowId}`
    ),

  createProjectMeeting: (
    projectId: string,
    body: { meetUrl: string; botName?: string; voiceId?: string }
  ) =>
    request(PikaInviteResponseSchema, `/projects/${projectId}/meetings`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  endProjectMeeting: (projectId: string, sessionRowId: string) =>
    request(
      PikaMeetingSessionDetailResponseSchema,
      `/projects/${projectId}/meetings/${sessionRowId}/leave`,
      { method: 'POST' }
    ),

  // Trends
  getTrends: () => request(TrendsResponseSchema, '/trends'),

  searchTrends: (query: string) =>
    request(
      TrendSearchResponseSchema,
      `/trends/search?q=${encodeURIComponent(query)}`
    ),

  discoverTrends: () =>
    request(DiscoverResponseSchema, '/trends/discover'),

  // ── Direct generation ────────────────────────────────────────────

  generateImage: (input: {
    prompt: string;
    model?: string;
    aspectRatio?: string;
    style?: string;
    enhance?: boolean;
  }) =>
    request(
      z.object({
        url: z.string(),
        prompt: z.string(),
        enhancedPrompt: z.string().nullable(),
        model: z.string(),
        aspectRatio: z.string(),
        costCents: z.number(),
      }),
      '/generate/image',
      { method: 'POST', body: JSON.stringify(input) }
    ),

  generateVideo: (input: {
    prompt: string;
    model?: string;
    duration?: number;
    imageUrl?: string;
    generateAudio?: boolean;
    enhance?: boolean;
  }) =>
    request(
      z.object({
        url: z.string(),
        prompt: z.string(),
        enhancedPrompt: z.string().nullable(),
        model: z.string(),
        duration: z.number(),
        costCents: z.number(),
      }),
      '/generate/video',
      { method: 'POST', body: JSON.stringify(input) }
    ),

  generateAudio: (input:
    | { type: 'single'; text: string }
    | { type: 'dialogue'; lines: { speaker: 'alex' | 'sam'; text: string }[] }
  ) =>
    request(
      z.object({
        audioUrl: z.string(),
        cacheKey: z.string(),
        durationSeconds: z.number(),
        cached: z.boolean(),
        costCents: z.number(),
      }),
      '/generate/audio',
      { method: 'POST', body: JSON.stringify(input) }
    ),

  generateWorld: (input: {
    prompt: string;
    displayName?: string;
    model?: string;
  }) =>
    request(
      z.object({
        worldId: z.string(),
        marbleUrl: z.string(),
        thumbnailUrl: z.string().nullable(),
        prompt: z.string(),
        model: z.string(),
        costCents: z.number(),
      }),
      '/generate/world',
      { method: 'POST', body: JSON.stringify(input) }
    ),

  // Health
  health: () => request(HealthSchema, '/health'),
};
