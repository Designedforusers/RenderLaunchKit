// ── Queue Names ──

export const QUEUE_NAMES = {
  ANALYSIS: 'analysis',
  GENERATION: 'generation',
  REVIEW: 'review',
} as const;

// ── Job Names ──

export const JOB_NAMES = {
  ANALYZE_REPO: 'analyze-repo',
  RESEARCH: 'research',
  STRATEGIZE: 'strategize',
  GENERATE_BLOG: 'generate-blog',
  GENERATE_SOCIAL: 'generate-social',
  GENERATE_FAQ: 'generate-faq',
  GENERATE_IMAGES: 'generate-images',
  GENERATE_VIDEO: 'generate-video',
  CREATIVE_REVIEW: 'creative-review',
  FILTER_WEBHOOK: 'filter-webhook',
} as const;

// ── Queue Configuration ──

export const QUEUE_CONFIG = {
  [QUEUE_NAMES.ANALYSIS]: {
    concurrency: 2,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential' as const, delay: 5000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  },
  [QUEUE_NAMES.GENERATION]: {
    concurrency: 5,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential' as const, delay: 3000 },
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
    },
  },
  [QUEUE_NAMES.REVIEW]: {
    concurrency: 1,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'fixed' as const, delay: 2000 },
      removeOnComplete: { count: 50 },
      removeOnFail: { count: 25 },
    },
  },
} as const;

// ── Job Timeouts (ms) ──

export const JOB_TIMEOUTS = {
  [JOB_NAMES.ANALYZE_REPO]: 120_000,
  [JOB_NAMES.RESEARCH]: 180_000,
  [JOB_NAMES.STRATEGIZE]: 60_000,
  [JOB_NAMES.GENERATE_BLOG]: 120_000,
  [JOB_NAMES.GENERATE_SOCIAL]: 90_000,
  [JOB_NAMES.GENERATE_FAQ]: 90_000,
  [JOB_NAMES.GENERATE_IMAGES]: 300_000,
  [JOB_NAMES.GENERATE_VIDEO]: 600_000,
  [JOB_NAMES.CREATIVE_REVIEW]: 60_000,
  [JOB_NAMES.FILTER_WEBHOOK]: 30_000,
} as const;

// ── Asset Type Labels ──

export const ASSET_TYPE_LABELS: Record<string, string> = {
  blog_post: 'Blog Post',
  twitter_thread: 'Twitter Thread',
  linkedin_post: 'LinkedIn Post',
  product_hunt_description: 'Product Hunt',
  hacker_news_post: 'Hacker News',
  faq: 'FAQ',
  changelog_entry: 'Changelog',
  og_image: 'OG Image',
  social_card: 'Social Card',
  product_video: 'Product Video',
  voiceover_script: 'Voiceover Script',
  video_storyboard: 'Storyboard',
};

// ── Status Colors (for dashboard) ──

export const STATUS_COLORS: Record<string, string> = {
  pending: '#94a3b8',
  analyzing: '#60a5fa',
  researching: '#a78bfa',
  strategizing: '#f59e0b',
  generating: '#10b981',
  reviewing: '#ec4899',
  revising: '#f97316',
  complete: '#10b981',
  failed: '#ef4444',
  queued: '#94a3b8',
  approved: '#10b981',
  rejected: '#ef4444',
  regenerating: '#f97316',
};

// ── Phase Order ──

export const PHASE_ORDER = [
  'pending',
  'analyzing',
  'researching',
  'strategizing',
  'generating',
  'reviewing',
  'complete',
] as const;

// ── GitHub API ──

export const GITHUB_API_BASE = 'https://api.github.com';
export const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com';

// ── Redis Channel Prefixes ──

export const REDIS_CHANNELS = {
  PROJECT_EVENTS: (projectId: string) => `project:${projectId}:events`,
  GITHUB_CACHE: (key: string) => `github:cache:${key}`,
} as const;

// ── Limits ──

export const MAX_REVISION_ROUNDS = 2;
export const MIN_APPROVAL_SCORE = 7;
export const RESEARCH_MAX_STEPS = 15;
export const EMBEDDING_DIMENSIONS = 1536;
