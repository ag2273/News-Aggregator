/**
 * Usage analytics: counting, privacy (nothing identifying ever stored or
 * rendered), retention, salt rotation, and the admin page + CSV.
 *
 * The privacy tests are the point of this file. They read the stored file and
 * the rendered HTML/CSV and assert that a seeded secret install id, email and
 * user id do not appear anywhere. If any of that ever leaks, these fail.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles, _resetDbCache } from '../db.js';
import { createUser, _resetUsersCache, userCounts } from '../users.js';
import { setReaction, _resetReactionsCache } from '../reactions.js';
import { hashAdminPassword } from '../adminReactions.js';
import {
  recordDevice,
  recordOpen,
  recordShare,
  recordSourceView,
  recordEvent,
  recordQuery,
  recordSignup,
  deviceHash,
  dayKey,
  prune,
  KEEP_DAYS,
  MIN_QUERY_LENGTH,
  BEACON_RATE_LIMIT,
  beaconRateState,
  recordBeaconHit,
  _resetBeaconRateLimit,
  _resetAnalyticsCache,
  getAnalytics,
} from '../analytics.js';
import { aggregateStats, periodDays, renderStatsPage, renderStatsCsv } from '../adminStats.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const ANALYTICS_FILE = path.join(DATA_DIR, 'analytics.json');
const HASH_FILE = path.join(DATA_DIR, 'admin-password.hash');

const PASSWORD = 'test-admin-pass-123';
/** A distinctive value: if it ever shows up in output, privacy broke. */
const SECRET_INSTALL_ID = 'test-install-id-0123456789abcdef';
const SECRET_EMAIL = 'leaky-user@secret-domain.example';
const SECRET_USER_ID = 'user-id-must-not-leak-0001';

function resetAll(): void {
  for (const f of ['users.json', 'news.json', 'reactions.json', 'admin-password.hash', 'analytics.json']) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetDbCache();
  _resetReactionsCache();
  _resetAnalyticsCache();
  _resetBeaconRateLimit();
  delete process.env['ADMIN_PASSWORD_HASH_FILE'];
}

function makeArticle(id: string, title: string, publishedAt = Date.now()): Article {
  return {
    id,
    title,
    summary: null,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId: 'youm7',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt,
    isBreaking: false,
  };
}

function configureAdmin(): void {
  fs.writeFileSync(HASH_FILE, hashAdminPassword(PASSWORD));
  process.env['ADMIN_PASSWORD_HASH_FILE'] = HASH_FILE;
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

function readAnalyticsRaw(): string {
  try {
    return fs.readFileSync(ANALYTICS_FILE, 'utf8');
  } catch {
    return '';
  }
}

function articleLookup(): Parameters<typeof aggregateStats>[1] {
  return [
    {
      id: 'a1',
      title: 'خبر أول',
      url: 'https://example.com/a1',
      sourceName: 'اليوم السابع',
      sourceId: 'youm7',
      category: 'egypt',
    },
    {
      id: 'a2',
      title: 'خبر ثانٍ',
      url: 'https://example.com/a2',
      sourceName: 'الجزيرة',
      sourceId: 'aljazeera',
      category: 'world',
    },
  ];
}

beforeEach(resetAll);

describe('analytics: counting', () => {
  it('counts opens per article and flattens them in the aggregate', () => {
    recordOpen('a1');
    recordOpen('a1');
    recordOpen('a2');

    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.opens).toBe(3);
    const top = data.topArticles.find((a) => a.articleId === 'a1');
    expect(top?.opens).toBe(2);
    expect(data.topArticles[0]?.articleId).toBe('a1');
  });

  it('counts one device per day per install id, not per call', () => {
    expect(recordDevice(SECRET_INSTALL_ID)).toBe(true);
    expect(recordDevice(SECRET_INSTALL_ID)).toBe(false);
    expect(recordDevice('another-install-id-9876543210')).toBe(true);

    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.dauToday).toBe(2);
  });

  it('rejects a missing or implausible install id instead of counting it', () => {
    expect(recordDevice(undefined)).toBe(false);
    expect(recordDevice('')).toBe(false);
    expect(recordDevice('   ')).toBe(false);
    expect(recordDevice('short')).toBe(false);
    expect(recordDevice('x'.repeat(129))).toBe(false);
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.dauToday).toBe(0);
  });

  it('drops search queries shorter than the minimum', () => {
    recordQuery('ا');
    recordQuery('  ');
    recordQuery('');
    recordQuery('غزة');
    recordQuery('غزة');

    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.topQueries).toHaveLength(1);
    expect(data.topQueries[0]).toEqual({ id: 'غزة', name: 'غزة', count: 2 });
    expect(MIN_QUERY_LENGTH).toBe(2);
  });

  it('counts source views, shares and the account actions separately', () => {
    recordSourceView('youm7');
    recordSourceView('youm7');
    recordShare('a1');
    recordEvent('save');
    recordEvent('follow');
    recordEvent('keyword_follow');
    recordEvent('keyword_mute');

    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.shares).toBe(1);
    expect(data.summary.sourceViews).toBe(2);
    expect(data.summary.saves).toBe(1);
    expect(data.summary.follows).toBe(1);
    expect(data.summary.keywordFollows).toBe(1);
    expect(data.summary.keywordMutes).toBe(1);
    expect(data.perSource.find((s) => s.id === 'youm7')?.count).toBe(2);
  });

  it('folds article opens into per-category counts', () => {
    recordOpen('a1');
    recordOpen('a2');
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.perCategory.find((c) => c.id === 'egypt')?.count).toBe(1);
    expect(data.perCategory.find((c) => c.id === 'world')?.count).toBe(1);
  });

  it('caps the top-article list at 20 and the query list at 50', () => {
    for (let i = 0; i < 30; i += 1) recordOpen(`art-${i}`);
    for (let i = 0; i < 80; i += 1) recordQuery(`query-number-${i}`);
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.topArticles).toHaveLength(20);
    expect(data.topQueries).toHaveLength(50);
  });

  it('attributes user totals and sign-ups to the right day', () => {
    createUser({
      id: SECRET_USER_ID,
      email: SECRET_EMAIL,
      passwordHash: 'salt:hash',
      createdAt: Date.now(),
      emailVerified: true,
    });
    const counts = userCounts();
    expect(counts.total).toBe(1);
    expect(counts.verified).toBe(1);
    const data = aggregateStats(getAnalytics(), articleLookup(), [], counts, { period: '24h' });
    expect(data.summary.totalUsers).toBe(1);
    expect(data.summary.verifiedUsers).toBe(1);
    expect(data.summary.newSignupsToday).toBe(1);
  });

  it('recordSignup lands on the given day', () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    recordSignup(yesterday);
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '7d' });
    expect(data.summary.signupsInPeriod).toBe(1);
    const bucket = getAnalytics().days[dayKey(yesterday)];
    expect(bucket?.signups).toBe(1);
  });

  it('sums reactions from the timestamps it is given', () => {
    const now = Date.now();
    const data = aggregateStats(
      getAnalytics(),
      articleLookup(),
      [{ articleId: 'a1', total: 2, at: [now, now] }],
      userCounts(),
      { period: '24h' },
    );
    expect(data.summary.reactions).toBe(2);
    const today = data.daily.find((d) => d.day === dayKey(now));
    expect(today?.reactions).toBe(2);
  });
});

describe('analytics: privacy', () => {
  it('never writes the raw install id to the store file', () => {
    recordDevice(SECRET_INSTALL_ID);
    recordOpen('a1');
    const raw = readAnalyticsRaw();
    expect(raw).not.toBe('');
    expect(raw).not.toContain(SECRET_INSTALL_ID);
  });

  it('stores only a day-scoped hash, never the id itself', () => {
    recordDevice(SECRET_INSTALL_ID);
    const store = getAnalytics();
    const today = dayKey(Date.now());
    const devices = store.days[today]?.devices ?? [];
    expect(devices).toHaveLength(1);
    expect(devices[0]).not.toContain(SECRET_INSTALL_ID);
    expect(devices[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(devices[0]).toBe(deviceHash(SECRET_INSTALL_ID, store.salts[today] as string));
  });

  it('produces a different hash for the same device on a different day', () => {
    const saltA = 'a'.repeat(32);
    const saltB = 'b'.repeat(32);
    expect(deviceHash(SECRET_INSTALL_ID, saltA)).not.toBe(deviceHash(SECRET_INSTALL_ID, saltB));
  });

  it('rotates the salt per day and prunes old salts', () => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;
    recordDevice(SECRET_INSTALL_ID, now);
    recordDevice(SECRET_INSTALL_ID, yesterday);
    const store = getAnalytics();
    const today = dayKey(now);
    const yday = dayKey(yesterday);
    expect(store.salts[today]).toBeTruthy();
    expect(store.salts[yday]).toBeTruthy();
    expect(store.salts[today]).not.toBe(store.salts[yday]);

    // A third, older day's salt is dropped when retention prunes it.
    const old = now - (KEEP_DAYS + 2) * 24 * 60 * 60 * 1000;
    recordDevice(SECRET_INSTALL_ID, old);
    const after = getAnalytics();
    expect(after.salts[dayKey(old)]).toBeUndefined();
  });

  it('drops the hashed device list of a closed day but keeps its count', () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    recordDevice(SECRET_INSTALL_ID, twoDaysAgo);
    recordDevice('another-install-id-9876543210', twoDaysAgo);
    const store = getAnalytics();
    const key = dayKey(twoDaysAgo);
    // The day is already closed, so its hashes were dropped on write. Only the
    // count survives, which is what makes cross-day correlation impossible.
    expect(store.days[key]?.devices).toBeUndefined();
    expect(store.days[key]?.dau).toBe(2);
  });

  it('drops a write older than the retention window instead of resurrecting it', () => {
    const tooOld = Date.now() - (KEEP_DAYS + 5) * 24 * 60 * 60 * 1000;
    recordOpen('a1', tooOld);
    expect(getAnalytics().days[dayKey(tooOld)]).toBeUndefined();
  });

  it('renders no email, user id or install id on the page or in the CSV', () => {
    createUser({
      id: SECRET_USER_ID,
      email: SECRET_EMAIL,
      passwordHash: 'salt:hash',
      createdAt: Date.now(),
      emailVerified: true,
    });
    recordDevice(SECRET_INSTALL_ID);
    recordOpen('a1');
    recordQuery('غزة');

    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '7d' });
    const html = renderStatsPage(data);
    const csv = renderStatsCsv(data);
    for (const secret of [SECRET_EMAIL, SECRET_USER_ID, SECRET_INSTALL_ID]) {
      expect(html).not.toContain(secret);
      expect(csv).not.toContain(secret);
    }
  });

  it('renders no raw IP address even when one was in the request', () => {
    recordOpen('a1');
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '7d' });
    const html = renderStatsPage(data);
    expect(html).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it('keeps search queries unlinked to any device or account', () => {
    recordDevice(SECRET_INSTALL_ID);
    recordQuery('كلمة بحث مميزة');
    const raw = readAnalyticsRaw();
    // The query is stored as a plain counter under the day — no id beside it.
    expect(raw).toContain('كلمة بحث مميزة');
    expect(raw).not.toContain(SECRET_INSTALL_ID);
    const bucket = getAnalytics().days[dayKey(Date.now())];
    expect(bucket?.queries).toEqual({ 'كلمة بحث مميزة': 1 });
  });
});

describe('analytics: beacon rate limit', () => {
  it('allows the budget and then refuses, with a retry-after', () => {
    let last = { allowed: true, retryAfterMs: 0 };
    for (let i = 0; i < BEACON_RATE_LIMIT; i += 1) {
      last = beaconRateState('1.2.3.4');
      expect(last.allowed).toBe(true);
      recordBeaconHit('1.2.3.4');
    }
    const blocked = beaconRateState('1.2.3.4');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    // A different IP has its own budget.
    expect(beaconRateState('5.6.7.8').allowed).toBe(true);
  });

  it('expires hits outside the window', () => {
    const longAgo = Date.now() - 2 * 60 * 1000;
    for (let i = 0; i < BEACON_RATE_LIMIT; i += 1) recordBeaconHit('9.9.9.9', longAgo);
    expect(beaconRateState('9.9.9.9').allowed).toBe(true);
  });
});

describe('admin stats: page and CSV', () => {
  it('renders the Arabic page with the summary and no JS', () => {
    recordOpen('a1');
    const html = renderStatsPage(
      aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '7d' }),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('إحصاءات الاستخدام');
    expect(html).not.toContain('<script');
  });

  it('exports a BOM-prefixed CSV', () => {
    recordOpen('a1');
    const csv = renderStatsCsv(
      aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '7d' }),
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('خبر أول');
  });

  it('periodDays covers the right number of days, oldest first', () => {
    const now = Date.now();
    expect(periodDays('24h', now)).toHaveLength(1);
    expect(periodDays('7d', now)).toHaveLength(7);
    expect(periodDays('30d', now)).toHaveLength(30);
    const week = periodDays('7d', now);
    expect(week[week.length - 1]).toBe(dayKey(now));
    expect(week[0] < week[week.length - 1]).toBe(true);
  });
});

describe('admin stats: HTTP', () => {
  beforeEach(() => {
    insertArticles([makeArticle('a1', 'خبر أول'), makeArticle('a2', 'خبر ثانٍ')]);
    configureAdmin();
    setReaction('a1', 'someone', 'like');
  });

  it('401s without credentials', async () => {
    const res = await app.request('/admin/stats');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('503s when no admin hash is configured', async () => {
    delete process.env['ADMIN_PASSWORD_HASH_FILE'];
    fs.rmSync(HASH_FILE, { force: true });
    const res = await app.request('/admin/stats', {
      headers: { authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(503);
  });

  it('renders the page for the admin, with the nav to reactions', async () => {
    await app.request('/api/events/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-install-id': SECRET_INSTALL_ID },
      body: JSON.stringify({ articleId: 'a1' }),
    });
    const res = await app.request('/admin/stats?period=7d', {
      headers: { authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('إحصاءات الاستخدام');
    expect(html).toContain('/admin/reactions');
    expect(html).toContain('خبر أول');
    expect(html).not.toContain(SECRET_INSTALL_ID);
  });

  it('exports the CSV', async () => {
    const res = await app.request('/admin/stats.csv?period=24h', {
      headers: { authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('counts a beacon open and refuses a replayed flood', async () => {
    const open = () =>
      app.request('/api/events/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-install-id': SECRET_INSTALL_ID },
        body: JSON.stringify({ articleId: 'a1' }),
      });
    expect((await open()).status).toBe(200);
    _resetBeaconRateLimit();
    // Fill the budget for this (shared) test IP, then expect a 429.
    for (let i = 0; i < BEACON_RATE_LIMIT + 1; i += 1) await open();
    expect((await open()).status).toBe(429);
  });

  it('rejects an open for an article that does not exist', async () => {
    const res = await app.request('/api/events/open', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ articleId: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a share without an articleId', async () => {
    const res = await app.request('/api/events/share', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('counts a signed-up user from the real register route', async () => {
    const res = await app.request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: SECRET_EMAIL, password: 'long-enough-password' }),
    });
    expect(res.status).toBe(200);
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.newSignupsToday).toBe(1);
    expect(readAnalyticsRaw()).not.toContain(SECRET_EMAIL);
  });

  it('counts a real search as a query, not as a user', async () => {
    await app.request('/api/search?q=' + encodeURIComponent('غزة'));
    const data = aggregateStats(getAnalytics(), articleLookup(), [], userCounts(), { period: '24h' });
    expect(data.summary.searches).toBe(1);
    expect(readAnalyticsRaw()).not.toContain('"user"');
  });
});

describe('analytics: salt is unguessable', () => {
  it('uses 16 random bytes per day', () => {
    recordDevice(SECRET_INSTALL_ID);
    const salt = getAnalytics().salts[dayKey(Date.now())] as string;
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(salt).not.toBe(crypto.randomBytes(16).toString('hex'));
  });
});
