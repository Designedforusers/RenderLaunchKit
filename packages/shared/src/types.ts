/**
 * Domain type re-exports.
 *
 * Every type that used to live as a hand-written `interface` or `type`
 * declaration in this file now lives as a `z.infer<typeof XSchema>`
 * inside `./schemas/`. This file is the public alias surface so the
 * rest of the codebase keeps importing from `@launchkit/shared` exactly
 * as before — the migration is invisible to consumers.
 *
 * The three enum unions (`AssetType`, `AssetStatus`, `ProjectStatus`)
 * that used to be hand-written and parallel to the drizzle pgEnums
 * are now derived from those pgEnums in `./enums.ts`. Adding a new
 * value means editing one place; the typechecker keeps everything in
 * sync from there.
 *
 * Why a re-export shim instead of letting consumers import from
 * `./schemas/` directly: changing every `import type { RepoAnalysis }
 * from '@launchkit/shared'` site to a different path would have
 * blown the diff for this PR up by ~30 files for zero functional
 * gain. Keeping the public alias surface lets the migration be a
 * pure refactor of the shared package itself.
 */

export type {
  AssetType,
  AssetStatus,
  CommitRunStatus,
  FeedbackAction,
  OutreachChannel,
  OutreachStatus,
  ProjectStatus,
  TrendSource,
} from './enums.js';

export type {
  // repo-analysis
  CommitSummary,
  ProjectCategory,
  RepoAnalysis,
  // research
  Competitor,
  HNMention,
  ResearchResult,
  // strategy
  AssetGenerationPlan,
  ChannelStrategy,
  SkippedAsset,
  StrategyBrief,
  StrategyTone,
  // review
  AssetReview,
  CreativeReview,
  // progress event
  ProgressEvent,
  ProgressEventType,
  // voiceover
  ParsedVoiceoverScript,
  VoiceoverSegment,
  // strategy insight
  StrategyInsight,
  // job data
  AnalyzeRepoJobData,
  FilterWebhookJobData,
  JobData,
  ResearchJobData,
  ReviewJobData,
  StrategizeJobData,
  // api
  AssetResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectResponse,
  // ── Phase 2: agentic GTM build ──
  // trend signal
  TrendSignal,
  TrendSignalInsert,
  // dev influencer
  AudienceBreakdown,
  DevInfluencer,
  DevInfluencerInsert,
  InfluencerPlatforms,
  // commit marketing run
  CommitMarketingRun,
  CommitMarketingRunInsert,
  TrendUsedSnapshot,
  InfluencerRecommendedSnapshot,
  // outreach draft
  OutreachDraft,
  OutreachDraftInsert,
  OutreachStatusUpdate,
  // asset feedback event
  AssetFeedbackEvent,
  AssetFeedbackEventRequest,
  // asset cost event (Phase 9 cost tracking)
  AssetCostBreakdown,
  AssetCostEventRow,
  CostEvent,
  CostEventProvider,
  ProjectCostsByProvider,
  ProjectCostsResponse,
  // ── Phase 5: influencer discovery pipeline ──
  // influencer candidate (agent/matcher output, not a DB row)
  InfluencerCandidate,
  // ── Pika video meeting integration ──
  // subprocess stdout / job payloads / DB row / HTTP boundary shapes
  PikaSessionStatus,
  PikaExitCode,
  PikaSessionUpdate,
  PikaLeaveResponse,
  PikaNeedsTopupPayload,
  PikaInviteRequest,
  PikaInviteJobData,
  PikaLeaveJobData,
  PikaMeetingSessionRow,
  PikaMeetingSessionListResponse,
  PikaMeetingSessionDetailResponse,
  PikaInviteResponse,
} from './schemas/index.js';
