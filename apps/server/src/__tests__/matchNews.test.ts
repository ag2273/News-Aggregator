import { describe, it, expect } from 'vitest';
import { mentionsTeam, normalizeArabic, relatedNews, teamWords } from '../matchNews.js';

const article = (id: string, title: string, summary: string | null = null) => ({
  id,
  title,
  summary,
  sourceName: 'مصدر',
  url: `https://example.test/${id}`,
  publishedAt: 1000 - Number(id.replace(/\D/g, '') || 0),
});

describe('Arabic normalisation', () => {
  it('folds the variants that make the same word look different', () => {
    expect(normalizeArabic('الأهلي')).toBe('الاهلي');
    expect(normalizeArabic('الأهلى')).toBe('الاهلي');
    expect(normalizeArabic('الأهلية')).toBe('الاهليه');
    expect(normalizeArabic('مباراةٌ')).toBe('مباراه');
  });

  it('drops punctuation so a hyphenated name still matches', () => {
    expect(normalizeArabic('ر.سانتاندير')).toBe('ر سانتاندير');
  });
});

describe('team words', () => {
  it('keeps the distinctive words and drops the filler', () => {
    expect(teamWords('الأهلي')).toEqual(['الاهلي']);
    expect(teamWords('منتخب مصر')).toEqual(['مصر']);
    // «إف» and «سي» are two-letter filler in «باريس إف سي».
    expect(teamWords('باريس إف سي')).toEqual(['باريس']);
  });
});

describe('mentionsTeam', () => {
  it('matches the club in an ordinary headline', () => {
    expect(mentionsTeam('الأهلي يعلن حالة الطوارئ قبل مواجهة بيراميدز', 'الأهلي')).toBe(true);
  });

  it('does not match the National Bank of Egypt', () => {
    // Measured on production: a currency article linked to an Ahly match.
    expect(mentionsTeam('تحرك جديد في سعر الدولار اليوم بالبنك الأهلي', 'الأهلي')).toBe(false);
  });

  it('does not match a university with the same adjective', () => {
    // Substring matching made «الأهلية» contain «الأهلي».
    expect(mentionsTeam('جامعة أسيوط الأهلية تعقد الاجتماع الثاني للجنة الموارد', 'الأهلي')).toBe(false);
    expect(mentionsTeam('طلبة لغات عمّان الأهلية يشاركون بالترويج السياحي', 'الأهلي')).toBe(false);
  });

  it('still matches when the club follows the word «النادي»', () => {
    expect(mentionsTeam('النادي الأهلي يعلن التشكيل', 'الأهلي')).toBe(true);
  });

  it('matches a two-word club on its distinctive word', () => {
    expect(mentionsTeam('ريال مدريد يفوز على برشلونة', 'ريال مدريد')).toBe(true);
    expect(mentionsTeam('برشلونة يتعاقد مع مهاجم', 'ريال مدريد')).toBe(false);
  });

  it('finds the club only in the summary', () => {
    expect(mentionsTeam('عنوان عام بلا أسماء فريق محدد', 'الزمالك')).toBe(false);
    expect(mentionsTeam('عنوان عام الزمالك يستعد', 'الزمالك')).toBe(true);
  });
});

describe('relatedNews', () => {
  const corpus = [
    article('1', 'الأهلي يعلن حالة الطوارئ قبل مواجهة بيراميدز'),
    article('2', 'تحرك جديد في سعر الدولار اليوم بالبنك الأهلي'),
    article('3', 'جامعة أسيوط الأهلية تعقد الاجتماع الثاني'),
    article('4', 'الزمالك يحسم موقف مصطفى الزناري من التجديد'),
    article('5', 'مران خفيف لـ الزمالك في الجونة قبل مواجهة الفريقين'),
  ];

  it('returns only the real coverage, newest first', () => {
    const hits = relatedNews('الأهلي', 'بيراميدز', { articles: corpus });
    expect(hits.map((h) => h.id)).toEqual(['1']);
  });

  it('marks an article that names both clubs as both, not home', () => {
    // The old matcher reported "home" because it checked home first, so away
    // coverage read as home coverage. «مران خفيف لـ الزمالك في الجونة» names both.
    const hits = relatedNews('الزمالك', 'الجونة', { articles: corpus });
    expect(hits.find((h) => h.id === '5')!.team).toBe('both');
    // And a single-team headline is labelled with the side that actually appears.
    expect(hits.find((h) => h.id === '4')!.team).toBe('home');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => article(String(i + 1), `الأهلي خبر ${i}`));
    expect(relatedNews('الأهلي', 'بيراميدز', { articles: many, limit: 3 })).toHaveLength(3);
  });

  it('never matches a team with no words', () => {
    expect(relatedNews('', '', { articles: corpus })).toEqual([]);
  });
});

describe('institutional names are not clubs', () => {
  // Measured on production: a «وادي دجلة × الاتحاد السكندري» match returned ten
  // articles, every one about the European Union or a workers' union.
  const unionArticles = [
    'فشل مفاوضات كوب31 للمناخ بعد رفض الاتحاد الأوروبي ودول أخرى مسودة الاتفاق',
    '«رجال أعمال إسكندرية» و«الاتحاد الأوروبي» يبحثان تطوير سلاسل القيمة الزراعية',
    'الاتحاد المصري لتمويل المشروعات يستهدف زيادة تمويل القطاعات الصناعية',
    'رئيس الاتحاد العام للنقابات: يجب إجراء مراجعة شاملة لقانون المنظمات النقابية',
    '45 مليار يورو لأوكرانيا تشعل المواجهة داخل الاتحاد الأوروبي',
  ];

  it('never matches the European Union or a workers union', () => {
    for (const title of unionArticles) {
      expect(mentionsTeam(title, 'الاتحاد السكندري')).toBe(false);
    }
  });

  it('still matches the club when the distinctive word is there', () => {
    expect(mentionsTeam('الاتحاد السكندري يتعاقد مع مدرب جديد', 'الاتحاد السكندري')).toBe(true);
    expect(mentionsTeam('حسم الاتحاد السكندري صفقة المهاجم', 'الاتحاد السكندري')).toBe(true);
  });

  it('identifies a multi-word club by its distinctive word, not its generic one', () => {
    // «الاتحاد» alone is the union/EU; «السكندري» is the club.
    expect(teamWords('الاتحاد السكندري')).toContain('السكندري');
    expect(mentionsTeam('الاتحاد الأوروبي يقرر', 'الاتحاد السكندري')).toBe(false);
  });

  it('never matches the football federation for a bank club', () => {
    expect(mentionsTeam('محامي زيزو: سنطالب بـ82 مليون جنيه أمام اتحاد الكرة', 'الزمالك')).toBe(false);
  });

  it('returns nothing rather than wrong articles', () => {
    // An empty news tab is correct when nothing real is there.
    const hits = relatedNews('وادي دجلة', 'الاتحاد السكندري', {
      articles: unionArticles.map((t, i) => ({
        id: String(i), title: t, summary: null, sourceName: 's', url: 'u', publishedAt: i,
      })),
    });
    expect(hits).toEqual([]);
  });
});
