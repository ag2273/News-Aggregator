/**
 * GET /api/feed balancing, end to end.
 *
 * Production symptom: the first page showed 5 of 9 live sources because one
 * outlet published ~20x more than the rest. This asserts the endpoint itself
 * spreads sources, and that paging over the response has no duplicates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles } from '../db.js';
import { _resetDbCache } from '../db.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

function makeArticle(sourceId: string, n: number, ageMs: number): Article {
  return {
    id: `${sourceId}-${n}`,
    title: `${sourceId} article ${n}`,
    summary: null,
    imageUrl: null,
    url: `https://example.com/${sourceId}/${n}`,
    sourceId,
    sourceName: sourceId,
    category: 'misc',
    country: 'EG',
    publishedAt: Date.now() - ageMs,
    isBreaking: false,
  };
}

/** One dominant outlet plus several small ones, as in production. */
function seed() {
  const articles: Article[] = [];
  let age = 0;
  // Dominant source: 40 articles, the newest first.
  for (let i = 0; i < 40; i++) articles.push(makeArticle('almasry', i, age++ * 1000));
  // Eight smaller sources with 3 each, older on average.
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
    for (let i = 0; i < 3; i++) articles.push(makeArticle(id, i, age++ * 1000));
  }
  insertArticles(articles);
}

const distinct = (rows: Array<{ sourceId: string }>) => new Set(rows.map((r) => r.sourceId)).size;

describe('GET /api/feed: source balance', () => {
  beforeEach(() => {
    // A fresh store per test.
    for (const f of ['news.json', 'cache.json', 'ingest-cache.json']) {
      try {
        fs.rmSync(path.join(DATA_DIR, f), { force: true });
      } catch {
        /* ignore */
      }
    }
    _resetDbCache();
    seed();
  });

  it('spreads the first page across many sources', async () => {
    const res = await app.request('/api/feed?limit=20');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ sourceId: string }>; total: number };
    // 9 sources in the corpus; the old behaviour would be 1-2 here.
    expect(distinct(json.data)).toBeGreaterThanOrEqual(8);
    expect(json.data).toHaveLength(20);
  });

  it('does not let the dominant source fill the page', async () => {
    const res = await app.request('/api/feed?limit=50');
    const json = (await res.json()) as { data: Array<{ sourceId: string }> };
    const per = json.data.reduce<Record<string, number>>((m, r) => {
      m[r.sourceId] = (m[r.sourceId] ?? 0) + 1;
      return m;
    }, {});
    const biggest = Math.max(...Object.values(per));
    // The 8 small sources only hold 3 each (24), so after they are exhausted the
    // page must be filled by the dominant one — the cap is a fairness rule, not
    // a reason to return an empty page. It still must not own the whole page
    // while other sources have articles left.
    expect(biggest).toBeLessThan(json.data.length);
    expect(distinct(json.data)).toBe(9);
  });

  it('caps one source when the others have plenty', async () => {
    // Give every small source enough depth that the cap is never lifted.
    const deep: Article[] = [];
    let age = 0;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      for (let i = 0; i < 30; i++) deep.push(makeArticle(id, i, age++ * 1000));
    }
    insertArticles(deep);

    const res = await app.request('/api/feed?limit=50');
    const json = (await res.json()) as { data: Array<{ sourceId: string }> };
    const per = json.data.reduce<Record<string, number>>((m, r) => {
      m[r.sourceId] = (m[r.sourceId] ?? 0) + 1;
      return m;
    }, {});
    expect(Math.max(...Object.values(per))).toBeLessThanOrEqual(6);
    expect(distinct(json.data)).toBe(9);
  });

  it('pages without duplicates across the whole corpus', async () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < 64; offset += 16) {
      const res = await app.request(`/api/feed?limit=16&offset=${offset}`);
      const json = (await res.json()) as { data: Array<{ id: string }> };
      for (const a of json.data) {
        expect(seen.has(a.id)).toBe(false);
        seen.add(a.id);
      }
    }
    expect(seen.size).toBe(64); // 40 + 8*3
  });

  it('keeps total equal to the store size', async () => {
    const res = await app.request('/api/feed?limit=5');
    const json = (await res.json()) as { total: number };
    expect(json.total).toBe(64);
  });
});
