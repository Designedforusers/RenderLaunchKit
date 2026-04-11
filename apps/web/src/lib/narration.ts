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
import type {
  ElevenLabsCharacterAlignment,
  NarrationCacheSource,
  NarrationMinioUploadStatus,
} from './elevenlabs.js';

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

/**
 * Every legitimate value the `X-Narration-Audio-Src` response
 * header can take on a narrated request. The value tells an
 * operator looking at the response:
 *
 *   `'minio-read-hit'` — The audio was served from the MinIO
 *       tier-2 cache. This is the "the fix is actually working"
 *       signal across deploys: if you see this after a fresh
 *       dyno boot, the durable cache short-circuited ElevenLabs.
 *   `'minio'`          — The audio lives in MinIO and the task
 *       payload contains a MinIO URL. Reached by either (a) a
 *       same-instance tier-1 hit while the MinIO client was
 *       configured, or (b) a cold ElevenLabs synth followed by
 *       a successful MinIO upload.
 *   `'minio-failed'`   — The cold ElevenLabs synth succeeded
 *       but the post-synthesis MinIO upload threw. The render
 *       still completes via the data-URI fallback, but the next
 *       request for the same key will re-pay ElevenLabs. Signal
 *       that MinIO is degraded.
 *   `'data-uri'`       — MinIO is not configured at all on this
 *       instance (local dev without a container, or a
 *       deployment that never wired the credentials). The audio
 *       is inlined as a base64 data URI in the task payload.
 *   `'n/a'`            — Visual variant; this header still ships
 *       on every response for shape consistency, but there is
 *       no narration to report on.
 */
export type NarrationAudioSourceHeader =
  | 'minio'
  | 'minio-read-hit'
  | 'minio-failed'
  | 'data-uri'
  | 'n/a';

/**
 * Map the narration synthesis result's tri-state
 * (`cacheSource`, `minioUrl`, `minioUploadStatus`) into the
 * flat `X-Narration-Audio-Src` header value the route handler
 * writes to the response. The header is what an operator
 * watching production reads to diagnose "is the durable cache
 * actually working?" and "did the last request pay ElevenLabs?".
 *
 * Decision order matters:
 *
 *   1. `cacheSource === 'minio'` wins first. A tier-2 hit is
 *      the "success signal" we most want to see in production
 *      telemetry, and it must be unambiguous even in the
 *      (currently impossible) edge case where the synth
 *      function returned `cacheSource='minio'` but forgot to
 *      populate `minioUrl`. Trust the cacheSource over the
 *      URL presence.
 *   2. A populated `minioUrl` from any other source (a tier-3
 *      cold synth with a successful upload) maps to `'minio'`.
 *      Tier-1 hits never populate `minioUrl` because local disk
 *      having the file does not imply MinIO has it.
 *   3. `minioUploadStatus === 'upload-failed'` is the only
 *      observable way to know the cold path tried MinIO and
 *      failed. This is the "investigate MinIO" signal.
 *   4. Everything else falls through to `'data-uri'` — either
 *      MinIO is not configured at all or this was a tier-1 hit
 *      where the URL is intentionally suppressed.
 */
export function mapNarrationToHeaderValue(narration: {
  cacheSource: NarrationCacheSource;
  minioUrl?: string | undefined;
  minioUploadStatus?: NarrationMinioUploadStatus | undefined;
}): Exclude<NarrationAudioSourceHeader, 'n/a'> {
  if (narration.cacheSource === 'minio') {
    return 'minio-read-hit';
  }
  if (narration.minioUrl !== undefined) {
    return 'minio';
  }
  if (narration.minioUploadStatus === 'upload-failed') {
    return 'minio-failed';
  }
  return 'data-uri';
}
