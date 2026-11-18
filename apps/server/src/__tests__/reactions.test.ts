/**
 * Reactions: one per user per article, switching, removal, the verification
 * gate, counts, rate limiting, the trending weight, and deletion cleanup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles } from '../db.js';
import { _resetDbCache } from '../db.js';
import { createUser, markUserVerified, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import {
  setReaction,
  removeReaction,
  countsFor,
  myReaction,
  deleteReactionsForUser,
  checkReactionRate,
  recordReaction,
  reactionWeight,
  isValidReaction,
  emptyCounts,
  REACTION_TYPES,
  REACTION_RATE_LIMIT,
  _resetReactionsCache,
} from '../reactions.js';
import {
  trendingScore,
  reactionScore,
  recencyScore,
  rankTrending,
  REACTION_MAX,
  RECENCY_MAX,
  REACTION_SATURATION,
  TRENDING_WINDOW_MS,
} from '../trending.js';
import { deleteAccount } from '../account.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

const FILES = [
  'users.json',
  'news.json',
  'follows.json',
  'saved.json',
  'push-tokens.json',
  'verify-tokens.json',
  'reactions.json',
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
  _resetDbCache();
  _resetReactionsCache();
}

function makeArticle(id: string, ageMs = 0): Article {
  return {
    id,
    title: `article ${id}`,
    summary: null,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId: 'youm7',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now() - ageMs,
    isBreaking: false,
  };
}

function seedUser(id = 'u1', verified = true): { id: string; token: string } {
  createUser({
    id,
    email: `${id}@example.com`,
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: verified,
  });
  if (verified) markUserVerified(id);
  return { id, token: createToken(id) };
}

beforeEach(resetAll);

describe('reactions: store rules', () => {
  it('accepts only the five types', () => {
    for (const t of REACTION_TYPES) expect(isValidReaction(t)).toBe(true);
    expect(isValidReaction('clap')).toBe(false);
    expect(isValidReaction(undefined)).toBe(false);
    expect(isValidReaction(3)).toBe(false);
  });

  it('records one reaction per user per article', () => {
    setReaction('a1', 'u1', 'like');
    setReaction('a1', 'u1', 'love');
    const counts = countsFor('a1');
    expect(counts.love).toBe(1);
    expect(counts.like).toBe(0);
    expect(counts.total).toBe(1);
    expect(myReaction('a1', 'u1')).toBe('love');
  });

  it('counts different users together', () => {
    setReaction('a1', 'u1', 'like');
    setReaction('a1', 'u2', 'like');
    setReaction('a1', 'u3', 'sad');
    expect(countsFor('a1')).toMatchObject({ like: 2, sad: 1, total: 3 });
  });

  it('removes a reaction', () => {
    setReaction('a1', 'u1', 'wow');
    const result = removeReaction('a1', 'u1');
    expect(result.removed).toBe(true);
    expect(result.myReaction).toBeNull();
    expect(countsFor('a1')).toEqual(emptyCounts());
  });

  it('reporting removal of nothing is harmless', () => {
    expect(removeReaction('a1', 'nobody').removed).toBe(false);
  });

  it('keeps counts per article separate', () => {
    setReaction('a1', 'u1', 'like');
    setReaction('a2', 'u1', 'angry');
    expect(countsFor('a1').like).toBe(1);
    expect(countsFor('a2').angry).toBe(1);
  });

  it('survives a cache reset (persisted)', () => {
    setReaction('a1', 'u1', 'love');
    _resetReactionsCache();
    expect(countsFor('a1').love).toBe(1);
    expect(myReaction('a1', 'u1')).toBe('love');
  });
});

describe('reactions: rate limit', () => {
  const now = 1_700_000_000_000;

  it('allows changes under the limit', () => {
    expect(checkReactionRate('u1', now).allowed).toBe(true);
  });

  it('blocks at the limit and reports a retry', () => {
    for (let i = 0; i < REACTION_RATE_LIMIT; i++) recordReaction('u1', now - i * 100);
    const state = checkReactionRate('u1', now);
    expect(state.allowed).toBe(false);
    expect(state.retryAfterMs).toBeGreaterThan(0);
  });

  it('forgets changes older than a minute', () => {
    for (let i = 0; i < REACTION_RATE_LIMIT; i++) recordReaction('u1', now - 61_000 - i);
    expect(checkReactionRate('u1', now).allowed).toBe(true);
  });
});

describe('reactions: API', () => {
  it('requires a session', async () => {
    insertArticles([makeArticle('a1')]);
    const res = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'like' }),
    });
    expect(res.status).toBe(401);
  });

  it('gates unverified accounts with EMAIL_NOT_VERIFIED', async () => {
    insertArticles([makeArticle('a1')]);
    const { token } = seedUser('unv', false);
    const res = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'like' }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_NOT_VERIFIED');
  });

  it('sets, switches and removes via the endpoints', async () => {
    insertArticles([makeArticle('a1')]);
    const { token } = seedUser();

    const put = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'like' }),
    });
    expect(put.status).toBe(200);
    const first = (await put.json()) as { data: { counts: { like: number }; myReaction: string } };
    expect(first.data.myReaction).toBe('like');
    expect(first.data.counts.like).toBe(1);

    // Switch.
    const sw = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sad' }),
    });
    const switched = (await sw.json()) as { data: { counts: { like: number; sad: number } } };
    expect(switched.data.counts.like).toBe(0);
    expect(switched.data.counts.sad).toBe(1);

    // Remove.
    const del = await app.request('/api/articles/a1/reaction', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);
    const after = (await del.json()) as { data: { counts: { total: number } } };
    expect(after.data.counts.total).toBe(0);
  });

  it('rejects an unknown type with 400', async () => {
    insertArticles([makeArticle('a1')]);
    const { token } = seedUser();
    const res = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clap' }),
    });
    expect(res.status).toBe(400);
  });

  it('404s for an unknown article', async () => {
    const { token } = seedUser();
    const res = await app.request('/api/articles/nope/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'like' }),
    });
    expect(res.status).toBe(404);
  });

  it('serves public counts to a guest', async () => {
    insertArticles([makeArticle('a1')]);
    setReaction('a1', 'u1', 'love');
    setReaction('a1', 'u2', 'love');
    const res = await app.request('/api/articles/a1/reactions');
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: { counts: { love: number; total: number }; myReaction: null; emoji: Record<string, string> };
    };
    expect(json.data.counts).toMatchObject({ love: 2, total: 2 });
    expect(json.data.myReaction).toBeNull();
    expect(json.data.emoji.love).toBe('❤️');
  });

  it('rate-limits a flood with 429', async () => {
    insertArticles([makeArticle('a1')]);
    const { token, id } = seedUser();
    const now = Date.now();
    for (let i = 0; i < REACTION_RATE_LIMIT; i++) recordReaction(id, now);

    const res = await app.request('/api/articles/a1/reaction', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'like' }),
    });
    expect(res.status).toBe(429);
    expect(((await res.json()) as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('reactions: payloads', () => {
  it('includes counts and myReaction in the feed for a signed-in caller', async () => {
    insertArticles([makeArticle('a1'), makeArticle('a2')]);
    const { token } = seedUser();
    setReaction('a1', 'someone', 'like');

    const guest = (await (await app.request('/api/feed?limit=10')).json()) as {
      data: Array<{ id: string; reactions?: { total: number }; myReaction?: unknown }>;
    };
    const guestA1 = guest.data.find((a) => a.id === 'a1');
    expect(guestA1?.reactions?.total).toBe(1);
    expect(guestA1?.myReaction).toBeNull();

    const mine = (await (await app.request('/api/feed?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: Array<{ id: string; myReaction?: unknown }> };
    expect(mine.data.find((a) => a.id === 'a1')).toBeTruthy();
  });

  it('includes reactions on a single article', async () => {
    insertArticles([makeArticle('a1')]);
    setReaction('a1', 'u9', 'angry');
    const json = (await (await app.request('/api/articles/a1')).json()) as {
      data: { reactions: { angry: number; total: number } };
    };
    expect(json.data.reactions).toMatchObject({ angry: 1, total: 1 });
  });
});

describe('trending: reaction weight', () => {
  const now = 1_700_000_000_000;

  it('scores a fresh article above an older one with no reactions', () => {
    const fresh = trendingScore({ id: 'a', publishedAt: now - 60_000 }, 0, now);
    const older = trendingScore({ id: 'b', publishedAt: now - 6 * 3600_000 }, 0, now);
    expect(fresh).toBeGreaterThan(older);
  });

  it('keeps the reaction term bounded so it cannot run away', () => {
    // Reactions can lift an older story, but only by at most REACTION_MAX points:
    // 1,000,000 reactions score the same as the saturation count.
    const saturated = trendingScore({ id: 'a', publishedAt: now - 20 * 3600_000 }, 1_000_000, now);
    expect(saturated).toBeLessThanOrEqual(RECENCY_MAX + REACTION_MAX + 0.001);
    expect(reactionScore(1_000_000)).toBe(REACTION_MAX);
  });

  it('prefers the fresher story when reactions are equal', () => {
    const fresh = trendingScore({ id: 'f', publishedAt: now - 60_000 }, 5, now);
    const older = trendingScore({ id: 'o', publishedAt: now - 2 * 3600_000 }, 5, now);
    expect(fresh).toBeGreaterThan(older);
  });

  it('caps the reaction contribution', () => {
    expect(reactionScore(0)).toBe(0);
    expect(reactionScore(1)).toBeLessThan(reactionScore(10));
    expect(reactionScore(REACTION_SATURATION)).toBeCloseTo(REACTION_MAX, 5);
    expect(reactionScore(10_000)).toBe(REACTION_MAX);
  });

  it('decays recency to zero at the window edge', () => {
    expect(recencyScore(now, now)).toBe(RECENCY_MAX);
    expect(recencyScore(now - TRENDING_WINDOW_MS, now)).toBe(0);
    expect(recencyScore(now - TRENDING_WINDOW_MS - 1, now)).toBe(0);
  });

  it('ranks by score and drops articles older than the window', () => {
    const ranked = rankTrending(
      [
        { id: 'old', publishedAt: now - TRENDING_WINDOW_MS - 1 },
        { id: 'fresh', publishedAt: now - 1000 },
        { id: 'stale', publishedAt: now - 40 * 3600_000 },
      ],
      () => 0,
      now,
    );
    expect(ranked.map((a) => a.id)).not.toContain('old');
    expect(ranked.map((a) => a.id)).toEqual(['fresh', 'stale']);
  });

  it('lets a heavily reacted older story rank above a fresh quiet one', () => {
    // This is the point of having a reaction signal at all: 500 reactions on a
    // 4-hour-old story is genuinely trending, and it is allowed to win.
    const ranked = rankTrending(
      [
        { id: 'fresh', publishedAt: now - 60_000 },
        { id: 'popular', publishedAt: now - 4 * 3600_000 },
      ],
      (id) => (id === 'popular' ? 500 : 0),
      now,
    );
    expect(ranked[0]?.id).toBe('popular');
  });

  it('reports the article reaction total for weighting', () => {
    setReaction('a1', 'u1', 'like');
    setReaction('a1', 'u2', 'love');
    expect(reactionWeight('a1')).toBe(2);
    expect(reactionWeight('missing')).toBe(0);
  });
});

describe('reactions: account deletion', () => {
  it('removes the user’s reactions and leaves other users’ alone', () => {
    const doomed = seedUser('gone');
    seedUser('stays');
    setReaction('a1', 'gone', 'like');
    setReaction('a1', 'stays', 'love');
    setReaction('a2', 'gone', 'angry');

    expect(countsFor('a1').total).toBe(2);
    expect(deleteReactionsForUser('gone')).toBe(2);

    expect(countsFor('a1').total).toBe(1);
    expect(countsFor('a1').love).toBe(1);
    expect(countsFor('a2').total).toBe(0);
    expect(myReaction('a1', 'stays')).toBe('love');
  });

  it('removes reactions as part of full account deletion', () => {
    seedUser('gone2');
    setReaction('a1', 'gone2', 'like');
    const report = deleteAccount('gone2');
    expect(report?.reactions).toBe(1);
    expect(countsFor('a1').total).toBe(0);
  });
});
