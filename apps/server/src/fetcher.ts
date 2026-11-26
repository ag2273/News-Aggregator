import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import type { Article, Source } from './types.js';
import { categorize, detectBreaking } from './categorize.js';
import { decodeHtmlEntities } from './text.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  cdataPropName: '__cdata',
  parseTagValue: false,
  trimValues: true,
});

function hashUrl(url: string): string {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

/** The url of a media element, or of the first of several (the parser gives an array). */
function mediaUrl(node: unknown, imageOnly = false): string | null {
  const list = Array.isArray(node) ? node : node ? [node] : [];
  for (const n of list) {
    if (!n || typeof n !== 'object') continue;
    const o = n as Record<string, unknown>;
    const url = o['@_url'];
    if (!url) continue;
    const type = String(o['@_type'] ?? '');
    const medium = String(o['@_medium'] ?? '');
    // A video or audio enclosure is not a card picture.
    if (imageOnly && !type.startsWith('image')) continue;
    if (!imageOnly && (/^(video|audio)/.test(type) || /^(video|audio)$/.test(medium))) continue;
    return String(url);
  }
  return null;
}

export function extractImage(item: Record<string, unknown>): string | null {
  // Try <media:content>, <media:thumbnail>, <media:group>, <enclosure>, <image>.
  // Each can repeat: measured, a feed with two <media:content> sizes was parsed as an
  // ARRAY, and reading `['@_url']` off the array found nothing, so the card had no
  // picture although the feed carried two (#57 follow-up).
  const direct =
    mediaUrl(item['media:content']) ??
    mediaUrl(item['media:thumbnail']) ??
    mediaUrl((item['media:group'] as Record<string, unknown> | undefined)?.['media:content']) ??
    mediaUrl((item['media:group'] as Record<string, unknown> | undefined)?.['media:thumbnail']) ??
    mediaUrl(item['enclosure'], true);
  if (direct) return direct;

  // Some feeds have <image><url>
  const img = item['image'] as Record<string, unknown> | undefined;
  if (typeof img === 'object' && img?.['url']) return String(img['url']);

  // The first <img> in the description or the full content. Not only .jpg/.png:
  // image CDNs often serve a photo from a URL with no extension at all.
  for (const field of ['content:encoded', 'description']) {
    const html = extractText(item[field]);
    const m = html.match(/<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["']/i);
    if (m && !/(logo|icon|pixel|1x1|spacer|feeds\.feedburner)/i.test(m[1]!)) return m[1]!.replace(/&amp;/g, '&');
  }

  return null;
}

function extractText(val: unknown): string {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (o['__cdata']) return String(o['__cdata']);
    if (o['#text']) return String(o['#text']);
  }
  return String(val);
}

function parseDate(val: unknown): number {
  if (!val) return Date.now();
  const s = typeof val === 'string' ? val : String(val);
  const d = new Date(s);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

/**
 * Titles that are a section front, not a story.
 *
 * Measured on the tech feeds: `مقالات - ArabGamerZ`, `ألعاب - Arabhardware`,
 * `الرئيسية - هاشتاق عربي` and `فريق عرب جيمرز` all resolve to the outlet's
 * homepage or a category page. Google News indexes those fronts as if they were
 * articles, so 29 of 150 tech rows were navigation, and they were landing in the
 * digest as "news".
 *
 * Two rules, both narrow: the FIRST word before the outlet suffix is a
 * navigation word, or the whole title is just the outlet name.
 */
/**
 * A real 404 served with HTTP 200.
 *
 * Measured: `gate.ahram.org.eg/News/5671902` answers 200 with
 * `<title>الصفحة غير موجودة</title>` and the RSS title is the error text, so the
 * item looked like an ordinary article and was ingested five times. Narrow on
 * purpose: a headline that merely says "صفحة جديدة في العلاقات…" is untouched.
 */
const ERROR_PAGE_TITLE = /عفوا الصفحة|الصفحة غير موجودة|الصفحة التي تحاول|page not found|\b404\b/i;

/**
 * Channel fronts that survived the navigation-word rule: an outlet's own section
 * landing page, matched WITHOUT its " - Outlet" suffix.
 *
 * Each was verified by resolving its Google News link: they land on
 * masrawy.com/, youm7.com/, arabhardware.net/companies/sony,
 * style.ahram.org.eg/UI/Front/Search.aspx…, aitnews.com/latest-it-news/page/N.
 * Deliberately an explicit list, not a pattern: "الكشف عن هاتف iPhone 17 |
 * المواصفات كاملة" has the same shape and is a real story.
 */
const KNOWN_FRONTS: readonly string[] = [
  'أهرام ستايل | بوابة المرأة المصرية',
  'الأخبار التقنية - البوابة التقنية',
  'Masrawy Home Page | مصراوي',
  'اليوم السابع | Youm7',
  'البوابة التقنية | مصدرك الأول للأخبار التقنية',
  'CNBC العربية Breaking News | أخبار عاجلة',
  'ازياء - أخبار السعودية | صحيفة عكاظ',
  'العدد اليومي لصحيفة عكاظ | تصفح وتحميل النسخة الكاملة PDF',
  'شركة سوني | Sony',
  'العربية | أبرز الأخبار العالمية والمحلية العاجلة',
];

const SECTION_WORDS: readonly string[] = [
  'الرئيسية', 'الصفحة الرئيسية', 'مقالات', 'ألعاب', 'أخبار', 'فريق',
  'من نحن', 'اتصل بنا', 'تواصل معنا', 'سياسة الخصوصية', 'بيان الخصوصية',
  'شروط الاستخدام', 'الأقسام', 'انمي', 'أنمي', 'نصائح', 'newsletter',
  'archives', 'ارشيف', 'أرشيف', 'اتصل', 'اعلن معنا', 'أعلن معنا',
] as const;

/** The title without Google News' trailing " - Outlet" suffix. */
export function titleWithoutOutlet(title: string): string {
  const i = title.lastIndexOf(' - ');
  return (i > 20 ? title.slice(0, i) : title).trim();
}

export function isSectionPageTitle(title: string): boolean {
  const trimmed = title.trim();
  // An error page is never a story, whatever its shape.
  if (ERROR_PAGE_TITLE.test(trimmed)) return true;
  // A verified channel front.
  if (KNOWN_FRONTS.includes(titleWithoutOutlet(trimmed))) return true;
  // "الرئيسية - هاشتاق عربي - هاشتاق عربي": the suffix is appended by Google
  // News, so look at the first segment only.
  const head = trimmed.split(/\s+[-–|]\s+/)[0]?.trim() ?? trimmed;
  if (SECTION_WORDS.includes(head)) return true;
  // "فريق عرب جيمرز" is the outlet's own team page: a navigation word followed by
  // the outlet name and nothing else. Deliberately NOT applied to a headline like
  // "الرئيسية: الحكومة تعلن…", where the word is followed by a real sentence.
  const firstToken = head.split(/\s+/)[0] ?? head;
  const rest = head.slice(firstToken.length).trim();
  if (SECTION_WORDS.includes(firstToken) && rest.length > 0 && rest.split(/\s+/).length <= 3) {
    return true;
  }
  // A title with no room for a headline beyond the outlet name is a front.
  return head.length === 0;
}

export async function fetchSource(source: Source): Promise<Article[]> {
  const articles: Article[] = [];

  let raw: string;
  try {
    const res = await fetch(source.rssUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; NewsAggregatorBot/1.0; +https://github.com/ag2273/News-Aggregator)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      console.warn(`[${source.id}] HTTP ${res.status}`);
      return [];
    }
    raw = await res.text();
  } catch (e) {
    console.warn(`[${source.id}] fetch error:`, (e as Error).message);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = parser.parse(raw);
  } catch (e) {
    console.warn(`[${source.id}] XML parse error:`, (e as Error).message);
    return [];
  }

  const p = parsed as Record<string, unknown>;
  const rss = (p['rss'] ?? p['feed']) as Record<string, unknown> | undefined;
  if (!rss) {
    console.warn(`[${source.id}] no rss/feed root`);
    return [];
  }

  const channel = (rss['channel'] ?? rss) as Record<string, unknown>;
  const rawItems = channel['item'] ?? channel['entry'];
  const items: Array<Record<string, unknown>> = Array.isArray(rawItems)
    ? rawItems
    : rawItems
    ? [rawItems as Record<string, unknown>]
    : [];

  for (const item of items.slice(0, 50)) {
    const url = extractText(item['link'] ?? item['guid']);
    if (!url || !url.startsWith('http')) continue;

    const title = extractText(item['title']);
    if (!title) continue;

    const cleanTitle = decodeHtmlEntities(title);
    if (!cleanTitle) continue;
    // A section front is not a story: it resolves to the outlet's own homepage or
    // category page, and it was reaching the digest as "news".
    if (isSectionPageTitle(cleanTitle)) continue;

    const rawSummary = extractText(item['description'] ?? item['summary'] ?? '').replace(
      /<[^>]+>/g,
      '',
    ); // strip HTML tags
    const summary = decodeHtmlEntities(rawSummary).slice(0, 500) || null;

    articles.push({
      id: hashUrl(url),
      title: cleanTitle,
      summary,
      imageUrl: extractImage(item),
      url,
      sourceId: source.id,
      sourceName: source.nameAr,
      category: categorize(cleanTitle, summary),
      country: source.country,
      publishedAt: parseDate(item['pubDate'] ?? item['published'] ?? item['updated']),
      isBreaking: detectBreaking(cleanTitle),
    });
  }

  return articles;
}
