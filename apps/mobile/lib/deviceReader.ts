// Reading an article from the DEVICE, for the publishers our server cannot reach (#55).
//
// WHY THE DEVICE AND NOT THE SERVER
// ---------------------------------
// Measured: from our server these three publishers reset the TLS handshake (#52), so
// the server-side reader and cleaner both answer "not reachable". The user's phone
// reaches them fine. So for those three the page is fetched and read HERE, and the
// article is drawn in the app's own reader design — exactly the look other sources
// get from the server.
//
// WHY THE EXTRACTION IS THIS SIMPLE
// ---------------------------------
// The app cannot ship Mozilla Readability plus a DOM parser: it is the size of the
// rest of the bundle, and it exists for pages we already read on the server. What is
// needed here is only "the story on a news page", which has a stable shape: an
// `<article>`/`itemprop=articleBody` container (or the body), a headline, images, and
// paragraphs of real Arabic prose. The rules below are that shape, and the
// THRESHOLDS are pinned by tests so "thin" cannot drift.

import { arabicLength } from './text';
import { isAdRequestHost } from './adBlockHosts';

/** One block of the article body, in reading order. */
export type DeviceBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; url: string; caption: string | null };

export interface DeviceArticle {
  title: string | null;
  blocks: DeviceBlock[];
  /** True when the extraction produced a body worth drawing. */
  readable: boolean;
}

/**
 * The minimum this reader will call a story.
 *
 * A gallery caption, a paywall teaser and a "please enable JavaScript" shell all
 * produce a few short lines. Measured on the real pages: an actual article carries
 * well over 400 Arabic characters in at least two paragraphs, while the shells
 * carry fewer than 150 characters and one paragraph. Both numbers are pinned in
 * `__tests__/DeviceReader.test.ts`.
 */
export const MIN_DEVICE_PARAGRAPHS = 2;
export const MIN_DEVICE_ARABIC_CHARS = 400;

/** Below this a paragraph is a caption, a label or navigation, not prose. */
const MIN_PARAGRAPH_ARABIC = 20;

/** Page chrome that arrives as an <img> inside the article container. */
function isChrome(src: string, width: number | null, height: number | null): boolean {
  const url = src.toLowerCase();
  if (/(sprite|logo|icon|avatar|pixel|1x1|spacer|blank)\.(png|gif|svg|webp|jpe?g)/.test(url)) return true;
  if (width !== null && height !== null && (width <= 2 || height <= 2)) return true;
  // A badge, an icon or a share button: real photos are not declared this small.
  if ((width !== null && width < 100) || (height !== null && height < 80)) return true;
  return false;
}

/**
 * The real picture behind an `<img>`: these outlets lazy-load, so `src` is often a
 * placeholder and the photo is in `data-src`, `data-original` or a srcset (#57).
 * The same rule as the server's reader (`imageSource` in reader.ts).
 */
export function imageSource(attrs: string): string | null {
  const attr = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(attrs)?.[1]?.trim() || null;
  const lazy = attr('data-src') ?? attr('data-lazy-src') ?? attr('data-original') ?? attr('data-full-url') ?? attr('data-lazy');
  const src = attr('src');
  const placeholder = !src || /^data:/i.test(src) || /(lazy|placeholder|blank|loading|spacer|grey|gray)[^/]*\.(gif|png|svg|jpe?g|webp)/i.test(src);
  if (lazy && !/^data:/i.test(lazy)) return lazy;
  if (!placeholder) return src;
  const set = attr('data-srcset') ?? attr('srcset');
  if (set) {
    const best = set
      .split(',')
      .map((c) => c.trim().split(/\s+/))
      .filter(([u]) => u && !/^data:/i.test(u))
      .sort((a, b) => parseInt(b[1] ?? '0', 10) - parseInt(a[1] ?? '0', 10))[0];
    if (best?.[0]) return best[0];
  }
  return null;
}

/** An ad network's image, or one that is plainly a banner. */
function isAdImage(url: string): boolean {
  if (isAdRequestHost(url)) return true;
  const path = url.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] ?? '';
  return /\/(ads?|banners?|advert[a-z]*|sponsor[a-z]*|promo)\//i.test(path) || /[_-](ad|banner)s?[_-]/i.test(path);
}

/** Pull `<meta property="og:...">` or `<meta name="...">` out of the head. */
function meta(html: string, key: string): string | null {
  const direct = new RegExp(
    `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)`,
    'i',
  ).exec(html);
  if (direct?.[1]) return decodeEntities(direct[1]);
  const reversed = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
    'i',
  ).exec(html);
  return reversed?.[1] ? decodeEntities(reversed[1]) : null;
}

/** The handful of entities these pages actually carry in text and titles. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
    .replace(/&ldquo;|&rdquo;/gi, '"')
    .replace(/&ndash;|&mdash;|&lsquo;/gi, '—')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** Markup that is never article prose. */
function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, ' ');
}

/** The headline: og:title, then the document title, minus the outlet's suffix. */
export function deviceTitle(html: string): string | null {
  const raw = meta(html, 'og:title') ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
  if (!raw) return null;
  const clean = decodeEntities(raw.replace(/\s+/g, ' ')).trim();
  // "<headline> | <outlet>" and the two dash variants these outlets use. A dash
  // INSIDE the headline is not a separator, so only a spaced one is cut — the
  // unspaced "-" that العربية and الأهرام use in "<headline> - <outlet>" is handled
  // by cutting at the last separator, and only when the tail is short (an outlet
  // name, not the end of a sentence).
  const parts = clean.split(/\s+[|–—]\s+/);
  if (parts.length > 1 && parts[0]!.trim().length > 10) return parts[0]!.trim();
  const dash = clean.lastIndexOf(' - ');
  if (dash > 10 && clean.length - dash <= 30) return clean.slice(0, dash).trim();
  return arabicLength(clean) >= 15 ? clean : null;
}

/**
 * The article body as blocks.
 *
 * Images keep their position relative to the paragraphs, because a photo that jumps
 * to the end of the story is a different story.
 */
export function deviceBlocks(html: string, baseUrl: string): DeviceBlock[] {
  const doc = stripNoise(html);
  // The narrowest container that is the story; the body is the fallback.
  const container =
    /<article\b[\s\S]*?<\/article>/i.exec(doc)?.[0] ??
    /<[^>]+itemprop=["']articleBody["'][\s\S]*?<\/div>/i.exec(doc)?.[0] ??
    doc;

  const blocks: DeviceBlock[] = [];
  const seenImages = new Set<string>();
  // Walk paragraphs, headings and images in document order in one pass.
  const marks = [...container.matchAll(/<(h2|h3|p|img)\b([^>]*)>/gi)];
  for (const mark of marks) {
    const tag = mark[1]!.toLowerCase();
    const attrs = mark[2] ?? '';
    if (tag === 'img') {
      const src = imageSource(attrs);
      if (!src) continue;
      const width = /width=["']?(\d+)/i.exec(attrs)?.[1];
      const height = /height=["']?(\d+)/i.exec(attrs)?.[1];
      if (isChrome(src, width ? Number(width) : null, height ? Number(height) : null)) continue;
      const url = absoluteUrl(src.replace(/&amp;/g, '&'), baseUrl);
      if (!/^https?:\/\//i.test(url) || isAdImage(url)) continue;
      const key = url.split('?')[0]!.replace(/[-_]\d{2,4}x\d{2,4}(?=\.\w+$)/, '').toLowerCase();
      if (seenImages.has(key)) continue;
      seenImages.add(key);
      const caption = /alt=["']([^"']+)["']/i.exec(attrs)?.[1] ?? null;
      blocks.push({ type: 'image', url, caption: caption ? decodeEntities(caption) : null });
      continue;
    }
    const start = (mark.index ?? 0) + mark[0].length;
    const closeAt = container.indexOf(`</${tag}>`, start);
    if (closeAt < 0) continue;
    const text = decodeEntities(
      container
        .slice(start, closeAt)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' '),
    )
      .replace(/\s+/g, ' ')
      .trim();
    // A heading is legitimately short ("تفاصيل القرار"), so the prose floor does not
    // apply to it; a paragraph that short is a caption or a label.
    const min = tag === 'p' ? MIN_PARAGRAPH_ARABIC : 3;
    if (arabicLength(text) < min) continue;
    blocks.push({ type: tag === 'p' ? 'paragraph' : 'heading', text });
  }

  // No structured body survived: fall back to the container's own prose, split into
  // sentences, so a story in a template we do not know still reads.
  if (!blocks.some((b) => b.type === 'paragraph')) {
    const flat = decodeEntities(container.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    for (const sentence of flat.split(/(?<=[.!?؟\u06D4])\s+/)) {
      const s = sentence.trim();
      if (arabicLength(s) >= MIN_PARAGRAPH_ARABIC) blocks.push({ type: 'paragraph', text: s });
    }
  }

  // A lead image that lives outside the container is still the article's image.
  // Also when the body's first picture comes after the text has started: the lead
  // photo usually sits above the article container.
  const firstImage = blocks.findIndex((b) => b.type === 'image');
  const firstText = blocks.findIndex((b) => b.type === 'paragraph');
  if (firstImage < 0 || (firstText >= 0 && firstImage > firstText)) {
    const og = meta(html, 'og:image');
    const url = og ? absoluteUrl(og.replace(/&amp;/g, '&'), baseUrl) : null;
    const key = url?.split('?')[0]!.replace(/[-_]\d{2,4}x\d{2,4}(?=\.\w+$)/, '').toLowerCase();
    if (url && key && !seenImages.has(key) && !isChrome(url, null, null) && !isAdImage(url)) {
      blocks.unshift({ type: 'image', url, caption: null });
    }
  }

  return blocks;
}

/**
 * A relative image source is resolved against the page it came from.
 *
 * Passed explicitly rather than held in a module-level variable: the extractor is
 * called for one article at a time, and a shared mutable base is exactly how a
 * second article would silently resolve its images against the first.
 */
function absoluteUrl(src: string, base: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith('//')) return `https:${src}`;
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}

/**
 * The article, or a truthful "not readable".
 *
 * `baseUrl` is the page the markup came from: relative image sources are resolved
 * against it, which is why every image on a real page still loads.
 */
export function extractDeviceArticle(html: string, baseUrl: string): DeviceArticle {
  if (!html || html.length < 200) return { title: null, blocks: [], readable: false };
  const blocks = deviceBlocks(html, baseUrl);
  const paragraphs = blocks.filter((b) => b.type === 'paragraph');
  const chars = paragraphs.reduce(
    (sum, b) => sum + arabicLength((b as { text: string }).text),
    0,
  );
  const readable =
    paragraphs.length >= MIN_DEVICE_PARAGRAPHS && chars >= MIN_DEVICE_ARABIC_CHARS;
  return { title: deviceTitle(html), blocks: readable ? blocks : [], readable };
}
