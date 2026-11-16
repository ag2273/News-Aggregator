import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import type { Article, Source } from './types.js';
import { categorize } from './categorize.js';
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

function extractImage(item: Record<string, unknown>): string | null {
  // Try <media:content>, <media:thumbnail>, <enclosure>, og-style <image>
  const media = item['media:content'] as Record<string, unknown> | undefined;
  if (media?.['@_url']) return String(media['@_url']);

  const thumb = item['media:thumbnail'] as Record<string, unknown> | undefined;
  if (thumb?.['@_url']) return String(thumb['@_url']);

  const enclosure = item['enclosure'] as Record<string, unknown> | undefined;
  if (enclosure?.['@_url'] && String(enclosure['@_type'] ?? '').startsWith('image'))
    return String(enclosure['@_url']);

  // Some feeds have <image><url>
  const img = item['image'] as Record<string, unknown> | undefined;
  if (typeof img === 'object' && img?.['url']) return String(img['url']);

  // Try to pick first img src from description HTML
  const desc = extractText(item['description']);
  if (desc) {
    const m = desc.match(/src=["']([^"']+\.(jpg|jpeg|png|webp))/i);
    if (m) return m[1];
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
      isBreaking: false,
    });
  }

  return articles;
}
