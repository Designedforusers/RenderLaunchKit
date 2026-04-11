# Follow-up issues

Issues surfaced by the final architecture audit that are outside the
scope of the current testing + polish pass but worth tracking.

## Duplicated `composeMinioEndpoint` across env modules

`apps/web/src/env.ts` and `apps/workflows/src/env.ts` both carry an
identical 10-line `composeMinioEndpoint(host)` helper. Unlike the
intentional duplications documented in `CLAUDE.md` § "Workflows
service" (where `anthropic-claude-client.ts` is duplicated because
moving it to a shared package would force the worker's non-asset-gen
agents onto a wrong boundary), this helper has no service-specific
dependency — it is pure URL composition with no env or process
state.

**Follow-up**: move to `packages/shared/src/lib/compose-minio-endpoint.ts`
(the package is browser-safe, has no `process.env` reads) and import
from both env modules.

Low priority — the duplication is ~20 lines total and the helpers
stay in lockstep by copy-paste discipline. The move would add a
shared-package import cycle across the monorepo for a very small
surface.

## Dashboard bundle size warning

Vite's build reports `dist/assets/index-*.js` at ~1.16 MB (~342 KB
gzipped), which is above the default `chunkSizeWarningLimit` of 500
KB. The warning has been firing since the LandingPage + framer-motion
+ GSAP landed.

**Follow-up options:**

1. Configure `build.rollupOptions.output.manualChunks` in
   `apps/dashboard/vite.config.ts` to split vendor libs (react,
   framer-motion, gsap, phosphor-icons) into separate chunks.
2. Dynamic-import the LandingPage so the `/app` route doesn't pay
   the ~500 KB marketing-page weight.
3. Bump `build.chunkSizeWarningLimit` to silence the warning if we
   accept the current size.

Not urgent — 342 KB gzipped is still well under Render's HTTP2
response budget for a single-page app. Revisit if page-load metrics
degrade.
