import {
  VIDEO_FPS,
  type PodcastDialogueSegment,
  type PodcastWaveformProps,
} from '@launchkit/video';
import type {
  RepoAnalysis,
  ResearchResult,
  StrategyBrief,
  StrategyInsight,
} from '@launchkit/shared';
import { generateWrittenAsset } from './written-asset-agent.js';
import {
  buildAudioCacheKey,
  synthesizeMultiVoiceDialogue,
  type PodcastDialogueLine,
} from '../lib/elevenlabs.js';
import { accentColorForTone } from '../lib/strategy-style.js';

/**
 * Podcast script pipeline (Phase 4).
 *
 * Produces a multi-speaker dev podcast asset:
 *   1. Writer agent emits a 2-3 minute dialogue between two hosts
 *      (`Alex` and `Sam`) under the `podcast_script` ASSET_PROMPTS branch.
 *   2. The script is parsed line-by-line into structured dialogue.
 *   3. ElevenLabs renders each line through the per-speaker voice
 *      (`primaryVoiceId` for Alex, `altVoiceId` for Sam) and concatenates
 *      the per-line MP3 buffers into a single playable track.
 *   4. The same line list is converted into frame-accurate
 *      `PodcastDialogueSegment[]` for the `LaunchKitPodcastWaveform`
 *      Remotion composition. Each segment's duration is derived from the
 *      same `2.3 words/sec + 0.4s gap` heuristic the writer agent uses
 *      so the on-screen captions stay roughly aligned with the audio.
 *
 * The asset's audio MP3 lives in `.cache/elevenlabs-rendered/${cacheKey}.mp3`
 * and is served by the `/api/assets/:id/audio.mp3` route in `apps/web`.
 */

interface PodcastScriptInput {
  assetId: string;
  repoName: string;
  repoAnalysis: RepoAnalysis;
  research: ResearchResult;
  strategy: StrategyBrief;
  pastInsights: StrategyInsight[];
  generationInstructions: string;
  revisionInstructions?: string;
}

export interface PodcastScriptResult {
  script: string;
  audioCacheKey: string;
  metadata: Record<string, unknown>;
}

// Conversational TTS lands around 2.3 spoken words per second; we add
// 0.4s of natural breath at every speaker turn boundary to match the
// listening experience. Same constants the writer agent uses so the
// frame timeline and the duration estimate stay in lockstep.
const WORDS_PER_SECOND = 2.3;
const TURN_GAP_SECONDS = 0.4;

function parseDialogueLines(content: string): PodcastDialogueLine[] {
  const lines: PodcastDialogueLine[] = [];
  for (const raw of content.split('\n')) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = /^(alex|sam)\s*:\s*(.+)$/i.exec(trimmed);
    if (!match) {
      continue;
    }
    const speakerLabel = match[1];
    const spoken = match[2];
    if (!speakerLabel || !spoken) {
      continue;
    }
    lines.push({
      speaker: speakerLabel.toLowerCase() === 'alex' ? 'alex' : 'sam',
      text: spoken,
    });
  }
  return lines;
}

function estimateLineDurationSeconds(text: string): number {
  const wordCount = text.split(/\s+/).filter((word) => word.length > 0).length;
  return Math.max(0.6, wordCount / WORDS_PER_SECOND);
}

function buildSegments(
  lines: PodcastDialogueLine[]
): { segments: PodcastDialogueSegment[]; totalFrames: number } {
  let cursor = 0;
  const segments: PodcastDialogueSegment[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }
    const lineSeconds =
      estimateLineDurationSeconds(line.text) +
      (index > 0 ? TURN_GAP_SECONDS : 0);
    const lineFrames = Math.max(VIDEO_FPS, Math.round(lineSeconds * VIDEO_FPS));
    segments.push({
      speaker: line.speaker,
      text: line.text,
      startInFrames: cursor,
      endInFrames: cursor + lineFrames,
    });
    cursor += lineFrames;
  }
  return { segments, totalFrames: cursor };
}

export async function generatePodcastScriptAsset(
  input: PodcastScriptInput
): Promise<PodcastScriptResult> {
  const writerResult = await generateWrittenAsset({
    repoAnalysis: input.repoAnalysis,
    research: input.research,
    strategy: input.strategy,
    pastInsights: input.pastInsights,
    assetType: 'podcast_script',
    generationInstructions: input.generationInstructions,
    ...(input.revisionInstructions !== undefined
      ? { revisionInstructions: input.revisionInstructions }
      : {}),
  });

  const dialogueLines = parseDialogueLines(writerResult.content);

  if (dialogueLines.length === 0) {
    // The writer prompt enforces the `Speaker: line` format, but we
    // fail loud rather than silently rendering a zero-line podcast —
    // the alternative is a 0-byte MP3 the dashboard would render as a
    // broken player with no error context.
    throw new Error(
      `podcast-script-agent: writer produced 0 parseable dialogue lines from ${writerResult.content.length} chars of output`
    );
  }

  const audioCacheKey = buildAudioCacheKey(
    `${input.assetId}:podcast_script:${writerResult.content}`
  );

  const audio = await synthesizeMultiVoiceDialogue({
    cacheKey: audioCacheKey,
    lines: dialogueLines,
  });

  const { segments, totalFrames } = buildSegments(dialogueLines);
  const durationInFrames = Math.max(
    VIDEO_FPS,
    totalFrames,
    Math.ceil(audio.durationSeconds * VIDEO_FPS)
  );

  const remotionProps: PodcastWaveformProps = {
    productName: input.repoName,
    episodeTitle: `Inside ${input.repoName}: ${input.strategy.positioning.slice(0, 60)}`,
    accentColor: accentColorForTone(input.strategy.tone),
    backgroundColor: '#020617',
    audioSrc: audio.audioPath,
    durationInFrames,
    segments,
  };

  return {
    script: writerResult.content,
    audioCacheKey,
    metadata: {
      ...writerResult.metadata,
      audioCacheKey,
      audioCached: audio.cached,
      audioDurationSeconds: audio.durationSeconds,
      dialogueLineCount: dialogueLines.length,
      remotionProps,
    },
  };
}
