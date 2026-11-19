/**
 * Every endpoint that feeds a card must ship reaction counts and myReaction.
 *
 * Why a dedicated suite: the card is ONE component used on home, trending,
 * saved, following, search and the source page. Only /api/feed carried counts,
 * so a signed-in reader saw five emoji with no numbers on every other list —
 * reported from the device as "reactions don't show on cards".
 *
 * These assertions are on the endpoint payloads, not on the UI: if the server
 * stops sending the fields, every screen breaks at once.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles, _resetDbCache } from '../db.js';
import { createUser, markUserVerified, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import {
  setReaction,
  _resetReactionsCache,
  countsFor,
} from '../reactions.js';
import { _resetSavedCache, saveArticle } from '../saved.js';
import { followSource, _resetFollowsCache } from '../follows.js';
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
  'reactions.json',
  'ingest-cache.json',
  'cache.json',
];

interface CardArticle {
  id: string;
  reactions?: { like: number; total: number };
  myReaction?: unknown;
}

function resetAll(): void {
  for (const f of FILES) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetDbCache();
  _resetUsersCache();
  _resetReactionsCache();
  _resetSavedCache();
  _resetFollowsCache();
}

function makeArticle(id: string, sourceId = 'youm7', ageMs = 0): Article {
  return {
    id,
    title: `article ${id} عنوان`,
    summary: `summary ${id}`,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId,
    sourceName: sourceId,
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now() - ageMs,
    isBreaking: false,
  };
}

function seedUser(id = 'u-card'): string {
  createUser({
    id,
    email: `${id}@example.com`,
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: true,
  });
  markUserVerified(id);
  return createToken(id);
}

const find = (rows: CardArticle[], id: string) => rows.find((a) => a.id === id);

beforeEach(() => {
  resetAll();
  insertArticles([makeArticle('c1'), makeArticle('c2', 'shorouk', 1000)]);
});

describe('reaction data on every card list', () => {
  it('trending ships counts and myReaction', async () => {
    const token = seedUser();
    setReaction('c1', 'u-card', 'like');

    const res = await app.request('/api/trending?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: CardArticle[] };

    const row = find(json.data, 'c1');
    expect(row).toBeTruthy();
    expect(row?.reactions).toMatchObject({ like: 1, total: 1 });
    // The caller's own reaction drives the selected ring on the card.
    expect(row?.myReaction).toBe('like');
  });

  it('trending without a token still ships counts, with myReaction null', async () => {
    setReaction('c1', 'someone', 'wow');
    const json = (await (await app.request('/api/trending?limit=10')).json()) as {
      data: CardArticle[];
    };
    expect(find(json.data, 'c1')?.reactions).toMatchObject({ wow: 1, total: 1 });
    expect(find(json.data, 'c1')?.myReaction).toBeNull();
  });

  it('search ships counts and myReaction', async () => {
    const token = seedUser();
    setReaction('c1', 'u-card', 'love');

    const res = await app.request('/api/search?q=article', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: CardArticle[] };
    expect(find(json.data, 'c1')?.reactions).toMatchObject({ love: 1, total: 1 });
    expect(find(json.data, 'c1')?.myReaction).toBe('love');
  });

  it('the source page ships counts and myReaction', async () => {
    const token = seedUser();
    setReaction('c1', 'u-card', 'angry');

    const res = await app.request('/api/sources/youm7/articles?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: CardArticle[] };
    expect(find(json.data, 'c1')?.reactions).toMatchObject({ angry: 1, total: 1 });
    expect(find(json.data, 'c1')?.myReaction).toBe('angry');
  });

  it('saved ships counts', async () => {
    const token = seedUser();
    saveArticle('u-card', 'c1');
    setReaction('c1', 'u-card', 'like');

    const res = await app.request('/api/saved?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: CardArticle[] };
    expect(find(json.data, 'c1')?.reactions).toMatchObject({ like: 1, total: 1 });
    expect(find(json.data, 'c1')?.myReaction).toBe('like');
  });

  it('the following feed ships counts', async () => {
    const token = seedUser();
    followSource('u-card', 'youm7');
    setReaction('c1', 'u-card', 'love');

    const res = await app.request('/api/feed/following?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: CardArticle[] };
    expect(find(json.data, 'c1')?.reactions).toMatchObject({ love: 1, total: 1 });
    expect(find(json.data, 'c1')?.myReaction).toBe('love');
  });

  it('the grouped feed rows carry counts on the article, the lead and the members', async () => {
    const token = seedUser();
    // Two outlets reporting the same story, plus a third unrelated article.
    insertArticles([
      {
        ...makeArticle('same-a', 'youm7', 10),
        title: 'الرئيس الصيني يدعو لحظر الأسلحة النووية بالكامل',
      },
      {
        ...makeArticle('same-b', 'shorouk', 20),
        title: 'الرئيس الصيني يدعو إلى حظر الأسلحة النووية بالكامل وتدميرها',
      },
    ]);
    setReaction('same-a', 'u-card', 'like');
    setReaction('same-b', 'another', 'wow');

    const res = await app.request('/api/feed?grouped=1&limit=20', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: Array<
        | { kind: 'article'; article: CardArticle }
        | {
            kind: 'cluster';
            lead: CardArticle;
            members: CardArticle[];
          }
      >;
    };

    for (const row of json.data) {
      if (row.kind === 'article') {
        expect(row.article.reactions).toBeDefined();
        continue;
      }
      // A cluster row renders the LEAD in the card, so the lead must carry its
      // own numbers; the sheet lists members, so they must carry theirs too.
      expect(row.lead.reactions).toBeDefined();
      for (const m of row.members) expect(m.reactions).toBeDefined();
    }

    const all = json.data.flatMap((r) =>
      r.kind === 'article' ? [r.article] : [r.lead, ...r.members],
    );
    expect(find(all, 'same-a')?.reactions).toMatchObject({ like: 1 });
    expect(find(all, 'same-b')?.reactions).toMatchObject({ wow: 1 });
  });

  it('the counts on a card match the article endpoint for the same id', async () => {
    // Consistency guard: a card and the reader must never disagree.
    const token = seedUser();
    setReaction('c1', 'u-card', 'like');
    setReaction('c1', 'other', 'like');

    const trending = (await (await app.request('/api/trending?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: CardArticle[] };
    const single = (await (await app.request('/api/articles/c1', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: CardArticle };

    expect(find(trending.data, 'c1')?.reactions).toEqual(single.data.reactions);
    expect(single.data.reactions).toEqual(countsFor('c1'));
    expect(countsFor('c1').total).toBe(2);
  });
});
