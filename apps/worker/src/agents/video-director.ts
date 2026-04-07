import { generateJSON } from '../lib/claude.js';
import { generateImage } from '../lib/fal.js';
import { generateVideo } from '../lib/fal.js';
import type { RepoAnalysis, ResearchResult, StrategyBrief } from '@launchkit/shared';

interface VideoDirectorInput {
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  brief: string;
}

interface StoryboardResult {
  concept: string;
  shots: Array<{
    description: string;
    prompt: string;
    duration: number;
  }>;
  voiceoverNotes: string;
}

const SYSTEM_PROMPT = `You are a video director specializing in developer product demo videos. Your job is to create a storyboard and generation prompts for Kling 3.0 video generation.

Output JSON:
{
  "concept": "overall video concept in one sentence",
  "shots": [
    {
      "description": "what this shot shows/communicates",
      "prompt": "detailed Kling video generation prompt",
      "duration": 5
    }
  ],
  "voiceoverNotes": "notes for matching voiceover timing"
}

Guidelines for video prompts:
- Keep shots simple and clear — AI video works best with clean scenes
- 1-3 shots total (5 seconds each)
- Abstract/conceptual works better than literal UI screenshots
- Think: code flowing, data visualizing, connections forming
- Dark themes with bright accents match developer aesthetics
- Smooth, slow camera movements
- No text in the video (will be overlaid separately)
- First shot: establish the problem/context
- Last shot: show the satisfying result/solution`;

export async function runVideoDirector(
  input: VideoDirectorInput
): Promise<{
  videoUrl: string;
  thumbnailUrl: string;
  storyboard: StoryboardResult;
  metadata: Record<string, unknown>;
}> {
  const userPrompt = `Create a 5-10 second product video storyboard for:

**Product:** ${input.repoAnalysis.description || input.research.targetAudience}
**Category:** ${input.repoAnalysis.category}
**Positioning:** ${input.strategy.positioning}
**Tone:** ${input.strategy.tone}

**Brief:** ${input.brief}

Create a visually stunning, abstract video that captures the essence of what this product does for developers.`;

  const storyboard = await generateJSON<StoryboardResult>(SYSTEM_PROMPT, userPrompt);

  // Generate a hero frame as image first (for thumbnail and image-to-video)
  const heroPrompt = storyboard.shots[0]?.prompt || storyboard.concept;
  const thumbnail = await generateImage(heroPrompt, {
    aspectRatio: '16:9',
    style: 'cinematic dark tech',
  });

  // Generate video from the hero image
  const video = await generateVideo(
    storyboard.shots.map((s) => s.prompt).join('. '),
    {
      imageUrl: thumbnail.url,
      duration: Math.min(
        storyboard.shots.reduce((sum, s) => sum + s.duration, 0),
        10
      ),
    }
  );

  return {
    videoUrl: video.url,
    thumbnailUrl: thumbnail.url,
    storyboard,
    metadata: {
      concept: storyboard.concept,
      shotCount: storyboard.shots.length,
      totalDuration: video.duration,
      voiceoverNotes: storyboard.voiceoverNotes,
    },
  };
}
