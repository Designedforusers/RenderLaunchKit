import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorHandler } from './middleware/errors.js';
import { authMiddleware } from './middleware/auth.js';
import { apiRateLimit } from './middleware/rate-limit.js';
import projectApiRoutes from './routes/project-api-routes.js';
import projectCostRoutes from './routes/project-cost-routes.js';
import assetApiRoutes from './routes/asset-api-routes.js';
import projectEventStreamRoutes from './routes/project-event-stream-routes.js';
import githubWebhookRoutes from './routes/github-webhook-routes.js';
import pikaRoutes from './routes/pika-routes.js';
import chatRoutes from './routes/chat-routes.js';
import trendsApiRoutes from './routes/trends-api-routes.js';
import { generateRoutes } from './routes/generate-routes.js';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';

const app = new Hono();

app.onError((err, c) => {
  console.error('[Error]', err.message, err.stack);
  return c.json(
    {
      error: err.message || 'Internal server error',
      ...(env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
    500
  );
});

// Resolve paths relative to the monorepo root via import.meta.url so
// they work regardless of process.cwd() (tsx watch sets cwd to apps/web/).
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..', '..', '..'
);

const dashboardDistDir = path.resolve(REPO_ROOT, 'apps/dashboard/dist');
const dashboardIndexPath = path.join(dashboardDistDir, 'index.html');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function buildStaticFilePath(requestPath: string): string | null {
  const normalized = path.posix.normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const relativePath = normalized.replace(/^\/+/, '');
  const filePath = path.resolve(dashboardDistDir, relativePath);

  if (filePath !== dashboardDistDir && !filePath.startsWith(`${dashboardDistDir}${path.sep}`)) {
    return null;
  }

  return filePath;
}

async function serveDashboardFile(filePath: string): Promise<Response | null> {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const file = await readFile(filePath);
    return new Response(file, {
      headers: {
        'Content-Type':
          contentTypes[path.extname(filePath).toLowerCase()] ??
          'application/octet-stream',
      },
    });
  } catch {
    return null;
  }
}

// ── Middleware ──

app.use('*', logger());
app.use('*', secureHeaders());
app.use(
  '/api/*',
  cors({
    origin: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
      : ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use('*', errorHandler);

// ── API Routes ──
//
// Order is significant. Hono runs middleware in declaration order, so:
//
//   1. Webhooks mount first because they authenticate via HMAC signature
//      and must not be subject to the API key middleware below. They have
//      their own body-size limit defined inside the route.
//
//   2. The SSE event stream is intentionally public (no auth) so the
//      dashboard can subscribe without negotiating bearer tokens. Knowing
//      the project UUID is the implicit access control. The rate-limit
//      middleware still applies to SSE so a single IP can't open thousands
//      of streams.
//
//   3. The general /api/* rate limit is mounted next. It applies to
//      everything underneath — including the SSE route just above (Hono
//      will resolve the handler from the SSE route since it was declared
//      first, but the rate limit also fires because it's a more specific
//      `/api/*` matcher).
//
//   4. Finally the auth middleware and the protected routes.

app.use('/api/*', apiRateLimit);

// Webhooks don't need auth (they use signature verification + replay
// protection inside the route).
app.route('/api/webhooks', githubWebhookRoutes);

// SSE events don't need auth for demo purposes — the dashboard subscribes
// directly. In production this trade-off should be re-examined.
app.route('/api/projects', projectEventStreamRoutes);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/projects', projectApiRoutes);
// Project cost aggregation — mounted at /api/projects so the
// handler's `/:projectId/costs` relative path resolves to
// `/api/projects/:projectId/costs`. Declared after
// `projectApiRoutes` so the cost-specific matcher does not
// shadow the generic project routes.
app.route('/api/projects', projectCostRoutes);
// Pika video meeting sessions — same mount point so the
// handler's `/:projectId/meetings*` relative paths resolve to
// `/api/projects/:projectId/meetings*`. Declared after the two
// matchers above so a `:projectId` path param lookup still
// resolves to the right handler.
app.route('/api/projects', pikaRoutes);
// Agent chat — streaming SSE endpoint for the dashboard's chat UI.
// Mounted after the auth middleware so the API key gate applies.
app.route('/api/projects', chatRoutes);
app.route('/api/assets', assetApiRoutes);
app.route('/api/trends', trendsApiRoutes);
app.route('/api/generate', generateRoutes);

// ── Health Check ──

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'launchkit-web',
    timestamp: new Date().toISOString(),
  });
});

// ── Static Files (Dashboard SPA) ──

app.get('*', (c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.notFound();
  }

  return (async () => {
    if (!existsSync(dashboardIndexPath)) {
      return c.text(
        'Dashboard build not found. Run `npm run build` or start the dashboard dev server separately.',
        503
      );
    }

    const requestedPath =
      c.req.path === '/' ? '/index.html' : c.req.path;
    const staticFilePath = buildStaticFilePath(requestedPath);

    if (staticFilePath) {
      const staticResponse = await serveDashboardFile(staticFilePath);
      if (staticResponse) {
        return staticResponse;
      }
    }

    const indexHtml = await readFile(dashboardIndexPath, 'utf-8');
    return c.html(indexHtml);
  })();
});

// ── Start Server ──

const port = env.PORT;

console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Web Service                   ║
║  Port: ${String(port).padEnd(33)}║
║  Env: ${env.NODE_ENV.padEnd(34)}║
╚══════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});
