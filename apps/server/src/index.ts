import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { refreshAll, getArticles, getArticleById, getSources, getCategories, getTrending, getArticlesBySource, getSourceMeta } from './ingest.js';

const app = new Hono();

app.use('*', cors());

// Trigger a refresh on startup
refreshAll().catch(console.error);
// Also refresh every 10 minutes in background
setInterval(() => refreshAll().catch(console.error), 10 * 60 * 1000);

app.get('/api/feed', async (c) => {
  await refreshAll();
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const articles = getArticles(limit, offset);
  return c.json({ data: articles, total: articles.length });
});

app.get('/api/sources', (c) => {
  return c.json({ data: getSources() });
});

app.get('/api/categories', (c) => {
  return c.json({ data: getCategories() });
});

app.get('/api/trending', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50);
  const articles = getTrending(limit);
  return c.json({ data: articles, total: articles.length });
});

app.get('/api/sources/:id/articles', (c) => {
  const id = c.req.param('id');
  const source = getSourceMeta(id);
  if (!source) return c.json({ error: 'not found' }, 404);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const articles = getArticlesBySource(id, limit, offset);
  return c.json({ data: articles, source });
});

app.get('/api/articles/:id', (c) => {
  const id = c.req.param('id');
  const article = getArticleById(id);
  if (!article) return c.json({ error: 'not found' }, 404);
  return c.json({ data: article });
});

app.get('/health', (c) => c.json({ ok: true }));

const PORT = Number(process.env['PORT'] ?? 3001);
console.log(`[server] listening on http://localhost:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
