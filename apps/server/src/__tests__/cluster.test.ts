/**
 * Same-story clustering and the grouped feed.
 *
 * Precision matters more than recall: a wrong merge hides a distinct story. So
 * these tests pin both directions — real production pairs must merge, and
 * lookalike-but-different headlines must not.
 */

import { describe, it, expect } from 'vitest';
import {
  clusterTitle,
  shingles,
  jaccard,
  shouldMerge,
  prepare,
  clusterArticles,
  CLUSTER_MIN_SIMILARITY,
  CLUSTER_MIN_SHARED_SHINGLES,
  CLUSTER_WINDOW_MS,
} from '../cluster.js';
import { collapseToRows, groupedFeedPage } from '../groupedFeed.js';
import type { Article } from '../types.js';

function article(
  id: string,
  sourceId: string,
  title: string,
  ageMs = 0,
): Article {
  return {
    id,
    title,
    summary: null,
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

describe('cluster: title preparation', () => {
  it('strips the Google News outlet suffix', () => {
    expect(clusterTitle('رئيس الوزراء يشهد الإطلاق الرسمي لمشروع نيفيرا - بوابة الأهرام')).not.toContain(
      'الأهرام',
    );
  });

  it('normalises alef, teh marbuta and yeh variants', () => {
    const a = clusterTitle('انطلاق فعاليات التدريب البحري المصري');
    const b = clusterTitle('إنطلاق فعاليات التدريب البحرى المصرى');
    expect(a).toBe(b);
  });

  it('drops diacritics and punctuation', () => {
    expect(clusterTitle('«مدبولي» يُكلف بالتوسع')).toBe(clusterTitle('مدبولى يكلف بالتوسع'));
  });

  it('removes stop words that carry no story identity', () => {
    const prepared = clusterTitle('مقتل شخص في حادث على الطريق');
    expect(prepared.split(' ')).not.toContain('في');
    expect(prepared.split(' ')).not.toContain('على');
  });
});

describe('cluster: shingles and similarity', () => {
  it('builds 2-word shingles', () => {
    expect([...shingles('a b c')]).toEqual(['a b', 'b c']);
  });

  it('falls back to words for a one-word title', () => {
    expect([...shingles('خبر')]).toEqual(['خبر']);
  });

  it('scores identical sets as 1 and disjoint as 0', () => {
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(jaccard(new Set(['a', 'b']), new Set(['c', 'd']))).toBe(0);
  });
});

describe('cluster: merge decision', () => {
  const now = Date.now();
  const prep = (a: Article) => prepare([a])[0]!;

  it('merges the same story from two outlets (real production pair)', () => {
    const a = prep(
      article('1', 'almasry', 'رسميًا.. اعتماد 5 منشآت صحية بالمنيا ضمن منظومة الجودة وسلامة المرضى', 0),
    );
    const b = prep(
      article('2', 'youm7', 'محافظ المنيا: اعتماد 5 منشآت صحية بالمحافظة ضمن منظومة الجودة وسلامة المرضى', 60_000),
    );
    expect(shouldMerge(a, b)).toBe(true);
  });

  it('never merges two articles from the same source', () => {
    const t = 'رئيس الوزراء يشهد الإطلاق الرسمي لمشروع نيفيرا';
    const a = prep(article('1', 'youm7', t, 0));
    const b = prep(article('2', 'youm7', t, 60_000));
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('never merges across the time window', () => {
    const t = 'رئيس الوزراء يشهد الإطلاق الرسمي لمشروع نيفيرا';
    const a = prep(article('1', 'ahram', t, 0));
    const b = prep(article('2', 'youm7', t, CLUSTER_WINDOW_MS + 60_000));
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('does not merge different stories that share a topic word', () => {
    const a = prep(article('1', 'almasry', 'مقتل عامل وإصابة ابن عمه في مشاجرة بالهرم', 0));
    const b = prep(article('2', 'youm7', 'مقتل سيدة فلسطينية برصاص مستوطنين في أريحا', 0));
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('does not merge on a single shared bigram', () => {
    // Two short titles overlapping in one phrase must stay apart.
    const a = prep(article('1', 'a', 'غارات إسرائيلية على غزة', 0));
    const b = prep(article('2', 'b', 'غارات إسرائيلية على اليمن', 0));
    expect(shouldMerge(a, b)).toBe(false);
  });

  it('respects a stricter threshold when asked', () => {
    const a = prep(article('1', 'a', 'بوتين: تجارتنا مع دول آسيا تتجاوز نصف التعاملات', 0));
    const b = prep(article('2', 'b', 'بوتين: تجارتنا مع دول آسيا والمحيط تتجاوز نصف التعاملات', 0));
    expect(shouldMerge(a, b, 0.2, 2)).toBe(true);
    expect(shouldMerge(a, b, 0.99, 2)).toBe(false);
  });

  it('exposes the measured thresholds', () => {
    expect(CLUSTER_MIN_SIMILARITY).toBe(0.45);
    expect(CLUSTER_MIN_SHARED_SHINGLES).toBe(3);
  });
});

describe('cluster: grouping', () => {
  function corpus(): Article[] {
    return [
      article('a1', 'almasry', 'رسميًا.. اعتماد 5 منشآت صحية بالمنيا ضمن منظومة الجودة وسلامة المرضى', 0),
      article('a2', 'youm7', 'محافظ المنيا: اعتماد 5 منشآت صحية بالمحافظة ضمن منظومة الجودة وسلامة المرضى', 1000),
      article('b1', 'cnn-arabic', 'مصادر لـCNN: تعطل شبكة اتصالات بالغة السرية تابعة لوكالة الأمن القومي الأمريكي', 2000),
      article('b2', 'rt-arabic', 'تعطل شبكة اتصالات بالغة السرية تابعة للأمن القومي الأمريكي', 3000),
      article('c1', 'ahram', 'انطلاق تصوير مسلسل 180 بطولة عمرو يوسف', 4000),
      article('c2', 'skynews-arabia', 'أسعار الذهب ترتفع اليوم في مصر', 5000),
    ];
  }

  it('groups the two real pairs and leaves the rest alone', () => {
    const clusters = clusterArticles(corpus());
    const multi = clusters.filter((c) => c.members.length > 1);
    expect(multi).toHaveLength(2);
    expect(multi[0]?.members.map((m) => m.id)).toEqual(['a1', 'a2']);
    expect(multi[1]?.members.map((m) => m.id)).toEqual(['b1', 'b2']);
  });

  it('keeps singles as single-member clusters', () => {
    const clusters = clusterArticles(corpus());
    const singles = clusters.filter((c) => c.members.length === 1);
    expect(singles).toHaveLength(2);
  });

  it('includes every article exactly once', () => {
    const clusters = clusterArticles(corpus());
    const ids = clusters.flatMap((c) => c.members.map((m) => m.id));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('anchors the lead to the newest member', () => {
    const clusters = clusterArticles(corpus());
    const pair = clusters.find((c) => c.members.length > 1)!;
    expect(pair.lead.id).toBe('a1'); // ageMs 0 is newest
  });
});

describe('grouped feed: rows and pagination', () => {
  function corpus(): Article[] {
    const rows: Article[] = [];
    // Two real pairs plus four singles, newest-first.
    rows.push(article('a1', 'almasry', 'رسميًا.. اعتماد 5 منشآت صحية بالمنيا ضمن منظومة الجودة وسلامة المرضى', 0));
    rows.push(article('a2', 'youm7', 'محافظ المنيا: اعتماد 5 منشآت صحية بالمحافظة ضمن منظومة الجودة وسلامة المرضى', 1000));
    rows.push(article('b1', 'cnn-arabic', 'مصادر لـCNN: تعطل شبكة اتصالات بالغة السرية تابعة لوكالة الأمن القومي الأمريكي', 2000));
    rows.push(article('b2', 'rt-arabic', 'تعطل شبكة اتصالات بالغة السرية تابعة للأمن القومي الأمريكي', 3000));
    rows.push(article('c1', 'ahram', 'انطلاق تصوير مسلسل 180 بطولة عمرو يوسف', 4000));
    rows.push(article('c2', 'skynews-arabia', 'أسعار الذهب ترتفع اليوم في مصر', 5000));
    return rows;
  }

  it('collapses a cluster into one row at its first member', () => {
    const rows = collapseToRows(corpus(), clusterArticles(corpus()));
    expect(rows).toHaveLength(4); // 2 clusters + 2 singles
    expect(rows[0]?.kind).toBe('cluster');
  });

  it('never lists a cluster member separately', () => {
    const rows = collapseToRows(corpus(), clusterArticles(corpus()));
    const articleIds = rows.flatMap((r) => (r.kind === 'article' ? [r.article.id] : []));
    expect(articleIds).not.toContain('a2');
    expect(articleIds).not.toContain('b2');
  });

  it('has no duplicate rows across pages', () => {
    const seen = new Set<string>();
    for (let offset = 0; offset < 8; offset += 1) {
      const page = groupedFeedPage(corpus(), offset, 1);
      for (const row of page.rows) {
        const key = row.kind === 'article' ? row.article.id : row.lead.id;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
    // 4 rows max over a 6-article corpus with 2 pairs.
    expect(seen.size).toBeLessThanOrEqual(4);
  });

  it('reports totals for both articles and rows', () => {
    const page = groupedFeedPage(corpus(), 0, 50);
    expect(page.totalArticles).toBe(6);
    expect(page.totalRows).toBe(4);
  });
});
