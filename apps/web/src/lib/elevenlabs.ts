import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../env.js';
import { getWebObjectStorageClient } from './object-storage-client.js';

export type ElevenLabsCharacterAlignment = {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
};

type ElevenLabsResponse = {
  audio_base64?: string;
  alignment?: ElevenLabsCharacterAlignment;
  normalized_alignment?: ElevenLabsCharacterAlignment;
};

/**
 * Source-of-truth label for where a narration audio blob was found
 * on a given request. Surfaced all the way up to the
 * `X-Narration-Audio-Src` response header so operators watching
 * production can distinguish a deploy-surviving MinIO read hit
 * (the whole point of this cache tier) from a same-instance local
 * disk hit or an ElevenLabs API call that cost real money.
 *
 * The three states map cleanly to the three cache tiers the synth
 * function implements:
 *
 *   `'local'` → tier 1 hit: the launchkit-web disk has a cached
 *       copy from an earlier request on the same instance. Fast
 *       (~5ms) but vaporizes on every deploy.
 *   `'minio'` → tier 2 hit: local disk was missing but the MinIO
 *       bucket had a copy from a previous deploy or another web
 *       instance. This is the durable tier — a reviewer who
 *       deploys the Blueprint twice and regenerates the same
 *       narrated asset should see this state on the second run.
 *   `'api'`   → tier 3: neither cache had it, we called ElevenLabs
 *       and paid the synthesis cost. The audio is then written to
 *       both local disk and MinIO so the next request of either
 *       flavor short-circuits.
 */
export type NarrationCacheSource = 'local' | 'minio' | 'api';

/**
 * Outcome of the optional MinIO write on the tier-3 (API) path.
 * Only meaningful when `cacheSource === 'api'` and a MinIO client
 * was configured at request time — everywhere else this field is
 * `undefined`.
 *
 *   `'uploaded'`      → both the MP3 and the alignment JSON landed
 *       in MinIO. Next request for the same cacheKey hits tier 2
 *       and skips ElevenLabs even on a fresh deploy.
 *   `'upload-failed'` → the upload threw (network, auth, disk full
 *       on the MinIO box). The synthesis itself succeeded, so the
 *       caller still gets a working buffer and the render
 *       proceeds, but the route layer should log this as a signal
 *       worth investigating because the next request will re-pay
 *       the ElevenLabs cost.
 */
export type NarrationMinioUploadStatus = 'uploaded' | 'upload-failed';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..', '..'
);
const ELEVENLABS_CACHE_DIR = path.resolve(REPO_ROOT, '.cache/elevenlabs');
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

/**
 * Shape a valid narration cache key must satisfy. The real callers
 * all go through `buildElevenLabsCacheKey(seed)` which produces
 * exactly 16 lowercase hex chars from a SHA-1 digest slice, so in
 * practice every request hits this pattern. The guard exists as
 * defense-in-depth: a future caller (or a refactor that accidentally
 * plumbs user input into the key) must not be able to pass `..` or
 * `/etc/passwd` and escape `.cache/elevenlabs/` or
 * `launchkit-renders/audio/`. Path-traversal defences belong at the
 * value boundary, not scattered across every `path.join` call site.
 */
const CACHE_KEY_PATTERN = /^[a-f0-9]{16}$/;

/**
 * Default ElevenLabs HTTP timeout. 30 seconds is generous relative
 * to the 3-8 second typical synth latency but short enough that a
 * dead upstream cannot tie up a web dyno for minutes. Tests override
 * via the `requestTimeoutMs` parameter below.
 */
const DEFAULT_ELEVENLABS_TIMEOUT_MS = 30_000;

export function getElevenLabsConfig(): {
  apiKey: string;
  voiceId: string;
  modelId: string | null;
} | null {
  const apiKey = env.ELEVENLABS_API_KEY;
  const voiceId = env.ELEVENLABS_VOICE_ID;

  if (!apiKey || !voiceId) {
    return null;
  }

  return {
    apiKey,
    voiceId,
    modelId: env.ELEVENLABS_MODEL_ID ?? null,
  };
}

function getAudioPath(cacheKey: string): string {
  return path.join(ELEVENLABS_CACHE_DIR, `${cacheKey}.mp3`);
}

function getAlignmentPath(cacheKey: string): string {
  return path.join(ELEVENLABS_CACHE_DIR, `${cacheKey}.json`);
}

/**
 * MinIO key prefixes. Kept in one place so the tier-2 read and the
 * tier-3 write cannot drift — a mismatch would silently turn every
 * cache hit into a miss and nobody would notice until the ElevenLabs
 * bill showed up. The write under `audio/<cacheKey>.mp3` mirrors the
 * local-disk layout exactly, minus the directory prefix.
 */
function getMinioAudioKey(cacheKey: string): string {
  return `audio/${cacheKey}.mp3`;
}

function getMinioAlignmentKey(cacheKey: string): string {
  return `audio/${cacheKey}.json`;
}

export function buildElevenLabsCacheKey(seed: string): string {
  return createHash('sha1').update(seed).digest('hex').slice(0, 16);
}

export async function synthesizeSpeechWithTimestamps(input: {
  cacheKey: string;
  text: string;
  /**
   * Optional override for the ElevenLabs HTTP request timeout in
   * milliseconds. Defaults to 30 seconds. Tests set this to a tiny
   * value to exercise the timeout path deterministically without
   * having to wait for the real default.
   */
  requestTimeoutMs?: number;
}): Promise<{
  audioBuffer: Buffer;
  alignment: ElevenLabsCharacterAlignment;
  cacheSource: NarrationCacheSource;
  minioUrl?: string;
  minioUploadStatus?: NarrationMinioUploadStatus;
}> {
  // ── Boundary validation ──────────────────────────────────────
  //
  // The cache key flows directly into filesystem paths
  // (.cache/elevenlabs/<key>.{mp3,json}) and MinIO object keys
  // (audio/<key>.{mp3,json}). Accepting arbitrary strings here
  // would let a misbehaving caller write outside the cache
  // directory or manipulate the bucket layout. Every real caller
  // already computes the key through `buildElevenLabsCacheKey`
  // which produces 16-char lowercase hex, so the strict pattern
  // match is a zero-friction defense-in-depth layer.
  if (!CACHE_KEY_PATTERN.test(input.cacheKey)) {
    throw new Error(
      `Invalid cacheKey: must match /^[a-f0-9]{16}$/, got "${input.cacheKey}". ` +
        'Callers should use buildElevenLabsCacheKey() to derive keys from a seed.'
    );
  }

  const config = getElevenLabsConfig();

  if (!config) {
    throw new Error(
      'Narrated video requires ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID'
    );
  }

  const audioPath = getAudioPath(input.cacheKey);
  const alignmentPath = getAlignmentPath(input.cacheKey);
  const storageClient = getWebObjectStorageClient();
  const minioAudioKey = getMinioAudioKey(input.cacheKey);
  const minioAlignmentKey = getMinioAlignmentKey(input.cacheKey);

  // ── Tier 1: local disk hot cache ─────────────────────────────
  //
  // Fastest path (~5ms) for the same launchkit-web instance
  // serving the same narration twice. Vaporizes on every deploy,
  // which is exactly the problem tier 2 exists to solve.
  //
  // Tier 1 deliberately does NOT compose a `minioUrl` from the
  // cache key. Local disk having the file does not imply MinIO
  // also has it: the previous tier-3 call may have completed the
  // local write but failed the MinIO upload (the
  // `minioUploadStatus: 'upload-failed'` branch below). Speculatively
  // populating `minioUrl` here would let the route hand the
  // workflow task a 404-bound URL on the next request, and
  // Remotion's `<Audio>` would silently fail mid-render. The
  // route already falls back to a data-URI when `minioUrl` is
  // undefined, which is functionally correct and the cost of
  // the larger task payload is bounded to same-instance hot
  // cache hits.
  if (existsSync(audioPath) && existsSync(alignmentPath)) {
    const [audioBuffer, alignmentJson] = await Promise.all([
      readFile(audioPath),
      readFile(alignmentPath, 'utf8'),
    ]);

    return {
      audioBuffer,
      alignment: JSON.parse(alignmentJson) as ElevenLabsCharacterAlignment,
      cacheSource: 'local',
    };
  }

  // ── Tier 2: MinIO warm cache ─────────────────────────────────
  //
  // Skipped entirely when MinIO is not configured (local dev
  // without the container, or a deployment that never wired the
  // credentials). No regression vs. the old disk-only behavior in
  // that mode.
  //
  // On hit we hydrate the local disk cache so the next request on
  // this instance takes the tier-1 fast path. The hydration write
  // is independently try/caught: a full disk must NOT fail a
  // request that otherwise would have succeeded, because the
  // in-memory buffer is already good and the next request can
  // just re-hit MinIO.
  //
  // Parallel reads of the MP3 and alignment JSON: if either is
  // missing (partial prior write, manual bucket edit), we treat
  // the whole tier as a miss and fall through to synthesis
  // rather than returning stale or mismatched data.
  if (storageClient !== null) {
    const [audioFromMinio, alignmentFromMinio] = await Promise.all([
      storageClient.getObject(minioAudioKey),
      storageClient.getObject(minioAlignmentKey),
    ]);

    if (audioFromMinio !== null && alignmentFromMinio !== null) {
      let alignment: ElevenLabsCharacterAlignment | null = null;
      try {
        alignment = JSON.parse(
          alignmentFromMinio.toString('utf8')
        ) as ElevenLabsCharacterAlignment;
      } catch (err) {
        // A corrupt alignment JSON in MinIO is exactly the kind
        // of thing that should never happen but will eventually.
        // Log loudly so it gets noticed, then fall through to
        // synthesis which overwrites the bad object on upload.
        console.warn(
          '[elevenlabs] MinIO alignment JSON failed to parse, falling through to synthesis',
          err
        );
      }

      if (alignment !== null) {
        // Best-effort local disk hydration. Swallow failures —
        // a successful MinIO read is already enough to answer the
        // request, and the next request will just re-hit MinIO if
        // the disk write didn't take.
        try {
          await mkdir(ELEVENLABS_CACHE_DIR, { recursive: true });
          await Promise.all([
            writeFile(audioPath, audioFromMinio),
            writeFile(alignmentPath, alignmentFromMinio),
          ]);
        } catch (err) {
          console.warn(
            '[elevenlabs] MinIO hit hydration to local disk failed',
            err
          );
        }

        return {
          audioBuffer: audioFromMinio,
          alignment,
          cacheSource: 'minio',
          minioUrl: storageClient.getPublicUrl(minioAudioKey),
        };
      }
    }
  }

  // ── Tier 3: ElevenLabs API (the expensive cold path) ─────────
  //
  // Everything above missed. Call ElevenLabs, pay the synthesis
  // cost, write the result to every cache tier we have so the
  // next request for the same cacheKey short-circuits.
  await mkdir(ELEVENLABS_CACHE_DIR, { recursive: true });

  // Bounded HTTP timeout. `AbortSignal.timeout` fires an
  // `AbortError` on the fetch after the deadline, which we catch
  // below and rethrow with a clearer message. Without this, a
  // hanging upstream could hold an entire web dyno's worker
  // thread until the platform-level request timeout kills the
  // whole handler, minutes later. 30 seconds default; tests
  // override with a few milliseconds to exercise the path.
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_ELEVENLABS_TIMEOUT_MS;
  let response: Response;
  try {
    response = await fetch(
      `${ELEVENLABS_API_BASE}/text-to-speech/${config.voiceId}/with-timestamps`,
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
        signal: AbortSignal.timeout(requestTimeoutMs),
      }
    );
  } catch (err) {
    // Node surfaces the timeout as a `DOMException` with
    // `name === 'TimeoutError'` (when `AbortSignal.timeout` is
    // the trigger) or `AbortError` on some runtime versions.
    // Catch both, rethrow with a message the route handler can
    // surface to the operator without having to know about
    // AbortController internals. Non-abort errors (DNS failure,
    // connection reset, TLS handshake) propagate unchanged.
    if (
      err instanceof Error &&
      (err.name === 'TimeoutError' || err.name === 'AbortError')
    ) {
      throw new Error(
        `ElevenLabs request timed out after ${String(requestTimeoutMs)}ms`
      );
    }
    throw err;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `ElevenLabs synthesis failed (${response.status}): ${message.slice(0, 200)}`
    );
  }

  const payload = (await response.json()) as ElevenLabsResponse;
  const audioBase64 = payload.audio_base64;
  const alignment = payload.alignment;

  if (!audioBase64 || !alignment) {
    throw new Error('ElevenLabs did not return audio and timestamp alignment');
  }

  const audioBuffer = Buffer.from(audioBase64, 'base64');
  const alignmentBuffer = Buffer.from(JSON.stringify(alignment), 'utf8');

  // Local disk write is a hot-cache optimization for the next
  // same-instance request, not a correctness requirement for
  // this one — the in-memory buffer above is the source of
  // truth and the route handler returns it regardless. Wrap in
  // try/catch so a full disk, EISDIR, or EACCES cannot turn a
  // successful ElevenLabs synthesis into a 500. The worst case
  // is the next request misses tier-1 and hits tier-2 (MinIO)
  // instead, which is already fast and durable.
  //
  // Matches the same degraded-but-working pattern as the tier-2
  // hydration path above and the tier-3 MinIO upload below.
  try {
    await Promise.all([
      writeFile(audioPath, audioBuffer),
      writeFile(alignmentPath, alignmentBuffer),
    ]);
  } catch (err) {
    console.warn(
      '[elevenlabs] tier-3 local disk write failed after synthesis, next request will hit MinIO or re-synth',
      err
    );
  }

  // MinIO write is best-effort: the synthesis already succeeded
  // and the request will return a working buffer regardless. A
  // MinIO outage must NOT take down narrated rendering — it just
  // means the next request won't find the audio in tier 2 and
  // will re-pay the ElevenLabs cost. Log the failure so it's
  // observable without being fatal.
  //
  // Awaited (not fire-and-forget) because the route layer returns
  // the MinIO URL directly via `audioSrc` — if the upload were
  // still in flight when the workflow task started rendering,
  // Remotion's `<Audio src={minioUrl}>` would fetch a 404 and the
  // render would fail with an audio-missing error.
  let minioUrl: string | undefined;
  let minioUploadStatus: NarrationMinioUploadStatus | undefined;
  if (storageClient !== null) {
    try {
      await Promise.all([
        storageClient.uploadAudio(minioAudioKey, audioBuffer, 'audio/mpeg'),
        storageClient.uploadAudio(
          minioAlignmentKey,
          alignmentBuffer,
          'application/json'
        ),
      ]);
      minioUrl = storageClient.getPublicUrl(minioAudioKey);
      minioUploadStatus = 'uploaded';
    } catch (err) {
      console.warn(
        '[elevenlabs] MinIO post-synthesis upload failed, next request will re-pay ElevenLabs',
        err
      );
      minioUploadStatus = 'upload-failed';
    }
  }

  return {
    audioBuffer,
    alignment,
    cacheSource: 'api',
    ...(minioUrl !== undefined ? { minioUrl } : {}),
    ...(minioUploadStatus !== undefined ? { minioUploadStatus } : {}),
  };
}
