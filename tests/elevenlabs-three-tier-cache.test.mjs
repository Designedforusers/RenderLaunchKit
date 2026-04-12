// Integration tests for the three-tier narration cache in
// `apps/web/src/lib/elevenlabs.ts`.
//
// Architecture under test:
//
//     tier 1 (local disk) → tier 2 (MinIO) → tier 3 (ElevenLabs API)
//
// The whole point of this test file is to lock in which tier
// served a given request across every interesting combination of
// cache state and MinIO-client state. The previous test pass
// exercised only the leaf `getObject` method in isolation; these
// tests exercise the composition — i.e. the code that actually
// saves money on ElevenLabs in production.
//
// Test doubles:
//
// - `globalThis.fetch` is stubbed for the duration of each test so
//   tier 3 returns a canned ElevenLabs response instead of hitting
//   the real API. The stub only matches the ElevenLabs URL; every
//   other fetch flows through unchanged. (The AWS SDK used by
//   `@launchkit/asset-generators` talks HTTP via Node's http module
//   directly, not fetch, so the MinIO side is unaffected.)
//
// - `_setWebObjectStorageClientForTests` from the object-storage
//   client singleton swaps the MinIO client per test: either the
//   real client (for tier 2/3 happy paths), `null` (for the
//   "MinIO not configured" scenarios), or a hand-rolled stub that
//   throws on upload (for the "MinIO write failure" scenario).
//
// Local filesystem:
//
// - Each test uses a unique random `cacheKey` (16 hex chars) so
//   no two tests touch the same .cache/elevenlabs/<key>.mp3 or
//   audio/<key>.mp3 files. Cleanup happens in afterEach to keep
//   the local .cache/ directory tidy, but correctness does not
//   depend on it.
//
// MinIO:
//
// - Runs against the local docker-compose MinIO container at
//   localhost:9000. If the container is not reachable, the whole
//   test file skips each test gracefully via `t.skip()`.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.ELEVENLABS_API_KEY ??= 'test-key-not-real';
process.env.ELEVENLABS_VOICE_ID ??= 'test-voice-id';
process.env.MINIO_ENDPOINT_HOST ??= 'localhost:9000';
process.env.MINIO_ROOT_USER ??= 'launchkit';
process.env.MINIO_ROOT_PASSWORD ??= 'launchkit-dev-password';
process.env.MINIO_BUCKET ??= 'launchkit-renders-test-elevenlabs';

import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const LOCAL_CACHE_DIR = path.resolve(REPO_ROOT, '.cache/elevenlabs');

const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_BUCKET = 'launchkit-renders-test-elevenlabs';
const MINIO_ROOT_USER = 'launchkit';
const MINIO_ROOT_PASSWORD = 'launchkit-dev-password';
const ELEVENLABS_URL_FRAGMENT = 'elevenlabs.io';

// ── Fixtures and helpers ───────────────────────────────────────────

/**
 * Canned ElevenLabs response body. Tier-3 tests assert that the
 * synthesis function decodes the base64 audio and stores this
 * exact buffer at every cache tier, so the bytes matter — use
 * a payload big enough to be unambiguous but small enough that
 * round-trip assertions stay fast.
 */
const CANNED_AUDIO_BYTES = Buffer.concat([
  Buffer.from('fake-elevenlabs-mp3-header-'),
  randomBytes(64),
]);
const CANNED_ALIGNMENT = {
  characters: ['h', 'i', ' ', 't', 'h', 'e', 'r', 'e'],
  character_start_times_seconds: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35],
  character_end_times_seconds: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
};

function uniqueCacheKey() {
  // 16 hex chars to match `buildElevenLabsCacheKey`'s real output
  // length (see `apps/web/src/lib/elevenlabs.ts`).
  return randomBytes(8).toString('hex');
}

async function minioReachable() {
  try {
    const res = await fetch(`${MINIO_ENDPOINT}/minio/health/live`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Load the system under test + the object-storage singleton seam.
 * Lazy so each test run uses the freshly-built dist.
 */
async function loadModules() {
  const [elevenlabs, objStorageClient, assetGen] = await Promise.all([
    import('../apps/web/dist/lib/elevenlabs.js'),
    import('../apps/web/dist/lib/object-storage-client.js'),
    import('../packages/asset-generators/dist/clients/object-storage.js'),
  ]);
  return {
    synthesizeSpeechWithTimestamps: elevenlabs.synthesizeSpeechWithTimestamps,
    _setWebObjectStorageClientForTests:
      objStorageClient._setWebObjectStorageClientForTests,
    createObjectStorageClient: assetGen.createObjectStorageClient,
  };
}

/**
 * A real MinIO client pointed at the docker-compose container.
 * Used by tier-2 / tier-3 tests that want to observe real writes
 * and reads.
 */
function makeRealMinioClient(modules) {
  return modules.createObjectStorageClient({
    endpoint: MINIO_ENDPOINT,
    bucket: MINIO_BUCKET,
    accessKeyId: MINIO_ROOT_USER,
    secretAccessKey: MINIO_ROOT_PASSWORD,
  });
}

/**
 * A stub MinIO client whose uploads always throw. Used to verify
 * tier-3 degrades to `minioUploadStatus: 'upload-failed'` without
 * breaking the synthesis itself.
 */
function makeFailingMinioClient() {
  return {
    async uploadVideo() {
      throw new Error('stub uploadVideo failure');
    },
    async uploadAudio() {
      throw new Error('stub uploadAudio failure');
    },
    async getObject() {
      return null;
    },
    getPublicUrl(key) {
      return `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${key.replace(/^\//, '')}`;
    },
  };
}

/**
 * Install a stub over `globalThis.fetch` that intercepts ElevenLabs
 * calls and returns a canned body, leaving every other fetch
 * unchanged. Returns a restore function.
 */
function stubElevenLabsFetch() {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes(ELEVENLABS_URL_FRAGMENT)) {
      callCount += 1;
      return new Response(
        JSON.stringify({
          audio_base64: CANNED_AUDIO_BYTES.toString('base64'),
          alignment: CANNED_ALIGNMENT,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return originalFetch(input, init);
  };

  return {
    getCallCount: () => callCount,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

/**
 * Write a tier-1 hot-cache pair to disk using the test cacheKey.
 * Uses the SAME local directory the production code reads from so
 * the tier-1 existsSync checks actually hit.
 */
async function seedLocalCache(cacheKey, audioBytes, alignment) {
  await mkdir(LOCAL_CACHE_DIR, { recursive: true });
  await Promise.all([
    writeFile(path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`), audioBytes),
    writeFile(
      path.join(LOCAL_CACHE_DIR, `${cacheKey}.json`),
      JSON.stringify(alignment)
    ),
  ]);
}

/**
 * Delete any local cache files for this key. Used to reset tier-1
 * between phases of a test (e.g. verify tier-2 hit after wiping
 * local disk).
 */
async function clearLocalCache(cacheKey) {
  await Promise.all([
    rm(path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`), { force: true }),
    rm(path.join(LOCAL_CACHE_DIR, `${cacheKey}.json`), { force: true }),
  ]);
}

// ── Preflight ──────────────────────────────────────────────────────

const MINIO_OK = await minioReachable();

// Best-effort cleanup of local .cache/elevenlabs entries created by
// this test run. Does not block test correctness — we use unique
// keys per test so a leftover from a previous run never affects
// the next.
const seenCacheKeys = new Set();
after(async () => {
  for (const key of seenCacheKeys) {
    await clearLocalCache(key).catch(() => undefined);
  }
});

function registerCacheKey(key) {
  seenCacheKeys.add(key);
  return key;
}

// ── Tests ──────────────────────────────────────────────────────────

test('three-tier cache: tier-1 hit with MinIO configured returns cacheSource=local and never speculatively populates minioUrl', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  // Pre-populate the tier-1 hot cache so the existsSync branch
  // takes the fast path before anything else gets a chance to run.
  const seedAudio = Buffer.from('tier-1-seed-audio-payload');
  await seedLocalCache(cacheKey, seedAudio, CANNED_ALIGNMENT);

  // Even with a fully configured MinIO client, tier-1 must not
  // populate `minioUrl` — local disk having the file does not
  // imply MinIO has it (the previous tier-3 might have completed
  // the local write and failed the MinIO upload). The route
  // falls back to a data URI when minioUrl is undefined.
  modules._setWebObjectStorageClientForTests(makeRealMinioClient(modules));
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'ignored on tier-1 hit',
    });

    assert.equal(result.cacheSource, 'local');
    assert.ok(result.audioBuffer.equals(seedAudio));
    assert.deepEqual(result.alignment, CANNED_ALIGNMENT);
    assert.equal(
      result.minioUrl,
      undefined,
      'tier-1 must not speculatively populate minioUrl — see the upload-failed regression scenario'
    );
    assert.equal(result.minioUploadStatus, undefined);
    assert.equal(stub.getCallCount(), 0, 'ElevenLabs must not be called on tier-1 hit');
  } finally {
    stub.restore();
  }
});

test('three-tier cache: tier-1 hit with MinIO NOT configured returns cacheSource=local with no minioUrl', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  const seedAudio = Buffer.from('tier-1-seed-no-minio');
  await seedLocalCache(cacheKey, seedAudio, CANNED_ALIGNMENT);

  // Install null — simulates the local-dev case where MinIO env
  // vars are unset and `getWebObjectStorageClient` returns null.
  // The same-shape result as the tier-1-with-MinIO test above
  // confirms that the MinIO client state has no influence on
  // tier-1 return shape.
  modules._setWebObjectStorageClientForTests(null);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'ignored on tier-1 hit',
    });

    assert.equal(result.cacheSource, 'local');
    assert.ok(result.audioBuffer.equals(seedAudio));
    assert.equal(
      result.minioUrl,
      undefined,
      'minioUrl must be undefined when the client is null'
    );
    assert.equal(result.minioUploadStatus, undefined);
    assert.equal(stub.getCallCount(), 0);
  } finally {
    stub.restore();
  }
});

test('three-tier cache: tier-2 hit returns cacheSource=minio, hydrates local disk, and never calls ElevenLabs', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  // Upload tier-2 state directly: the mp3 and the alignment json
  // both have to be present under the `audio/<key>.<ext>` prefix
  // for the parallel getObject reads in tier 2 to both hit.
  const client = makeRealMinioClient(modules);
  const tier2Audio = Buffer.from('tier-2-seed-from-minio');
  const alignmentBuffer = Buffer.from(JSON.stringify(CANNED_ALIGNMENT), 'utf8');
  await client.uploadAudio(`audio/${cacheKey}.mp3`, tier2Audio, 'audio/mpeg');
  await client.uploadAudio(
    `audio/${cacheKey}.json`,
    alignmentBuffer,
    'application/json'
  );

  // No tier-1 files — force the synth function to fall through.
  await clearLocalCache(cacheKey);

  modules._setWebObjectStorageClientForTests(client);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'ignored on tier-2 hit',
    });

    assert.equal(result.cacheSource, 'minio');
    assert.ok(
      result.audioBuffer.equals(tier2Audio),
      'tier-2 hit must return the exact bytes stored in MinIO'
    );
    assert.deepEqual(result.alignment, CANNED_ALIGNMENT);
    assert.ok(result.minioUrl !== undefined);
    assert.match(result.minioUrl, new RegExp(`/audio/${cacheKey}\\.mp3$`));
    assert.equal(
      stub.getCallCount(),
      0,
      'tier-2 hit must not call ElevenLabs — that is the entire point of the cache'
    );

    // Local disk was wiped before the call. After a successful
    // tier-2 hit the synthesis function hydrates the hot cache so
    // the next same-instance request takes tier-1. Confirm both
    // files landed.
    assert.ok(
      existsSync(path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`)),
      'tier-2 hit must hydrate the local mp3 cache'
    );
    assert.ok(
      existsSync(path.join(LOCAL_CACHE_DIR, `${cacheKey}.json`)),
      'tier-2 hit must hydrate the local alignment cache'
    );
  } finally {
    stub.restore();
  }
});

test('three-tier cache: tier-3 full miss calls ElevenLabs, writes local + MinIO, returns cacheSource=api', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  const client = makeRealMinioClient(modules);
  modules._setWebObjectStorageClientForTests(client);

  // No tier-1 on disk, no tier-2 in MinIO for this key.
  await clearLocalCache(cacheKey);

  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'hi there',
    });

    assert.equal(result.cacheSource, 'api');
    assert.ok(
      result.audioBuffer.equals(CANNED_AUDIO_BYTES),
      'tier-3 should decode the base64 audio from the stubbed ElevenLabs response'
    );
    assert.deepEqual(result.alignment, CANNED_ALIGNMENT);
    assert.equal(stub.getCallCount(), 1, 'ElevenLabs fetched exactly once');
    assert.equal(result.minioUploadStatus, 'uploaded');
    assert.ok(result.minioUrl !== undefined);

    // Tier-3 writes both cache tiers so the next request for the
    // same key hits tier-1 (if same instance) or tier-2 (fresh
    // deploy). Verify both sides landed.
    assert.ok(
      existsSync(path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`)),
      'tier-3 must write to local disk'
    );
    const mp3FromMinio = await client.getObject(`audio/${cacheKey}.mp3`);
    assert.ok(mp3FromMinio !== null, 'tier-3 must upload mp3 to MinIO');
    assert.ok(mp3FromMinio.equals(CANNED_AUDIO_BYTES));

    const alignmentFromMinio = await client.getObject(`audio/${cacheKey}.json`);
    assert.ok(
      alignmentFromMinio !== null,
      'tier-3 must upload alignment JSON to MinIO'
    );
    assert.deepEqual(
      JSON.parse(alignmentFromMinio.toString('utf8')),
      CANNED_ALIGNMENT
    );
  } finally {
    stub.restore();
  }
});

test('three-tier cache: tier-3 with MinIO upload failure still succeeds but reports minioUploadStatus=upload-failed', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  modules._setWebObjectStorageClientForTests(makeFailingMinioClient());
  await clearLocalCache(cacheKey);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'will hit elevenlabs and fail to upload',
    });

    // Synthesis itself succeeded — the caller gets a working
    // buffer so the render still proceeds. The upload side-effect
    // failed, which we surface via minioUploadStatus and log a
    // warning from inside the synth function.
    assert.equal(result.cacheSource, 'api');
    assert.ok(result.audioBuffer.equals(CANNED_AUDIO_BYTES));
    assert.equal(result.minioUploadStatus, 'upload-failed');
    assert.equal(
      result.minioUrl,
      undefined,
      'minioUrl must be undefined when the upload threw'
    );
    assert.equal(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

test('three-tier cache: tier-3 with no MinIO client returns cacheSource=api and no MinIO metadata', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  modules._setWebObjectStorageClientForTests(null);
  await clearLocalCache(cacheKey);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'no minio, no upload',
    });

    assert.equal(result.cacheSource, 'api');
    assert.equal(result.minioUrl, undefined);
    assert.equal(result.minioUploadStatus, undefined);
    assert.equal(stub.getCallCount(), 1);
    // Local disk still gets written — that's the hot cache for the
    // same-instance follow-up request regardless of MinIO state.
    assert.ok(existsSync(path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`)));
  } finally {
    stub.restore();
  }
});

test('three-tier cache: partial MinIO state (mp3 present, alignment missing) falls through to tier 3', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  // Upload only the mp3 — simulate a prior upload that crashed
  // between the two uploadAudio calls. The tier-2 path must treat
  // this as a full miss and fall through to synthesis rather than
  // returning stale/partial data.
  const client = makeRealMinioClient(modules);
  await client.uploadAudio(
    `audio/${cacheKey}.mp3`,
    Buffer.from('partial-mp3-only'),
    'audio/mpeg'
  );
  // Intentionally do NOT upload the alignment.

  await clearLocalCache(cacheKey);
  modules._setWebObjectStorageClientForTests(client);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'partial minio state',
    });

    assert.equal(
      result.cacheSource,
      'api',
      'partial MinIO state must fall through to synthesis'
    );
    assert.equal(stub.getCallCount(), 1, 'ElevenLabs called to repair the cache');
    // After repair, both MinIO slots should have the fresh
    // ElevenLabs bytes (the partial mp3 we uploaded is overwritten).
    const repairedMp3 = await client.getObject(`audio/${cacheKey}.mp3`);
    assert.ok(repairedMp3 !== null);
    assert.ok(repairedMp3.equals(CANNED_AUDIO_BYTES));
  } finally {
    stub.restore();
  }
});

test('three-tier cache: corrupt MinIO alignment JSON falls through to tier 3 and repairs both slots', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  const client = makeRealMinioClient(modules);
  // Valid mp3, but the alignment JSON is deliberately malformed
  // so JSON.parse throws inside the tier-2 read. The synth
  // function must log the corruption and treat the tier as a
  // miss, not crash the request.
  await client.uploadAudio(
    `audio/${cacheKey}.mp3`,
    Buffer.from('corrupt-tier-2-mp3'),
    'audio/mpeg'
  );
  await client.uploadAudio(
    `audio/${cacheKey}.json`,
    Buffer.from('this-is-not-json-{{{'),
    'application/json'
  );

  await clearLocalCache(cacheKey);
  modules._setWebObjectStorageClientForTests(client);
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'corrupt alignment state',
    });

    assert.equal(result.cacheSource, 'api');
    assert.equal(stub.getCallCount(), 1);

    // Repair: tier-3 overwrites both MinIO slots with the fresh
    // canned payload, so the next tier-2 read would succeed.
    const repairedAlignmentBuffer = await client.getObject(
      `audio/${cacheKey}.json`
    );
    assert.ok(repairedAlignmentBuffer !== null);
    assert.deepEqual(
      JSON.parse(repairedAlignmentBuffer.toString('utf8')),
      CANNED_ALIGNMENT
    );
  } finally {
    stub.restore();
  }
});

// ── Guardrail tests: cacheKey validation, fetch timeout, disk fail ──
//
// These three tests cover the defensive fixes added alongside the
// three-tier cache: input validation on cacheKey to prevent path
// traversal, a bounded fetch timeout so a hanging ElevenLabs can't
// tie up a web dyno forever, and graceful degradation when the
// tier-3 local disk write throws (full disk, EISDIR, EACCES) so a
// successful synthesis isn't turned into a 500 by a failed hot
// cache hydration.

test('guardrails: synthesis rejects a cacheKey that does not match /^[a-f0-9]{16}$/', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  modules._setWebObjectStorageClientForTests(null);

  // Every realistic callers produces their key through
  // `buildElevenLabsCacheKey`, which yields 16 lowercase hex.
  // Anything else — uppercase, wrong length, path traversal
  // attempt, empty string — must be rejected at the boundary
  // before any filesystem or MinIO key is composed.
  const badKeys = [
    '', // empty
    '0123456789abcdef0', // 17 chars
    '0123456789abcde', // 15 chars
    '0123456789ABCDEF', // uppercase
    '../etc/passwd', // path traversal
    '0123456789abcdez', // non-hex char
    'audio/0123456789abcdef', // slash
  ];

  for (const bad of badKeys) {
    await assert.rejects(
      async () =>
        modules.synthesizeSpeechWithTimestamps({
          cacheKey: bad,
          text: 'irrelevant — should fail validation first',
        }),
      /Invalid cacheKey/,
      `expected rejection for cacheKey=${JSON.stringify(bad)}`
    );
  }
});

test('guardrails: ElevenLabs fetch timeout throws a clear error instead of hanging', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  // Use a real MinIO client so tier-2 also has to miss — we want
  // the request to reach tier 3 and trigger the timeout.
  modules._setWebObjectStorageClientForTests(makeRealMinioClient(modules));
  await clearLocalCache(cacheKey);

  // Stub fetch so the ElevenLabs URL hangs until the request's
  // AbortSignal fires. We honour the abort signal properly so
  // the AbortSignal.timeout inside the synth function can cancel
  // the in-flight request cleanly — otherwise the test would
  // hang instead of asserting the timeout.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    if (url.includes(ELEVENLABS_URL_FRAGMENT)) {
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const err = new Error('The operation was aborted.');
            err.name = signal.reason?.name ?? 'AbortError';
            reject(err);
            return;
          }
          signal.addEventListener(
            'abort',
            () => {
              const err = new Error('The operation was aborted.');
              err.name = signal.reason?.name ?? 'AbortError';
              reject(err);
            },
            { once: true }
          );
        }
        // Never resolve — force the timeout path.
      });
    }
    return originalFetch(input, init);
  };

  try {
    await assert.rejects(
      async () =>
        modules.synthesizeSpeechWithTimestamps({
          cacheKey,
          text: 'will time out',
          requestTimeoutMs: 50,
        }),
      /timed out after 50ms/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('guardrails: tier-3 local disk write failure does not break synthesis', async (t) => {
  if (!MINIO_OK) { t.skip('MinIO not reachable — run docker compose up -d minio'); return; }
  const modules = await loadModules();
  const cacheKey = registerCacheKey(uniqueCacheKey());

  // Force a deterministic EISDIR on the local disk write by
  // creating a DIRECTORY at the exact path the synth function
  // would otherwise write the mp3 file to. `writeFile` against
  // a directory throws EISDIR, which the tier-3 try/catch must
  // swallow so the synthesis still returns a working buffer.
  await mkdir(LOCAL_CACHE_DIR, { recursive: true });
  const blockingDir = path.join(LOCAL_CACHE_DIR, `${cacheKey}.mp3`);
  await mkdir(blockingDir, { recursive: true });

  modules._setWebObjectStorageClientForTests(makeRealMinioClient(modules));
  const stub = stubElevenLabsFetch();

  try {
    const result = await modules.synthesizeSpeechWithTimestamps({
      cacheKey,
      text: 'disk failure should not propagate',
    });

    // Synthesis still succeeded: the caller got the decoded
    // buffer and the MinIO upload happened, even though the
    // local disk write raised EISDIR under the hood.
    assert.equal(result.cacheSource, 'api');
    assert.ok(result.audioBuffer.equals(CANNED_AUDIO_BYTES));
    assert.equal(stub.getCallCount(), 1);
    assert.equal(result.minioUploadStatus, 'uploaded');
    assert.ok(result.minioUrl !== undefined);
  } finally {
    stub.restore();
    // Best-effort cleanup: remove the blocking directory so the
    // local .cache/ doesn't accumulate orphan directories from
    // repeated test runs.
    await rm(blockingDir, { recursive: true, force: true }).catch(
      () => undefined
    );
  }
});
