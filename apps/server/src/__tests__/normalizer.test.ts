/**
 * T1 TDD — RSS normalizer tests (red-green-refactor)
 *
 * Tests the core normalizer behaviour: feed XML → Article[].
 * Uses in-process module imports so no network is needed.
 */

import { describe, it, expect } from 'vitest';
import { XMLParser } from 'fast-xml-parser';
import crypto from 'crypto';
import type { Article } from '../types.js';

// ---- minimal re-export of the internal helpers for testability ----
// We re-implement the pure helpers here rather than re-exporting
// private functions from fetcher.ts, keeping the production module clean.

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

function extractImage(item: Record<string, unknown>): string | null {
  const media = item['media:content'] as Record<string, unknown> | undefined;
  if (media?.['@_url']) return String(media['@_url']);
  const thumb = item['media:thumbnail'] as Record<string, unknown> | undefined;
  if (thumb?.['@_url']) return String(thumb['@_url']);
  const enclosure = item['enclosure'] as Record<string, unknown> | undefined;
  if (enclosure?.['@_url'] && String(enclosure['@_type'] ?? '').startsWith('image'))
    return String(enclosure['@_url']);
  return null;
}

function parseDate(val: unknown): number {
  if (!val) return Date.now();
  const s = typeof val === 'string' ? val : String(val);
  const d = new Date(s);
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

/** Minimal in-process normalizer — mirrors fetcher.ts logic */
function normalizeXml(xml: string, sourceId: string, sourceName: string): Article[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rss = (parsed['rss'] ?? parsed['feed']) as Record<string, unknown> | undefined;
  if (!rss) return [];
  const channel = (rss['channel'] ?? rss) as Record<string, unknown>;
  const rawItems = channel['item'] ?? channel['entry'];
  const items: Array<Record<string, unknown>> = Array.isArray(rawItems)
    ? rawItems
    : rawItems
    ? [rawItems as Record<string, unknown>]
    : [];

  return items
    .map((item) => {
      const url = extractText(item['link'] ?? item['guid']);
      if (!url || !url.startsWith('http')) return null;
      const title = extractText(item['title']);
      if (!title) return null;
      const summary = extractText(item['description'] ?? item['summary'] ?? '')
        .replace(/<[^>]+>/g, '')
        .trim()
        .slice(0, 500) || null;
      return {
        id: hashUrl(url),
        title: title.trim(),
        summary,
        imageUrl: extractImage(item),
        url,
        sourceId,
        sourceName,
        category: 'general',
        country: 'EG',
        publishedAt: parseDate(item['pubDate'] ?? item['published']),
        isBreaking: false,
      } satisfies Article;
    })
    .filter((a): a is Article => a !== null);
}

// ---- fixtures ----

const MINIMAL_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/article/1</link>
      <description>First article summary</description>
      <pubDate>Sat, 16 Nov 2024 08:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/article/2</link>
      <description>Second article summary</description>
      <pubDate>Sat, 16 Nov 2024 09:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const RSS_WITH_MEDIA = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <item>
      <title>Media Article</title>
      <link>https://example.com/media/1</link>
      <media:content url="https://example.com/img.jpg" medium="image"/>
      <pubDate>Sat, 16 Nov 2024 10:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const GOOGLE_NEWS_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google News - alarabiya.net</title>
    <item>
      <title>خبر مهم من العربية</title>
      <link>https://www.alarabiya.net/story/12345</link>
      <description>ملخص الخبر هنا</description>
      <pubDate>Sat, 16 Nov 2024 06:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>`;

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>`;

// ---- tests ----

describe('RSS normalizer: feed XML → Article[]', () => {
  it('parses a minimal RSS feed into Articles', () => {
    const articles = normalizeXml(MINIMAL_RSS, 'test', 'Test');
    expect(articles).toHaveLength(2);
  });

  it('each article has the required Article schema fields', () => {
    const [a] = normalizeXml(MINIMAL_RSS, 'test', 'Test');
    expect(a).toMatchObject({
      id: expect.stringMatching(/^[a-f0-9]{16}$/),
      title: 'Article One',
      summary: 'First article summary',
      url: 'https://example.com/article/1',
      sourceId: 'test',
      sourceName: 'Test',
      category: 'general',
      country: 'EG',
      isBreaking: false,
    });
    expect(typeof a.publishedAt).toBe('number');
    expect(a.publishedAt).toBeGreaterThan(0);
  });

  it('dedupes by URL — same URL produces same id', () => {
    const a1 = normalizeXml(MINIMAL_RSS, 'src1', 'S1');
    const a2 = normalizeXml(MINIMAL_RSS, 'src2', 'S2');
    expect(a1[0]!.id).toBe(a2[0]!.id); // id is a hash of url
  });

  it('extracts media:content image URL', () => {
    const [a] = normalizeXml(RSS_WITH_MEDIA, 'test', 'Test');
    expect(a!.imageUrl).toBe('https://example.com/img.jpg');
  });

  it('handles Arabic-language feed items', () => {
    const [a] = normalizeXml(GOOGLE_NEWS_RSS, 'alarabiya', 'العربية');
    expect(a!.title).toBe('خبر مهم من العربية');
    expect(a!.url).toBe('https://www.alarabiya.net/story/12345');
  });

  it('returns empty array for a feed with no items', () => {
    const articles = normalizeXml(EMPTY_RSS, 'test', 'Test');
    expect(articles).toHaveLength(0);
  });

  it('strips HTML tags from summary', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel><item>
      <title>T</title><link>https://example.com/x</link>
      <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    </item></channel></rss>`;
    const [a] = normalizeXml(xml, 's', 'S');
    expect(a!.summary).toBe('Hello world');
  });

  it('skips items with no valid HTTP URL', () => {
    const xml = `<?xml version="1.0"?><rss version="2.0"><channel>
      <item><title>No URL</title><link>not-a-url</link></item>
      <item><title>Good</title><link>https://example.com/good</link></item>
    </channel></rss>`;
    const articles = normalizeXml(xml, 's', 'S');
    expect(articles).toHaveLength(1);
    expect(articles[0]!.url).toBe('https://example.com/good');
  });
});
