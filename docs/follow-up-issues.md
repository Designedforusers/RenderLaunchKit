# Follow-up issues

Issues surfaced by the final architecture audit that are outside the
scope of the current testing + polish pass but worth tracking.

## Dead code: `apps/worker/src/lib/influencer-matcher.ts`

The module exports `findInfluencersForCommit` and
`MatchedInfluencerRowSchema`. Neither is referenced by any production
code path — `apps/worker/src/processors/process-commit-marketing-run.ts`
uses `runInfluencerDiscoveryAgent` from
`apps/worker/src/agents/influencer-discovery-agent.ts` instead. The
matcher module has a module-load smoke test at
`tests/influencer-matcher.test.mjs`, and `trend-matcher.ts` +
`duplication-guard.ts` reference it in doc comments as "the canonical
embedding-based matcher pattern" — but no caller actually invokes
`findInfluencersForCommit` at runtime.

The module is an artifact of an earlier embedding-based matcher
design that was superseded by the agent-based discovery path in
Phase 5. The replacement made the matcher's call site redundant,
but the file was never deleted.

**Follow-up options (in order of effort):**

1. **Delete it.** `influencer-matcher.ts` + the matching test file +
   any comment references in sibling files. The trend-matcher.ts
   pattern reference can stay — the shape is the same, the
   reference is pedagogical.
2. **Rewire it into the commit-marketing run** as a pre-agent filter
   that narrows the influencer candidate set via pgvector cosine
   similarity before the LLM discovery agent runs, reducing
   agent-call latency on commit-marketing jobs.
3. **Move it under `tests/fixtures/`** as an exemplar of the raw-SQL
   pgvector pattern for future contributors to reference.

No action in this session. Captured here so the next audit doesn't
flag it again without context.

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
