import { describe, it, expect } from 'vitest';
import { cleanTitle, mentionsTeam, normalizeArabic, relatedNews, stripPublisher, teamWords } from '../matchNews.js';

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

  it('does not match a place that shares a word with the club name', () => {
    // «وادي دجلة» against «وادي السيليكون» and «وادي السير»: a place is not a club.
    expect(mentionsTeam('أشتون كوتشر.. من هوليوود إلى استثمارات وادي السيليكون', 'وادي دجلة')).toBe(false);
    expect(mentionsTeam('تعادل وادي السير والكتة بدوري اليد', 'وادي دجلة')).toBe(false);
    expect(mentionsTeam('وادي دجلة يضم مهاجما جديدا', 'وادي دجلة')).toBe(true);
  });
});

describe('article titles', () => {
  it('drops a trailing URL so a card never reads as junk', () => {
    // Measured: a match-news card was titled «الجمارك تحذر ... - www.dostor.org».
    expect(cleanTitle('الجمارك تحذر من الصفحات - www.dostor.org')).toBe('الجمارك تحذر من الصفحات');
    expect(stripPublisher('خبر - المصري اليوم', 'المصري اليوم')).toBe('خبر');
  });

  it('keeps a dash that is part of the sentence', () => {
    // A score or a real dash inside the title must not be mistaken for the tail.
    expect(stripPublisher('مباراة تنتهي 2-1 - فيوتشر', 'المصري اليوم')).toBe('مباراة تنتهي 2-1 - فيوتشر');
    expect(stripPublisher('عنوان فيه شرطة - داخل الجملة - نهاية', 'الغد')).toBe('عنوان فيه شرطة - داخل الجملة - نهاية');
  });
});

describe('clubs whose name is an institution', () => {
  it('does not fill a customs club with the customs authority', () => {
    // Measured on «الجمارك × شباب بلوزداد»: all eight articles were about Egypt's
    // customs service. The name has no distinctive word, so it is matched only
    // when the text also says نادي/فريق/مباراة.
    expect(mentionsTeam('الجمارك تحذر المواطنين من النصب باسم تقنين السيارات', 'الجمارك')).toBe(false);
    expect(mentionsTeam('رئيس مصلحة الجمارك يستعرض جهود تيسير الإجراءات', 'الجمارك')).toBe(false);
    expect(mentionsTeam('نادي الجمارك يتعاقد مع مدرب جديد', 'الجمارك')).toBe(true);
    expect(mentionsTeam('فريق الجمارك يفوز في الدوري الموريتاني', 'الجمارك')).toBe(true);
  });

  it('never mixes two clubs that share their first word', () => {
    // Issue #23, from a device: an Italian match showed six MLS articles, because
    // «إنتر ميلان» and «إنتر ميامي» share «إنتر».
    const mls = 'إنتر ميامي يضم لاعبا جديدا قبل انطلاق الدوري الأمريكي';
    const seria = 'إنتر ميلان يفوز على يوفنتوس في الدوري الإيطالي';
    expect(mentionsTeam(mls, 'إنتر ميلان', undefined, 'IT')).toBe(false);
    expect(mentionsTeam(seria, 'إنتر ميامي', undefined, 'US')).toBe(false);
    expect(mentionsTeam(seria, 'إنتر ميلان', undefined, 'IT')).toBe(true);
    expect(mentionsTeam(mls, 'إنتر ميامي', undefined, 'US')).toBe(true);
  });

  it('keeps Real Madrid out of Real Sociedad coverage', () => {
    expect(mentionsTeam('ريال سوسيداد يفوز على خيتافي', 'ريال مدريد', undefined, 'ES')).toBe(false);
    expect(mentionsTeam('ريال مدريد يفوز على برشلونة', 'ريال مدريد', undefined, 'ES')).toBe(true);
  });

  it('returns zero MLS articles for an Italian match, end to end', () => {
    const corpus = [
      { id: 'a', title: 'إنتر ميامي يتعاقد مع مدرب جديد', sourceName: 's', url: 'u', publishedAt: 2, summary: null },
      { id: 'b', title: 'إنتر ميلان يستعد للديربي أمام ميلان', sourceName: 's', url: 'u', publishedAt: 1, summary: null },
    ];
    const hits = relatedNews('أتالانتا', 'إنتر ميلان', { articles: corpus, country: 'IT' });
    expect(hits.map((h) => h.id)).toEqual(['b']);
  });

  it('handles the single-word name the API actually serves', () => {
    // Production calls Inter «إنتر» — one word — and that alone pulled seven MLS
    // articles. A single shared word can never be a full name.
    expect(mentionsTeam('خسارة قاسية لإنتر ميامي وميسي ينجو من الطرد', 'إنتر', undefined, 'IT')).toBe(false);
    expect(mentionsTeam('إنتر يفوز على يوفنتوس في الكالتشيو', 'إنتر', undefined, 'IT')).toBe(true);
    // The multi-word form accepts the short name only with country context in the
    // text — «إنتر» alone is not enough to tell it from Inter Miami.
    expect(mentionsTeam('إنتر يفوز على يوفنتوس في الكالتشيو', 'إنتر ميلان', undefined, 'IT')).toBe(true);
    expect(mentionsTeam('إنتر يفوز على يوفنتوس', 'إنتر ميلان', undefined, 'IT')).toBe(false);
  });

  it('rejects an MLS article whose summary is where «إنتر» appears', () => {
    // The real leak: the title was about Messi, the summary said «إنتر ميامي» and
    // «الدوري الأمريكي». Both signals point at the other club and the other country.
    const hits = relatedNews('أتالانتا', 'إنتر', {
      country: 'IT',
      articles: [
        {
          id: '1',
          title: 'شاهد.. ميسي يقوم بتصرف خبيث غير رياضي',
          summary: 'نشرت رابطة الدوري الأمريكي مقطعا لميسي مع إنتر ميامي',
          sourceName: 's',
          url: 'u',
          publishedAt: 1,
        },
      ],
    });
    expect(hits).toEqual([]);
  });

  it('rejects an article that names a different country than the match', () => {
    // «الدوري الأمريكي» in the text is a different country from the Italian match.
    expect(mentionsTeam('الدوري الأمريكي يعلن أفضل لاعب', 'إنتر', undefined, 'IT')).toBe(false);
  });

  it('does not treat a company that starts with the club name as the club', () => {
    // «إنتر ستيت جاز سيستمز» is a Pakistani energy company; it put an
    // investment article on an Italian football match.
    expect(
      mentionsTeam(
        'أعلنت شركتا دلتا السعودية للطاقة وإنتر ستيت جاز سيستمز الباكستانية توقيع اتفاقية',
        'إنتر',
        undefined,
        'IT',
      ),
    ).toBe(false);
  });
});
