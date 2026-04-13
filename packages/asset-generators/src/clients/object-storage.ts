import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  GetObjectCommand,
  NoSuchBucket,
  NoSuchKey,
  PutBucketPolicyCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

/**
 * S3-compatible object storage client for rendered video bytes.
 *
 * This exists to abstract the AWS SDK boilerplate behind a tiny
 * factory surface that mirrors the `createFalMediaClient`,
 * `createElevenLabsClient`, and `createWorldLabsClient` pattern in
 * the rest of this package: the consumer app (`apps/workflows/` or
 * `apps/web/`) builds one at startup from its typed env module and
 * passes it to whatever code needs to upload or resolve URLs.
 *
 * MinIO is the only target today, so the factory defaults match
 * MinIO's constraints:
 *
 * - `forcePathStyle: true` — MinIO does not serve virtual-host-style
 *   `<bucket>.<host>` URLs, only `<host>/<bucket>/<key>`. Leaving
 *   this off produces `NoSuchBucket` on every request.
 * - `region: 'us-east-1'` — MinIO ignores the region but the AWS SDK
 *   insists on a non-empty one, and `us-east-1` is the canonical
 *   "please do nothing region-related" value.
 *
 * Pointing this at real AWS S3 or Cloudflare R2 is a config swap,
 * not a rewrite. Drop `forcePathStyle`, set the right region, pass
 * the vendor's endpoint + credentials, and every call site keeps
 * working. See ADR-002 for the full rationale for choosing MinIO
 * as the MVP target.
 */

export interface ObjectStorageConfig {
  /**
   * Base URL of the S3 endpoint, including scheme and (optional)
   * port. For MinIO on Render this is the public hostname of the
   * `launchkit-minio` service wrapped in `https://...` — the
   * typed env module in `apps/workflows/src/env.ts` composes it from
   * `MINIO_ENDPOINT_HOST`. Example:
   * `https://launchkit-minio-xyz.onrender.com`.
   */
  endpoint: string;

  /** Bucket name the client operates against. */
  bucket: string;

  /** MinIO root user / access key. */
  accessKeyId: string;

  /** MinIO root password / secret key. */
  secretAccessKey: string;

  /**
   * Public base URL used to compose 302 redirect targets for
   * already-uploaded objects. When omitted, defaults to `endpoint`.
   * Split so a future CDN in front of MinIO can serve a different
   * hostname from the S3 write endpoint without breaking uploads.
   */
  publicUrl?: string;
}

export interface UploadResult {
  /** Storage key (path-like identifier inside the bucket). */
  key: string;
  /** Public URL clients can GET the uploaded object from. */
  url: string;
  /** Byte size of the uploaded payload. */
  sizeBytes: number;
}

/**
 * @deprecated Use `UploadResult` instead. Retained as a named
 * re-export for backward compatibility with existing call sites.
 */
export type UploadVideoResult = UploadResult;

export interface ObjectStorageClient {
  /**
   * Upload an MP4 video buffer to the given `key` in the bucket and
   * return the key + public URL. Creates the bucket on first call
   * if it does not exist (idempotent via `HeadBucket` check).
   */
  uploadVideo(
    key: string,
    bytes: Buffer,
    contentType?: string
  ): Promise<UploadResult>;

  /**
   * Upload an audio buffer (default content-type `audio/mpeg`) to
   * the given `key` in the bucket. Used by the web service's
   * narrated-video handler to hoist the ElevenLabs MP3 out of the
   * Remotion task payload and pass a MinIO URL through `audioSrc`
   * instead of a multi-MB inline data URI. Same happy-path semantics
   * as `uploadVideo`: idempotent bucket creation, public-read ACL,
   * returns key + URL + size.
   */
  uploadAudio(
    key: string,
    bytes: Buffer,
    contentType?: string
  ): Promise<UploadResult>;

  /**
   * Download an object by key. Returns the raw bytes as a Buffer, or
   * `null` when the object does not exist (whether because the key is
   * absent or the bucket itself has not been created yet). Any other
   * S3 error — permissions, network, malformed response — propagates
   * to the caller unchanged.
   *
   * Used by the web service's narrated-video handler as the "warm"
   * cache tier between a local-disk hot cache (lost on every deploy)
   * and the ElevenLabs TTS API (the expensive cold path). The three
   * failure modes that count as "miss" are folded into a single
   * `null` return so the caller's tier-fallthrough branches stay
   * boring: any null → fall through to synthesis, anything else →
   * throw.
   *
   * Deliberately does NOT call `ensureBucket` — GETs should fail fast
   * on a missing bucket and be classified as a miss by the caller. A
   * `HeadBucket` check on every cache lookup would defeat the whole
   * "warm-tier latency" story this tier is supposed to deliver. The
   * write path (`uploadVideo`/`uploadAudio`) handles bucket creation
   * on the other side.
   */
  getObject(key: string): Promise<Buffer | null>;

  /**
   * Resolve a storage key to its public URL without hitting the
   * upstream. Pure string composition — safe to call in hot paths.
   */
  getPublicUrl(key: string): string;

  /**
   * Ensure the bucket exists and has the public-read policy applied.
   * Idempotent and cached per process. Call at service startup so
   * the first user request doesn't pay the latency.
   */
  warmup(): Promise<void>;
}

/**
 * Construct an S3-compatible client and return the tiny
 * upload/resolve surface. The underlying `S3Client` is lazily
 * shared across calls to `uploadVideo`; bucket existence is
 * checked once and cached in a module-scoped `ensuredBuckets` set
 * so repeated uploads in the same process don't re-issue the
 * `HeadBucket` check on every call.
 */
export function createObjectStorageClient(
  config: ObjectStorageConfig
): ObjectStorageClient {
  const publicUrl = (config.publicUrl ?? config.endpoint).replace(/\/$/, '');
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: 'us-east-1',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });

  const ensuredBuckets = new Set<string>();

  // MinIO ignores per-object ACLs (`public-read` on PutObject) under
  // the default bucket-ownership-enforced mode. A bucket-level policy
  // grants anonymous GetObject so the web service's 302 redirect to
  // the public URL actually works. Applied once per process on the
  // first upload, whether the bucket already existed or was just
  // created — idempotent on the MinIO side.
  const publicReadPolicy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Principal: { AWS: ['*'] },
        Action: ['s3:GetObject'],
        Resource: [`arn:aws:s3:::${config.bucket}/*`],
      },
    ],
  });

  async function ensureBucket(): Promise<void> {
    if (ensuredBuckets.has(config.bucket)) return;
    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (err: unknown) {
      // Distinguish "bucket doesn't exist yet" (→ CreateBucket) from
      // "everything else" (→ re-throw with the original cause). AWS
      // SDK surfaces the former as `NoSuchBucket` or `NotFound` with
      // `$metadata.httpStatusCode === 404`; 403 permission errors
      // also surface with `name === 'NotFound'` on some S3-compatible
      // implementations (including older MinIO builds), so the
      // name check alone is too broad and would silently fall
      // through to a `CreateBucket` call that also fails with a
      // different error — obscuring the real "your IAM credentials
      // are wrong" root cause.
      //
      // The check below is a positive allowlist: NoSuchBucket class,
      // or `NotFound` WITH an explicit 404 status. Anything else
      // (403, 5xx, network errors, malformed responses) re-throws
      // unchanged so the real error reaches the caller.
      const isBucketMissing =
        err instanceof NoSuchBucket ||
        (err !== null &&
          typeof err === 'object' &&
          'name' in err &&
          err.name === 'NoSuchBucket') ||
        (err !== null &&
          typeof err === 'object' &&
          'name' in err &&
          err.name === 'NotFound' &&
          '$metadata' in err &&
          typeof err.$metadata === 'object' &&
          err.$metadata !== null &&
          'httpStatusCode' in err.$metadata &&
          err.$metadata.httpStatusCode === 404);
      if (!isBucketMissing) throw err;

      await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }

    await s3.send(
      new PutBucketPolicyCommand({
        Bucket: config.bucket,
        Policy: publicReadPolicy,
      })
    );
    ensuredBuckets.add(config.bucket);
  }

  function getPublicUrl(key: string): string {
    const safeKey = key.replace(/^\//, '');
    return `${publicUrl}/${config.bucket}/${safeKey}`;
  }

  async function uploadWithContentType(
    key: string,
    bytes: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    await ensureBucket();

    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType,
        // `public-read` ACL means the web service can 302-redirect
        // browsers directly to the object URL without signing. The
        // rendered video (and the narrated audio it references) is
        // the user-facing output, not private data — no signing
        // needed. A future private-bucket mode would swap this for
        // a `getSignedUrl` call at read time.
        ACL: 'public-read',
      })
    );

    return {
      key,
      url: getPublicUrl(key),
      sizeBytes: bytes.byteLength,
    };
  }

  async function uploadVideo(
    key: string,
    bytes: Buffer,
    contentType = 'video/mp4'
  ): Promise<UploadResult> {
    return uploadWithContentType(key, bytes, contentType);
  }

  async function uploadAudio(
    key: string,
    bytes: Buffer,
    contentType = 'audio/mpeg'
  ): Promise<UploadResult> {
    return uploadWithContentType(key, bytes, contentType);
  }

  async function getObject(key: string): Promise<Buffer | null> {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: config.bucket,
          Key: key,
        })
      );

      if (response.Body === undefined) {
        // S3 spec requires a body on a successful GET. If we ever see
        // a success without one we'd rather treat it as a miss and
        // let the caller re-fetch than silently return an empty
        // Buffer that corrupts downstream decoders.
        return null;
      }

      // `transformToByteArray` drains the entire stream into a single
      // Uint8Array in one awaited call. For the objects this client
      // reads (MP3 up to ~5 MB, small JSON alignment files) the
      // memory cost is a rounding error and avoids the footguns of
      // manual stream concatenation. `Buffer.from(Uint8Array)` is a
      // zero-copy view when the underlying ArrayBuffer is already
      // page-aligned, which is the case for the AWS SDK's response.
      const bytes = await response.Body.transformToByteArray();
      return Buffer.from(bytes);
    } catch (err: unknown) {
      // Two flavors of "miss" both fold into `null`:
      //
      // 1. `NoSuchKey` — object doesn't exist under an existing bucket.
      //    This is the steady-state cache-miss path; every cold lookup
      //    on a content-addressable key that hasn't been written yet
      //    ends up here.
      //
      // 2. `NoSuchBucket` — the bucket itself doesn't exist. This
      //    happens exactly once per fresh deploy, before the first
      //    successful write has called `ensureBucket`. If we
      //    re-threw here, the first narrated-video request on a
      //    brand-new MinIO instance would 500 instead of degrading
      //    to a synthesize-and-upload path. That's a bad cold-start
      //    story for no benefit — the subsequent write creates the
      //    bucket and every later read finds it.
      //
      // Anything else (auth failures, connection errors, 5xx) means
      // something is actually broken and the caller deserves to see
      // it, so we re-throw.
      const isMissing =
        err instanceof NoSuchKey ||
        err instanceof NoSuchBucket ||
        (err !== null &&
          typeof err === 'object' &&
          'name' in err &&
          (err.name === 'NoSuchKey' || err.name === 'NoSuchBucket'));
      if (isMissing) return null;
      throw err;
    }
  }

  return {
    uploadVideo,
    uploadAudio,
    getObject,
    getPublicUrl,
    warmup: ensureBucket,
  };
}
