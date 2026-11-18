/**
 * T3 — category classifier tests.
 * Pure, offline: no network, no store.
 */

import { describe, it, expect } from 'vitest';
import { categorize, normalizeCategory, detectBreaking, CATEGORIES } from '../categorize.js';

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

describe('detectBreaking', () => {
  /**
   * Real titles from production. The old rule was `title.includes('عاجل')`,
   * which flagged ordinary news that merely mentioned urgency; these cases pin
   * the label-not-keyword rule in both directions.
   */
  it('flags editorial alert labels in the title', () => {
    // Real Al Jazeera alerts (prefix + separator).
    expect(detectBreaking('عاجل | مسؤول عراقي للجزيرة: قائد فيلق القدس بالحرس الثوري الإيراني إسماعيل قآني وصل العراق لحل')).toBe(true);
    expect(detectBreaking('عاجل | هيئة بريطانية: مسلحون على زورق حاولوا اعتلاء ناقلة قرب المكلا')).toBe(true);
    expect(detectBreaking('عاجل| "أدنوك" الإماراتية: تعرض إحدى سفننا لهجوم بمضيق هرمز وإصابة 11 شخصا')).toBe(true);
    // Real Al Arabiya alert.
    expect(detectBreaking('عاجل: طائرة ركاب روسية تهبط اضطرارياً في مطار أنطاليا التركي بعد بلاغ بوجود قنبلة')).toBe(true);
    // Google News variants seen live: "عاجل..", "عاجل.", and the "- عاجل -" suffix.
    expect(detectBreaking('عاجل.. كيما: رفع سعر الغاز لمصانع الأسمدة 50% مؤقتًا')).toBe(true);
    expect(detectBreaking('عاجل. تحرّك عسكري أميركي رفيع في إسرائيل')).toBe(true);
    expect(detectBreaking('الجيش الإيراني يعلن إسقاط مسيرة أميركية في أجواء مضيق هرمز - عاجل - قناة الغد')).toBe(true);
    expect(detectBreaking('التحالف يعترض صاروخ أطلقته الحوثيون باتجاه الرياض - عاجل - قناة الغد')).toBe(true);
    // Bullet and English alert markers.
    expect(detectBreaking('🔴 انفجار كبير في ميناء بيروت')).toBe(true);
    expect(detectBreaking('BREAKING: earthquake hits the coast')).toBe(true);
  });

  it('does NOT flag ordinary news that merely contains عاجل', () => {
    // All real production titles that the old keyword rule wrongly flagged.
    expect(detectBreaking('قرار عاجل من الأعلى للإعلام ضد رضا عبد العال ومحمد فاروق - المصري اليوم')).toBe(false);
    expect(detectBreaking('ثعابين في مدرسة مصرية تثير الذعر.. وتحرك عاجل من السلطات (فيديو)')).toBe(false);
    expect(detectBreaking('رسالة عاجلة عبر الهاتف.. تنبيه أمني في البحرين الآن للمواطنين والمقيمين')).toBe(false);
    expect(detectBreaking('إنذار داخل مقر المخابرات الأمريكية.. وتحرك عاجل لفرق الإطفاء')).toBe(false);
    expect(detectBreaking('عقب ظهور ثعبان داخل إحدى مدارس الغردقة.. تحرك عاجل من «تعليم البحر الأحمر»')).toBe(false);
    expect(detectBreaking('بيان مهم من الكويت بشأن أصوات الانفجارات.. ونداء عاجل للمواطنين والمقيمين')).toBe(false);
    expect(detectBreaking('تحرك برلماني عاجل لإنهاء أزمة إلغاء مئات طلبات التصالح بالشرقية')).toBe(false);
    expect(detectBreaking('تحذير أمني عاجل لمستخدمي «Java».. ثغرات خطيرة تسمح باختراق الأنظمة')).toBe(false);
    // The word mid-sentence, and the feminine form which is not used as a label.
    expect(detectBreaking('الاقتصاد المصري ينمو 4.9% خلال الربع الأول من 2026-2027')).toBe(false);
    expect(detectBreaking('عاجلة: تفاصيل جديدة عن الحادث')).toBe(false);
  });

  it('does NOT flag live coverage as breaking', () => {
    // Real production titles: these are sport live blogs, not breaking events.
    expect(detectBreaking('مباشر مباراة ليبيا ضد تونس في تصفيات كأس أمم أفريقيا 2027.. لحظة بلحظة')).toBe(false);
    expect(detectBreaking('مباشر مباراة العراق ضد إيران في بطولة البصرة الدولية 2026.. لحظة بلحظة')).toBe(false);
    expect(detectBreaking('متابعة الأحداث لحظة بلحظة')).toBe(false);
    expect(detectBreaking('تغطية مباشرة للقمة العربية')).toBe(false);
    // A genuine alert that also mentions live coverage is still breaking: the
    // outlet's own label outranks the live-blog wording.
    expect(detectBreaking('عاجل | تغطية مباشرة: انفجار في وسط العاصمة')).toBe(true);
  });

  it('returns false for regular titles', () => {
    expect(detectBreaking('الأهلي يفوز في مباراة القمة بالدوري المصري')).toBe(false);
    expect(detectBreaking('ارتفاع أسعار الذهب والدولار اليوم في مصر')).toBe(false);
    expect(detectBreaking('آبل تطرح هاتف آيفون جديد بتقنية الذكاء الاصطناعي')).toBe(false);
    expect(detectBreaking('بوتين يصل إلى الصين في زيارة رسمية')).toBe(false);
  });

  it('handles empty or non-string input safely', () => {
    expect(detectBreaking('')).toBe(false);
    expect(detectBreaking(null)).toBe(false);
    expect(detectBreaking(undefined)).toBe(false);
  });
});
