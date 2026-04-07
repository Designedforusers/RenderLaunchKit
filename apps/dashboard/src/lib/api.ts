const API_BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Projects ──

export interface ProjectSummary {
  id: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  status: string;
  reviewScore: number | null;
  revisionCount: number;
  webhookEnabled: boolean;
  assetCount: number;
  completedAssets: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDetail {
  id: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  status: string;
  repoAnalysis: any;
  research: any;
  strategy: any;
  reviewScore: number | null;
  reviewFeedback: any;
  revisionCount: number;
  webhookEnabled: boolean;
  assets: Asset[];
  jobs: Job[];
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  type: string;
  status: string;
  content: string | null;
  mediaUrl: string | null;
  metadata: Record<string, any> | null;
  qualityScore: number | null;
  reviewNotes: string | null;
  userApproved: boolean | null;
  userEdited: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Job {
  id: string;
  name: string;
  status: string;
  attempts: number;
  duration: number | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export const api = {
  // Projects
  listProjects: () => request<ProjectSummary[]>('/projects'),

  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),

  createProject: (repoUrl: string) =>
    request<{ id: string; status: string }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ repoUrl }),
    }),

  deleteProject: (id: string) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  toggleWebhook: (id: string, enabled: boolean) =>
    request<{ id: string; webhookEnabled: boolean }>(`/projects/${id}/webhook`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),

  // Assets
  getAsset: (id: string) => request<Asset>(`/assets/${id}`),

  approveAsset: (id: string) =>
    request<{ id: string; userApproved: boolean }>(`/assets/${id}/approve`, {
      method: 'POST',
    }),

  rejectAsset: (id: string) =>
    request<{ id: string; userApproved: boolean }>(`/assets/${id}/reject`, {
      method: 'POST',
    }),

  editAsset: (id: string, content: string) =>
    request<{ id: string; userEdited: boolean }>(`/assets/${id}/content`, {
      method: 'PUT',
      body: JSON.stringify({ content }),
    }),

  regenerateAsset: (id: string, instructions?: string) =>
    request<{ id: string; status: string }>(`/assets/${id}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ instructions }),
    }),

  // Health
  health: () => request<{ status: string }>('/health'),
};
