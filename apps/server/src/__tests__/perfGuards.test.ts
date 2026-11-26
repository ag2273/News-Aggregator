import { describe, it, expect } from 'vitest';
import { relatedNews } from '../matchNews.js';
import { remember } from '../boundedCache.js';

// Guards for the performance fixes: the faster paths must give the same answers.

const words = ['الأهلي', 'الزمالك', 'بيراميدز', 'البنك الأهلي', 'وادي دجلة', 'الاتحاد السكندري', 'الدولار', 'الطقس', 'إنتر ميلان', 'إنتر ميامي'];
const corpus = Array.from({ length: 400 }, (_, i) => ({
  id: `a${i}`,
  title: `${words[i % words.length]} ${words[(i * 7) % words.length]} خبر رقم ${i}`,
  summary: i % 3 ? `ملخص عن ${words[(i * 3) % words.length]} في الدوري` : null,
  sourceName: 'مصدر',
  url: `https://example.test/${i}`,
  // Newest first, with ties, as the store hands it over.
  publishedAt: 100_000 - Math.floor(i / 2),
}));

describe('relatedNews fast paths', () => {
  const pairs: Array<[string, string]> = [
    ['الأهلي', 'الزمالك'],
    ['وادي دجلة', 'الاتحاد السكندري'],
    ['إنتر ميلان', 'بيراميدز'],
    ['الأهلي', 'الأهلي'],
  ];
  it.each(pairs)('stopping early on a newest-first corpus changes nothing (%s × %s)', (home, away) => {
    for (const limit of [1, 5, 10, 50]) {
      const full = relatedNews(home, away, { articles: corpus, limit });
      const early = relatedNews(home, away, { articles: corpus, limit, newestFirst: true });
      expect(early).toEqual(full);
    }
  });

  it('gives the same answer the second time (cached normalisation)', () => {
    const a = relatedNews('الأهلي', 'بيراميدز', { articles: corpus });
    const b = relatedNews('الأهلي', 'بيراميدز', { articles: corpus });
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('remember (bounded cache)', () => {
  it('never holds more than max, dropping expired entries first, then the oldest', () => {
    const map = new Map<string, { at: number }>();
    for (let i = 0; i < 10; i++) remember(map, `k${i}`, { at: i }, 5, (e) => e.at < 3);
    expect(map.size).toBe(5);
    expect([...map.keys()]).toEqual(['k5', 'k6', 'k7', 'k8', 'k9']);
  });

  it('evicts expired entries before fresh ones', () => {
    const map = new Map<string, { at: number }>();
    remember(map, 'fresh', { at: 10 }, 3, (e) => e.at < 5);
    remember(map, 'stale1', { at: 1 }, 3, (e) => e.at < 5);
    remember(map, 'stale2', { at: 2 }, 3, (e) => e.at < 5);
    remember(map, 'new', { at: 11 }, 3, (e) => e.at < 5);
    expect([...map.keys()]).toEqual(['fresh', 'new']);
  });
});
