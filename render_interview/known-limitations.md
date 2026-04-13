# Known Limitations

Things to be honest about if asked.

## 1. SSE stream is unauthenticated

The `/api/projects/:id/events` SSE endpoint is open. The browser's EventSource API doesn't support custom headers, so bearer-token auth requires a query-string token. Rate limiting and UUID opacity provide baseline protection. A signed HMAC token in the query string is the proper fix.

## 2. Render Workflows read-only filesystem

Workflows (beta) blocks `apt-get` during the build. Chrome system libraries can't be installed. I solved this with a Docker-based renderer sidecar. When Workflows exits beta, this can collapse back into a single task.

## 3. No pagination on project list

`GET /api/projects` returns all projects. Fine for demo scale but not production. A cursor-based pagination is the right fix.

## 4. Direct audio generation is ephemeral

The `/api/generate/audio` creative studio endpoint writes MP3s to local disk. After a deploy or restart, those files 404. The pipeline's audio (voice commercials, podcasts) correctly uploads to MinIO — only the playground is affected.

## 5. Project re-run deletes history

Re-running the same GitHub repo deletes the previous project and all cascaded children (assets, costs, feedback). This is a design choice for the unique-repo constraint, but it means you can't A/B compare runs.

## 6. Test coverage gaps

Unit tests cover schemas, pricing, helpers, and the trigger interfaces. The three heaviest code paths — `dispatchAsset`, the review processor, and the workflow parent task — have zero unit tests. They rely on the deploy-time E2E path.
