import {
  createObjectStorageClient,
  type ObjectStorageClient,
} from '@launchkit/asset-generators';
import { composeMinioEndpoint } from '@launchkit/shared';
import { env } from '../env.js';

/**
 * Module-level lazy singleton MinIO client for the web service.
 *
 * The web service writes to MinIO from inside the three-tier
 * narration cache (`apps/web/src/lib/elevenlabs.ts`): tier 3
 * uploads the freshly-synthesized ElevenLabs MP3 + alignment
 * JSON to `audio/<cacheKey>.mp3` and `audio/<cacheKey>.json`,
 * where `<cacheKey>` is the 16-char SHA-1 slice produced by
 * `buildElevenLabsCacheKey`. The route then passes a MinIO URL
 * (instead of a 3-5 MB inline data URI) to the workflow task as
 * the `audioSrc` Remotion prop. The alternative — embedding the
 * audio as a `data:` URI in the task payload — was slow to
 * serialize, slow to transmit, and uncomfortably close to
 * whatever payload cap the SDK happens to enforce this week.
 *
 * Constructing the S3 client is cheap but not free (it builds an
 * HTTPS agent, resolves credentials, computes request signers), so
 * we memoize one instance per process. First call reads the
 * typed env module, composes the endpoint URL via the shared
 * `composeMinioEndpoint` helper (which branches on local vs
 * render-hosted host shape), and instantiates.
 *
 * Returns `null` when required env fields are missing so callers
 * can branch to a fallback path at the use site. The narrated-video
 * handler uses this to fall back to the legacy data-URI path when
 * running locally without a MinIO container — same degraded-but-
 * working behavior the rest of the web service's optional-dep
 * paths follow.
 */
let instance: ObjectStorageClient | null = null;
let instanceConfigured = false;

export function getWebObjectStorageClient(): ObjectStorageClient | null {
  if (instanceConfigured) return instance;

  const endpoint = composeMinioEndpoint(env.MINIO_ENDPOINT_HOST);
  if (
    endpoint === null ||
    env.MINIO_ROOT_USER === undefined ||
    env.MINIO_ROOT_PASSWORD === undefined
  ) {
    instanceConfigured = true;
    instance = null;
    return null;
  }

  // Render services resolve each other's `.onrender.com` hostname to
  // an internal IP. MinIO listens on its PORT (9000), not 443, so
  // HTTPS connections to the internal IP get ECONNREFUSED. Use HTTP
  // on port 9000 for S3 API calls and keep the HTTPS URL for
  // browser-facing 302 redirects.
  const host = env.MINIO_ENDPOINT_HOST ?? '';
  const isRenderHosted =
    host.endsWith('.onrender.com') && !host.includes(':');
  const s3Endpoint = isRenderHosted
    ? `http://${host}:9000`
    : endpoint;

  instance = createObjectStorageClient({
    endpoint: s3Endpoint,
    bucket: env.MINIO_BUCKET,
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
    publicUrl: endpoint,
  });
  instanceConfigured = true;
  return instance;
}

/**
 * Test-only seam. Reset the cached singleton so a subsequent call
 * to `getWebObjectStorageClient` reads env again and either
 * rebuilds or returns null. Pass a fake to install a stub client
 * directly without touching env.
 */
export function _setWebObjectStorageClientForTests(
  fake: ObjectStorageClient | null,
  configured = true
): void {
  instance = fake;
  instanceConfigured = configured;
}
