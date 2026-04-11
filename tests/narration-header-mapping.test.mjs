// Unit tests for `mapNarrationToHeaderValue` in
// `apps/web/src/lib/narration.ts`.
//
// The function is the state machine behind the
// `X-Narration-Audio-Src` response header. It takes the
// synthesis result's tri-state — `cacheSource`, optional
// `minioUrl`, optional `minioUploadStatus` — and returns the
// flat header string a dashboard operator reads to diagnose
// "is the durable cache actually working?"
//
// These tests enumerate every legitimate
// `(cacheSource × minioUrl × uploadStatus)` triple that the
// synthesis function in `elevenlabs.ts` can actually produce,
// plus one defensive edge case (tier-2 hit whose minioUrl was
// inexplicably dropped — the function must still return
// `'minio-read-hit'` because the source tier takes priority
// over URL presence).
//
// Covered combinations (6 legitimate + 2 defensive):
//
//   cacheSource  minioUrl       uploadStatus   →  header
//   -----------  -------------  -------------  -  ----------------
//   'local'      set            undefined      →  'minio'
//   'local'      undefined      undefined      →  'data-uri'
//   'minio'      set            undefined      →  'minio-read-hit'
//   'minio'      undefined      undefined      →  'minio-read-hit' (defensive)
//   'api'        set            'uploaded'     →  'minio'
//   'api'        undefined      'upload-failed'→  'minio-failed'
//   'api'        undefined      undefined      →  'data-uri'
//   'api'        set            undefined      →  'minio' (defensive)
//
// Plus one table-driven parameterized test that locks in the
// exact mapping as a single assertion block. If anyone changes
// the decision order inside the helper without updating this
// test, the parameterized case will fail loud with a clear
// diff.

import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

const SAMPLE_MINIO_URL =
  'http://localhost:9000/launchkit-renders/audio/abcdef0123456789.mp3';

async function loadMapper() {
  const mod = await import('../apps/web/dist/lib/narration.js');
  return mod.mapNarrationToHeaderValue;
}

test('header mapping: tier-1 hit with MinIO configured → "minio"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'local',
    minioUrl: SAMPLE_MINIO_URL,
  });
  assert.equal(header, 'minio');
});

test('header mapping: tier-1 hit with MinIO NOT configured → "data-uri"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'local',
    // no minioUrl
  });
  assert.equal(header, 'data-uri');
});

test('header mapping: tier-2 hit (cacheSource=minio) → "minio-read-hit"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'minio',
    minioUrl: SAMPLE_MINIO_URL,
  });
  assert.equal(header, 'minio-read-hit');
});

test('header mapping: tier-2 hit without minioUrl → "minio-read-hit" (cacheSource wins over URL presence)', async () => {
  // This is the defensive case: the synth function should never
  // return cacheSource='minio' without also populating minioUrl
  // (because tier-2 composes the URL from getPublicUrl on the
  // same client that served the read), but if a future refactor
  // breaks that invariant the header should still reflect the
  // cache-source truth. A tier-2 hit is "the fix is working"
  // signal — we don't want a silent regression to downgrade it
  // to 'data-uri' just because someone accidentally dropped the
  // URL population.
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'minio',
    // no minioUrl (hypothetical future regression)
  });
  assert.equal(header, 'minio-read-hit');
});

test('header mapping: tier-3 cold synth with successful MinIO upload → "minio"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'api',
    minioUrl: SAMPLE_MINIO_URL,
    minioUploadStatus: 'uploaded',
  });
  assert.equal(header, 'minio');
});

test('header mapping: tier-3 cold synth with failed MinIO upload → "minio-failed"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'api',
    // no minioUrl — upload failed so nothing to compose a URL for
    minioUploadStatus: 'upload-failed',
  });
  assert.equal(header, 'minio-failed');
});

test('header mapping: tier-3 cold synth with no MinIO client → "data-uri"', async () => {
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'api',
    // no minioUrl, no minioUploadStatus
  });
  assert.equal(header, 'data-uri');
});

test('header mapping: tier-3 with minioUrl set but no uploadStatus → "minio" (URL presence wins)', async () => {
  // Another defensive case: if a future refactor populates
  // minioUrl from a tier-3 path without setting minioUploadStatus,
  // the URL takes precedence over the missing status field. We
  // don't want an in-flight refactor to silently downgrade to
  // 'data-uri' just because one field got wired before the other.
  const mapNarrationToHeaderValue = await loadMapper();
  const header = mapNarrationToHeaderValue({
    cacheSource: 'api',
    minioUrl: SAMPLE_MINIO_URL,
    // no minioUploadStatus
  });
  assert.equal(header, 'minio');
});

// ── Full parameterized lock-in ─────────────────────────────────
//
// A single table-driven test whose failure message shows the
// entire mapping matrix. If any branch's expected output changes
// without intent, this is the test that should fail first and
// make the diff obvious.

test('header mapping: parameterized matrix lock-in', async () => {
  const mapNarrationToHeaderValue = await loadMapper();

  /** @type {Array<{label: string, input: object, expected: string}>} */
  const cases = [
    {
      label: 'tier-1 + MinIO configured',
      input: { cacheSource: 'local', minioUrl: SAMPLE_MINIO_URL },
      expected: 'minio',
    },
    {
      label: 'tier-1 + MinIO not configured',
      input: { cacheSource: 'local' },
      expected: 'data-uri',
    },
    {
      label: 'tier-2 (durable cache hit)',
      input: { cacheSource: 'minio', minioUrl: SAMPLE_MINIO_URL },
      expected: 'minio-read-hit',
    },
    {
      label: 'tier-2 defensive (no URL)',
      input: { cacheSource: 'minio' },
      expected: 'minio-read-hit',
    },
    {
      label: 'tier-3 + upload success',
      input: {
        cacheSource: 'api',
        minioUrl: SAMPLE_MINIO_URL,
        minioUploadStatus: 'uploaded',
      },
      expected: 'minio',
    },
    {
      label: 'tier-3 + upload failure',
      input: { cacheSource: 'api', minioUploadStatus: 'upload-failed' },
      expected: 'minio-failed',
    },
    {
      label: 'tier-3 + no MinIO',
      input: { cacheSource: 'api' },
      expected: 'data-uri',
    },
    {
      label: 'tier-3 defensive (URL set, no status)',
      input: { cacheSource: 'api', minioUrl: SAMPLE_MINIO_URL },
      expected: 'minio',
    },
  ];

  const failures = [];
  for (const { label, input, expected } of cases) {
    const actual = mapNarrationToHeaderValue(input);
    if (actual !== expected) {
      failures.push(
        `  [${label}] expected ${expected}, got ${actual} (input: ${JSON.stringify(input)})`
      );
    }
  }

  assert.equal(
    failures.length,
    0,
    `mapNarrationToHeaderValue matrix mismatch:\n${failures.join('\n')}`
  );
});
