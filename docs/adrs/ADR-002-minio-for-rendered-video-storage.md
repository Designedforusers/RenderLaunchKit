# ADR-002: MinIO on Render for rendered video storage

**Status:** Accepted
**Date:** 2026-04-10
**Deciders:** @designforusers

## Context

Remotion renders produce 5 MB to 50 MB MP4 files per asset, and the current
pipeline has no durable home for those bytes. Today the web service's
`renderRemotionComposition` helper in `apps/web/src/lib/remotion-render.ts`
writes finished renders to `REMOTION_CACHE_DIR` — a hard-coded
`.cache/remotion-renders` directory anchored to the monorepo root via
`import.meta.url`. The `/api/assets/:id/video.mp4` route in
`apps/web/src/routes/asset-api-routes.ts:111` then streams the file back to
the client through the `fileToWebStream` helper, buffering the bytes through
the web dyno's Node process on every request.

That layout was a reasonable MVP choice when rendering and serving lived on
the same dyno, but it has three structural problems that get worse the
moment any of the three pressures below show up in production:

1. **The cache is dyno-local.** Render web services scale horizontally. Dyno
   A rendering a video does nothing for dyno B serving the next request for
   the same asset — B re-renders the whole thing, wasting 30-60 seconds of
   wall clock and a few cents of CPU. The in-process `renderJobs` dedup map
   at `remotion-render.ts:69` only covers the single-process case.
2. **The cache dies on every deploy.** Render's dyno filesystem is
   ephemeral. Every push to `main` wipes `.cache/remotion-renders` across
   every web dyno, so the first request after a deploy pays the full render
   cost even for a video that rendered five minutes before the deploy.
3. **Byte-streaming chews the web dyno's budget.** The `fileToWebStream`
   path keeps memory bounded per request, but the dyno still holds the
   socket for the full download, the file handle for the full read, and any
   OS page cache the kernel decides to allocate. On a 512 MB starter plan
   with two concurrent 100 MB downloads, the web process competes with its
   own JIT for headroom — comment at `asset-api-routes.ts:213-220` already
   flags this as the motivation for streaming instead of buffering.

The problem doubles once Remotion rendering migrates off the web service
and onto the Workflows service per the `CLAUDE.md` § "Workflows service"
architecture. The renderer and the serving surface are no longer the same
process, which means even the dyno-local cache hit case stops working: the
workflows dyno writes the bytes, the web dyno can't see them, and there's
no shared filesystem to bridge them. The web service either has to
re-download the bytes from the workflows service over HTTP on every
request (doubling the internal bandwidth cost) or both services have to
agree on an object store that sits between them.

We need a persistent, URL-addressable video store that survives dyno
restarts and deploys, is readable by both the workflows and web services,
and does not force the web dyno to hold the full payload in memory or
socket state while a client downloads it.

## Decision

Deploy MinIO as a Render-native Docker service using the `minio/minio:latest`
image with a 10 GB Render SSD Disk mounted at `/data`, exposing the
S3-compatible API on port 9000 and the admin console on port 9001. The
service config follows Render's official `render-examples/minio` Blueprint
(https://github.com/render-examples/minio) as its starting point, extended
to set `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` via the dashboard secret
surface and to pin the single bucket name (`launchkit-renders`) as a
non-secret env var so every service boots with the same reference.

The workflows service's `renderRemotionVideo` task will upload each
finished MP4 to MinIO via a new shared helper in the
`@launchkit/asset-generators` package (`packages/asset-generators/src/clients/object-storage.ts`,
landing in a follow-up commit) built on `@aws-sdk/client-s3` with
`forcePathStyle: true` — MinIO does not support the virtual-host style S3
URL layout, and the AWS SDK defaults to virtual-host, so the flag is
mandatory. The helper exposes a single `uploadRenderedVideo({ assetId,
version, variant, body })` entry point that handles idempotent bucket
creation (one `HeadBucket` + `CreateBucket` on cold start), the `PutObject`
upload with `ContentType: 'video/mp4'` and `ACL: 'public-read'`, and
returns `{ url, key }` where `url` is the direct MinIO public URL.

After upload, the task persists the URL on a new `rendered_video_url`
column on the `assets` table (migration lands in the same follow-up
commit) and returns `{ url, key, cached }` to the web caller.

The web service's `/api/assets/:id/video.mp4` handler will be rewritten
around this column: if `asset.rendered_video_url` is non-null, return a
`302` redirect to that URL with `Cache-Control: public, max-age=31536000,
immutable`. If null, trigger the `renderRemotionVideo` workflow via the
existing `triggerWorkflowGeneration` helper and redirect to the returned
URL once it settles. The `fileToWebStream` bytes-through-Hono path is
deleted from the video route entirely. The audio route at
`apps/web/src/routes/asset-api-routes.ts:250` keeps its existing
file-streaming path for now — that's a separate migration, tracked
separately.

Bucket ACL is `public-read` because the rendered video is the publishable
output, not private user data: the dashboard already surfaces the video
inline in the asset card and on social share links. Signed URLs would add
complexity (URL rotation, expiry on share links, cache-key churn) without
protecting anything the asset card doesn't already expose.

## Consequences

### Positive

- **Render-native, deploys from the Blueprint.** MinIO lives in the same
  `render.yaml` as every other service. No external AWS / R2 / GCS
  account to provision, no cross-cloud IAM, no separate billing surface
  to reconcile against the Render dashboard. A fork of the repo deploys
  the storage layer with the same `Deploy to Render` button as every
  other service.
- **Persistent across restarts AND deploys.** Render Disks are not
  ephemeral. Daily Disk snapshots provide automatic backups without any
  bespoke backup job.
- **S3-compatible, no lock-in.** The same `@aws-sdk/client-s3` calls work
  unchanged against MinIO, AWS S3, Cloudflare R2, Backblaze B2, and
  every other S3-compatible store. If this decision needs to be
  revisited at scale, migration is a config swap and a bucket copy, not
  a rewrite of the upload or read paths.
- **No per-GB egress fee, no per-request charge.** MinIO on a Render
  Disk costs the flat dyno plan + the Disk plan, period. A sudden
  traffic spike from a viral launch does not produce a surprise bill.
- **Decouples storage from compute.** The workflows service writes, the
  web service reads, and neither needs to know how the other runs. A
  future background re-render job (e.g., reprocessing every video after
  a composition change) becomes a workflows-only operation with no
  coordination against the web service.
- **Removes the memory pressure on the web dyno.** A 302 redirect hands
  the download off to the client's HTTP stack. The web dyno sees a
  kilobyte of response headers regardless of video size.

### Negative

- **Single point of failure.** One MinIO dyno, one Disk. If the dyno
  crashes, video serving goes dark until Render restarts it (typically
  <60 s). Acceptable for the public showcase; not acceptable for a
  production SaaS with SLAs. The mitigation if this ever becomes a real
  constraint is the S3-compatibility contract: swap MinIO for R2 or S3
  behind the same client code.
- **Disk sizing is a human operation.** 10 GB holds roughly 500-1000
  rendered videos at average size. Monitoring disk utilisation and
  resizing the Disk is manual; there is no autoscaling. Adding a
  Render-side alert on disk utilisation is a follow-up.
- **One more service in the Blueprint.** Every service is a thing to
  watch, update, and pay for. The cost is real but small relative to
  the wins above.

### Neutral

- **The bucket is created programmatically.** The `object-storage.ts`
  helper runs a `HeadBucket` on first upload and falls through to
  `CreateBucket` if the bucket does not exist. No manual dashboard step
  after the service boots.
- **Local dev does not need MinIO.** The existing
  `.cache/remotion-renders` path stays as the fallback for `npm run
  dev` — `docker-compose.override.yml` can add a local MinIO container
  later if end-to-end parity matters, but the default dev loop does
  not require it.

## Alternatives considered

- **Cloudflare R2.** S3-compatible, zero egress, per-GB storage is
  cheaper than a Render Disk. Rejected because it pulls the stack off
  Render, requires provisioning a Cloudflare account and API credentials
  on every fork, and complicates the one-click deploy story for anyone
  copying the repo. The "Render showcase" framing of the project makes
  the off-platform dependency a bigger cost than the egress savings.
- **AWS S3.** The industry default. Rejected for the same reason as R2,
  plus egress charges, plus the cognitive cost of explaining IAM
  policies in a public repo that should be easy to fork.
- **Render Disk on the web service directly.** Mount a Disk at
  `.cache/remotion-renders` and call the current code done. Rejected
  because a Render Disk can only be mounted on one service at a time —
  the workflows service that will own rendering cannot write through
  the web dyno's Disk. The moment rendering moves to workflows, the
  shared-filesystem model stops working, and we'd be back here.
- **Postgres `bytea` column.** Store the MP4 bytes directly on the
  asset row. Rejected: 5-50 MB per video times hundreds of assets blows
  out Postgres storage pricing relative to a Disk, `bytea` round-trips
  through Node are slow enough to reintroduce the memory pressure
  problem, and backup / restore times degrade superlinearly with row
  size.
- **Supabase Storage / Firebase Storage.** Both are S3-compatible
  layers over GCS. Rejected for the same off-platform reason as R2,
  with the additional cost of being third-party SaaS surfaces that
  could change pricing or availability independently of Render.

## References

- `CLAUDE.md` § "Workflows service"
- `apps/web/src/lib/remotion-render.ts` — the current synchronous render
  path, to be migrated onto the Workflows service in a follow-up commit
- `apps/web/src/routes/asset-api-routes.ts:111` — the
  `/api/assets/:id/video.mp4` handler, to be rewritten as a 302 redirect
- `render.yaml` — the current service topology; the MinIO service will
  land here
- `apps/workflows/src/tasks/render-remotion-video.ts` — the new task
  will land here
- `packages/asset-generators/src/clients/object-storage.ts` — the new
  upload helper will land here
- https://github.com/render-examples/minio — Render's official MinIO
  Blueprint example
