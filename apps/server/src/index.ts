import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  refreshAll,
  getArticles,
  getArticleById,
  getSources,
  getCategories,
  getTrending,
  getArticlesBySource,
  getSourceMeta,
} from './ingest.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  toSafeUser,
  type StoredUser,
} from './users.js';
import {
  hashPassword,
  verifyPassword,
  createToken,
  extractUserId,
  isValidEmail,
  isValidPassword,
  authMiddleware,
} from './auth.js';

export { authMiddleware };

export const app = new Hono();

app.use('*', cors());

// Trigger a refresh on startup
refreshAll().catch(console.error);
// Also refresh every 10 minutes in background
setInterval(() => refreshAll().catch(console.error), 10 * 60 * 1000);

// --- Auth routes ---

app.post('/api/auth/register', async (c) => {
  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid json body' }, 400);
  }

  const { email, password, name } = body;
  if (!isValidEmail(email)) {
    return c.json({ error: 'invalid email address' }, 400);
  }
  if (!isValidPassword(password)) {
    return c.json({ error: 'password must be at least 8 characters' }, 400);
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = findUserByEmail(normalizedEmail);
  if (existing) {
    return c.json({ error: 'email already registered' }, 409);
  }

  const passwordHash = await hashPassword(password);
  const user: StoredUser = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    passwordHash,
    name: typeof name === 'string' && name.trim() ? name.trim() : undefined,
    createdAt: Date.now(),
  };

  createUser(user);
  const token = createToken(user.id);
  return c.json({ data: { token, user: toSafeUser(user) } });
});

app.post('/api/auth/login', async (c) => {
  let body: { email?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const { email, password } = body;
  if (typeof email !== 'string' || typeof password !== 'string') {
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const user = findUserByEmail(email);
  if (!user) {
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return c.json({ error: 'invalid credentials' }, 401);
  }

  const token = createToken(user.id);
  return c.json({ data: { token, user: toSafeUser(user) } });
});

app.get('/api/auth/me', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const user = findUserById(userId);
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ data: { user: toSafeUser(user) } });
});

app.post('/api/auth/logout', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return c.json({ data: { ok: true } });
});

// --- News & Feed routes ---

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
if (process.env['NODE_ENV'] !== 'test') {
  console.log(`[server] listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}
