import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  refreshAll,
  getArticles,
  getBalancedFeed,
  getArticleById,
  getSources,
  getCategories,
  getTrending,
  getArticlesBySource,
  getArticlesByFollowedSources,
  getSourceMeta,
} from './ingest.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  markUserVerified,
  normalizeEmail,
  toSafeUser,
  type StoredUser,
} from './users.js';
import {
  consumeToken,
  loadResendKey,
  maskEmail,
  peekToken,
  resendAllowance,
  sendVerificationForUser,
  sentTimes,
  VERIFY_ERRORS,
} from './verify.js';
import {
  getFollowedSources,
  followSource,
  unfollowSource,
} from './follows.js';
import {
  getSavedArticleIds,
  isArticleSaved,
  saveArticle,
  unsaveArticle,
} from './saved.js';
import { searchArticles } from './search.js';
import {
  registerPushToken,
  updatePushPrefs,
  unregisterPushToken,
  getPushPrefs,
  isValidMode,
  isLegacyExpoToken,
  loadServiceAccount,
  type PushMode,
} from './push.js';
import type { Article } from './types.js';
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

/** Error code the app matches on to show the verification banner. */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/**
 * Gate for account-bound routes: the caller must be signed in AND have proven
 * the email address. Browsing stays public; anything that writes to an account
 * requires verification. Returns a 403 response to send, or null when allowed.
 */
function requireVerified(c: {
  req: { header: (name: string) => string | undefined };
  json: (body: unknown, status: 403) => Response;
}): Response | null {
  const userId = extractUserId(c.req.header('Authorization'));
  const user = userId ? findUserById(userId) : null;
  if (!user) return null; // the route's own 401 handles this
  if (user.emailVerified) return null;
  return c.json(
    {
      error: 'Email verification required',
      code: EMAIL_NOT_VERIFIED,
      emailVerified: false,
    },
    403,
  );
}

app.use('*', cors());

// Push needs the Firebase service-account key. Log the outcome once at boot
// (never the key itself); a missing key disables push but never crashes.
const pushAccount = loadServiceAccount();
if (pushAccount) {
  console.log(`[push] FCM credentials loaded (project ${pushAccount.project_id})`);
}

// Email verification needs the Resend key. Warn once at boot; never crash.
if (loadResendKey()) {
  console.log('[email] Resend API key loaded — verification emails enabled');
}

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

  const normalizedEmail = normalizeEmail(email);
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
    emailVerified: false,
  };

  createUser(user);

  // Send the link without making the user wait: sign-up returns a session even
  // if the mail cannot be sent (the app can resend).
  try {
    await sendVerificationForUser(user);
  } catch (err) {
    console.error('[email] verification send failed at sign-up:', err);
  }

  const token = createToken(user.id);
  return c.json({ data: { token, user: toSafeUser(user) } });
});

/**
 * GET /verify?token=... — the link in the email.
 * Renders a small RTL Arabic page; no JS, works in any browser.
 */
app.get('/verify', (c) => {
  const raw = (c.req.query('token') ?? '').trim();
  const outcome = raw ? consumeToken(raw) : ({ status: 'invalid' } as const);

  if (outcome.status === 'verified') {
    const user = findUserById(outcome.userId);
    if (user) markUserVerified(user.id);
  }

  const success = outcome.status === 'verified';
  const message = success
    ? 'تم توثيق بريدك ✅ ارجع للتطبيق'
    : outcome.status === 'expired'
      ? VERIFY_ERRORS.expired
      : outcome.status === 'used'
        ? VERIFY_ERRORS.used
        : VERIFY_ERRORS.invalid;
  const hint = success
    ? 'يمكنك الآن استخدام كل مميزات حسابك.'
    : 'افتح التطبيق واضغط «إعادة إرسال الرابط» للحصول على رابط جديد.';

  const accent = success ? '#10B981' : '#EF4444';
  const title = success ? 'تم التوثيق' : 'تعذّر التوثيق';

  return c.html(`<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — رئيس التحرير</title>
  </head>
  <body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0B1511;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;direction:rtl;text-align:center;padding:24px;">
    <div style="max-width:420px;background:#182721;border-radius:20px;padding:32px 24px;">
      <div style="width:64px;height:64px;margin:0 auto 20px;border-radius:32px;background:${accent};display:flex;align-items:center;justify-content:center;font-size:32px;line-height:64px;color:#FFFFFF;">
        ${success ? '✓' : '!'}
      </div>
      <h1 style="margin:0 0 12px;font-size:20px;color:#F8FAFC;">${message}</h1>
      <p style="margin:0;font-size:14px;line-height:24px;color:#94A3B8;">${hint}</p>
      <p style="margin:24px 0 0;font-size:13px;color:#34D399;font-weight:700;">رئيس التحرير</p>
    </div>
  </body>
</html>`, success ? 200 : 400);
});

/**
 * POST /api/auth/resend-verification — Bearer.
 * 60s cooldown, max 5 per rolling day; already-verified is a 200 no-op.
 */
app.post('/api/auth/resend-verification', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const user = findUserById(userId);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  if (user.emailVerified) {
    return c.json({ data: { ok: true, alreadyVerified: true } });
  }

  const allowance = resendAllowance(sentTimes(user.id));
  if (!allowance.allowed) {
    return c.json(
      {
        error: 'too many requests',
        code: 'RESEND_RATE_LIMITED',
        retryAfterSeconds: Math.ceil(allowance.retryAfterMs / 1000),
        remainingToday: allowance.remainingToday,
      },
      429,
    );
  }

  const result = await sendVerificationForUser(user);
  return c.json({
    data: {
      ok: true,
      sent: result.ok,
      // Not the token: it only ever travels by email.
      message: result.ok ? 'sent' : 'send-failed',
      remainingToday: resendAllowance(sentTimes(user.id)).remainingToday,
    },
  });
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

// --- Follows routes (Bearer protected) ---

app.get('/api/follows', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const sourceIds = getFollowedSources(userId);
  return c.json({ data: { sourceIds } });
});

app.put('/api/follows/:sourceId', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const sourceId = c.req.param('sourceId');
  const meta = getSourceMeta(sourceId);
  if (!meta) return c.json({ error: 'source not found' }, 404);
  const sourceIds = followSource(userId, sourceId);
  return c.json({ data: { sourceIds } });
});

app.delete('/api/follows/:sourceId', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const sourceId = c.req.param('sourceId');
  const sourceIds = unfollowSource(userId, sourceId);
  return c.json({ data: { sourceIds } });
});

app.get('/api/feed/following', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const sourceIds = getFollowedSources(userId);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const articles = getArticlesByFollowedSources(sourceIds, limit, offset);
  return c.json({ data: articles, total: articles.length });
});

// --- Saved articles routes (Bearer protected) ---

app.get('/api/saved', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const savedIds = getSavedArticleIds(userId);
  const articles: Article[] = [];
  for (const id of savedIds) {
    const a = getArticleById(id);
    if (a) articles.push(a);
  }
  const page = articles.slice(offset, offset + limit);
  return c.json({ data: page, total: page.length });
});

app.get('/api/saved/:articleId', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const articleId = c.req.param('articleId');
  const saved = isArticleSaved(userId, articleId);
  return c.json({ data: { saved } });
});

app.put('/api/saved/:articleId', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const articleId = c.req.param('articleId');
  const article = getArticleById(articleId);
  if (!article) return c.json({ error: 'article not found' }, 404);
  const articleIds = saveArticle(userId, articleId);
  return c.json({ data: { ok: true, saved: true, articleIds } });
});

app.delete('/api/saved/:articleId', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const articleId = c.req.param('articleId');
  const articleIds = unsaveArticle(userId, articleId);
  return c.json({ data: { ok: true, saved: false, articleIds } });
});

// --- Push notification routes (Bearer protected) ---

app.post('/api/push/register', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { token?: unknown; platform?: unknown; provider?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const platform = typeof body.platform === 'string' ? body.platform.trim() : '';
  const provider = typeof body.provider === 'string' ? body.provider.trim() : 'fcm';
  if (!token) return c.json({ error: 'token is required' }, 400);
  // Expo push tokens belong to a service this server no longer uses.
  if (isLegacyExpoToken(token)) {
    return c.json({ error: 'Expo push tokens are not supported; send the FCM token' }, 400);
  }
  if (provider !== 'fcm') {
    return c.json({ error: "provider must be 'fcm'" }, 400);
  }

  const record = registerPushToken(userId, token, platform || 'unknown', provider);
  return c.json({
    data: {
      token: record.token,
      enabled: record.enabled,
      mode: record.mode,
      provider: record.provider,
    },
  });
});

app.put('/api/push/preferences', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { token?: unknown; enabled?: unknown; mode?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return c.json({ error: 'token is required' }, 400);
  if (body.mode !== undefined && !isValidMode(body.mode)) {
    return c.json({ error: "mode must be 'urgent' or 'all'" }, 400);
  }
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') {
    return c.json({ error: 'enabled must be a boolean' }, 400);
  }

  const record = updatePushPrefs(userId, token, {
    enabled: body.enabled as boolean | undefined,
    mode: body.mode as PushMode | undefined,
  });
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({
    data: { token: record.token, enabled: record.enabled, mode: record.mode, provider: record.provider },
  });
});

app.get('/api/push/preferences', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  const token = (c.req.query('token') ?? '').trim();
  if (!token) return c.json({ error: 'token is required' }, 400);

  const record = getPushPrefs(userId, token);
  if (!record) return c.json({ error: 'not found' }, 404);
  return c.json({
    data: { token: record.token, enabled: record.enabled, mode: record.mode, provider: record.provider },
  });
});

app.delete('/api/push/register', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { token?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return c.json({ error: 'token is required' }, 400);

  unregisterPushToken(userId, token);
  return c.json({ data: { ok: true } });
});

// --- News & Feed routes ---

app.get('/api/feed', async (c) => {
  await refreshAll();
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  // Balanced across sources: one high-volume outlet could otherwise fill the
  // whole page. `max` is opt-in for callers that want the raw ceiling.
  const maxParam = Number(c.req.query('max'));
  const maxPerSource = Number.isFinite(maxParam) && maxParam > 0 ? maxParam : undefined;
  const { articles, total } = getBalancedFeed(limit, offset, maxPerSource);
  return c.json({ data: articles, total });
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

// Search across title, summary and source name (Arabic-normalized).
app.get('/api/search', (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  const { articles, total } = searchArticles(q, limit, offset);
  return c.json({ data: articles, total });
});

app.get('/health', (c) => c.json({ ok: true }));

const PORT = Number(process.env['PORT'] ?? 3001);
if (process.env['NODE_ENV'] !== 'test') {
  console.log(`[server] listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}
