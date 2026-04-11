import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  NoSuchBucket,
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
   * Resolve a storage key to its public URL without hitting the
   * upstream. Pure string composition — safe to call in hot paths.
   */
  getPublicUrl(key: string): string;
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

  async function ensureBucket(): Promise<void> {
    if (ensuredBuckets.has(config.bucket)) return;
    try {
      await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
      ensuredBuckets.add(config.bucket);
      return;
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
    }

    await s3.send(new CreateBucketCommand({ Bucket: config.bucket }));
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

  return {
    uploadVideo,
    uploadAudio,
    getPublicUrl,
  };
}
