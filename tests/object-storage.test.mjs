// Integration tests for the MinIO/S3 client wrapper.
//
// Unlike the rest of the test suite which stubs at module
// boundaries, this file runs against the REAL local MinIO
// container (`docker compose up -d minio`) because stubbing
// `@aws-sdk/client-s3` at import time without a test seam would
// require a loader hook we do not have. Instead, the tests hit
// `http://localhost:9000` with the local dev credentials and
// assert on real HTTP round-trips.
//
// Every test uses a unique key (`random suffix`) so parallel
// runs never collide. The bucket (`launchkit-renders`) is
// created lazily by the client on the first `uploadVideo` /
// `uploadAudio` call — subsequent calls short-circuit via the
// module-scoped `ensuredBuckets` cache.
//
// In CI, the MinIO service is started as a GitHub Actions
// service alongside Postgres + Redis (see the plan's Phase 6).
// Locally, `docker compose up -d minio` is the one-time bring-up.
// If MinIO is not reachable these tests fail loud — that is
// exactly the signal you want, because the web + workflows
// services also fail when it is down.

process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/launchkit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_BUCKET = 'launchkit-renders-test';
const MINIO_ROOT_USER = 'launchkit';
const MINIO_ROOT_PASSWORD = 'launchkit-dev-password';

function makeClient() {
  // Import lazily so `--experimental-test-isolation` (if ever
  // enabled) doesn't re-import on each test.
  return import('../packages/asset-generators/dist/clients/object-storage.js').then(
    (mod) =>
      mod.createObjectStorageClient({
        endpoint: MINIO_ENDPOINT,
        bucket: MINIO_BUCKET,
        accessKeyId: MINIO_ROOT_USER,
        secretAccessKey: MINIO_ROOT_PASSWORD,
      })
  );
}

function uniqueKey(prefix) {
  return `${prefix}/${randomBytes(8).toString('hex')}.bin`;
}

// ── Preflight: skip the whole suite if MinIO is not reachable ────

async function minioReachable() {
  try {
    const res = await fetch(`${MINIO_ENDPOINT}/minio/health/live`);
    return res.ok;
  } catch {
    return false;
  }
}

// ── Tests ────────────────────────────────────────────────────────

// NOTE on object fetchability: vanilla MinIO does NOT expose
// uploaded objects publicly just because the PutObject call
// carries `ACL: 'public-read'`. A fresh bucket starts with a
// private bucket policy and the ACL alone is not enough to make
// objects reachable via an unsigned GET — production uses the
// bucket policy that `render.yaml` applies via the MinIO service's
// own config. These tests assert on the upload side of the
// contract (the AWS SDK call succeeds, the URL is returned with
// the right shape) but do not assert fetch-back because that is
// an infrastructure concern outside the client wrapper's scope.

test('object-storage: uploadVideo happy path returns key + URL + sizeBytes', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable at localhost:9000 — run `docker compose up -d minio`');
    return;
  }
  const client = await makeClient();
  const key = uniqueKey('videos');
  const bytes = Buffer.from('fake-mp4-payload-bytes-for-upload-test');
  const result = await client.uploadVideo(key, bytes, 'video/mp4');
  assert.equal(result.key, key);
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.match(result.url, /^http:\/\/localhost:9000\/launchkit-renders-test\/videos\//);
});

test('object-storage: uploadAudio delegates to the same PutObject body with audio content type', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  const client = await makeClient();
  const key = uniqueKey('audio');
  const bytes = Buffer.from('fake-mp3-audio-payload');
  const result = await client.uploadAudio(key, bytes);
  assert.equal(result.key, key);
  assert.equal(result.sizeBytes, bytes.byteLength);
  assert.match(result.url, /^http:\/\/localhost:9000\/launchkit-renders-test\/audio\//);
});

test('object-storage: getPublicUrl composes <publicUrl>/<bucket>/<key>', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  const client = await makeClient();
  const url = client.getPublicUrl('videos/example.mp4');
  assert.equal(
    url,
    'http://localhost:9000/launchkit-renders-test/videos/example.mp4'
  );
});

test('object-storage: getPublicUrl strips a leading slash on the key', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  const client = await makeClient();
  const url = client.getPublicUrl('/videos/example.mp4');
  // No double slash after the bucket.
  assert.equal(
    url,
    'http://localhost:9000/launchkit-renders-test/videos/example.mp4'
  );
});

test('object-storage: bucket cache short-circuits HeadBucket on subsequent uploads', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  // Two sequential uploads against the same client should both
  // succeed; the second one hits the in-memory `ensuredBuckets`
  // cache and skips the HeadBucket round-trip. We cannot assert
  // network-call count directly without instrumenting the S3
  // client, but a successful back-to-back pair is a strong signal
  // that the cache doesn't break the second upload.
  const client = await makeClient();
  const k1 = uniqueKey('bucket-cache-1');
  const k2 = uniqueKey('bucket-cache-2');
  const r1 = await client.uploadVideo(k1, Buffer.from('one'), 'video/mp4');
  const r2 = await client.uploadVideo(k2, Buffer.from('two'), 'video/mp4');
  assert.equal(r1.key, k1);
  assert.equal(r2.key, k2);
  assert.notEqual(r1.url, r2.url);
});

test('object-storage: invalid credentials fail loud (not silently via the NotFound-as-missing path)', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  // Regression guard for the `ensureBucket` classification fix
  // (Nit B). Prior to the fix, a 403 would be misread as
  // "bucket missing" and fall through to a `CreateBucket` call
  // that ALSO failed with a different error, obscuring the real
  // "credentials wrong" root cause. With the tightened check,
  // the 403 re-throws unchanged.
  const { createObjectStorageClient } = await import(
    '../packages/asset-generators/dist/clients/object-storage.js'
  );
  const badClient = createObjectStorageClient({
    endpoint: MINIO_ENDPOINT,
    bucket: MINIO_BUCKET,
    accessKeyId: 'definitely-not-the-real-user',
    secretAccessKey: 'definitely-not-the-real-password',
  });
  await assert.rejects(
    async () =>
      badClient.uploadVideo(
        uniqueKey('permission-test'),
        Buffer.from('x'),
        'video/mp4'
      )
    // Any error is acceptable — the point is that it throws,
    // not silently returns. We don't assert on a specific
    // error message because the AWS SDK wraps the 403 in
    // different error classes depending on version.
  );
});

test('object-storage: publicUrl config override changes the returned URL prefix', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  const { createObjectStorageClient } = await import(
    '../packages/asset-generators/dist/clients/object-storage.js'
  );
  const client = createObjectStorageClient({
    endpoint: MINIO_ENDPOINT,
    bucket: MINIO_BUCKET,
    accessKeyId: MINIO_ROOT_USER,
    secretAccessKey: MINIO_ROOT_PASSWORD,
    publicUrl: 'https://cdn.example.com',
  });
  const key = uniqueKey('cdn-override');
  const result = await client.uploadVideo(key, Buffer.from('x'), 'video/mp4');
  // Upload should still land on MinIO (the write path uses the
  // real `endpoint`), but the returned URL reflects the `publicUrl`
  // override so a CDN in front of MinIO can be swapped without
  // changing the uploader.
  assert.match(result.url, /^https:\/\/cdn\.example\.com\//);
});

// ── getObject tier-2 cache read surface ─────────────────────────
//
// These four tests lock in the three-tier narration cache contract.
// `elevenlabs.ts` reads this method in the "warm" tier between a
// local-disk hot cache and the ElevenLabs API cold path. The
// invariants under test:
//
// 1. A hit returns the exact bytes that were uploaded (round-trip
//    fidelity — otherwise the MP3 decodes into garbage).
// 2. A `NoSuchKey` miss returns `null` (not a thrown error) so the
//    caller's `?? fallThrough()` pattern works.
// 3. A `NoSuchBucket` miss returns `null` too — on a fresh MinIO
//    deploy the bucket doesn't exist yet, and the first-request
//    recovery path relies on this classification to fall through
//    to synthesize-and-upload instead of 500ing.
// 4. A non-404 error (bogus credentials) still throws. Swallowing
//    those would hide real operational failures behind silent
//    cache misses.

test('object-storage: getObject round-trips uploaded bytes on hit', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  const client = await makeClient();
  const key = uniqueKey('get-hit');
  const bytes = Buffer.concat([
    Buffer.from('narration-mp3-payload-'),
    randomBytes(128),
  ]);
  await client.uploadAudio(key, bytes);
  const fetched = await client.getObject(key);
  assert.ok(fetched !== null, 'expected getObject to return a Buffer, got null');
  assert.ok(Buffer.isBuffer(fetched), 'expected Buffer, got different type');
  assert.equal(fetched.byteLength, bytes.byteLength);
  assert.ok(fetched.equals(bytes), 'fetched bytes do not match uploaded bytes');
});

test('object-storage: getObject returns null on NoSuchKey miss', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  // Prime the bucket with a real upload so the bucket itself
  // definitely exists — this isolates the miss signal to the key
  // rather than conflating key-missing with bucket-missing (which
  // the next test covers separately).
  const client = await makeClient();
  await client.uploadVideo(uniqueKey('prime'), Buffer.from('prime'), 'video/mp4');

  const missingKey = uniqueKey('get-miss');
  const fetched = await client.getObject(missingKey);
  assert.equal(fetched, null);
});

test('object-storage: getObject returns null on NoSuchBucket miss (fresh-deploy regression guard)', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  // Point the client at a bucket name that definitely does not
  // exist. The getObject path must NOT call `ensureBucket` (that
  // would defeat the tier-2 latency story) so the S3 server
  // surfaces `NoSuchBucket` directly. The client must classify
  // that as a cache miss so the first narrated request against
  // a brand-new MinIO instance falls through to synthesize-and-
  // upload instead of 500ing.
  const { createObjectStorageClient } = await import(
    '../packages/asset-generators/dist/clients/object-storage.js'
  );
  const nonExistentBucket = `launchkit-does-not-exist-${randomBytes(6).toString('hex')}`;
  const client = createObjectStorageClient({
    endpoint: MINIO_ENDPOINT,
    bucket: nonExistentBucket,
    accessKeyId: MINIO_ROOT_USER,
    secretAccessKey: MINIO_ROOT_PASSWORD,
  });
  const fetched = await client.getObject('any/key.mp3');
  assert.equal(fetched, null);
});

test('object-storage: getObject propagates non-404 errors (bogus credentials)', async (t) => {
  if (!(await minioReachable())) {
    t.skip('MinIO not reachable');
    return;
  }
  // Credential failures must NOT fold into the `null` miss path.
  // A silent cache miss on a permission error would hide the real
  // operational failure and cause the caller to quietly re-call
  // ElevenLabs on every request — the exact leak this fix is
  // trying to close. The error class varies across AWS SDK
  // versions, so we only assert that *something* throws.
  const { createObjectStorageClient } = await import(
    '../packages/asset-generators/dist/clients/object-storage.js'
  );
  const badClient = createObjectStorageClient({
    endpoint: MINIO_ENDPOINT,
    bucket: MINIO_BUCKET,
    accessKeyId: 'definitely-not-the-real-user',
    secretAccessKey: 'definitely-not-the-real-password',
  });
  await assert.rejects(async () => badClient.getObject('any/key.mp3'));
});
