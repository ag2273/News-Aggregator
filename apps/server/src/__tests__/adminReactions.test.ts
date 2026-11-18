/**
 * Admin reaction statistics: aggregation, period filter, sort, pagination, CSV,
 * auth, and the privacy rule (no user identifiers, ever).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles, _resetDbCache } from '../db.js';
import { createUser, _resetUsersCache } from '../users.js';
import { setReaction, removeReaction, _resetReactionsCache } from '../reactions.js';
import {
  aggregateReactions,
  hashAdminPassword,
  verifyAdminPassword,
  loadAdminHash,
  parseBasicAuth,
  adminRateState,
  recordAdminFailure,
  _resetAdminRateLimit,
  renderAdminPage,
  renderAdminCsv,
  periodCutoff,
  formatCairo,
  ADMIN_PAGE_SIZE,
  ADMIN_FAIL_LIMIT,
} from '../adminReactions.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const HASH_FILE = path.join(DATA_DIR, 'admin-password.hash');

const PASSWORD = 'test-admin-pass-123';

function resetAll(): void {
  for (const f of ['users.json', 'news.json', 'reactions.json', 'admin-password.hash']) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetDbCache();
  _resetReactionsCache();
  _resetAdminRateLimit();
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

function seedUsers(ids: string[]): void {
  for (const id of ids) {
    createUser({
      id,
      email: `${id}@secret-domain.example`,
      passwordHash: 'salt:hash',
      createdAt: Date.now(),
      emailVerified: true,
    });
  }
}

/** Write the admin hash and point the server at it. */
function configureAdmin(): void {
  fs.writeFileSync(HASH_FILE, hashAdminPassword(PASSWORD));
  process.env['ADMIN_PASSWORD_HASH_FILE'] = HASH_FILE;
}

const basic = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

beforeEach(resetAll);

describe('admin: aggregation', () => {
  it('counts one reaction per user in the current state (switches replace)', () => {
    seedUsers(['u1', 'u2']);
    setReaction('a1', 'u1', 'like');
    setReaction('a1', 'u2', 'like');
    setReaction('a1', 'u2', 'love'); // switch: still one for u2

    const data = aggregateReactions(
      { a1: { u1: { type: 'like', updatedAt: Date.now() }, u2: { type: 'love', updatedAt: Date.now() } } },
      [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 'اليوم السابع', publishedAt: Date.now() }],
      { period: 'all' },
    );
    expect(data.summary.totalReactions).toBe(2);
    expect(data.summary.perType.like).toBe(1);
    expect(data.summary.perType.love).toBe(1);
    expect(data.rows[0]?.total).toBe(2);
  });

  it('drops removed reactions', () => {
    seedUsers(['u1', 'u2']);
    setReaction('a1', 'u1', 'like');
    setReaction('a1', 'u2', 'wow');
    removeReaction('a1', 'u1');

    const data = aggregateReactions(
      { a1: { u2: { type: 'wow', updatedAt: Date.now() } } },
      [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 'اليوم السابع', publishedAt: Date.now() }],
      { period: 'all' },
    );
    expect(data.summary.totalReactions).toBe(1);
    expect(data.rows[0]?.counts.wow).toBe(1);
    expect(data.rows[0]?.counts.like).toBe(0);
  });

  it('handles the legacy bare-string reaction shape', () => {
    const data = aggregateReactions(
      { a1: { u1: 'like' as never, u2: 'sad' as never } },
      [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 'اليوم السابع', publishedAt: Date.now() }],
      { period: 'all' },
    );
    expect(data.summary.totalReactions).toBe(2);
    expect(data.rows[0]?.counts.like).toBe(1);
    expect(data.rows[0]?.counts.sad).toBe(1);
  });

  it('ignores reactions for articles that are no longer stored', () => {
    const data = aggregateReactions(
      { ghost: { u1: { type: 'like', updatedAt: Date.now() } } },
      [],
      { period: 'all' },
    );
    expect(data.summary.totalReactions).toBe(0);
    expect(data.rows).toHaveLength(0);
  });

  it('reports articles with at least one reaction', () => {
    const now = Date.now();
    const articles = [
      { id: 'a1', title: 'خبر ١', url: 'https://x/1', sourceName: 's', publishedAt: now },
      { id: 'a2', title: 'خبر ٢', url: 'https://x/2', sourceName: 's', publishedAt: now },
    ];
    const data = aggregateReactions(
      {
        a1: { u1: { type: 'like', updatedAt: now } },
        a2: { u2: { type: 'love', updatedAt: now } },
      },
      articles,
      { period: 'all' },
    );
    expect(data.summary.articlesWithReactions).toBe(2);
    expect(data.rows).toHaveLength(2);
  });
});

describe('admin: period filter', () => {
  const now = 1_700_000_000_000;
  const articles = [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 's', publishedAt: now }];

  it('filters by reaction time when known', () => {
    const reactions = {
      a1: {
        fresh: { type: 'like' as const, updatedAt: now - 60_000 },
        old: { type: 'like' as const, updatedAt: now - 10 * 24 * 60 * 60 * 1000 },
      },
    };
    expect(aggregateReactions(reactions, articles, { period: '24h', now }).summary.totalReactions).toBe(1);
    expect(aggregateReactions(reactions, articles, { period: '7d', now }).summary.totalReactions).toBe(1);
    expect(aggregateReactions(reactions, articles, { period: '30d', now }).summary.totalReactions).toBe(2);
    expect(aggregateReactions(reactions, articles, { period: 'all', now }).summary.totalReactions).toBe(2);
  });

  it('falls back to the article publish time for legacy reactions', () => {
    const oldArticle = [{ ...articles[0]!, publishedAt: now - 10 * 24 * 60 * 60 * 1000 }];
    const reactions = { a1: { legacy: { type: 'like' as const, updatedAt: 0 } } };
    // updatedAt 0 marks a pre-timestamp record; the article date decides.
    expect(aggregateReactions(reactions, oldArticle, { period: '7d', now }).summary.totalReactions).toBe(0);
    expect(aggregateReactions(reactions, oldArticle, { period: '30d', now }).summary.totalReactions).toBe(1);
  });

  it('computes cutoffs correctly', () => {
    expect(periodCutoff('all', now)).toBe(0);
    expect(periodCutoff('24h', now)).toBe(now - 24 * 60 * 60 * 1000);
  });
});

describe('admin: sort and pagination', () => {
  const now = Date.now();
  function many(n: number) {
    const articles = Array.from({ length: n }, (_, i) => ({
      id: `a${i}`,
      title: `خبر ${i}`,
      url: `https://x/${i}`,
      sourceName: 's',
      publishedAt: now,
    }));
    const reactions: Record<string, Record<string, { type: 'like' | 'love'; updatedAt: number }>> = {};
    for (let i = 0; i < n; i++) {
      reactions[`a${i}`] = {};
      // Descending reaction counts, so ordering is predictable.
      for (let j = 0; j <= n - i; j++) {
        reactions[`a${i}`]![`u${i}-${j}`] = { type: j % 2 === 0 ? 'like' : 'love', updatedAt: now };
      }
    }
    return { articles, reactions };
  }

  it('sorts by total by default and by a type when asked', () => {
    const { articles, reactions } = many(5);
    const byTotal = aggregateReactions(reactions, articles, { period: 'all' });
    expect(byTotal.rows[0]!.total).toBeGreaterThanOrEqual(byTotal.rows[1]!.total);

    const byLove = aggregateReactions(reactions, articles, { period: 'all', sort: 'love' });
    expect(byLove.rows[0]!.counts.love).toBeGreaterThanOrEqual(byLove.rows[1]!.counts.love);
  });

  it('pages at 50 rows', () => {
    const { articles, reactions } = many(ADMIN_PAGE_SIZE + 10);
    const first = aggregateReactions(reactions, articles, { period: 'all', page: 1 });
    expect(first.rows).toHaveLength(ADMIN_PAGE_SIZE);
    expect(first.pageCount).toBe(2);

    const second = aggregateReactions(reactions, articles, { period: 'all', page: 2 });
    expect(second.rows.length).toBe(10);
  });
});

describe('admin: privacy', () => {
  it('emits no user identifier in the HTML', () => {
    seedUsers(['user-abc-123', 'user-xyz-789']);
    const articles = [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 's', publishedAt: Date.now() }];
    const reactions = {
      a1: {
        'user-abc-123': { type: 'like' as const, updatedAt: Date.now() },
        'user-xyz-789': { type: 'love' as const, updatedAt: Date.now() },
      },
    };
    const data = aggregateReactions(reactions, articles, { period: 'all' });
    const html = renderAdminPage(data);

    expect(html).not.toContain('user-abc-123');
    expect(html).not.toContain('user-xyz-789');
    expect(html).not.toContain('@secret-domain.example');
    // Counts are present.
    expect(html).toContain('إحصاءات التفاعلات');
  });

  it('emits no user identifier in the CSV', () => {
    const articles = [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 's', publishedAt: Date.now() }];
    const reactions = { a1: { 'user-abc-123': { type: 'like' as const, updatedAt: Date.now() } } };
    const csv = renderAdminCsv(aggregateReactions(reactions, articles, { period: 'all' }));
    expect(csv).not.toContain('user-abc-123');
    expect(csv).not.toContain('@secret-domain.example');
  });
});

describe('admin: CSV encoding', () => {
  it('starts with a UTF-8 BOM and quotes fields with commas', () => {
    const articles = [
      { id: 'a1', title: 'خبر فيه فاصلة, ونص', url: 'https://x/1', sourceName: 's', publishedAt: Date.now() },
    ];
    const reactions = { a1: { u1: { type: 'like' as const, updatedAt: Date.now() } } };
    const csv = renderAdminCsv(aggregateReactions(reactions, articles, { period: 'all' }));

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"خبر فيه فاصلة, ونص"');
    const header = csv.replace('\uFEFF', '').split('\r\n')[0];
    expect(header).toContain('👍');
    expect(header).toContain('الإجمالي');
  });

  it('formats Cairo time', () => {
    // 2026-01-01T10:00:00Z is 12:00 in Cairo (UTC+2).
    const formatted = formatCairo(Date.UTC(2026, 0, 1, 10, 0, 0));
    expect(formatted).toContain('2026');
    expect(formatted).toContain('12:00');
    expect(formatted).toContain('2026');
  });
});

describe('admin: password and basic auth', () => {
  it('hashes and verifies, and rejects a wrong password', () => {
    const hash = hashAdminPassword('secret-one');
    expect(verifyAdminPassword('secret-one', hash)).toBe(true);
    expect(verifyAdminPassword('secret-two', hash)).toBe(false);
    expect(verifyAdminPassword('secret-one', 'garbage')).toBe(false);
  });

  it('keeps identity out of the data model itself', () => {
    // The aggregate row type has no field that could hold an identifier; this
    // asserts the rendered keys, so adding one later breaks the test.
    const articles = [{ id: 'a1', title: 'خبر', url: 'https://x/1', sourceName: 's', publishedAt: Date.now() }];
    const reactions = { a1: { 'user-secret-id': { type: 'like' as const, updatedAt: Date.now() } } };
    const row = aggregateReactions(reactions, articles, { period: 'all' }).rows[0]!;
    expect(Object.keys(row).sort()).toEqual(
      ['articleId', 'counts', 'publishedAt', 'sourceName', 'title', 'total', 'url'].sort(),
    );
    // The row keeps the article id (needed to link out) but nothing about users.
    expect(JSON.stringify(row)).not.toContain('user-secret-id');
  });

  it('parses a Basic header and rejects malformed ones', () => {
    expect(parseBasicAuth(basic('admin', 'pw'))).toEqual({ username: 'admin', password: 'pw' });
    expect(parseBasicAuth(undefined)).toBeNull();
    expect(parseBasicAuth('Bearer abc')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('no-colon').toString('base64')}`)).toBeNull();
  });

  it('returns null for a missing hash file', () => {
    expect(loadAdminHash(path.join(DATA_DIR, 'nope.hash'))).toBeNull();
  });
});

describe('admin: HTTP auth', () => {
  beforeEach(() => {
    insertArticles([makeArticle('a1', 'خبر فيه تفاعل')]);
    setReaction('a1', 'someone', 'like');
  });

  it('answers 503 when no hash is configured (never open)', async () => {
    const res = await app.request('/admin/reactions');
    expect(res.status).toBe(503);
  });

  it('answers 401 with a WWW-Authenticate challenge when credentials are absent', async () => {
    configureAdmin();
    const res = await app.request('/admin/reactions');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('answers 401 for a wrong password', async () => {
    configureAdmin();
    const res = await app.request('/admin/reactions', {
      headers: { Authorization: basic('admin', 'wrong') },
    });
    expect(res.status).toBe(401);
  });

  it('answers 200 with the table for correct credentials', async () => {
    configureAdmin();
    const res = await app.request('/admin/reactions', {
      headers: { Authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('إحصاءات التفاعلات');
    expect(html).toContain('خبر فيه تفاعل');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
  });

  it('serves the CSV with a BOM', async () => {
    configureAdmin();
    const res = await app.request('/admin/reactions.csv', {
      headers: { Authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    // res.text() strips a leading BOM, so check the raw bytes.
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('rate-limits repeated failures with 429', async () => {
    configureAdmin();
    const ip = '203.0.113.77';
    for (let i = 0; i < ADMIN_FAIL_LIMIT; i++) {
      await app.request('/admin/reactions', {
        headers: { 'x-forwarded-for': ip, Authorization: basic('admin', 'wrong') },
      });
    }
    const res = await app.request('/admin/reactions', {
      headers: { 'x-forwarded-for': ip, Authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(429);
  });

  it('honours the period, sort and page query params', async () => {
    configureAdmin();
    const res = await app.request('/admin/reactions?period=30d&sort=love&page=1', {
      headers: { Authorization: basic('admin', PASSWORD) },
    });
    expect(res.status).toBe(200);
  });

  it('serves robots.txt disallowing /admin', async () => {
    const res = await app.request('/robots.txt');
    const body = await res.text();
    expect(body).toContain('Disallow: /admin');
  });
});

describe('admin: rate limiter', () => {
  const now = 1_700_000_000_000;

  it('allows under the limit and blocks at it', () => {
    expect(adminRateState('ip1', now).allowed).toBe(true);
    for (let i = 0; i < ADMIN_FAIL_LIMIT; i++) recordAdminFailure('ip1', now - i);
    expect(adminRateState('ip1', now).allowed).toBe(false);
  });

  it('forgets failures older than the window', () => {
    for (let i = 0; i < ADMIN_FAIL_LIMIT; i++) recordAdminFailure('ip2', now - 20 * 60 * 1000 - i);
    expect(adminRateState('ip2', now).allowed).toBe(true);
  });
});
