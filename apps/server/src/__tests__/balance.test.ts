/**
 * Feed balancing: page 1 must show many sources, and paging must stay correct.
 *
 * The bug: the store is newest-first across all articles, so one high-volume
 * outlet (المصري اليوم, ~670/day) took 33 of the first 50 slots and the feed
 * showed 5 of 9 live sources even though the others had fresh articles.
 */

import { describe, it, expect } from 'vitest';
import { interleaveBySource, balancedPage, DEFAULT_MAX_PER_SOURCE } from '../balance.js';

interface Row {
  id: string;
  sourceId: string;
  publishedAt: number;
}

/** Newest-first rows, `counts` articles per source, round-robin by age. */
function corpus(counts: Record<string, number>): Row[] {
  const rows: Row[] = [];
  let t = 1_000_000;
  const remaining = { ...counts };
  // Emit in age order, cycling sources so each source's articles are interleaved.
  let emitted = true;
  while (emitted) {
    emitted = false;
    for (const [sourceId, count] of Object.entries(counts)) {
      const left = remaining[sourceId] ?? 0;
      if (left <= 0) continue;
      emitted = true;
      remaining[sourceId] = left - 1;
      rows.push({ id: `${sourceId}-${count - left}`, sourceId, publishedAt: t-- });
    }
  }
  return rows;
}

/** A realistic corpus: one outlet dominating, as in production. */
function productionShape(): Row[] {
  const rows: Row[] = [];
  let t = 1_000_000;
  const spec: Array<[string, number]> = [
    ['almasry', 33],
    ['rt-arabic', 9],
    ['skynews-arabia', 6],
    ['bbc-arabic', 1],
    ['cnn-arabic', 1],
  ];
  for (const [sourceId, count] of spec) {
    for (let i = 0; i < count; i++) rows.push({ id: `${sourceId}-${i}`, sourceId, publishedAt: t-- });
  }
  return rows.sort((a, b) => b.publishedAt - a.publishedAt);
}

const distinct = (rows: Row[]) => new Set(rows.map((r) => r.sourceId)).size;

describe('balance: interleave', () => {
  it('puts every source first before any source twice', () => {
    const rows = corpus({ a: 3, b: 3, c: 2 });
    const out = interleaveBySource(rows);
    expect(out.slice(0, 3).map((r) => r.sourceId)).toEqual(['a', 'b', 'c']);
  });

  it('keeps every article exactly once', () => {
    const rows = corpus({ a: 10, b: 4, c: 7 });
    const out = interleaveBySource(rows);
    expect(out).toHaveLength(rows.length);
    expect(new Set(out.map((r) => r.id)).size).toBe(rows.length);
  });

  it('handles a single source', () => {
    const rows = corpus({ a: 5 });
    expect(interleaveBySource(rows).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });

  it('handles an empty corpus', () => {
    expect(interleaveBySource([])).toEqual([]);
  });

  it('still drains a long source after short ones end', () => {
    const rows = corpus({ long: 8, short: 2 });
    const out = interleaveBySource(rows);
    expect(out).toHaveLength(10);
    // The last positions must be the long source's remainder.
    expect(out.slice(-4).every((r) => r.sourceId === 'long')).toBe(true);
  });
});

describe('balance: pages', () => {
  it('shows many sources on page 1 instead of one dominant outlet', () => {
    const rows = productionShape();
    const before = rows.slice(0, 50);
    expect(distinct(before)).toBe(5);

    const page = balancedPage(rows, 0, 50);
    expect(distinct(page)).toBeGreaterThanOrEqual(5);
    expect(page).toHaveLength(50);
  });

  it('caps a single source per page', () => {
    const rows = corpus({ big: 100, small: 3 });
    const page = balancedPage(rows, 0, 50, 6);
    const perSource = page.reduce<Record<string, number>>((m, r) => {
      m[r.sourceId] = (m[r.sourceId] ?? 0) + 1;
      return m;
    }, {});
    // Once the small source runs out the cap is lifted, but not before.
    expect(perSource['big']).toBeGreaterThan(0);
    expect(perSource['small']).toBe(3);
  });

  it('fills the page from a single-source corpus', () => {
    const rows = corpus({ only: 80 });
    const page = balancedPage(rows, 0, 50, 6);
    expect(page).toHaveLength(50);
  });

  it('produces no duplicates and no skips across pages', () => {
    const rows = corpus({ a: 120, b: 40, c: 20, d: 15, e: 9 });
    const limit = 50;
    const pages: Row[] = [];
    for (let offset = 0; offset < 200; offset += limit) {
      pages.push(...balancedPage(rows, offset, limit));
    }
    expect(pages).toHaveLength(200);
    expect(new Set(pages.map((r) => r.id)).size).toBe(200);
  });

  it('pages are contiguous with the balanced order', () => {
    const rows = corpus({ a: 30, b: 20, c: 10 });
    const whole = balancedPage(rows, 0, rows.length);
    const first = balancedPage(rows, 0, 25);
    const second = balancedPage(rows, 25, 25);
    expect([...first, ...second]).toEqual(whole.slice(0, 50));
  });

  it('returns an empty page past the end', () => {
    const rows = corpus({ a: 10 });
    expect(balancedPage(rows, 100, 50)).toEqual([]);
  });

  it('rejects a non-positive limit', () => {
    const rows = corpus({ a: 10 });
    expect(balancedPage(rows, 0, 0)).toEqual([]);
  });

  it('maxPerSource 0 disables the ceiling', () => {
    const rows = corpus({ a: 10, b: 10 });
    const capped = balancedPage(rows, 0, 20, 3);
    const uncapped = balancedPage(rows, 0, 20, 0);
    expect(distinct(capped)).toBe(2);
    expect(uncapped).toHaveLength(20);
  });

  it('has a sane default ceiling', () => {
    expect(DEFAULT_MAX_PER_SOURCE).toBeGreaterThan(0);
    expect(DEFAULT_MAX_PER_SOURCE).toBeLessThanOrEqual(10);
  });
});
