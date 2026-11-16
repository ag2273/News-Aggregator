/**
 * T3 — category classifier tests.
 * Pure, offline: no network, no store.
 */

import { describe, it, expect } from 'vitest';
import { categorize, normalizeCategory, CATEGORIES } from '../categorize.js';

describe('categorize: title+summary → category id', () => {
  it('classifies tech articles', () => {
    expect(categorize('آبل تطلق هاتف آيفون جديد بتقنية الذكاء الاصطناعي')).toBe('tech');
  });

  it('classifies sports articles', () => {
    expect(categorize('الأهلي يفوز في مباراة القمة بالدوري المصري')).toBe('sports');
  });

  it('classifies economy articles', () => {
    expect(categorize('ارتفاع أسعار الدولار والجنيه في البورصة المصرية')).toBe('economy');
  });

  it('classifies health articles', () => {
    expect(categorize('وزارة الصحة تعلن عن حملة لقاح كورونا')).toBe('health');
  });

  it('classifies general Egyptian news as egypt', () => {
    expect(categorize('الرئيس المصري يفتتح مشروعًا جديدًا في القاهرة')).toBe('egypt');
  });

  it('falls back to misc for unrelated content', () => {
    expect(categorize('تقرير عن الطقس غدًا')).toBe('misc');
  });

  it('handles empty summary', () => {
    expect(categorize('منتخب مصر يخوض مباراة ودية')).toBe('sports');
  });
});

describe('normalizeCategory', () => {
  it('passes through known ids', () => {
    expect(normalizeCategory('tech')).toBe('tech');
  });

  it('maps legacy/missing values to misc', () => {
    expect(normalizeCategory('general')).toBe('misc');
    expect(normalizeCategory(null)).toBe('misc');
    expect(normalizeCategory(undefined)).toBe('misc');
  });

  it('all category ids are unique', () => {
    expect(new Set(CATEGORIES.map((c) => c.id)).size).toBe(CATEGORIES.length);
  });
});
