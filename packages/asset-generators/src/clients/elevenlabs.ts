import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Factory-constructed ElevenLabs client. Handles both:
 *
 *   1. Single-voice 30s commercials (`synthesizeSingleVoice`).
 *   2. Multi-speaker 2–3 minute podcast dialogue (`synthesizeMultiVoiceDialogue`).
 *
 * Both write MP3s into a shared cache directory (`.cache/elevenlabs-rendered/`)
 * relative to `process.cwd()`. The web service's asset-streaming route
 * reads back from the same directory when the dashboard requests the
 * audio by asset id. The directory name is intentionally distinct from
 * the web narration cache (`.cache/elevenlabs`) so the two clients
 * never collide on filenames or evict each other's outputs.
 *
 * The factory takes its configuration as a constructor argument — no
 * env access inside this file. When the consumer app cannot supply an
 * API key or primary voice id, it passes `null` and the factory
 * returns `null` instead of a client; agents that require synthesis
 * will throw at call time with a clear message. That matches the
 * previous worker-hosted behavior where `getWorkerElevenLabsConfig()`
 * returned `null` for an incomplete config.
 */

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// Rough heuristic: English TTS at conversational pace lands around
// 14 characters per second. Used both for the cached fast path (no
// MP3 decode needed) and as the post-synthesis duration estimate.
// Accurate enough for progress bars and chunked-streaming Content-Length
// hints; not accurate enough for tight A/V sync (which Phase 4 does
// not require for the eager commercial + podcast assets).
const CHARS_PER_SECOND = 14;

// Extra silence the listener hears at every speaker turn boundary in
// the multi-voice path. We do not actually splice silence into the
// MP3 stream — see the comment in `synthesizeMultiVoiceDialogue` for
// why — but we do credit the duration estimate so the playback UI
// reports a realistic length.
const TURN_GAP_SECONDS = 0.4;

export interface ElevenLabsClientConfig {
  apiKey: string;
  primaryVoiceId: string;
  altVoiceId: string;
  modelId: string | null;
  /**
   * Absolute path to the cache directory. Defaults to
   * `${process.cwd()}/.cache/elevenlabs-rendered` — the same location
   * the worker and the web service's asset-streaming route have been
   * coordinating on since Phase 4. Tests override this to point at a
   * temp dir.
   */
  cacheDir?: string;
}

export type ElevenLabsRenderResult = {
  audioPath: string;
  cacheKey: string;
  durationSeconds: number;
  cached: boolean;
};

export type PodcastDialogueLine = {
  speaker: 'alex' | 'sam';
  text: string;
};

export interface ElevenLabsClient {
  buildAudioCacheKey(seed: string): string;
  synthesizeSingleVoice(input: {
    cacheKey: string;
    text: string;
  }): Promise<ElevenLabsRenderResult>;
  synthesizeMultiVoiceDialogue(input: {
    cacheKey: string;
    lines: PodcastDialogueLine[];
  }): Promise<ElevenLabsRenderResult>;
}

export function createElevenLabsClient(
  config: ElevenLabsClientConfig
): ElevenLabsClient {
  const cacheDir =
    config.cacheDir ?? path.resolve(process.cwd(), '.cache/elevenlabs-rendered');

  function buildAudioCacheKey(seed: string): string {
    return createHash('sha1').update(seed).digest('hex').slice(0, 16);
  }

  function getAudioPath(cacheKey: string): string {
    return path.join(cacheDir, `${cacheKey}.mp3`);
  }

  function estimateDurationSeconds(text: string): number {
    return Math.max(1, Math.ceil(text.length / CHARS_PER_SECOND));
  }

  function buildTempPath(cacheKey: string): string {
    return path.join(
      cacheDir,
      `${cacheKey}.${process.pid}.${Date.now()}.tmp`
    );
  }

  async function fetchVoiceMp3(input: {
    voiceId: string;
    text: string;
  }): Promise<Buffer> {
    const response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${input.voiceId}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': config.apiKey,
        },
        body: JSON.stringify({
          text: input.text,
          ...(config.modelId ? { model_id: config.modelId } : {}),
          output_format: 'mp3_44100_128',
        }),
      }
    );

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `ElevenLabs synthesis failed (${response.status}): ${message.slice(0, 200)}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async function writeAtomic(
    targetPath: string,
    buffer: Buffer
  ): Promise<void> {
    await mkdir(cacheDir, { recursive: true });
    const tempPath = buildTempPath(path.basename(targetPath, '.mp3'));
    await writeFile(tempPath, buffer);
    await rename(tempPath, targetPath);
  }

  async function synthesizeSingleVoice(input: {
    cacheKey: string;
    text: string;
  }): Promise<ElevenLabsRenderResult> {
    const audioPath = getAudioPath(input.cacheKey);

    if (existsSync(audioPath)) {
      // Cache hit — skip the upstream call entirely. The duration
      // estimate stays text-derived (rather than parsing the MP3) so
      // the cached and freshly-rendered paths return the same value
      // for the same input text.
      return {
        audioPath,
        cacheKey: input.cacheKey,
        durationSeconds: estimateDurationSeconds(input.text),
        cached: true,
      };
    }

    const buffer = await fetchVoiceMp3({
      voiceId: config.primaryVoiceId,
      text: input.text,
    });

    await writeAtomic(audioPath, buffer);

    return {
      audioPath,
      cacheKey: input.cacheKey,
      durationSeconds: estimateDurationSeconds(input.text),
      cached: false,
    };
  }

  async function synthesizeMultiVoiceDialogue(input: {
    cacheKey: string;
    lines: PodcastDialogueLine[];
  }): Promise<ElevenLabsRenderResult> {
    const audioPath = getAudioPath(input.cacheKey);
    // `estimateDurationSeconds` is `Math.max(1, ⌈chars / 14⌉)`. We feed
    // it the total character count directly rather than allocating a
    // throwaway `' '.repeat(totalChars)` string just to call `.length`
    // on it. The `.text` indirection is wrapped in a tiny shim so the
    // single-voice path keeps its existing string-input contract.
    const totalChars = input.lines.reduce(
      (sum, line) => sum + line.text.length,
      0
    );
    const turnBoundaries = Math.max(0, input.lines.length - 1);
    const estimatedDuration =
      Math.max(1, Math.ceil(totalChars / CHARS_PER_SECOND)) +
      turnBoundaries * TURN_GAP_SECONDS;

    if (existsSync(audioPath)) {
      return {
        audioPath,
        cacheKey: input.cacheKey,
        durationSeconds: estimatedDuration,
        cached: true,
      };
    }

    const buffers: Buffer[] = [];
    for (const line of input.lines) {
      const voiceId =
        line.speaker === 'alex' ? config.primaryVoiceId : config.altVoiceId;
      const buffer = await fetchVoiceMp3({
        voiceId,
        text: line.text,
      });
      buffers.push(buffer);
    }

    // Concatenate the per-line MP3 buffers in order. MP3 frames are
    // self-delimiting and do not carry an outer container, so byte-level
    // concatenation produces a stream that every standard player decodes
    // as one continuous track. We deliberately do NOT splice silent
    // padding between lines: a raw zero-byte run inside an MP3 stream
    // is undefined behavior (the decoder may emit clicks, drop frames,
    // or refuse to seek), and the natural breath at sentence boundaries
    // already gives the listener enough of a turn-taking cue.
    const merged = Buffer.concat(buffers);

    await writeAtomic(audioPath, merged);

    return {
      audioPath,
      cacheKey: input.cacheKey,
      durationSeconds: estimatedDuration,
      cached: false,
    };
  }

  return {
    buildAudioCacheKey,
    synthesizeSingleVoice,
    synthesizeMultiVoiceDialogue,
  };
}
