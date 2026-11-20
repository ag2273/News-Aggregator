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
   * Real production titles. Three rule iterations were measured against them:
   * a bare keyword match (21 flags, 52% precise), label-only (10 flags,
   * 60%), and the current label + narrow incident rule (11 flags, 90.9%).
   */

  it('flags editorial alert labels', () => {
    expect(detectBreaking('عاجل | مسؤول عراقي للجزيرة: قائد فيلق القدس بالحرس الثوري الإيراني إسماعيل قآني وصل العراق')).toBe(true);
    expect(detectBreaking('عاجل| "أدنوك" الإماراتية: تعرض إحدى سفننا لهجوم بمضيق هرمز وإصابة 11 شخصا')).toBe(true);
    expect(detectBreaking('عاجل: طائرة ركاب روسية تهبط اضطرارياً في مطار أنطاليا التركي بعد بلاغ بوجود قنبلة - العربية')).toBe(true);
    expect(detectBreaking('عاجل | مجلس القيادة الرئاسي اليمني: إصدار قانون يصنف جماعة الحوثي منظمة إرهابية')).toBe(true);
    // Google News variants.
    expect(detectBreaking('عاجل.. كيما: رفع سعر الغاز لمصانع الأسمدة 50% مؤقتًا')).toBe(true);
    expect(detectBreaking('عاجل. تحرّك عسكري أميركي رفيع في إسرائيل')).toBe(true);
    expect(detectBreaking('الجيش الإيراني يعلن إسقاط مسيرة أميركية - عاجل - قناة الغد')).toBe(true);
    expect(detectBreaking('🔴 انفجار كبير في ميناء بيروت')).toBe(true);
    expect(detectBreaking('BREAKING: earthquake hits the coast')).toBe(true);
  });

  it('does not flag a labelled holding statement or scheduled event', () => {
    // Real production false positives from the label tier.
    expect(detectBreaking('عاجل | وزير النقل الأمريكي: لم يحدد بعد السبب الجذري لتعطل جهاز توجيه حركة الطيران يوم الجمعة')).toBe(false);
    expect(detectBreaking('عاجل | نائب محافظ هرمزغان الإيرانية: الهجوم الأمريكي على مواقع بجزيرة قشم لم يلحق ضررا بمناطق سكنية')).toBe(false);
    expect(detectBreaking('عاجل | ترمب يصل إلى الصين لحضور اجتماع أبيك والمشاركة في قمة مع الرئيسين الصيني والروسي')).toBe(false);
    expect(detectBreaking('عاجل | واشنطن تنفي إصابة رادار أميركي بمسيرات إيرانية')).toBe(false);
  });

  it('flags major incidents with a stated toll', () => {
    // Real production titles from the Egyptian and Gulf sources, which never
    // use an "عاجل" label.
    expect(detectBreaking('مصرع 19 شخصًا في تحطم طائرة عسكرية روسية من طراز «أنطونوف-12» بمقاطعة كيميروفو - المصري اليوم')).toBe(true);
    expect(detectBreaking('لا ناجين.. تحطم طائرة عسكرية روسية ومقتل 19')).toBe(true);
    expect(detectBreaking('إصابة العشرات جراء تصادم قطارين في التشيك - بوابة الأهرام')).toBe(true);
    expect(detectBreaking('مصرع وإصابة 5 أشخاص إثر انهيار منزل في السيدة زينب - Masrawy')).toBe(true);
    expect(detectBreaking('تحطم مروحية عسكرية أردنية خلال تدريب')).toBe(false); // no toll stated -> stays unflagged
  });

  it('does not flag routine news that mentions urgency or casualties', () => {
    // The near-miss family: urgency words inside a compound.
    expect(detectBreaking('قرار عاجل من الأعلى للإعلام ضد رضا عبد العال ومحمد فاروق - المصري اليوم')).toBe(false);
    expect(detectBreaking('تحرك عاجل من محافظة القاهرة بشأن الأكشاك المرخصة')).toBe(false);
    expect(detectBreaking('تحذير أمني عاجل لمستخدمي «Java».. ثغرات خطيرة')).toBe(false);
    expect(detectBreaking('بيان مهم من الكويت.. ونداء عاجل للمواطنين والمقيمين')).toBe(false);
    expect(detectBreaking('رسالة عاجلة عبر الهاتف.. تنبيه أمني في البحرين')).toBe(false);
    // Small/routine incidents below the toll line, and blotter entries.
    expect(detectBreaking('إصابة 5 أشخاص فى حادث تصادم بسوهاج - بوابة الأهرام')).toBe(false);
    expect(detectBreaking('إصابة 3 أشخاص فى حريق شقة سكنية بالسيوف شرق الإسكندرية')).toBe(false);
    expect(detectBreaking('مصرع شخص في حادث تصادم بين سيارة ملاكي وأخرى نقل بطريق السلوم')).toBe(false);
    expect(detectBreaking('ضبط 445 كجم لحوم ودواجن غير صالحة للاستهلاك الآدمي بشربين')).toBe(false);
    expect(detectBreaking('مقتل عامل وإصابة ابن عمه في مشاجرة بسبب أولوية المرور بالهرم')).toBe(false);
    // Not an incident at all.
    expect(detectBreaking('غرق سفينة شحن تحمل 3 آلاف طن من القمح في طريقها إلى مصر')).toBe(false);
    expect(detectBreaking('هل تتأثر مصر بعد غرق سفينة القمح في البحر الأسود؟')).toBe(false);
    expect(detectBreaking('قتلت زوجها بعد 3 أشهر من الزفاف.. ماذا حدث في جريمة كرداسة؟')).toBe(false);
    expect(detectBreaking('زلزال بقوة 5.9 درجة يهز جزيرة فلوريس في إندونيسيا - Masrawy')).toBe(false);
    expect(detectBreaking('حصيلة دامية في 3 أشهر.. آلاف الانتهاكات ومئات القتلى في اليمن')).toBe(false);
  });

  it('does not flag sport injuries, recipes or live blogs', () => {
    expect(detectBreaking('أتلتيكو مدريد يعلن تفاصيل إصابة لوكمان - المصري اليوم')).toBe(false);
    expect(detectBreaking('«طري وغرقان في التتبيلة».. طريقة تحضير الباذنجان المخلل')).toBe(false);
    expect(detectBreaking('مباشر مباراة ليبيا ضد تونس في تصفيات كأس أمم أفريقيا 2027.. لحظة بلحظة')).toBe(false);
    expect(detectBreaking('متابعة الأحداث لحظة بلحظة')).toBe(false);
    expect(detectBreaking('تغطية مباشرة للقمة العربية')).toBe(false);
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
