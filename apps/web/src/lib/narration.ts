import { createHash } from 'node:crypto';
import {
  VIDEO_FPS,
} from '@launchkit/video';
import type {
  LaunchKitCaption,
  LaunchKitVideoProps,
  LaunchKitVideoShot,
} from '@launchkit/video';
import type { ParsedVoiceoverScript } from '@launchkit/shared';
import type { ElevenLabsCharacterAlignment } from './elevenlabs.js';

function findNextDefined(values: number[], start: number, end: number): number | null {
  for (let index = start; index <= end; index += 1) {
    const value = values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function findPreviousDefined(values: number[], start: number, end: number): number | null {
  for (let index = end; index >= start; index -= 1) {
    const value = values[index];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

export function buildNarratedCacheSeed(input: {
  assetId: string;
  assetVersion: number;
  voiceoverAssetId: string;
  voiceoverVersion: number;
  voiceId: string;
  modelId: string | null;
  plainText: string;
  remotionProps: LaunchKitVideoProps;
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        assetId: input.assetId,
        assetVersion: input.assetVersion,
        voiceoverAssetId: input.voiceoverAssetId,
        voiceoverVersion: input.voiceoverVersion,
        voiceId: input.voiceId,
        modelId: input.modelId,
        plainText: input.plainText,
        remotionProps: input.remotionProps,
      })
    )
    .digest('hex')
    .slice(0, 16);
}

export function audioBufferToDataUri(buffer: Buffer): string {
  return `data:audio/mpeg;base64,${buffer.toString('base64')}`;
}

export function alignmentToCaptions(
  script: ParsedVoiceoverScript,
  alignment: ElevenLabsCharacterAlignment,
  fps = VIDEO_FPS
): LaunchKitCaption[] {
  return script.segments.map((segment, index, segments) => {
    const startSeconds =
      findNextDefined(
        alignment.character_start_times_seconds,
        segment.charStart,
        Math.max(segment.charStart, segment.charEnd - 1)
      ) ?? 0;
    const endSeconds =
      findPreviousDefined(
        alignment.character_end_times_seconds,
        segment.charStart,
        Math.max(segment.charStart, segment.charEnd - 1)
      ) ?? startSeconds;

    const previousEnd = index > 0 ? (segments[index - 1]?.charEnd ?? 0) : 0;
    const minStart = index > 0
      ? Math.ceil(
          (findPreviousDefined(
            alignment.character_end_times_seconds,
            previousEnd - 1,
            previousEnd - 1
          ) ?? 0) * fps
        )
      : 0;

    const startInFrames = Math.max(minStart, Math.floor(startSeconds * fps));
    const endInFrames = Math.max(
      startInFrames + 1,
      Math.ceil(endSeconds * fps)
    );

    return {
      startInFrames,
      endInFrames,
      text: segment.text,
    };
  });
}

function scaleShotsToDuration(
  shots: LaunchKitVideoShot[],
  targetFrames: number
): LaunchKitVideoShot[] {
  const currentFrames = shots.reduce(
    (total, shot) => total + shot.durationInFrames,
    0
  );

  if (currentFrames <= 0 || targetFrames <= currentFrames) {
    return shots;
  }

  const scaledShots = shots.map((shot) => ({
    ...shot,
    durationInFrames: Math.max(
      24,
      Math.round((shot.durationInFrames / currentFrames) * targetFrames)
    ),
  }));

  const totalScaledFrames = scaledShots.reduce(
    (total, shot) => total + shot.durationInFrames,
    0
  );
  const diff = targetFrames - totalScaledFrames;

  const lastIndex = scaledShots.length - 1;
  const lastShot = scaledShots[lastIndex];
  if (diff !== 0 && lastShot) {
    scaledShots[lastIndex] = {
      ...lastShot,
      durationInFrames: lastShot.durationInFrames + diff,
    };
  }

  return scaledShots;
}

export function buildNarratedVideoProps(input: {
  baseProps: LaunchKitVideoProps;
  audioSrc: string;
  captions: LaunchKitCaption[];
}): LaunchKitVideoProps {
  const captionDuration = input.captions.reduce(
    (max, caption) => Math.max(max, caption.endInFrames),
    0
  );

  return {
    ...input.baseProps,
    shots: scaleShotsToDuration(
      input.baseProps.shots,
      Math.max(
        input.baseProps.shots.reduce(
          (total, shot) => total + shot.durationInFrames,
          0
        ),
        captionDuration + 6
      )
    ),
    audioSrc: input.audioSrc,
    captions: input.captions,
  };
}
