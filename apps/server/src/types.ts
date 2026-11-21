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
      'https://news.google.com/rss/search?q=site:youm7.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:alarabiya.net&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:ahram.org.eg&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:almasryalyoum.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:masrawy.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:aawsat.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:alkhaleej.ae&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:alnaharegypt.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:okaz.com.sa&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:shorouknews.com&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:dostor.org&hl=ar&gl=EG&ceid=EG:ar',
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
      'https://news.google.com/rss/search?q=site:elwatannews.com&hl=ar&gl=EG&ceid=EG:ar',
    country: 'EG',
    intervalMinutes: 10,
    breaking: false,
    type: 'google-news',
  },
  // --- Added 2026-11-21, batch 2. The only one of the seven that is both
  // reachable and really news: see the batch-2 report for the six that are not
  // (five reset connections from the server, and الوقت is 36/36 price and
  // prayer-time filler rather than reporting).
  {
    id: 'alwatan-sa',
    name: 'Al Watan (Saudi)',
    nameAr: 'الوطن',
    url: 'https://www.alwatan.com.sa',
    rssUrl:
      'https://news.google.com/rss/search?q=site:alwatan.com.sa&hl=ar&gl=EG&ceid=EG:ar',
    country: 'SA',
    intervalMinutes: 30,
    breaking: false,
    type: 'google-news',
  },
];
