---
paths:
  - "packages/shared/src/schema.ts"
  - "apps/workflows/src/lib/dispatch-asset.ts"
  - "apps/worker/src/processors/review-generated-assets.ts"
  - "apps/web/src/routes/asset-api-routes.ts"
  - "**/assets/**"
---

# Asset status lifecycle

Every asset row follows a linear state machine defined by the `asset_status` pgEnum:

```
queued → generating → reviewing → complete
                          ↓
                    approved / rejected
                          ↓
                    regenerating → queued  (loop)

              any state → failed  (escape hatch)
```

| Status | What's happening | Who drives it |
|---|---|---|
| `queued` | Waiting for Render Workflow parent task to pick up. | `buildProjectLaunchStrategy`, `regenerateAsset` route, creative-review re-queue. |
| `generating` | Workflow child task running the provider call. | `dispatchAsset` in `apps/workflows/src/lib/dispatch-asset.ts`. |
| `reviewing` | Creative-director-agent scoring quality — automated AI step, never user-initiated. | Review BullMQ job enqueued after all workflow children settle. |
| `approved` | User approved or creative-director auto-approved. | `POST /api/assets/:id/approve` or review processor. |
| `rejected` | User rejected or creative-director rejected. May be re-queued. | `POST /api/assets/:id/reject` or review processor. |
| `complete` | Terminal success after full review pass settles. | Review processor finalization. |
| `regenerating` | Flipping back to `queued` on next workflow trigger. | `POST /api/assets/:id/regenerate` or creative-review re-queue. |
| `failed` | Error during generation or review. Partial failures are first-class. | `dispatchAsset` catch block or review error handler. |

Key invariant: `reviewing` is an automated AI step. A user never manually transitions an asset to `reviewing`.
