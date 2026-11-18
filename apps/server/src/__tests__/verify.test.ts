/**
 * Email verification: token handling, resend limits, the verify page, gating,
 * and the migration that keeps existing accounts usable.
 *
 * Resend is always a stub fetch — no email leaves this process.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import {
  hashToken,
  generateToken,
  issueToken,
  consumeToken,
  peekToken,
  resendAllowance,
  recordResend,
  sentTimes,
  buildVerificationEmail,
  sendVerificationEmail,
  maskEmail,
  loadResendKey,
  verifyUrl,
  RESEND_COOLDOWN_MS,
  RESEND_DAILY_LIMIT,
  TOKEN_TTL_MS,
  _resetVerifyCache,
} from '../verify.js';
import {
  createUser,
  findUserByEmail,
  findUserById,
  markUserVerified,
  normalizeEmail,
  deleteUser,
  _resetUsersCache,
  type StoredUser,
} from '../users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const TOKENS_FILE = path.join(DATA_DIR, 'verify-tokens.json');

function user(overrides: Partial<StoredUser> = {}): StoredUser {
  return {
    id: 'user-1',
    email: 'reader@example.com',
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: false,
    ...overrides,
  };
}

beforeEach(() => {
  for (const f of [USERS_FILE, TOKENS_FILE]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetVerifyCache();
  delete process.env['RESEND_API_KEY_FILE'];
});

describe('verify: email normalization', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Reader@Example.COM ')).toBe('reader@example.com');
  });

  it('treats differently-cased addresses as the same account', async () => {
    createUser(user({ email: 'Reader@Example.com' }));
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '  READER@example.COM  ', password: 'password123' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('verify: tokens', () => {
  it('generates at least 32 bytes of randomness', () => {
    const token = generateToken();
    // base64url of 32 bytes = 43 chars
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(new Set(Array.from({ length: 20 }, generateToken)).size).toBe(20);
  });

  it('hashes with SHA-256 and stores only the hash', () => {
    const { token } = issueToken('user-1');
    const raw = fs.readFileSync(TOKENS_FILE, 'utf8');
    expect(raw).not.toContain(token); // the raw token is never written
    const stored = JSON.parse(raw) as { tokens: Array<{ tokenHash: string }> };
    expect(stored.tokens[0]?.tokenHash).toBe(hashToken(token));
    expect(stored.tokens[0]?.tokenHash).toHaveLength(64);
  });

  it('verifies a live token exactly once', () => {
    const { token } = issueToken('user-1');
    expect(peekToken(token).status).toBe('verified');
    expect(consumeToken(token)).toEqual({ status: 'verified', userId: 'user-1' });
    // second use is distinguishable from invalid
    expect(consumeToken(token).status).toBe('used');
  });

  it('expires after 24 hours', () => {
    const issuedAt = 1_000_000;
    const { token } = issueToken('user-1', issuedAt);
    expect(consumeToken(token, issuedAt + TOKEN_TTL_MS - 1).status).toBe('verified');

    _resetVerifyCache();
    fs.rmSync(TOKENS_FILE, { force: true });
    const second = issueToken('user-1', issuedAt).token;
    expect(consumeToken(second, issuedAt + TOKEN_TTL_MS + 1).status).toBe('expired');
  });

  it('rejects an unknown or empty token', () => {
    expect(consumeToken('not-a-real-token').status).toBe('invalid');
    expect(consumeToken('').status).toBe('invalid');
  });

  it('invalidates the older token when a new one is issued', () => {
    const first = issueToken('user-1').token;
    const second = issueToken('user-1').token;
    expect(consumeToken(first).status).toBe('invalid');
    expect(consumeToken(second).status).toBe('verified');
  });
});

describe('verify: resend policy', () => {
  const now = 1_700_000_000_000;

  it('allows the first send', () => {
    expect(resendAllowance([], now)).toEqual({
      allowed: true,
      retryAfterMs: 0,
      remainingToday: RESEND_DAILY_LIMIT,
    });
  });

  it('enforces the 60s cooldown', () => {
    const sentAt = [now - 1_000];
    const result = resendAllowance(sentAt, now);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBe(RESEND_COOLDOWN_MS - 1_000);
  });

  it('allows again right after the cooldown', () => {
    expect(resendAllowance([now - RESEND_COOLDOWN_MS], now).allowed).toBe(true);
  });

  it('caps at 5 per rolling day', () => {
    const sentAt = Array.from({ length: RESEND_DAILY_LIMIT }, (_, i) => now - i * 61_000);
    const result = resendAllowance(sentAt, now);
    expect(result.allowed).toBe(false);
    expect(result.remainingToday).toBe(0);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('forgets sends older than a day', () => {
    const old = Array.from({ length: RESEND_DAILY_LIMIT }, (_, i) => now - 25 * 60 * 60 * 1000 - i * 1000);
    expect(resendAllowance(old, now).allowed).toBe(true);
    expect(resendAllowance(old, now).remainingToday).toBe(RESEND_DAILY_LIMIT);
  });

  it('records and reports send history', () => {
    recordResend('user-1', now);
    recordResend('user-1', now + RESEND_COOLDOWN_MS + 1);
    expect(sentTimes('user-1')).toHaveLength(2);
  });
});

describe('verify: email content', () => {
  const link = verifyUrl('abc123');

  it('builds an RTL Arabic email with the button and the link', () => {
    const content = buildVerificationEmail(link);
    expect(content.subject).toBe('وثّق بريدك في رئيس التحرير');
    expect(content.html).toContain('dir="rtl"');
    expect(content.html).toContain('توثيق البريد');
    expect(content.html).toContain(link);
    expect(content.html).toContain('24 ساعة');
    expect(content.html).toContain('تجاهل');
    expect(content.html).not.toContain('<script');
  });

  it('has a plain-text part with the link', () => {
    const content = buildVerificationEmail(link);
    expect(content.text).toContain(link);
    expect(content.text).toContain('24 ساعة');
    expect(content.text).not.toContain('<');
  });

  it('points at /verify on the public host', () => {
    expect(link).toBe('https://news.nileorbit.com/verify?token=abc123');
  });

  it('masks addresses in logs', () => {
    expect(maskEmail('delivered@resend.dev')).toBe('de*******@resend.dev');
    expect(maskEmail('a@b.co')).toBe('a*@b.co');
    expect(maskEmail('nonsense')).toBe('***');
  });
});

describe('verify: Resend client', () => {
  it('posts the documented payload and returns the id', async () => {
    const calls: Array<{ url: string; body: any; auth: string }> = [];
    const fetcher = (async (url: string, init: any) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init.body)),
        auth: init.headers.Authorization,
      });
      return { ok: true, status: 200, json: async () => ({ id: 'resend-msg-1' }) } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await sendVerificationEmail('delivered@resend.dev', 'https://x/verify?token=t', 're_test', fetcher);
    expect(result).toEqual({ ok: true, id: 'resend-msg-1', status: 200 });
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect(calls[0]!.auth).toBe('Bearer re_test');
    expect(calls[0]!.body.from).toBe('رئيس التحرير <no-reply@nileorbit.com>');
    expect(calls[0]!.body.to).toEqual(['delivered@resend.dev']);
    expect(calls[0]!.body.subject).toBe('وثّق بريدك في رئيس التحرير');
  });

  it('does nothing without a key', async () => {
    let called = false;
    const fetcher = (async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
    const result = await sendVerificationEmail('delivered@resend.dev', 'https://x', null, fetcher);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no-api-key');
    expect(called).toBe(false);
  });

  it('reports a rejection without throwing', async () => {
    const fetcher = (async () => ({
      ok: false,
      status: 422,
      text: async () => 'invalid from address',
    })) as unknown as typeof fetch;
    const result = await sendVerificationEmail('delivered@resend.dev', 'https://x', 're_test', fetcher);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  it('returns null for a missing key file', () => {
    expect(loadResendKey(path.join(DATA_DIR, 'nope-key'))).toBeNull();
  });
});

describe('verify: migration of existing accounts', () => {
  it('marks accounts without the field as verified on load', () => {
    // Write a pre-verification users file by hand.
    fs.writeFileSync(
      USERS_FILE,
      JSON.stringify([
        { id: 'old-1', email: 'old@example.com', passwordHash: 'a:b', createdAt: 111 },
        { id: 'old-2', email: 'OLD2@example.com', passwordHash: 'c:d', createdAt: 222 },
      ]),
    );
    _resetUsersCache();

    const first = findUserById('old-1');
    const second = findUserById('old-2');
    expect(first?.emailVerified).toBe(true);
    expect(first?.verifiedAt).toBe(111);
    expect(second?.emailVerified).toBe(true);

    // It is persisted, not just computed on read.
    const onDisk = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) as StoredUser[];
    expect(onDisk.every((u) => u.emailVerified === true)).toBe(true);
  });

  it('leaves an explicitly unverified account alone', () => {
    createUser(user({ id: 'new-1', emailVerified: false }));
    _resetUsersCache();
    expect(findUserById('new-1')?.emailVerified).toBe(false);
  });

  it('marks an account verified on demand', () => {
    createUser(user({ id: 'u2', emailVerified: false }));
    const updated = markUserVerified('u2', 999);
    expect(updated?.emailVerified).toBe(true);
    expect(updated?.verifiedAt).toBe(999);
  });
});

describe('verify: gated endpoints', () => {
  async function signUp(email: string): Promise<{ token: string; id: string }> {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    const json = (await res.json()) as { data: { token: string; user: { id: string } } };
    return { token: json.data.token, id: json.data.user.id };
  }

  const gatedCalls: Array<[string, string, RequestInit?]> = [
    ['GET', '/api/follows'],
    ['PUT', '/api/follows/youm7'],
    ['DELETE', '/api/follows/youm7'],
    ['GET', '/api/feed/following'],
    ['GET', '/api/saved'],
    ['GET', '/api/saved/some-article'],
    ['PUT', '/api/saved/some-article'],
    ['DELETE', '/api/saved/some-article'],
    ['POST', '/api/push/register', { body: JSON.stringify({ token: 'fcm-x', platform: 'android' }) }],
    ['PUT', '/api/push/preferences', { body: JSON.stringify({ token: 'fcm-x', enabled: true }) }],
    ['GET', '/api/push/preferences?token=fcm-x'],
    ['DELETE', '/api/push/register', { body: JSON.stringify({ token: 'fcm-x' }) }],
  ];

  it('returns 403 EMAIL_NOT_VERIFIED on every account-bound endpoint', async () => {
    const { token } = await signUp(`unverified${Date.now()}@example.com`);
    for (const [method, url, init] of gatedCalls) {
      const res = await app.request(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(init ?? {}),
      });
      expect(res.status, `${method} ${url}`).toBe(403);
      const json = (await res.json()) as { code?: string; emailVerified?: boolean };
      expect(json.code, `${method} ${url}`).toBe('EMAIL_NOT_VERIFIED');
      expect(json.emailVerified).toBe(false);
    }
  });

  it('keeps browsing public for an unverified account', async () => {
    for (const url of ['/api/feed', '/api/sources', '/api/categories', '/api/trending', '/api/search?q=خبر']) {
      const res = await app.request(url);
      expect(res.status, url).toBe(200);
    }
  });

  it('allows every gated endpoint again once verified', async () => {
    const { token, id } = await signUp(`becomes-verified${Date.now()}@example.com`);
    markUserVerified(id);

    for (const [method, url, init] of gatedCalls) {
      const res = await app.request(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(init ?? {}),
      });
      expect(res.status, `${method} ${url}`).not.toBe(403);
    }
  });

  it('reports emailVerified in the session', async () => {
    const { token, id } = await signUp(`session${Date.now()}@example.com`);
    const before = (await (await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: { user: { emailVerified: boolean } } };
    expect(before.data.user.emailVerified).toBe(false);

    markUserVerified(id);
    const after = (await (await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: { user: { emailVerified: boolean } } };
    expect(after.data.user.emailVerified).toBe(true);
  });
});

describe('verify: /verify page', () => {
  it('verifies the account through the link and shows success', async () => {
    createUser(user({ id: 'link-user', email: 'link@example.com' }));
    const { token } = issueToken('link-user');

    const res = await app.request(`/verify?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('تم توثيق بريدك');
    expect(html).toContain('dir="rtl"');
    expect(findUserById('link-user')?.emailVerified).toBe(true);

    // The same link twice: consumed, and said so.
    const again = await app.request(`/verify?token=${encodeURIComponent(token)}`);
    expect(again.status).toBe(400);
    expect(await again.text()).toContain('تم استخدام هذا الرابط');
  });

  it('explains an expired link', async () => {
    const { token } = issueToken('link-user', Date.now() - TOKEN_TTL_MS - 1000);
    const res = await app.request(`/verify?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('انتهت صلاحية رابط التوثيق');
  });

  it('explains an invalid link and points at resend', async () => {
    const res = await app.request('/verify?token=garbage');
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).toContain('رابط التوثيق غير صالح');
    expect(html).toContain('إعادة إرسال الرابط');
  });

  it('handles a missing token', async () => {
    const res = await app.request('/verify');
    expect(res.status).toBe(400);
    expect(await res.text()).toContain('رابط التوثيق غير صالح');
  });
});

describe('verify: resend endpoint', () => {
  async function signUp(email: string): Promise<{ token: string; id: string }> {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    const json = (await res.json()) as { data: { token: string; user: { id: string } } };
    return { token: json.data.token, id: json.data.user.id };
  }

  it('requires a session', async () => {
    const res = await app.request('/api/auth/resend-verification', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('is a 200 no-op for a verified account', async () => {
    const { token, id } = await signUp(`verified${Date.now()}@example.com`);
    markUserVerified(id);
    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { alreadyVerified?: boolean } };
    expect(json.data.alreadyVerified).toBe(true);
  });

  it('enforces the cooldown with a retry time', async () => {
    const { token } = await signUp(`cooldown${Date.now()}@example.com`);
    recordResend(findUserByEmail((await (await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })).json() as any).data.user.email)!.id);

    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as { code: string; retryAfterSeconds: number };
    expect(json.code).toBe('RESEND_RATE_LIMITED');
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
    expect(json.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('enforces the daily cap', async () => {
    const { token, id } = await signUp(`daily${Date.now()}@example.com`);
    const now = Date.now();
    for (let i = 0; i < RESEND_DAILY_LIMIT; i++) {
      recordResend(id, now - i * (RESEND_COOLDOWN_MS + 1000));
    }
    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as { remainingToday: number };
    expect(json.remainingToday).toBe(0);
  });

  it('sends through Resend when allowed, and reports it', async () => {
    const { token } = await signUp(`send${Date.now()}@example.com`);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'resend-live-1' }),
      text: async () => '',
    } as unknown as Response);

    // Point the key loader at a real file so the send is attempted.
    const keyFile = path.join(DATA_DIR, 'resend-test-key');
    fs.writeFileSync(keyFile, 're_fake_key_for_tests');
    process.env['RESEND_API_KEY_FILE'] = keyFile;

    const res = await app.request('/api/auth/resend-verification', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { sent: boolean; message: string } };
    expect(json.data.sent).toBe(true);
    expect(json.data.message).toBe('sent');
    expect(fetchSpy).toHaveBeenCalledOnce();

    fetchSpy.mockRestore();
    fs.rmSync(keyFile, { force: true });
  });
});

describe('verify: sign-up flow', () => {
  it('creates an unverified account but still returns a session', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `fresh${Date.now()}@example.com`, password: 'password123' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { token: string; user: { emailVerified: boolean } };
    };
    expect(json.data.token).toBeTruthy();
    expect(json.data.user.emailVerified).toBe(false);
  });

  it('still signs up when no Resend key is configured', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `nokey${Date.now()}@example.com`, password: 'password123' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { user: { emailVerified: boolean } } };
    expect(json.data.user.emailVerified).toBe(false);
  });

  it('deletes a single account without touching others', () => {
    createUser(user({ id: 'keep-me', email: 'keep@example.com' }));
    createUser(user({ id: 'drop-me', email: 'drop@example.com' }));
    expect(deleteUser('drop-me')).toBe(true);
    expect(findUserById('drop-me')).toBeNull();
    expect(findUserById('keep-me')).not.toBeNull();
    expect(deleteUser('drop-me')).toBe(false);
  });
});
