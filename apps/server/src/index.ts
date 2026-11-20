import crypto from 'node:crypto';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  refreshAll,
  getArticles,
  getBalancedFeed,
  getFeedArticles,
  withReactions,
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
import { groupedFeedPage } from './groupedFeed.js';
import {
  ADMIN_USERNAME,
  aggregateReactions,
  adminRateState,
  formatCairo,
  isPeriod,
  loadAdminHash,
  parseBasicAuth,
  recordAdminFailure,
  renderAdminCsv,
  renderAdminPage,
  verifyAdminPassword,
  _resetAdminRateLimit,
} from './adminReactions.js';
import {
  getPreferences,
  addKeyword,
  removeKeyword,
  setKeywordNotify,
  muteKeyword,
  unmuteKeyword,
  muteSource,
  unmuteSource,
  isMuted,
  MAX_FOLLOWED_KEYWORDS,
  MAX_MUTED_KEYWORDS,
} from './keywords.js';
import {
  isValidReaction,
  setReaction,
  removeReaction,
  countsFor,
  myReaction,
  checkReactionRate,
  recordReaction,
  REACTION_TYPES,
  REACTION_EMOJI,
  getAllReactions,
} from './reactions.js';
import {
  deleteAccount,
  checkDeleteRateLimit,
  recordDeleteAttempt,
} from './account.js';
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
  recordDevice,
  recordOpen,
  recordShare,
  recordSourceView,
  recordEvent,
  recordQuery,
  recordSignup,
  beaconRateState,
  recordBeaconHit,
  getAnalytics,
} from './analytics.js';
import {
  aggregateStats,
  reactionRowsFromStore,
  renderStatsPage,
  renderStatsCsv,
} from './adminStats.js';
import { userCounts } from './users.js';
import { getAllArticles } from './db.js';
import { privacyCopy, privacyLang, renderPrivacyPage } from './privacy.js';
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
  json: (body: unknown, status: 401 | 403) => Response;
}): Response | null {
  const userId = extractUserId(c.req.header('Authorization'));
  const user = userId ? findUserById(userId) : null;

  // A valid signature for an account that no longer exists (deleted account) must
  // be rejected here. The route's own check only tests whether the token parsed,
  // so returning null for "no such user" let a deleted account keep reading
  // gated endpoints until its 30-day token expired.
  if (!user) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
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
  // Aggregate only: no id, email or IP is recorded for this.
  recordSignup(user.createdAt);

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

/**
 * DELETE /api/auth/account — in-app account deletion.
 * Requires the current password: a stolen session alone must not be able to
 * destroy the account. Removes every record for the user; sessions die with the
 * account because every route looks the user up by id.
 */
app.delete('/api/auth/account', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);

  const user = findUserById(userId);
  if (!user) return c.json({ error: 'Unauthorized' }, 401);

  let body: { password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.password !== 'string' || !body.password) {
    return c.json({ error: 'password is required' }, 400);
  }
  if (!(await verifyPassword(body.password, user.passwordHash))) {
    return c.json({ error: 'incorrect password' }, 401);
  }

  const report = deleteAccount(userId);
  if (!report) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ data: { deleted: true } });
});

/**
 * POST /api/delete-account — the public web form, for people without the app.
 * Same password proof; rate-limited per IP because it is unauthenticated.
 */
app.post('/api/delete-account', async (c) => {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';

  const limit = checkDeleteRateLimit(`ip:${ip}`);
  if (!limit.allowed) {
    const retry = Math.ceil(limit.retryAfterMs / 1000);
    return c.json(
      { error: 'too many requests', retryAfterSeconds: retry },
      429,
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    recordDeleteAttempt(`ip:${ip}`, false);
    return c.json({ error: 'invalid JSON body' }, 400);
  }

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) {
    recordDeleteAttempt(`ip:${ip}`, false);
    return c.json({ error: 'email and password are required' }, 400);
  }

  const user = findUserByEmail(email);
  // Same answer for unknown address and wrong password, so the form cannot be
  // used to discover which addresses have accounts.
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    recordDeleteAttempt(`ip:${ip}`, false);
    return c.json({ error: 'incorrect email or password' }, 401);
  }

  deleteAccount(user.id);
  recordDeleteAttempt(`ip:${ip}`, true);
  return c.json({ data: { deleted: true } });
});

/** GET /delete-account — the public Arabic page explaining how to delete. */
app.get('/delete-account', (c) => {
  return c.html(`<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>حذف الحساب — رئيس التحرير</title>
    <style>
      body{margin:0;min-height:100vh;background:#0B1511;color:#F8FAFC;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;direction:rtl;text-align:right;padding:24px}
      .wrap{max-width:520px;margin:0 auto;background:#182721;border-radius:20px;padding:28px}
      h1{font-size:22px;margin:0 0 8px}
      h2{font-size:16px;margin:24px 0 8px;color:#34D399}
      p,li{font-size:14px;line-height:26px;color:#CBD5E1}
      ul{padding-inline-start:20px}
      label{display:block;font-size:13px;margin:12px 0 6px;color:#94A3B8}
      input{width:100%;box-sizing:border-box;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:#12221B;color:#F8FAFC;padding:0 12px;font-size:14px}
      button{width:100%;height:46px;margin-top:18px;border:0;border-radius:12px;background:#EF4444;color:#fff;font-size:15px;font-weight:700}
      .note{font-size:12px;color:#94A3B8;margin-top:14px}
      .ok{background:#14301F;color:#6EE7B7;padding:12px;border-radius:12px;margin-top:16px;font-size:13px}
      .err{background:#3B1215;color:#F87171;padding:12px;border-radius:12px;margin-top:16px;font-size:13px}
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1>حذف الحساب</h1>
      <p>تحذف حسابك في تطبيق «رئيس التحرير» نهائيًا. الحذف لا رجعة فيه.</p>

      <h2>من داخل التطبيق</h2>
      <p>افتح التطبيق ← «حسابي» ← «حذف الحساب» ← أدخل كلمة المرور للتأكيد.</p>

      <h2>من غير التطبيق</h2>
      <p>لو مسحت التطبيق، اكتب بريدك وكلمة المرور هنا وحذف حسابك على طول.</p>
      <form id="f">
        <label for="email">البريد الإلكتروني</label>
        <input id="email" name="email" type="email" autocomplete="email" dir="ltr" required />
        <label for="password">كلمة المرور</label>
        <input id="password" name="password" type="password" autocomplete="current-password" dir="ltr" required />
        <button type="submit">حذف الحساب نهائيًا</button>
      </form>
      <div id="msg" class="note">بنحذف كل بياناتك: الحساب نفسه، المصادر اللي بتتابعها، المقالات المحفوظة، وتوكن الإشعارات. مفيش نسخة بترجع.</div>

      <h2>قبل الحذف</h2>
      <ul>
        <li>مش هتقدر ترجع الحساب بعد الحذف.</li>
        <li>لو حابب تحتفظ بحاجة، احفظ روابط المقالات المهمة الأول.</li>
        <li>لأي استفسار: no-reply@nileorbit.com</li>
        <li>إيه البيانات اللي بنجمعها؟ شوف <a href="/privacy" style="color:#34D399">سياسة الخصوصية</a>.</li>
      </ul>
    </div>
    <script>
      // A single anchored submit; no frameworks. The endpoint answers JSON.
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = document.getElementById('msg');
        msg.className = 'note';
        msg.textContent = 'جاري الحذف…';
        try {
          const res = await fetch('/api/delete-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: document.getElementById('email').value,
              password: document.getElementById('password').value,
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (res.ok && json.data && json.data.deleted) {
            document.getElementById('f').style.display = 'none';
            msg.className = 'ok';
            msg.textContent = 'تم حذف حسابك وكل بياناته. شكرًا لاستخدامك رئيس التحرير.';
          } else if (res.status === 429) {
            msg.className = 'err';
            msg.textContent = 'محاولات كثيرة. حاول تاني بعد ' + (json.retryAfterSeconds || 3600) + ' ثانية.';
          } else {
            msg.className = 'err';
            msg.textContent = 'البريد أو كلمة المرور غلط.';
          }
        } catch {
          msg.className = 'err';
          msg.textContent = 'تعذّر الاتصال. حاول مرة أخرى.';
        }
      });
    </script>
  </body>
</html>`);
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
  recordEvent('follow');
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
  return c.json({
    data: articles.map((a) => withReactions(a, userId)),
    total: articles.length,
  });
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
  return c.json({ data: page.map((a) => withReactions(a, userId)), total: page.length });
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
  recordEvent('save');
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
  const viewerId = extractUserId(c.req.header('Authorization'));
  const grouped = c.req.query('grouped');

  if (grouped === '1' || grouped === 'true') {
    // Grouped shape: /api/feed?grouped=1 returns rows that are either an article
    // or a same-story cluster. The default shape is untouched for compatibility.
    const ordered = getFeedArticles();
    const page = groupedFeedPage(ordered, offset, limit, maxPerSource);
    return c.json({
      data: page.rows.map((row) =>
        row.kind === 'article'
          ? { kind: 'article' as const, article: withReactions(row.article, viewerId) }
          : {
              kind: 'cluster' as const,
              lead: withReactions(row.lead, viewerId),
              members: row.members.map((m) => withReactions(m, viewerId)),
              sourceCount: new Set(row.members.map((m) => m.sourceId)).size,
              isBreaking: row.members.some((m) => m.isBreaking),
            },
      ),
      total: page.totalArticles,
      totalRows: page.totalRows,
      grouped: true,
    });
  }

  const { articles, total } = getBalancedFeed(limit, offset, maxPerSource);

  // Mutes hide content for a signed-in user, server-side. Filtering happens after
  // balancing so a hidden article does not reshuffle everyone else's order, and
  // the page may legitimately come back shorter than `limit`.
  let visible = articles;
  if (viewerId) {
    const prefs = getPreferences(viewerId);
    if (prefs.mutedSources.length || prefs.mutedKeywords.length) {
      visible = articles.filter((a) => !isMuted(a, prefs));
    }
  }
  return c.json({ data: visible.map((a) => withReactions(a, viewerId)), total });
});

app.get('/api/sources', (c) => {
  return c.json({ data: getSources() });
});

app.get('/api/categories', (c) => {
  return c.json({ data: getCategories() });
});

app.get('/api/trending', (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 20), 50);
  const viewerId = extractUserId(c.req.header('Authorization'));
  const articles = getTrending(limit);
  // Every list that renders a card carries counts and myReaction; the card is the
  // same component everywhere, so a list without them shows an empty capsule.
  return c.json({
    data: articles.map((a) => withReactions(a, viewerId)),
    total: articles.length,
  });
});

app.get('/api/sources/:id/articles', (c) => {
  const id = c.req.param('id');
  const source = getSourceMeta(id);
  if (!source) return c.json({ error: 'not found' }, 404);
  recordSourceView(id);
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const offset = Number(c.req.query('offset') ?? 0);
  const articles = getArticlesBySource(id, limit, offset);
  const viewerId = extractUserId(c.req.header('Authorization'));
  return c.json({ data: articles.map((a) => withReactions(a, viewerId)), source });
});

// Search across title, summary and source name (Arabic-normalized).
app.get('/api/articles/:id', (c) => {
  const article = getArticleById(c.req.param('id'));
  if (!article) return c.json({ error: 'article not found' }, 404);
  const viewerId = extractUserId(c.req.header('Authorization'));
  return c.json({ data: withReactions(article, viewerId) });
});

/**
 * PUT /api/articles/:id/reaction — set or replace the caller's reaction.
 * Verified accounts only: reacting is account-bound (403 EMAIL_NOT_VERIFIED).
 * Tapping the same reaction again removes it, which the app expresses by
 * calling DELETE, so this endpoint always sets.
 */
app.put('/api/articles/:id/reaction', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  const articleId = c.req.param('id');
  if (!getArticleById(articleId)) return c.json({ error: 'article not found' }, 404);

  let body: { type?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (!isValidReaction(body.type)) {
    return c.json({ error: `type must be one of: ${REACTION_TYPES.join(', ')}` }, 400);
  }

  const rate = checkReactionRate(userId);
  if (!rate.allowed) {
    return c.json(
      { error: 'too many reactions', retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000) },
      429,
    );
  }

  const result = setReaction(articleId, userId, body.type);
  recordReaction(userId);
  return c.json({ data: result });
});

/** DELETE /api/articles/:id/reaction — remove the caller's reaction. */
app.delete('/api/articles/:id/reaction', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  const articleId = c.req.param('id');
  if (!getArticleById(articleId)) return c.json({ error: 'article not found' }, 404);

  const result = removeReaction(articleId, userId);
  return c.json({ data: result });
});

/** Public counts, allowed for everyone including guests. */
app.get('/api/articles/:id/reactions', (c) => {
  const articleId = c.req.param('id');
  if (!getArticleById(articleId)) return c.json({ error: 'article not found' }, 404);
  const viewerId = extractUserId(c.req.header('Authorization'));
  return c.json({
    data: {
      counts: countsFor(articleId),
      myReaction: myReaction(articleId, viewerId),
      emoji: REACTION_EMOJI,
    },
  });
});

/** GET /api/preferences — followed keywords and mutes for the caller. */
app.get('/api/preferences', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  const prefs = getPreferences(userId);
  return c.json({
    data: {
      keywords: prefs.keywords,
      mutedKeywords: prefs.mutedKeywords,
      mutedSources: prefs.mutedSources,
      limits: { keywords: MAX_FOLLOWED_KEYWORDS, mutedKeywords: MAX_MUTED_KEYWORDS },
    },
  });
});

/** POST /api/keywords {keyword, notify} — follow a keyword. */
app.post('/api/keywords', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { keyword?: unknown; notify?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.keyword !== 'string') return c.json({ error: 'keyword is required' }, 400);

  const result = addKeyword(userId, body.keyword, body.notify !== false);
  if (!result.ok) {
    if (result.error === 'limit') {
      return c.json({ error: `keyword limit reached (${MAX_FOLLOWED_KEYWORDS})` }, 409);
    }
    if (result.error === 'duplicate') return c.json({ error: 'already following' }, 409);
    return c.json({ error: 'keyword must be at least 2 characters' }, 400);
  }
  recordEvent('keyword_follow');
  return c.json({ data: { keywords: result.keywords } });
});

/** DELETE /api/keywords/:keyword */
app.delete('/api/keywords/:keyword', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;
  return c.json({ data: { keywords: removeKeyword(userId, c.req.param('keyword')) } });
});

/** PUT /api/keywords/:keyword/notify {notify} — per-keyword toggle. */
app.put('/api/keywords/:keyword/notify', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { notify?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.notify !== 'boolean') return c.json({ error: 'notify must be a boolean' }, 400);
  return c.json({
    data: { keywords: setKeywordNotify(userId, c.req.param('keyword'), body.notify) },
  });
});

/** POST /api/mutes {keyword} or {sourceId} */
app.post('/api/mutes', async (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  let body: { keyword?: unknown; sourceId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.keyword === 'string') {
    recordEvent('keyword_mute');
    return c.json({ data: { mutedKeywords: muteKeyword(userId, body.keyword) } });
  }
  if (typeof body.sourceId === 'string') {
    recordEvent('keyword_mute');
    return c.json({ data: { mutedSources: muteSource(userId, body.sourceId) } });
  }
  return c.json({ error: 'keyword or sourceId is required' }, 400);
});

/** DELETE /api/mutes?keyword=… or ?sourceId=… */
app.delete('/api/mutes', (c) => {
  const userId = extractUserId(c.req.header('Authorization'));
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const gate = requireVerified(c);
  if (gate) return gate;

  const keyword = c.req.query('keyword');
  const sourceId = c.req.query('sourceId');
  if (keyword) return c.json({ data: { mutedKeywords: unmuteKeyword(userId, keyword) } });
  if (sourceId) return c.json({ data: { mutedSources: unmuteSource(userId, sourceId) } });
  return c.json({ error: 'keyword or sourceId is required' }, 400);
});

app.get('/api/search', (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 50), 1), 200);
  const offset = Math.max(Number(c.req.query('offset') ?? 0), 0);
  // Count the query text only: no user, no IP, and nothing below 2 chars.
  recordQuery(q);
  const { articles, total } = searchArticles(q, limit, offset);
  const viewerId = extractUserId(c.req.header('Authorization'));
  return c.json({ data: articles.map((a) => withReactions(a, viewerId)), total });
});

// --- Admin: reaction statistics (aggregate counts only) ---

/**
 * Shared guard for /admin/*: 503 when no hash is configured, 401 with a
 * WWW-Authenticate challenge when credentials are missing or wrong, 429 after too
 * many failures. Returns a response to send, or null when the request may proceed.
 */
function guardAdmin(c: {
  req: { header: (n: string) => string | undefined };
  json: (b: unknown, s: 401 | 429 | 503) => Response;
}): Response | null {
  const hash = loadAdminHash();
  if (!hash) return c.json({ error: 'admin disabled' }, 503);

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const rate = adminRateState(ip);
  if (!rate.allowed) {
    return c.json(
      { error: 'too many attempts', retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000) },
      429,
    );
  }

  const creds = parseBasicAuth(c.req.header('authorization'));
  if (!creds || creds.username !== ADMIN_USERNAME || !verifyAdminPassword(creds.password, hash)) {
    recordAdminFailure(ip);
    return c.json({ error: 'unauthorized' }, 401);
  }
  return null;
}

/** The challenge header, needed so browsers prompt. */
function adminChallenge(c: { header: (n: string, v: string) => void }): void {
  c.header('WWW-Authenticate', 'Basic realm="admin", charset="UTF-8"');
  c.header('X-Robots-Tag', 'noindex, nofollow, noarchive');
}

/** Build the aggregate for the current query string. */
function adminDataFromQuery(q: Record<string, string | undefined>): ReturnType<typeof aggregateReactions> {
  const period = isPeriod(q['period']) ? q['period'] : '7d';
  const sortParam = q['sort'];
  const sort =
    sortParam && (REACTION_TYPES as readonly string[]).includes(sortParam)
      ? (sortParam as (typeof REACTION_TYPES)[number])
      : 'total';
  const page = Math.max(1, Number(q['page'] ?? 1) || 1);
  const articles = getFeedArticles().map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    sourceName: a.sourceName,
    publishedAt: a.publishedAt,
  }));
  return aggregateReactions(getAllReactions(), articles, { period, sort, page });
}

app.get('/admin/reactions', (c) => {
  const denied = guardAdmin(c);
  if (denied) {
    if (denied.status === 401) adminChallenge(c);
    return denied;
  }
  adminChallenge(c);
  const data = adminDataFromQuery({
    period: c.req.query('period'),
    sort: c.req.query('sort'),
    page: c.req.query('page'),
  });
  return c.html(renderAdminPage(data));
});

app.get('/admin/reactions.csv', (c) => {
  const denied = guardAdmin(c);
  if (denied) {
    if (denied.status === 401) adminChallenge(c);
    return denied;
  }
  adminChallenge(c);
  const data = adminDataFromQuery({
    period: c.req.query('period'),
    sort: c.req.query('sort'),
    page: '1',
  });
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="reactions-${data.period}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return c.body(renderAdminCsv(data));
});

/** GET /privacy — the public privacy policy. Indexable on purpose (Play needs a
 * reachable policy URL), Arabic by default and English at ?lang=en. */
app.get('/privacy', (c) => {
  const lang = privacyLang(c.req.query('lang'));
  return c.html(renderPrivacyPage(privacyCopy(lang)));
});

/** Robots: keep crawlers out of /admin entirely. */
app.get('/robots.txt', (c) => {
  c.header('Content-Type', 'text/plain; charset=utf-8');
  return c.body('User-agent: *\nDisallow: /admin\nAllow: /\n');
});

// --- Usage beacon endpoints (unauthenticated, rate-limited, no identity) ---

/**
 * Shared guard for the beacons: a per-IP budget, plus the day's anonymous
 * device count. Nothing here reads or stores the caller's account.
 */
function guardBeacon(c: {
  req: { header: (n: string) => string | undefined };
  json: (b: unknown, s: 429) => Response;
}): Response | null {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || c.req.header('x-real-ip') || 'unknown';
  const rate = beaconRateState(ip);
  if (!rate.allowed) {
    return c.json({ error: 'too many requests', retryAfterSeconds: Math.ceil(rate.retryAfterMs / 1000) }, 429);
  }
  recordBeaconHit(ip);
  // Count the device for today's DAU. The raw id is hashed and discarded.
  recordDevice(c.req.header('x-install-id'));
  return null;
}

/** POST /api/events/open {articleId} — the reader was opened. */
app.post('/api/events/open', async (c) => {
  const denied = guardBeacon(c);
  if (denied) return denied;
  let body: { articleId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.articleId !== 'string' || !body.articleId) {
    return c.json({ error: 'articleId is required' }, 400);
  }
  if (!getArticleById(body.articleId)) return c.json({ error: 'article not found' }, 404);
  recordOpen(body.articleId);
  return c.json({ ok: true });
});

/** POST /api/events/share {articleId} — the share sheet was used. */
app.post('/api/events/share', async (c) => {
  const denied = guardBeacon(c);
  if (denied) return denied;
  let body: { articleId?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid JSON body' }, 400);
  }
  if (typeof body.articleId !== 'string' || !body.articleId) {
    return c.json({ error: 'articleId is required' }, 400);
  }
  if (!getArticleById(body.articleId)) return c.json({ error: 'article not found' }, 404);
  recordShare(body.articleId);
  return c.json({ ok: true });
});

/** GET /api/events/ping — app start: counts the device for today only. */
app.get('/api/events/ping', (c) => {
  const denied = guardBeacon(c);
  if (denied) return denied;
  return c.json({ ok: true });
});

// --- Admin: usage statistics (aggregate counts only) ---

/** Build the aggregate for the current query string. */
function statsDataFromQuery(q: Record<string, string | undefined>): ReturnType<typeof aggregateStats> {
  const period = isPeriod(q['period']) ? q['period'] : '7d';
  const articles = getAllArticles().map((a) => ({
    id: a.id,
    title: a.title,
    url: a.url,
    sourceName: a.sourceName,
    sourceId: a.sourceId,
    category: a.category,
  }));
  // Reaction timestamps only; the aggregation never sees a user id.
  const reactions = reactionRowsFromStore(getAllReactions());
  return aggregateStats(getAnalytics(), articles, reactions, userCounts(), {
    period,
    // All ten outlets, so a source with no opens shows 0 rather than vanishing.
    knownSources: getSources().map((s) => ({ id: s.id, name: s.name })),
  });
}

app.get('/admin/stats', (c) => {
  const denied = guardAdmin(c);
  if (denied) {
    if (denied.status === 401) adminChallenge(c);
    return denied;
  }
  adminChallenge(c);
  const data = statsDataFromQuery({ period: c.req.query('period') });
  return c.html(renderStatsPage(data));
});

app.get('/admin/stats.csv', (c) => {
  const denied = guardAdmin(c);
  if (denied) {
    if (denied.status === 401) adminChallenge(c);
    return denied;
  }
  adminChallenge(c);
  const data = statsDataFromQuery({ period: c.req.query('period') });
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="stats-${data.period}-${new Date().toISOString().slice(0, 10)}.csv"`,
  );
  return c.body(renderStatsCsv(data));
});

app.get('/health', (c) => c.json({ ok: true }));

const PORT = Number(process.env['PORT'] ?? 3001);
if (process.env['NODE_ENV'] !== 'test') {
  console.log(`[server] listening on http://localhost:${PORT}`);
  serve({ fetch: app.fetch, port: PORT });
}
