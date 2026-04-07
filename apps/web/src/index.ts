import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { serveStatic } from '@hono/node-server/serve-static';
import { errorHandler } from './middleware/errors.js';
import { authMiddleware } from './middleware/auth.js';
import projectsRouter from './routes/projects.js';
import assetsRouter from './routes/assets.js';
import eventsRouter from './routes/events.js';
import webhooksRouter from './routes/webhooks.js';

const app = new Hono();

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
app.route('/api/webhooks', webhooksRouter);

// SSE events don't need auth for demo purposes
app.route('/api/projects', eventsRouter);

// Protected API routes
app.use('/api/*', authMiddleware);
app.route('/api/projects', projectsRouter);
app.route('/api/assets', assetsRouter);

// ── Health Check ──

app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'launchkit-web',
    timestamp: new Date().toISOString(),
  });
});

// ── Static Files (Dashboard SPA) ──

app.use(
  '/*',
  serveStatic({
    root: '../dashboard/dist',
  })
);

// SPA fallback — serve index.html for all non-API routes
app.get('*', (c) => {
  return c.html('<!doctype html><html><body><div id="root">Loading...</div></body></html>');
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
