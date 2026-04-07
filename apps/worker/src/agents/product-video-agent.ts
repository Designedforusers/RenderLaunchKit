import { generateJSON } from '../lib/anthropic-claude-client.js';
import { generateImage } from '../lib/fal-media-client.js';
import { generateVideo } from '../lib/fal-media-client.js';
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
} from '@launchkit/shared';

interface VideoDirectorInput {
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  generationInstructions: string;
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

function accentColorForTone(tone: StrategyBrief['tone']): string {
  switch (tone) {
    case 'technical':
      return '#38bdf8';
    case 'casual':
      return '#f59e0b';
    case 'authoritative':
      return '#f97316';
    case 'enthusiastic':
    default:
      return '#10b981';
  }
}

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
  const shots: LaunchKitVideoShot[] = input.storyboard.shots.map((shot, index) => ({
    id: `shot-${index + 1}`,
    headline: shot.headline,
    caption: shot.caption,
    imageUrl: input.shotImages[index],
    durationInFrames: toFrames(shot.duration),
    accent: shot.accent,
  }));

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

async function planVideoPackage(input: VideoDirectorInput): Promise<{
  storyboard: StoryboardResult;
  thumbnailUrl: string;
  remotionProps: LaunchKitVideoProps;
}> {
  const userPrompt = `Create a short developer-product launch video plan for:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Repo Name:** ${input.repoName}
**Category:** ${input.repoAnalysis.category}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Asset Generation Instructions:** ${input.generationInstructions}

Return a concise storyboard for a polished launch video and write prompts for strong still visuals that can anchor each shot.`;

  const storyboard = await generateJSON(StoryboardResultSchema, SYSTEM_PROMPT, userPrompt);
  const shotImages = await Promise.all(
    storyboard.shots.map((shot) =>
      generateImage(shot.visualPrompt, {
        aspectRatio: '16:9',
        style: 'cinematic dark tech',
      }).then((image) => image.url)
    )
  );

  return {
    storyboard,
    thumbnailUrl: shotImages[0] || '',
    remotionProps: buildRemotionProps({
      repoName: input.repoName,
      repoAnalysis: input.repoAnalysis,
      strategy: input.strategy,
      storyboard,
      shotImages,
    }),
  };
}

export async function generateVideoStoryboardAsset(input: VideoDirectorInput): Promise<{
  storyboard: StoryboardResult;
  thumbnailUrl: string;
  metadata: Record<string, unknown>;
}> {
  const plan = await planVideoPackage(input);

  return {
    storyboard: plan.storyboard,
    thumbnailUrl: plan.thumbnailUrl,
    metadata: {
      renderer: 'remotion',
      remotionProps: plan.remotionProps,
      concept: plan.storyboard.concept,
      shotCount: plan.storyboard.shots.length,
      totalDurationInFrames: getLaunchKitVideoDurationInFrames(plan.remotionProps),
      totalDurationSeconds:
        getLaunchKitVideoDurationInFrames(plan.remotionProps) / VIDEO_FPS,
      voiceoverNotes: plan.storyboard.voiceoverNotes,
    },
  };
}

export async function generateProductVideoAsset(
  input: VideoDirectorInput
): Promise<{
  videoUrl: string;
  thumbnailUrl: string;
  storyboard: StoryboardResult;
  metadata: Record<string, unknown>;
}> {
  const plan = await planVideoPackage(input);
  let videoUrl = '';
  let renderer: 'fal' | 'remotion' = 'remotion';

  if (process.env.FAL_API_KEY) {
    const video = await generateVideo(
      plan.storyboard.shots.map((shot) => shot.visualPrompt).join('. '),
      {
        imageUrl: plan.thumbnailUrl,
        duration: Math.min(
          Math.max(
            plan.storyboard.shots.reduce((sum, shot) => sum + shot.duration, 0),
            4
          ),
          10
        ),
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
      totalDurationInFrames: getLaunchKitVideoDurationInFrames(plan.remotionProps),
      totalDurationSeconds:
        getLaunchKitVideoDurationInFrames(plan.remotionProps) / VIDEO_FPS,
      voiceoverNotes: plan.storyboard.voiceoverNotes,
    },
  };
}
