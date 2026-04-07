import { z } from 'zod';
import {
  AssetResponseSchema,
  CreateProjectResponseSchema,
  ProjectResponseSchema,
} from '@launchkit/shared';
import type {
  AssetResponse,
  ProjectResponse,
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
    throw new Error(error.error || `HTTP ${response.status}`);
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
  status: z.string(),
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

export const api = {
  // Projects
  listProjects: () =>
    request(z.array(ProjectSummarySchema), '/projects'),

  getProject: (id: string) =>
    request(DashboardProjectDetailSchema, `/projects/${id}`),

  createProject: (repoUrl: string) =>
    request(CreateProjectResponseSchema, '/projects', {
      method: 'POST',
      body: JSON.stringify({ repoUrl }),
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

  regenerateAsset: (id: string, instructions?: string) =>
    request(ProjectIdEnvelopeSchema, `/assets/${id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ instructions }),
    }),

  // Health
  health: () => request(HealthSchema, '/health'),
};
