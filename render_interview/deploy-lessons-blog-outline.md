# Deploying a TypeScript Monorepo with Remotion on Render --- 7 Things We Learned

> **Format:** Practical developer tutorial / blog post
> **Audience:** TypeScript developers deploying non-trivial apps to Render for the first time
> **Pitch angle:** "Here's a piece of content I'd create in week one at Render."

---

## Intro (2--3 paragraphs)

LaunchKit is a TypeScript monorepo with 9 services: an Hono API server, a React dashboard, BullMQ workers, Render Workflows tasks, a cron scheduler, and a Docker-based Remotion render service. Locally, everything was clean --- 170 tests passing, typecheck/lint/build all green. Zero code bugs.

Every single deploy failure was an infrastructure configuration issue. None of them required changing application code. That distinction matters: it means the platform is doing its job (enforcing production constraints), and the developer just needs to know what those constraints are.

Here are the seven things we learned, with the exact error messages so you can ctrl-F your way here when it happens to you.

---

## Lesson 1: devDependencies get stripped in production

### The error

```
error TS2307: Cannot find module 'react' or its corresponding type declarations.
```

TypeScript compilation fails during the build step. `@types/react`, `@types/node`, and similar packages are missing.

### Why it happens

Render sets `NODE_ENV=production` during builds. When `npm ci` runs in a production environment, it skips everything in `devDependencies`. That's correct behavior for runtime --- but TypeScript type packages are needed at *build* time, not runtime.

### The fix

Change the build command:

```
npm ci --include=dev && npm run build
```

### Takeaway

If your TypeScript project puts type packages in `devDependencies` (as it should), you need `--include=dev` on any platform that sets `NODE_ENV=production` during the build phase.

---

## Lesson 2: Postgres plan names changed

### The error

```
Legacy Postgres plans, including 'starter', are no longer supported.
```

Blueprint deployment fails validation before any service starts.

### Why it happens

Render updated their Postgres plan naming. Old names like `starter` and `pro` are deprecated. The new format includes the resource size: `pro-4gb`, `standard-8gb`, etc.

### The fix

In `render.yaml`:

```yaml
databases:
  - name: launchkit-db
    plan: pro-4gb      # not "pro" or "starter"
```

### Takeaway

When a Blueprint fails before anything deploys, check the plan names first. Render's pricing page has the current list. The format is `{tier}-{size}` with a hyphen.

---

## Lesson 3: Render Workflows has a read-only filesystem (beta)

### The error

```
apt-get update
E: Unable to open lock file /var/lib/apt/lists/lock - open (30: Read-only file system)
```

A Workflows task that needs system-level dependencies (like Chrome for Remotion rendering) can't install them.

### Why it happens

Render Workflows runs tasks in a managed environment with a read-only root filesystem. You can't `apt-get install` anything. This is a beta constraint --- the tradeoff is simpler orchestration in exchange for less runtime flexibility.

### The fix

Move workloads that need system packages into a separate Docker-based web service (or background worker). Trigger it from the workflow via an HTTP call instead of running it as a workflow task directly.

```
Workflow task (orchestration) → HTTP POST → Docker service (has Chrome) → result
```

### Takeaway

Render Workflows is great for orchestrating multi-step pipelines, but if a step needs system-level dependencies, run it in a Docker service and call it from the workflow. Don't fight the read-only filesystem.

---

## Lesson 4: Docker builds need a .dockerignore

### The error

```
Error: No Remotion binary found. Could not find "npx remotion" in PATH.
```

Or more generally: binaries that were installed by `npm ci` inside the Docker build can't be found at runtime.

### Why it happens

Without a `.dockerignore`, Docker copies your entire local directory --- including `node_modules` (easily 1GB+) --- into the build context. The local `node_modules` were built for macOS; the Docker image is Linux. The stale local modules shadow the clean `npm ci` install, and native binaries don't resolve.

### The fix

Create `.dockerignore`:

```
node_modules
.git
dist
```

Three lines. That's it.

### Takeaway

If a Docker build works on a fresh clone but fails from your working directory, you're missing a `.dockerignore`. This is the single most common Docker deployment issue and it takes 10 seconds to fix.

---

## Lesson 5: npm prepare scripts need git in Docker

### The error

```
npm error /bin/sh: 1: git: not found
npm error lifecycle script "prepare" failed
```

`npm ci` fails during the Docker build, not during your application code.

### Why it happens

If your `package.json` has a `prepare` script (common with Husky, Lefthook, or other git-hook managers), `npm ci` will run it during install. Lefthook's `prepare` script calls `git`, which isn't available in `node:22-bookworm-slim`.

### The fix

Add `git` to your Dockerfile's system dependencies:

```dockerfile
RUN apt-get update && apt-get install -y git
```

Or, if you don't need hooks in CI/production, guard the prepare script:

```json
"prepare": "node -e \"try{require('lefthook')}catch{}\""
```

### Takeaway

Audit your `prepare`, `postinstall`, and `preinstall` scripts. If any of them assume tools that exist on your dev machine (git, python, make), those tools need to be in your Docker image too.

---

## Lesson 6: Remotion recommends runtime Chrome download, not build-time

### The error

```
Error: Could not find Chromium revision. npx remotion browser ensure failed.
```

Running `npx remotion browser ensure` in the Dockerfile fails in a monorepo context, or produces a binary that doesn't persist correctly.

### Why it happens

In a monorepo, `npx` resolution during Docker builds can be unreliable --- the binary might resolve to the wrong workspace, or the download path might not survive multi-stage builds. Remotion's own documentation recommends a different approach.

### The fix

1. Install system libraries Chrome needs (in the Dockerfile):

```dockerfile
RUN apt-get update && apt-get install -y \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
    libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libasound2 libxshmfence1
```

2. Let Remotion download Chrome at runtime via `ensureBrowser()`:

```typescript
import { ensureBrowser } from "@remotion/renderer";
await ensureBrowser();
```

### Takeaway

When a tool offers both a CLI install path and a programmatic runtime path, the runtime path is usually more reliable in containers. The tool knows its own resolution logic better than `npx` does.

---

## Lesson 7: Workspace-level policies can add Blueprint requirements

### The error

```
Blueprint validation error: IP allow list is required for this workspace.
```

A Blueprint that passes schema validation still gets rejected on deploy.

### Why it happens

Render workspaces can have org-level policies that add requirements beyond what's in the standard Blueprint spec. In this case, the workspace required an IP allow list on Postgres instances. This wasn't in the public Blueprint documentation because it's a workspace-specific setting.

### The fix

Add the required policy fields to `render.yaml`:

```yaml
databases:
  - name: launchkit-db
    ipAllowList:
      - source: 0.0.0.0/0
        description: Allow all (restrict in production)
```

### Takeaway

If your Blueprint is syntactically valid but the workspace rejects it, check workspace-level policies. The error messages are specific --- read them carefully and add what's missing.

---

## What went right

Every failure in this list is a configuration issue. Not one of them required changing application code.

- 170 tests passed locally before the first deploy. They still pass.
- Zero code changes were needed to get the app running on Render.
- The app worked on first boot once the config was correct.

This is actually the ideal outcome. It means the local development experience was honest --- the code does what it says it does. The gap was between "works on my machine" and "works in a production environment," and that gap was entirely bridgeable with config changes.

The seven fixes above took a few hours total. A blog post like this takes that down to minutes for the next person.

---

## Closing (1 paragraph)

Deploying a monorepo to any cloud platform is a negotiation between your local assumptions and the platform's production constraints. The errors are predictable, the fixes are small, and once you've seen them, you don't hit them again. If you're deploying a TypeScript monorepo to Render, bookmark this page. You'll need at least three of these.
