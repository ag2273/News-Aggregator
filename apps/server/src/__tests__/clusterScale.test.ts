/**
 * The grouped feed must not freeze the server as the store grows.
 *
 * `/api/feed?grouped=1` clusters the whole store. The old double loop compared every
 * article with every cluster so far: ~21,000 rows measured 7.5s of synchronous CPU,
 * and every other route (matches, live status, saved, reader) waited behind it until
 * the app's 20s timeout. These tests pin that the faster search gives the SAME
 * clusters, that it stays fast at production size, and that the result is reused
 * until the store changes.
 */

import { describe, it, expect } from 'vitest';
import { clusterArticles, prepare, shouldMerge } from '../cluster.js';
import type { Cluster } from '../cluster.js';
import { groupedFeedPage, groupedFeedPageCached } from '../groupedFeed.js';
import type { Article } from '../types.js';

/** The previous algorithm, kept verbatim as the reference the fast one must match. */
function referenceClusters(articles: Article[]): Cluster[] {
  const prepared = prepare(articles);
  const clusters: Array<{ members: typeof prepared }> = [];
  for (const item of prepared) {
    let placed = false;
    for (const cluster of clusters) {
      const lead = cluster.members[0];
      if (!lead) continue;
      if (shouldMerge(lead, item)) {
        cluster.members.push(item);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ members: [item] });
  }
  return clusters.map((c) => ({ lead: c.members[0]!.article, members: c.members.map((m) => m.article) }));
}

const ids = (cs: Cluster[]) => cs.map((c) => c.members.map((m) => m.id));

/** Deterministic corpus with many near-duplicate headlines across sources. */
function corpus(n: number, spanMs: number, storyPool: number, seed = 1): Article[] {
  let s = seed;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const letters = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
  const vocab = Array.from({ length: 1500 }, () => {
    let w = '';
    const len = 3 + Math.floor(rnd() * 4);
    for (let j = 0; j < len; j++) w += letters[Math.floor(rnd() * letters.length)];
    return w;
  });
  const word = () => vocab[Math.floor(rnd() * rnd() * vocab.length)]!;
  const stories = Array.from({ length: storyPool }, () => Array.from({ length: 9 }, word));
  const now = Date.UTC(2026, 10, 26);
  const out: Article[] = [];
  for (let i = 0; i < n; i++) {
    // Most titles are a shared story with a word or two swapped; some are noise.
    const base = rnd() < 0.7 ? [...stories[Math.floor(rnd() * storyPool)]!] : Array.from({ length: 9 }, word);
    if (rnd() < 0.5) base[Math.floor(rnd() * base.length)] = word();
    if (rnd() < 0.3) base.push(word());
    out.push({
      id: `a${i}`,
      title: base.join(' '),
      summary: null,
      imageUrl: null,
      url: `https://example.test/${i}`,
      sourceId: `s${Math.floor(rnd() * 29)}`,
      sourceName: 'x',
      category: 'misc',
      country: 'eg',
      publishedAt: now - Math.floor((i / n) * spanMs),
      isBreaking: false,
    } as Article);
  }
  return out;
}

describe('clusterArticles at store scale', () => {
  it('gives exactly the clusters the old double loop gave (newest-first input)', () => {
    const articles = corpus(3000, 3 * 24 * 3600_000, 120);
    const fast = clusterArticles(articles);
    expect(fast.some((c) => c.members.length > 1)).toBe(true);
    expect(ids(fast)).toEqual(ids(referenceClusters(articles)));
  });

  it('gives the same clusters when the input is not sorted', () => {
    const articles = corpus(1500, 2 * 24 * 3600_000, 60, 7);
    const shuffled = articles.filter((_, i) => i % 2 === 0).concat(articles.filter((_, i) => i % 2 === 1));
    expect(ids(clusterArticles(shuffled))).toEqual(ids(referenceClusters(shuffled)));
  });

  it('clusters a production-sized store (21,409 rows) well under a second', () => {
    const articles = corpus(21_409, 14 * 24 * 3600_000, 2000, 3);
    const t = performance.now();
    clusterArticles(articles);
    // The old loop took ~7.5s here on a fast machine; this budget leaves room for CI.
    expect(performance.now() - t).toBeLessThan(2000);
  });
});

describe('grouped feed cache', () => {
  it('builds once per store version and pages the same as the uncached path', () => {
    const articles = corpus(800, 24 * 3600_000, 40, 11);
    let loads = 0;
    const load = () => {
      loads++;
      return articles;
    };
    const a = groupedFeedPageCached(1001, load, 0, 20);
    const b = groupedFeedPageCached(1001, load, 20, 20);
    expect(loads).toBe(1);
    expect(a).toEqual(groupedFeedPage(articles, 0, 20));
    expect(b).toEqual(groupedFeedPage(articles, 20, 20));
    groupedFeedPageCached(1002, load, 0, 20);
    expect(loads).toBe(2);
  });
});
