import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { errorHandler } from './middleware/errors.js';
import { authMiddleware } from './middleware/auth.js';
import projectApiRoutes from './routes/project-api-routes.js';
import assetApiRoutes from './routes/asset-api-routes.js';
import projectEventStreamRoutes from './routes/project-event-stream-routes.js';
import githubWebhookRoutes from './routes/github-webhook-routes.js';

const app = new Hono();
const dashboardDistDir = path.resolve(process.cwd(), 'apps/dashboard/dist');
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
          contentTypes[path.extname(filePath).toLowerCase()] ||
          'application/octet-stream',
      },
    });
  } catch {
    return null;
  }
}

// ── Middleware ──

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowHeaders: ['Content-Type', 'Authorization'],
  })
);
app.use('*', errorHandler);

// ── API Routes ──

// Webhooks don't need auth (they use signature verification)
app.route('/api/webhooks', githubWebhookRoutes);

// SSE events don't need auth for demo purposes
app.route('/api/projects', projectEventStreamRoutes);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/projects', projectApiRoutes);
app.route('/api/assets', assetApiRoutes);

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

const port = parseInt(process.env.PORT || '3000');

console.log(`
╔══════════════════════════════════════════╗
║  LaunchKit Web Service                   ║
║  Port: ${String(port).padEnd(33)}║
║  Env: ${(process.env.NODE_ENV || 'development').padEnd(34)}║
╚══════════════════════════════════════════╝
`);

serve({
  fetch: app.fetch,
  port,
});
