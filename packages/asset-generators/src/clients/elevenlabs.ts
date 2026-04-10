import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeElevenLabsCostCents } from '@launchkit/shared';
import { recordCost } from '../cost-tracker.js';

/**
 * Fallback model id used for cost computation when the consumer
 * passes `modelId: null`. Uses Eleven v3 — the only model that
 * supports the Text-to-Dialogue endpoint. The deprecated Turbo v2
 * is no longer the default.
 */
const DEFAULT_ELEVENLABS_MODEL_FOR_COST = 'eleven_v3';

/**
 * Model used for the Text-to-Dialogue endpoint. Only `eleven_v3`
 * is supported by the dialogue API.
 */
const DIALOGUE_MODEL = 'eleven_v3';

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
  /**
   * Synthesize a multi-speaker dialogue using the Text-to-Dialogue
   * endpoint (`POST /v1/text-to-dialogue`). Produces a single audio
   * file with natural turn-taking, prosody matching, and emotional
   * continuity between speakers. Requires `eleven_v3`.
   *
   * Falls back to per-line TTS + byte-concat if the dialogue
   * endpoint is unavailable (wrong voice IDs, model mismatch, etc.)
   * so the pipeline never breaks during a demo.
   */
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

    // Record the upstream TTS cost. Only the upstream-hit path
    // records — the cached branch above returns before reaching
    // this line so cache hits are free. `inputUnits` is the
    // character count fed to the synthesis engine.
    recordCost({
      provider: 'elevenlabs',
      operation: 'tts',
      inputUnits: input.text.length,
      costCents: computeElevenLabsCostCents(
        config.modelId ?? DEFAULT_ELEVENLABS_MODEL_FOR_COST,
        input.text.length
      ),
      metadata: {
        voiceId: config.primaryVoiceId,
        modelId: config.modelId ?? DEFAULT_ELEVENLABS_MODEL_FOR_COST,
        path: 'single-voice',
      },
    });

    await writeAtomic(audioPath, buffer);

    return {
      audioPath,
      cacheKey: input.cacheKey,
      durationSeconds: estimateDurationSeconds(input.text),
      cached: false,
    };
  }

  /**
   * Try the Text-to-Dialogue API (`POST /v1/text-to-dialogue`) first.
   * If it fails (voice not found, model not available, permissions),
   * fall back to the legacy per-line TTS + byte-concat approach.
   *
   * The dialogue API produces dramatically better audio — natural
   * turn-taking, prosody matching, emotional continuity — but
   * requires `eleven_v3` and v3-compatible voice IDs. The fallback
   * ensures the pipeline never breaks during a demo.
   */
  async function synthesizeMultiVoiceDialogue(input: {
    cacheKey: string;
    lines: PodcastDialogueLine[];
  }): Promise<ElevenLabsRenderResult> {
    const audioPath = getAudioPath(input.cacheKey);
    const totalChars = input.lines.reduce(
      (sum, line) => sum + line.text.length,
      0
    );
    const estimatedDuration = Math.max(
      1,
      Math.ceil(totalChars / CHARS_PER_SECOND)
    );

    if (existsSync(audioPath)) {
      return {
        audioPath,
        cacheKey: input.cacheKey,
        durationSeconds: estimatedDuration,
        cached: true,
      };
    }

    // Try Text-to-Dialogue first (best quality)
    const dialogueResult = await tryTextToDialogue(input.lines, totalChars);

    if (dialogueResult !== null) {
      await writeAtomic(audioPath, dialogueResult);
      return {
        audioPath,
        cacheKey: input.cacheKey,
        durationSeconds: estimatedDuration,
        cached: false,
      };
    }

    // Fallback: per-line TTS + byte-concat
    console.log('[ElevenLabs] Text-to-Dialogue unavailable, falling back to per-line TTS');
    const buffers: Buffer[] = [];
    for (const line of input.lines) {
      const voiceId =
        line.speaker === 'alex' ? config.primaryVoiceId : config.altVoiceId;
      const buffer = await fetchVoiceMp3({ voiceId, text: line.text });
      recordCost({
        provider: 'elevenlabs',
        operation: 'tts',
        inputUnits: line.text.length,
        costCents: computeElevenLabsCostCents(
          config.modelId ?? DEFAULT_ELEVENLABS_MODEL_FOR_COST,
          line.text.length
        ),
        metadata: {
          voiceId,
          speaker: line.speaker,
          modelId: config.modelId ?? DEFAULT_ELEVENLABS_MODEL_FOR_COST,
          path: 'multi-voice-fallback',
        },
      });
      buffers.push(buffer);
    }

    const merged = Buffer.concat(buffers);
    await writeAtomic(audioPath, merged);

    return {
      audioPath,
      cacheKey: input.cacheKey,
      durationSeconds: estimatedDuration,
      cached: false,
    };
  }

  /**
   * Attempt a Text-to-Dialogue call. Returns the audio buffer on
   * success, `null` on any failure so the caller can fall back.
   */
  async function tryTextToDialogue(
    lines: PodcastDialogueLine[],
    totalChars: number
  ): Promise<Buffer | null> {
    try {
      const dialogueInputs = lines.map((line) => ({
        text: line.text,
        voice_id:
          line.speaker === 'alex'
            ? config.primaryVoiceId
            : config.altVoiceId,
      }));

      const response = await fetch(
        `${ELEVENLABS_API_BASE}/text-to-dialogue?output_format=mp3_44100_128`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': config.apiKey,
          },
          body: JSON.stringify({
            inputs: dialogueInputs,
            model_id: DIALOGUE_MODEL,
          }),
        }
      );

      if (!response.ok) {
        const msg = await response.text();
        console.warn(
          `[ElevenLabs] Text-to-Dialogue failed (${response.status}): ${msg.slice(0, 150)}`
        );
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      recordCost({
        provider: 'elevenlabs',
        operation: 'text-to-dialogue',
        inputUnits: totalChars,
        costCents: computeElevenLabsCostCents(DIALOGUE_MODEL, totalChars),
        metadata: {
          modelId: DIALOGUE_MODEL,
          lineCount: lines.length,
          path: 'text-to-dialogue',
        },
      });

      return buffer;
    } catch (err) {
      console.warn(
        '[ElevenLabs] Text-to-Dialogue error, will fall back:',
        err instanceof Error ? err.message : String(err)
      );
      return null;
    }
  }

  return {
    buildAudioCacheKey,
    synthesizeSingleVoice,
    synthesizeMultiVoiceDialogue,
  };
}
