import type { LaunchKitVideoProps, LaunchKitVideoShot } from '@launchkit/video';
import {
  getLaunchKitVideoDurationInFrames,
  VIDEO_FPS,
} from '@launchkit/video';
import { StoryboardResultSchema } from '@launchkit/shared';
import type {
  RepoAnalysis,
  ResearchResult,
  StoryboardResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import { accentColorForTone } from '../helpers/strategy-style.js';
import type { LLMClient } from '../types.js';
import type { FalMediaClient, FalImageModel, FalVideoModel } from '../clients/fal.js';

export interface VideoDirectorInput {
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  generationInstructions: string;
  videoModel?: FalVideoModel;
  imageModel?: FalImageModel;
  /**
   * Phase 7 Layer 3 edit patterns — one entry per cluster of
   * semantically-similar user edits the cron has aggregated for
   * this asset's project category. The video director filters the
   * list to entries scoped to the current asset type (the cron
   * encodes asset_type in the insight body as `(<asset_type>, ...)`,
   * so `(product_video,` for the product-video agent and
   * `(video_storyboard,` for the storyboard agent) and renders them
   * as a "Common Edits Reviewers Made" prompt block so Claude
   * pre-empts the patterns when drafting the storyboard. Optional
   * and defaults to an empty list.
   */
  editPatterns?: StrategyInsight[];
}

/**
 * Internal type added to `planVideoPackage` so the storyboard and
 * product-video factories can disambiguate which `(<asset_type>,`
 * the edit-pattern filter should match. Both factories share the
 * same plan helper, but the cron writes per-asset-type insight
 * rows — the storyboard factory passes `'video_storyboard'` and
 * the product-video factory passes `'product_video'`.
 */
type VideoPlanAssetType = 'product_video' | 'video_storyboard';

export interface VideoStoryboardResult {
  storyboard: StoryboardResult;
  thumbnailUrl: string;
  metadata: Record<string, unknown>;
}

export interface ProductVideoResult {
  videoUrl: string;
  thumbnailUrl: string;
  storyboard: StoryboardResult;
  metadata: Record<string, unknown>;
}

export interface ProductVideoAgentDeps {
  llm: LLMClient;
  fal: FalMediaClient;
}

const SYSTEM_PROMPT = `You are a video director specializing in developer product demo videos. Your job is to create a storyboard and generation prompts for Kling 3.0 video generation.

Output JSON:
{
  "concept": "overall video concept in one sentence",
  "shots": [
    {
      "headline": "short on-screen headline",
      "caption": "one or two concise supporting sentences",
      "visualPrompt": "detailed visual prompt for a hero still/image",
      "duration": 2.5,
      "accent": "optional short highlighted word or phrase"
    }
  ],
  "voiceoverNotes": "notes for matching voiceover timing"
}

Guidelines:
- Keep shots simple and clear
- 2-4 shots total
- Abstract/conceptual works better than literal UI screenshots
- Think: code flowing, data visualizing, connections forming
- Dark themes with bright accents match developer aesthetics
- The headline must be under 8 words
- The caption must be under 22 words
- First shot: establish the problem/context
- Last shot: show the satisfying result/solution`;

function toFrames(durationSeconds: number): number {
  return Math.max(Math.round(durationSeconds * VIDEO_FPS), 30);
}

function buildRemotionProps(input: {
  repoName: string;
  repoAnalysis: RepoAnalysis;
  strategy: StrategyBrief;
  storyboard: StoryboardResult;
  shotImages: string[];
}): LaunchKitVideoProps {
  const shots: LaunchKitVideoShot[] = input.storyboard.shots.map(
    (shot, index) => {
      // `shotImages` and `storyboard.shots` are produced from the same
      // model output in `planVideoPackage`, so the lengths must match.
      // A mismatch means the upstream pipeline broke its invariant; we
      // fail loudly here instead of silently rendering a Remotion shot
      // with an empty image URL (which would otherwise produce a
      // mostly-black video the user would only catch on playback).
      const imageUrl = input.shotImages[index];
      if (imageUrl === undefined) {
        throw new Error(
          `Storyboard shot ${index + 1} has no image — got ${input.shotImages.length} images for ${input.storyboard.shots.length} shots`
        );
      }
      return {
        id: `shot-${index + 1}`,
        headline: shot.headline,
        caption: shot.caption,
        imageUrl,
        durationInFrames: toFrames(shot.duration),
        ...(shot.accent !== undefined ? { accent: shot.accent } : {}),
      };
    }
  );

  return {
    title: input.repoName,
    subtitle: input.strategy.positioning,
    badge: 'Launch Video',
    accentColor: accentColorForTone(input.strategy.tone),
    backgroundColor: '#020617',
    shots,
    outroCta: `Ship ${input.repoName} with a sharper launch story.`,
  };
}

function makePlanVideoPackage(deps: ProductVideoAgentDeps) {
  return async function planVideoPackage(
    input: VideoDirectorInput,
    assetType: VideoPlanAssetType
  ): Promise<{
    storyboard: StoryboardResult;
    thumbnailUrl: string;
    remotionProps: LaunchKitVideoProps;
  }> {
    // Phase 7 Layer 3 edit patterns. Filter to the entries scoped to
    // the current asset type — the cron encodes asset_type in the
    // insight body as `(<asset_type>, ...)`. The product-video and
    // storyboard factories share this helper but the cron writes
    // separate insight rows for each, so we filter on the caller's
    // explicit asset type rather than guessing from the input shape.
    const relevantEditPatterns =
      input.editPatterns?.filter((p) =>
        p.insight.includes(`(${assetType},`)
      ) ?? [];
    const editPatternsBlock =
      relevantEditPatterns.length > 0
        ? `\n\n**Common Edits Reviewers Made to Past ${assetType} Storyboards:**\nThese are real edits human reviewers applied to past ${assetType} storyboards in this category. Pre-empt them — design the shots and visual prompts the way reviewers want them, not the way the previous generation drafted them.\n${relevantEditPatterns
            .map((p) => `- ${p.insight}`)
            .join('\n')}`
        : '';

    const userPrompt = `Create a short developer-product launch video plan for:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Repo Name:** ${input.repoName}
**Category:** ${input.repoAnalysis.category}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Asset Generation Instructions:** ${input.generationInstructions}${editPatternsBlock}

Return a concise storyboard for a polished launch video and write prompts for strong still visuals that can anchor each shot.`;

    const storyboard = await deps.llm.generateJSON(
      StoryboardResultSchema,
      SYSTEM_PROMPT,
      userPrompt
    );
    const shotImages = await Promise.all(
      storyboard.shots.map((shot) =>
        deps.fal
          .generateImage(shot.visualPrompt, {
            aspectRatio: '16:9',
            style: 'cinematic dark tech',
            ...(input.imageModel !== undefined ? { model: input.imageModel } : {}),
          })
          .then((image) => image.url)
      )
    );

    return {
      storyboard,
      thumbnailUrl: shotImages[0] ?? '',
      remotionProps: buildRemotionProps({
        repoName: input.repoName,
        repoAnalysis: input.repoAnalysis,
        strategy: input.strategy,
        storyboard,
        shotImages,
      }),
    };
  };
}

export function makeGenerateVideoStoryboardAsset(deps: ProductVideoAgentDeps) {
  const planVideoPackage = makePlanVideoPackage(deps);
  return async function generateVideoStoryboardAsset(
    input: VideoDirectorInput
  ): Promise<VideoStoryboardResult> {
    const plan = await planVideoPackage(input, 'video_storyboard');

    return {
      storyboard: plan.storyboard,
      thumbnailUrl: plan.thumbnailUrl,
      metadata: {
        renderer: 'remotion',
        remotionProps: plan.remotionProps,
        concept: plan.storyboard.concept,
        shotCount: plan.storyboard.shots.length,
        totalDurationInFrames: getLaunchKitVideoDurationInFrames(
          plan.remotionProps
        ),
        totalDurationSeconds:
          getLaunchKitVideoDurationInFrames(plan.remotionProps) / VIDEO_FPS,
        voiceoverNotes: plan.storyboard.voiceoverNotes,
      },
    };
  };
}

export function makeGenerateProductVideoAsset(deps: ProductVideoAgentDeps) {
  const planVideoPackage = makePlanVideoPackage(deps);
  return async function generateProductVideoAsset(
    input: VideoDirectorInput
  ): Promise<ProductVideoResult> {
    const plan = await planVideoPackage(input, 'product_video');
    let videoUrl = '';
    let renderer: 'fal' | 'remotion' = 'remotion';

    // Previously this branch checked `env.FAL_API_KEY` directly. The
    // package does not touch env — instead the fal client reports its
    // own configured state via `isConfigured`, which the worker-side
    // factory sets from the same env var.
    if (deps.fal.isConfigured) {
      const video = await deps.fal.generateVideo(
        plan.storyboard.shots.map((shot) => shot.visualPrompt).join('. '),
        {
          imageUrl: plan.thumbnailUrl,
          duration: Math.min(
            Math.max(
              plan.storyboard.shots.reduce(
                (sum, shot) => sum + shot.duration,
                0
              ),
              4
            ),
            10
          ),
          ...(input.videoModel !== undefined ? { model: input.videoModel } : {}),
        }
      );
      videoUrl = video.url;
      renderer = 'fal';
    }

    return {
      videoUrl,
      thumbnailUrl: plan.thumbnailUrl,
      storyboard: plan.storyboard,
      metadata: {
        renderer,
        remotionProps: plan.remotionProps,
        concept: plan.storyboard.concept,
        shotCount: plan.storyboard.shots.length,
        totalDurationInFrames: getLaunchKitVideoDurationInFrames(
          plan.remotionProps
        ),
        totalDurationSeconds:
          getLaunchKitVideoDurationInFrames(plan.remotionProps) / VIDEO_FPS,
        voiceoverNotes: plan.storyboard.voiceoverNotes,
      },
    };
  };
}

export type GenerateVideoStoryboardAsset = ReturnType<
  typeof makeGenerateVideoStoryboardAsset
>;
export type GenerateProductVideoAsset = ReturnType<
  typeof makeGenerateProductVideoAsset
>;
