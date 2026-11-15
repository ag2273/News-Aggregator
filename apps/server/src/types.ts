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
}

export interface Source {
  id: string;
  name: string;
  nameAr: string;
  url: string;
  rssUrl: string;
  country: string;
  type: 'direct' | 'google-news';
}

export const SOURCES: Source[] = [
  // --- Direct RSS ---
  {
    id: 'youm7',
    name: 'Youm7',
    nameAr: 'اليوم السابع',
    url: 'https://www.youm7.com',
    rssUrl: 'https://www.youm7.com/rss/SectionRss?SectionID=1',
    country: 'EG',
    type: 'direct',
  },
  {
    id: 'aljazeera',
    name: 'Al Jazeera Arabic',
    nameAr: 'الجزيرة',
    url: 'https://www.aljazeera.net',
    rssUrl: 'https://www.aljazeera.net/aljazeerarss',
    country: 'QA',
    type: 'direct',
  },
  {
    id: 'bbc-arabic',
    name: 'BBC Arabic',
    nameAr: 'بي بي سي عربي',
    url: 'https://www.bbc.com/arabic',
    rssUrl: 'https://feeds.bbci.co.uk/arabic/rss.xml',
    country: 'GB',
    type: 'direct',
  },
  {
    id: 'cnn-arabic',
    name: 'CNN Arabic',
    nameAr: 'سي إن إن عربي',
    url: 'https://arabic.cnn.com',
    rssUrl: 'https://arabic.cnn.com/rss',
    country: 'AE',
    type: 'direct',
  },
  {
    id: 'skynews-arabia',
    name: 'Sky News Arabia',
    nameAr: 'سكاي نيوز عربية',
    url: 'https://www.skynewsarabia.com',
    rssUrl: 'https://www.skynewsarabia.com/rss',
    country: 'AE',
    type: 'direct',
  },
  {
    id: 'rt-arabic',
    name: 'RT Arabic',
    nameAr: 'آر تي عربي',
    url: 'https://arabic.rt.com',
    rssUrl: 'https://www.rtarabic.com/rss',
    country: 'RU',
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
    type: 'google-news',
  },
];
