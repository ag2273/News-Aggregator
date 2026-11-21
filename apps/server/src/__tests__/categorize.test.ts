/**
 * T3 — category classifier tests.
 * Pure, offline: no network, no store.
 */

import { describe, it, expect } from 'vitest';
import { categorize, normalizeCategory, detectBreaking, casualtyToll, CATEGORIES } from '../categorize.js';

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

describe('categorize: tech vocabulary from the new tech sources', () => {
  it('files game and hardware reviews as tech', () => {
    // Real titles from عرب هاردوير / عرب جيمرز that used to land in `misc`.
    expect(categorize('مراجعة لعبة Grand Theft Auto 6 - Arabhardware')).toBe('tech');
    expect(categorize('لعبة Rise of the Ronin في التطوير منذ 7 سنوات - ArabGamerZ')).toBe('tech');
    expect(categorize('تقنية DLSS 4.5 تصل إلى EVE Vanguard وAssetto Corsa Rally')).toBe('tech');
    expect(categorize('عرض بلايستيشن الجديد يكشف موعد الإطلاق')).toBe('tech');
    expect(categorize('كرت شاشة جديد من إنفيديا بذاكرة أكبر')).toBe('tech');
  });

  it('does not steal sport or economy stories', () => {
    // The vocabulary must not reclassify the general papers' output.
    expect(categorize('الأهلي يفوز على الزمالك في مباراة القمة بالدوري')).toBe('sports');
    expect(categorize('البنك المركزي يرفع أسعار الفائدة 2%')).toBe('economy');
    expect(categorize('مقتل 5 في انفجار بوسط بغداد')).not.toBe('tech');
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

  // --- Rule G: the 2026-11-21 re-measurement (span 3.25 days, 5,805 rows) ---
  //
  // These are real production titles. The first block is the six incidents the
  // previous rule missed entirely; the second is the five label-tier false
  // positives it produced. Both lists are why G exists.

  it('G recovers the six war-wording incidents the old rule missed', () => {
    // The toll reads the number before the casualty word ("3 آخرين", "6 قتلى").
    expect(
      detectBreaking('مقتل عنصر أمن سوري وإصابة 3 آخرين في إطلاق نار بريف دمشق'),
    ).toBe(true);
    expect(
      detectBreaking('مقتل 7 مدنيين وإصابة 4 آخرين في هجمات أوكرانية على جمهورية لوغانسك خلال يوم'),
    ).toBe(true);
    expect(
      detectBreaking('مقتل عنصرين من الأمن السوري وإصابة 4 آخرين في إطلاق نار بريف دمشق'),
    ).toBe(true);
    expect(detectBreaking('خلاف عائلي ينتهي بمأساة.. مقتل 8 أشخاص في حادث إطلاق نار بدير الزور')).toBe(true);
    // The verb form, with no casualty noun at all.
    expect(detectBreaking('مجزرة جديدة في نيالا.. غارات الجيش السوداني تقتل 37 مدنيا')).toBe(true);
    expect(detectBreaking('6 قتلى في غزة.. غارات إسرائيلية تطال البريج ومخيمي نازحين')).toBe(true);
  });

  it('G no longer flags the five label-tier false positives', () => {
    expect(
      detectBreaking(
        'عاجل | مراسل الجزيرة: مفوض الحكومة لدى المحكمة العسكرية في لبنان يوجه لـ5 عناصر من حزب الله تهمة تأليف مجموعة مسلحة',
      ),
    ).toBe(false);
    expect(
      detectBreaking(
        'عاجل| محكمة العدل الدولية: ندين قوات أمن ميانمار بتهمة قتل آلاف من مسلمي الروهينغا',
      ),
    ).toBe(false);
    expect(
      detectBreaking(
        'عاجل | كتائب حزب الله بالعراق: الإشكالات مع رئيس الحكومة ستعالج عبر قنوات خاصة لتفويت الفرصة على الأعداء',
      ),
    ).toBe(false);
    expect(
      detectBreaking(
        'عاجل | وول ستريت جورنال عن مصادر: ترمب أخبر كوشنر أثناء عودته من الصين بأن بوتين سئم الحرب ومستعد للتوصل إلى تسوية',
      ),
    ).toBe(false);
    // Known residual: an anonymous-sourced internal outage still reads as an
    // alert. Kept visible rather than papered over with a headline-specific marker.
    expect(
      detectBreaking(
        'عاجل | سي إن إن عن مصادر: تعطل شبكة بالغة السرية تستخدمها وكالة الأمن القومي الأمريكية في اتصالاتها الداخلية',
      ),
    ).toBe(true);
  });

  it('G keeps its tolerance of attribution wording, which is not a non-event signal', () => {
    // Excluding "عن مسؤولين"/"عن مصادر" once cost this real flag.
    expect(
      detectBreaking(
        'عاجل | وول ستريت جورنال عن مسؤولين: واشنطن أرسلت منظومة باتريوت إضافية إلى إسرائيل لتعزيز دفاعاتها الصاروخية',
      ),
    ).toBe(true);
  });

  it('reads the toll on either side of the casualty word', () => {
    expect(casualtyToll('مقتل 19 مدنيا في قصف')).toBe(19);
    expect(casualtyToll('6 قتلى في غزة')).toBe(6);
    expect(casualtyToll('إصابة 11 شخصا في هجوم')).toBe(11);
    expect(casualtyToll('إصابة العشرات جراء تصادم قطارين')).toBe(30);
    // Cargo weight is still not a toll.
    expect(casualtyToll('غرق سفينة تحمل 3 آلاف طن من القمح')).toBe(0);
  });

  it('still refuses the routine incidents that G must not sweep in', () => {
    expect(detectBreaking('إصابة 3 أشخاص فى حريق شقة سكنية بالسيوف شرق الإسكندرية')).toBe(false);
    expect(detectBreaking('إصابة 5 أشخاص في حريق داخل شقة سكنية فى الحوامدية - اليوم السابع')).toBe(false);
    expect(detectBreaking('أسفر عن مقتل 305 مواطنين.. دعاء صلاة الجمعة في شمال سيناء يحيي ذكرى هجوم مسجد الروضة')).toBe(false);
    expect(detectBreaking('حصيلة جديدة لضحايا غارات سعودية')).toBe(false);
    expect(detectBreaking('انفجار أسطوانة بوتاجاز داخل مخبز بالشرقية وإصابة شاب')).toBe(false);
  });
});
