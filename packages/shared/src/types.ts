// ── Repo Analysis ──

export interface RepoAnalysis {
  readme: string;
  description: string;
  language: string;
  techStack: string[];
  framework: string | null;
  stars: number;
  forks: number;
  topics: string[];
  license: string | null;
  hasTests: boolean;
  hasCi: boolean;
  recentCommits: CommitSummary[];
  fileTree: string[];
  packageDeps: Record<string, string>;
  category: ProjectCategory;
}

export interface CommitSummary {
  sha: string;
  message: string;
  date: string;
  author: string;
}

export type ProjectCategory =
  | 'cli_tool'
  | 'web_app'
  | 'mobile_app'
  | 'library'
  | 'api'
  | 'framework'
  | 'devtool'
  | 'infrastructure'
  | 'data'
  | 'other';

// ── Research ──

export interface ResearchResult {
  competitors: Competitor[];
  targetAudience: string;
  marketContext: string;
  uniqueAngles: string[];
  recommendedChannels: string[];
  hnMentions: HNMention[];
}

export interface Competitor {
  name: string;
  url: string;
  description: string;
  stars?: number;
  differentiator: string;
}

export interface HNMention {
  title: string;
  url: string;
  points: number;
  commentCount: number;
}

// ── Strategy ──

export interface StrategyBrief {
  positioning: string;
  tone: 'technical' | 'casual' | 'enthusiastic' | 'authoritative';
  keyMessages: string[];
  selectedChannels: ChannelStrategy[];
  assetsToGenerate: AssetGenerationPlan[];
  skipAssets: SkippedAsset[];
}

export interface ChannelStrategy {
  channel: string;
  priority: number;
  reasoning: string;
}

export interface AssetGenerationPlan {
  type: AssetType;
  generationInstructions: string;
  priority: number;
}

export interface SkippedAsset {
  type: string;
  reasoning: string;
}

// ── Assets ──

export type AssetType =
  | 'blog_post'
  | 'twitter_thread'
  | 'linkedin_post'
  | 'product_hunt_description'
  | 'hacker_news_post'
  | 'faq'
  | 'changelog_entry'
  | 'og_image'
  | 'social_card'
  | 'product_video'
  | 'voiceover_script'
  | 'video_storyboard';

export type AssetStatus =
  | 'queued'
  | 'generating'
  | 'reviewing'
  | 'approved'
  | 'rejected'
  | 'regenerating'
  | 'complete'
  | 'failed';

export type ProjectStatus =
  | 'pending'
  | 'analyzing'
  | 'researching'
  | 'strategizing'
  | 'generating'
  | 'reviewing'
  | 'revising'
  | 'complete'
  | 'failed';

// ── Creative Director Review ──

export interface CreativeReview {
  overallScore: number;
  overallFeedback: string;
  assetReviews: AssetReview[];
  approved: boolean;
  revisionPriority: string[];
}

export interface AssetReview {
  assetId: string;
  score: number;
  strengths: string[];
  issues: string[];
  revisionInstructions?: string;
}

// ── SSE Events ──

export interface ProgressEvent {
  type: 'phase_start' | 'phase_complete' | 'asset_ready' | 'tool_call' | 'error' | 'status_update';
  phase?: string;
  data: Record<string, unknown>;
  timestamp: number;
}

// ── Strategy Insights (Learning System) ──

export interface StrategyInsight {
  id: string;
  category: string;
  insight: string;
  confidence: number;
  sampleSize: number;
}

// ── Job Types ──

export interface JobData {
  projectId: string;
  [key: string]: unknown;
}

export interface AnalyzeRepoJobData extends JobData {
  repoUrl: string;
  repoOwner: string;
  repoName: string;
}

export interface ResearchJobData extends JobData {
  repoAnalysis: RepoAnalysis;
}

export interface StrategizeJobData extends JobData {
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
}

export interface GenerateAssetJobData extends JobData {
  assetId: string;
  assetType: AssetType;
  generationInstructions: string;
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  pastInsights: StrategyInsight[];
  revisionInstructions?: string;
}

export interface ReviewJobData extends JobData {
  assetIds: string[];
}

export interface FilterWebhookJobData extends JobData {
  webhookEventId: string;
}

// ── API Types ──

export interface CreateProjectRequest {
  repoUrl: string;
}

export interface CreateProjectResponse {
  id: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  status: ProjectStatus;
  createdAt: string;
}

export interface ProjectResponse {
  id: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  status: ProjectStatus;
  repoAnalysis: RepoAnalysis | null;
  research: ResearchResult | null;
  strategy: StrategyBrief | null;
  reviewScore: number | null;
  reviewFeedback: CreativeReview | null;
  revisionCount: number;
  webhookEnabled: boolean;
  assets: AssetResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface AssetResponse {
  id: string;
  projectId: string;
  type: AssetType;
  status: AssetStatus;
  content: string | null;
  mediaUrl: string | null;
  metadata: Record<string, unknown> | null;
  qualityScore: number | null;
  reviewNotes: string | null;
  userApproved: boolean | null;
  userEdited: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
