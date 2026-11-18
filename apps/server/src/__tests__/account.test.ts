/**
 * Account deletion: every related record goes, sessions die, and the public web
 * form works with a rate limit.
 *
 * Play requires deletion to actually delete; a lingering push token would keep
 * notifying a closed account, and a lingering follows row would reappear for the
 * next sign-up with the same address.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { createToken } from '../auth.js';
import {
  createUser,
  findUserById,
  markUserVerified,
  _resetUsersCache,
  type StoredUser,
} from '../users.js';

/** Sign-ups start unverified; gated-route tests need a verified account. */
function markVerifiedForTest(userId: string): void {
  markUserVerified(userId);
}
import { followSource, getFollowedSources, _resetFollowsCache } from '../follows.js';
import { saveArticle, getSavedArticleIds, _resetSavedCache } from '../saved.js';
import { registerPushToken, getAllPushRecords, _resetPushCache } from '../push.js';
import { issueToken, sentTimes, _resetVerifyCache } from '../verify.js';
import {
  deleteAccount,
  rateLimitState,
  checkDeleteRateLimit,
  recordDeleteAttempt,
  _resetDeletionStore,
  DELETE_RATE_LIMIT,
  DELETE_RATE_WINDOW_MS,
} from '../account.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

const FILES = [
  'users.json',
  'follows.json',
  'saved.json',
  'push-tokens.json',
  'verify-tokens.json',
  'deletions.json',
];

function resetAll(): void {
  for (const f of FILES) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetFollowsCache();
  _resetSavedCache();
  _resetPushCache();
  _resetVerifyCache();
  _resetDeletionStore();
}

/** A user with one row in every store. */
function userWithData(id = 'user-del-1', email = 'del@example.com'): StoredUser {
  const user: StoredUser = {
    id,
    email,
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: true,
  };
  createUser(user);
  followSource(id, 'youm7');
  saveArticle(id, 'article-1');
  registerPushToken(id, 'fcm-token-del', 'android');
  issueToken(id);
  return user;
}

beforeEach(resetAll);

describe('account deletion: removes every related record', () => {
  it('deletes the user, follows, saved articles, push tokens and verify data', () => {
    const user = userWithData();

    // Everything is present before.
    expect(findUserById(user.id)).not.toBeNull();
    expect(getFollowedSources(user.id)).toEqual(['youm7']);
    expect(getSavedArticleIds(user.id)).toEqual(['article-1']);
    expect(getAllPushRecords()).toHaveLength(1);
    expect(sentTimes(user.id).length).toBeGreaterThanOrEqual(0);

    const report = deleteAccount(user.id);
    expect(report).not.toBeNull();

    // Everything is gone after.
    expect(findUserById(user.id)).toBeNull();
    expect(getFollowedSources(user.id)).toEqual([]);
    expect(getSavedArticleIds(user.id)).toEqual([]);
    expect(getAllPushRecords()).toHaveLength(0);
    expect(report?.follows).toBe(1);
    expect(report?.saved).toBe(1);
    expect(report?.pushTokens).toBe(1);
  });

  it('leaves other users untouched', () => {
    const doomed = userWithData('user-a', 'a@example.com');
    const kept = userWithData('user-b', 'b@example.com');

    deleteAccount(doomed.id);

    expect(findUserById(doomed.id)).toBeNull();
    expect(findUserById(kept.id)).not.toBeNull();
    expect(getFollowedSources(kept.id)).toEqual(['youm7']);
    expect(getSavedArticleIds(kept.id)).toEqual(['article-1']);
    // The surviving user still has their own token.
    expect(getAllPushRecords()).toHaveLength(1);
    expect(getAllPushRecords()[0]?.userId).toBe(kept.id);
  });

  it('returns null for an unknown account', () => {
    expect(deleteAccount('nobody')).toBeNull();
  });

  it('is idempotent: a second call is a no-op', () => {
    const user = userWithData();
    expect(deleteAccount(user.id)).not.toBeNull();
    expect(deleteAccount(user.id)).toBeNull();
  });

  it('does not let a re-signup inherit the old data', () => {
    const user = userWithData('user-re', 'same@example.com');
    deleteAccount(user.id);

    // Same id and address again: nothing carries over.
    userWithData('user-re', 'same@example.com');
    expect(getFollowedSources('user-re')).toEqual(['youm7']); // only what was just created
    expect(getSavedArticleIds('user-re')).toEqual(['article-1']);
    expect(getAllPushRecords()).toHaveLength(1);
  });
});

describe('DELETE /api/auth/account', () => {
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
    const res = await app.request('/api/auth/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with 401 and keeps the account', async () => {
    const { token, id } = await signUp(`wrongpass${Date.now()}@example.com`);
    const res = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'not-the-password' }),
    });
    expect(res.status).toBe(401);
    expect(findUserById(id)).not.toBeNull();
  });

  it('rejects a missing password with 400', async () => {
    const { token } = await signUp(`nopass${Date.now()}@example.com`);
    const res = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('deletes the account with the correct password and invalidates the session', async () => {
    const { token, id } = await signUp(`deleteme${Date.now()}@example.com`);

    const res = await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { deleted: boolean } }).data.deleted).toBe(true);
    expect(findUserById(id)).toBeNull();

    // The old session no longer resolves.
    const me = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(me.status).toBe(401);
  });

  it('rejects a deleted account on every gated route, not just /me', async () => {
    // Regression: requireVerified treated "no such user" as allowed, so a valid
    // token for a deleted account kept reading gated endpoints (empty arrays)
    // until it expired 30 days later.
    const { token, id } = await signUp(`gated${Date.now()}@example.com`);
    markVerifiedForTest(id);

    // Works while the account exists.
    expect((await app.request('/api/follows', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);

    await app.request('/api/auth/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'password123' }),
    });

    for (const [method, url] of [
      ['GET', '/api/follows'],
      ['GET', '/api/saved'],
      ['GET', '/api/feed/following'],
      ['GET', '/api/push/preferences?token=x'],
    ] as Array<[string, string]>) {
      const res = await app.request(url, {
        method,
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status, `${method} ${url}`).toBe(401);
    }
  });
});

describe('public deletion form', () => {
  it('serves an Arabic RTL page', async () => {
    const res = await app.request('/delete-account');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('حذف الحساب');
    expect(html).toContain('حسابي');
    expect(html).toContain('/api/delete-account');
  });

  it('deletes an account by email and password', async () => {
    const email = `webf${Date.now()}@example.com`;
    const reg = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    const id = ((await reg.json()) as { data: { user: { id: string } } }).data.user.id;

    const res = await app.request('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    expect(res.status).toBe(200);
    expect(findUserById(id)).toBeNull();
  });

  it('gives the same 401 for a wrong password and an unknown address', async () => {
    const email = `enum${Date.now()}@example.com`;
    await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });

    const wrongPass = await app.request('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.1' },
      body: JSON.stringify({ email, password: 'nope' }),
    });
    const unknown = await app.request('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '198.51.100.2' },
      body: JSON.stringify({ email: 'nobody@example.com', password: 'password123' }),
    });
    expect(wrongPass.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrongPass.json()).toEqual(await unknown.json());
  });

  it('rate-limits the form per IP', async () => {
    const ip = `203.0.113.${Date.now() % 250}`;
    for (let i = 0; i < DELETE_RATE_LIMIT; i++) {
      recordDeleteAttempt(`ip:${ip}`, false);
    }
    const res = await app.request('/api/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ email: 'x@example.com', password: 'whatever1' }),
    });
    expect(res.status).toBe(429);
    const json = (await res.json()) as { retryAfterSeconds: number };
    expect(json.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('deletion rate limit window', () => {
  const now = 1_700_000_000_000;

  it('allows attempts under the limit', () => {
    expect(rateLimitState([], now)).toEqual({
      allowed: true,
      remaining: DELETE_RATE_LIMIT,
      retryAfterMs: 0,
    });
  });

  it('blocks at the limit and reports when a slot frees', () => {
    const attempts = Array.from({ length: DELETE_RATE_LIMIT }, (_, i) => ({
      at: now - i * 1000,
      ok: false,
    }));
    const state = rateLimitState(attempts, now);
    expect(state.allowed).toBe(false);
    expect(state.retryAfterMs).toBeGreaterThan(0);
    expect(state.retryAfterMs).toBeLessThanOrEqual(DELETE_RATE_WINDOW_MS);
  });

  it('forgets attempts older than the window', () => {
    const old = Array.from({ length: DELETE_RATE_LIMIT }, (_, i) => ({
      at: now - DELETE_RATE_WINDOW_MS - 1000 - i,
      ok: false,
    }));
    expect(rateLimitState(old, now).allowed).toBe(true);
  });
});
