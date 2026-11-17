/**
 * Search tests: Arabic-aware normalization + matching + pagination.
 * Pure/offline — searchRows is exercised over a fixture list, so the live
 * JSON store is never touched.
 */

import { describe, it, expect } from 'vitest';
import { searchRows, articleMatchesQuery } from '../search.js';
import { normalizeForSearch } from '../text.js';
import type { StoredArticle } from '../db.js';

function row(
  id: string,
  title: string,
  summary: string | null,
  sourceName: string,
  publishedAt: number,
): StoredArticle {
  return {
    id,
    title,
    summary,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId: 'test',
    sourceName,
    category: 'egypt',
    country: 'EG',
    publishedAt,
    isBreaking: false,
    fetchedAt: publishedAt,
  };
}

// Newest-first, exactly how the store hands rows over.
const ROWS: StoredArticle[] = [
  row('a1', 'القاهرة تستضيف مؤتمرًا اقتصاديًا', 'يناقش المؤتمر أزمة الجنيه', 'اليوم السابع', 5000),
  row('a2', 'مباراة الأهلي والزمالك في الدوري', null, 'الجزيرة', 4000),
  row('a3', 'إطلاق هاتف جديد بتقنية الذكاء الاصطناعي', 'سعر الهاتف الجديد', 'الشرق', 3000),
  row('a4', 'أسعار الذهب ترتفع في الأسواق', 'تقرير عن الذهب', 'اليوم السابع', 2000),
  row('a5', 'خبر رياضى عن كأس مصر', 'ملخص المباراة', 'اليوم السابع', 1000),
];

describe('normalizeForSearch', () => {
  it('unifies alef variants', () => {
    expect(normalizeForSearch('أحمد')).toBe(normalizeForSearch('احمد'));
    expect(normalizeForSearch('إسلام')).toBe(normalizeForSearch('اسلام'));
    expect(normalizeForSearch('آمن')).toBe(normalizeForSearch('امن'));
  });

  it('unifies teh marbuta and alef maqsura', () => {
    expect(normalizeForSearch('قاهرة')).toBe(normalizeForSearch('قاهره'));
    expect(normalizeForSearch('مصطفى')).toBe(normalizeForSearch('مصطفي'));
  });

  it('strips tashkeel and tatweel', () => {
    expect(normalizeForSearch('مُبَارَاة')).toBe('مباراه');
    expect(normalizeForSearch('مبـــاراة')).toBe('مباراه');
  });

  it('lowercases Latin and collapses whitespace', () => {
    expect(normalizeForSearch('  Google   NEWS  ')).toBe('google news');
  });

  it('handles empty input', () => {
    expect(normalizeForSearch('')).toBe('');
    expect(normalizeForSearch(null)).toBe('');
    expect(normalizeForSearch(undefined)).toBe('');
  });
});

describe('search: matching', () => {
  it('matches on the title', () => {
    const { articles, total } = searchRows(ROWS, 'الذهب');
    expect(total).toBe(1);
    expect(articles[0]!.id).toBe('a4');
  });

  it('matches on the summary', () => {
    const { articles } = searchRows(ROWS, 'أزمة');
    expect(articles.map((a) => a.id)).toEqual(['a1']);
  });

  it('matches on the source name', () => {
    const { articles, total } = searchRows(ROWS, 'اليوم السابع');
    expect(total).toBe(3);
    expect(articles.map((a) => a.id)).toEqual(['a1', 'a4', 'a5']);
  });

  it('ignores Arabic orthography differences in the query', () => {
    // "رياضى" is stored, the user types "رياضي".
    expect(searchRows(ROWS, 'رياضي').total).toBe(1);
    // "اقتصاديًا" is stored, the user types it without tashkeel.
    expect(searchRows(ROWS, 'اقتصاديا').total).toBe(1);
    expect(searchRows(ROWS, 'مؤتمر').total).toBe(1);
    // Stored with a final alef maqsura, typed with yeh.
    expect(searchRows(ROWS, 'اقتصادى').total).toBe(1);
  });

  it('is case-insensitive for Latin text', () => {
    expect(articleMatchesQuery(ROWS[2]!, normalizeForSearch('ذكاء'))).toBe(true);
  });

  it('returns empty for no match', () => {
    const { articles, total } = searchRows(ROWS, 'كلمة غير موجودة');
    expect(articles).toEqual([]);
    expect(total).toBe(0);
  });

  it('returns empty for a blank query', () => {
    expect(searchRows(ROWS, '').total).toBe(0);
    expect(searchRows(ROWS, '   ').total).toBe(0);
  });

  it('keeps the newest-first order', () => {
    const { articles } = searchRows(ROWS, 'اليوم السابع');
    const times = articles.map((a) => a.publishedAt);
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });
});

describe('search: pagination', () => {
  it('limits the page but reports the full total', () => {
    const { articles, total } = searchRows(ROWS, 'اليوم السابع', 2, 0);
    expect(articles.map((a) => a.id)).toEqual(['a1', 'a4']);
    expect(total).toBe(3);
  });

  it('honours the offset', () => {
    const { articles, total } = searchRows(ROWS, 'اليوم السابع', 2, 2);
    expect(articles.map((a) => a.id)).toEqual(['a5']);
    expect(total).toBe(3);
  });

  it('returns an empty page past the end', () => {
    const { articles, total } = searchRows(ROWS, 'اليوم السابع', 2, 10);
    expect(articles).toEqual([]);
    expect(total).toBe(3);
  });
});
