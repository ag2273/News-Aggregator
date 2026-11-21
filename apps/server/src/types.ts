export interface Article {
  id: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string;
  sourceId: string;
  sourceName: string;
  category: string;
  country: string;
  publishedAt: number; // unix ms
  isBreaking: boolean;
  /** Reaction tally; always present on API responses, absent on stored rows. */
  reactions?: {
    like: number;
    love: number;
    wow: number;
    sad: number;
    angry: number;
    total: number;
  };
  /** The caller's own reaction, or null for guests and when they have not reacted. */
  myReaction?: 'like' | 'love' | 'wow' | 'sad' | 'angry' | null;
}

export interface Source {
  id: string;
  name: string;
  nameAr: string;
  url: string;
  rssUrl: string;
  country: string;
  type: 'direct' | 'google-news';
  /**
   * How often this outlet is polled. Chosen from its measured volume so a
   * 100-a-day paper is not on the same cycle as a 15-a-day one: the refresh
   * ticker is 10 minutes, and a source with a longer interval is skipped until
   * its own timer is due.
   */
  intervalMinutes: number;
  /**
   * Whether titles from this outlet may be flagged as breaking.
   *
   * New sources start false: rule G was tuned and measured on the original ten,
   * and an unmeasured outlet must not be able to fire a push. A source is
   * enabled only after it is hand-labelled against the same 85% gate.
   */
  breaking: boolean;
}

export const SOURCES: Source[] = [
  // --- Direct RSS ---
  {
    id: 'youm7',
    name: 'Youm7',
    nameAr: 'اليوم السابع',
    url: 'https://www.youm7.com',
    // The direct SectionRss feed still answers 200 but ships an EMPTY channel
    // (538 bytes, no <item>), so it contributed nothing for months while looking
    // healthy. Google News RSS for the site works, so use that instead.
    rssUrl:
      'https://news.google.com/rss/search?q=site:youm7.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: true,
    type: 'google-news',
  },
  {
    id: 'aljazeera',
    name: 'Al Jazeera Arabic',
    nameAr: 'الجزيرة',
    url: 'https://www.aljazeera.net',
    rssUrl: 'https://www.aljazeera.net/aljazeerarss',
    country: 'QA',
    intervalMinutes: 10,
    breaking: true,
    type: 'direct',
  },
  {
    id: 'bbc-arabic',
    name: 'BBC Arabic',
    nameAr: 'بي بي سي عربي',
    url: 'https://www.bbc.com/arabic',
    rssUrl: 'https://feeds.bbci.co.uk/arabic/rss.xml',
    country: 'GB',
    intervalMinutes: 30,
    breaking: true,
    type: 'direct',
  },
  {
    id: 'cnn-arabic',
    name: 'CNN Arabic',
    nameAr: 'سي إن إن عربي',
    url: 'https://arabic.cnn.com',
    rssUrl: 'https://arabic.cnn.com/rss',
    country: 'AE',
    intervalMinutes: 30,
    breaking: true,
    type: 'direct',
  },
  {
    id: 'skynews-arabia',
    name: 'Sky News Arabia',
    nameAr: 'سكاي نيوز عربية',
    url: 'https://www.skynewsarabia.com',
    rssUrl: 'https://www.skynewsarabia.com/rss',
    country: 'AE',
    intervalMinutes: 30,
    breaking: true,
    type: 'direct',
  },
  {
    id: 'rt-arabic',
    name: 'RT Arabic',
    nameAr: 'آر تي عربي',
    url: 'https://arabic.rt.com',
    rssUrl: 'https://www.rtarabic.com/rss',
    country: 'RU',
    intervalMinutes: 30,
    breaking: true,
    type: 'direct',
  },
  // --- Google News RSS (site: filter) ---
  {
    id: 'alarabiya',
    name: 'Al Arabiya',
    nameAr: 'العربية',
    url: 'https://www.alarabiya.net',
    rssUrl:
      'https://news.google.com/rss/search?q=site:alarabiya.net+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'AE',
    intervalMinutes: 10,
    breaking: true,
    type: 'google-news',
  },
  {
    id: 'ahram',
    name: 'Al-Ahram',
    nameAr: 'الأهرام',
    url: 'https://www.ahram.org.eg',
    rssUrl:
      'https://news.google.com/rss/search?q=site:ahram.org.eg+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 30,
    breaking: true,
    type: 'google-news',
  },
  {
    id: 'almasry',
    name: 'Al-Masry Al-Youm',
    nameAr: 'المصري اليوم',
    url: 'https://www.almasryalyoum.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:almasryalyoum.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: true,
    type: 'google-news',
  },
  {
    id: 'masrawy',
    name: 'Masrawy',
    nameAr: 'مصراوي',
    url: 'https://www.masrawy.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:masrawy.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 30,
    breaking: true,
    type: 'google-news',
  },

  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'asharqalawsat',
    name: 'Asharq Al-Awsat',
    nameAr: 'الشرق الأوسط',
    url: 'https://aawsat.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:aawsat.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'alkhaleej',
    name: 'Al Khaleej',
    nameAr: 'الخليج',
    url: 'https://www.alkhaleej.ae',
    rssUrl:
      'https://news.google.com/rss/search?q=site:alkhaleej.ae+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'AE',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'alnahar',
    name: 'Al Nahar',
    nameAr: 'النهار',
    url: 'https://www.alnaharegypt.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:alnaharegypt.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'okaz',
    name: 'Okaz',
    nameAr: 'عكاظ',
    url: 'https://www.okaz.com.sa',
    rssUrl:
      'https://news.google.com/rss/search?q=site:okaz.com.sa+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'alshorouk',
    name: 'Al Shorouk',
    nameAr: 'الشروق',
    url: 'https://www.shorouknews.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:shorouknews.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'aldostor',
    name: 'Al Dostor',
    nameAr: 'الدستور',
    url: 'https://www.dostor.org',
    rssUrl:
      'https://news.google.com/rss/search?q=site:dostor.org+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 1. Polled at its own measured interval, and
  // breaking starts DISABLED: rule G is only measured on the original ten, so an
  // unmeasured outlet must not be able to fire a push.
  {
    id: 'elwatannews',
    name: 'El Watan News',
    nameAr: 'الوطن نيوز',
    url: 'https://www.elwatannews.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:elwatannews.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },


  // --- Added 2026-11-21, batch 1 of round 2: the TECH sources. The user's
  // complaint was that every source was a general paper, so تكنولوجيا only
  // filled when one of them happened to run a tech story.
  // Measured: these five contribute 39 Arabic tech articles/day, and every
  // sampled article gave full text (3/3 each).
  {
    id: 'tech-wd',
    name: 'Tech Without Borders',
    nameAr: 'التقنية بلا حدود',
    url: 'https://tech-wd.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:tech-wd.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  {
    id: 'hashtagarabi',
    name: 'Hashtag Arabi',
    nameAr: 'هاشتاق عربي',
    url: 'https://hashtagarabi.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:hashtagarabi.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  {
    id: 'arabhardware',
    name: 'Arab Hardware',
    nameAr: 'عرب هاردوير',
    url: 'https://arabhardware.net',
    rssUrl:
      'https://news.google.com/rss/search?q=site:arabhardware.net+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  {
    id: 'arabgamerz',
    name: 'Arab Gamerz',
    nameAr: 'عرب جيمرز',
    url: 'https://arabgamerz.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:arabgamerz.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 60,
    breaking: false,
    type: 'google-news',
  },
  {
    id: 'aitnews',
    name: 'AIT News',
    nameAr: 'البوابة العربية للأخبار التقنية',
    url: 'https://aitnews.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:aitnews.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'AE',
    intervalMinutes: 60,
    breaking: false,
    type: 'google-news',
  },

  // --- Added 2026-11-22, round-2 batch 2: the big papers from Nabd's directory.
  // Measured 99/day, newest within 2h. Interval follows the volume.
  {
    id: 'alghad',
    name: 'Al Ghad',
    nameAr: 'الغد',
    url: 'https://alghad.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:alghad.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'JO',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // Measured 89/day, newest within 2h. Interval follows the volume.
  {
    id: 'elbalad',
    name: 'Sada El Balad',
    nameAr: 'صدى البلد',
    url: 'https://www.elbalad.news',
    rssUrl:
      'https://news.google.com/rss/search?q=site:elbalad.news+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // Measured 33/day, newest within 2h. Interval follows the volume.
  {
    id: 'al-madina',
    name: 'Al Madina',
    nameAr: 'المدينة',
    url: 'https://www.al-madina.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:al-madina.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
  // Measured 17/day, newest within 2h. Interval follows the volume.
  {
    id: 'aleqt',
    name: 'Al Eqtisadiah',
    nameAr: 'الاقتصادية',
    url: 'https://www.aleqt.com',
    rssUrl:
      'https://news.google.com/rss/search?q=site:aleqt.com+when:2d&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
];
