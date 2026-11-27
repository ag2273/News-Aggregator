// Reader mode: an article broken into the pieces a screen needs (#51).
//
// WHY THIS IS SERVER-SIDE
// -----------------------
// The app already fetches the publisher page in a WebView for "read at source",
// and that page carries the outlet's ads. Extracting on the device would mean two
// different extractors to keep honest; and the repo already has ONE verified
// extractor — `articleText.ts`, Mozilla Readability over linkedom, with the
// Google-News URL resolution and the HTTP/2 requirement that three of these
// publishers need (measured: 403 on HTTP/1.1, 200 on HTTP/2 for the same URL).
//
// So this module only reshapes that same extraction into structured blocks. It
// does not fetch anything itself and it never invents content: text comes from
// Readability, images only from what the article's own markup carries, and when
// there is no body worth showing it says so — the app then falls back to the
// source page in its ad-blocked WebView instead of rendering an empty reader.

import { AD_HOSTNAMES } from './adHosts.js';
import {
  arabicLength,
  extractArticleText,
  MAX_BODY_CHARS,
  MIN_BODY_ARABIC,
  parseArticle,
  stripScripts,
} from './articleText.js';

/** One block of the article body, in reading order. */
export type ReaderBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'image'; url: string; caption: string | null }
  | { type: 'video'; url: string };

export interface ReaderArticle {
  /** The article's own headline, when the page states one worth showing. */
  title: string | null;
  /** Body blocks in reading order. */
  blocks: ReaderBlock[];
  /** True when the extraction produced a body worth reading. */
  readable: boolean;
  /**
   * The PUBLISHER url this article actually lives at, after a Google-News link was
   * resolved. The app needs it even when nothing is readable: its browser fallback
   * must load the publisher's page, and handing it the `news.google.com` redirect
   * link instead renders Google's shell — an "invalid redirect" error, not the story
   * (issue #54). Null when we could not resolve it.
   */
  resolvedUrl?: string | null;
  /**
   * Why a reader view is not offered, so the app knows to fall back.
   *
   * Machine-readable on purpose: the fallback decision is a rule, not a message.
   * `unreachable` and `blocked` are about the publisher; `thin` means the page was
   * read but carried no body we could stand behind.
   */
  reason?: 'unreachable' | 'blocked' | 'thin';
}

/**
 * Images that are page chrome, not the story.
 *
 * Measured on these outlets: the logo, the share sprite and the 1×1 tracking pixel
 * all arrive as `<img>` inside the article container. Keeping them would put the
 * outlet's own furniture in the middle of the text.
 */
function isChrome(src: string, width: number | null, height: number | null): boolean {
  const url = src.toLowerCase();
  if (/(sprite|logo|icon|avatar|pixel|1x1|spacer|blank)\.(png|gif|svg|webp|jpe?g)/.test(url)) return true;
  if (/\/logo[^/]*\.(png|gif|svg|webp|jpe?g)$/.test(url)) return true;
  // A tracking pixel is small in the markup as well as on screen.
  if (width !== null && height !== null && (width <= 2 || height <= 2)) return true;
  // A badge, an icon or a share button: real photos are not declared this small.
  if ((width !== null && width < 100) || (height !== null && height < 80)) return true;
  return false;
}

/**
 * The real picture behind an `<img>` (#57 follow-up: "show the story's own pictures
 * in the reader").
 *
 * These outlets lazy-load: `src` is a grey placeholder or a 1×1 data: GIF, and the
 * photo is in `data-src` / `data-lazy-src` / `data-original` or a `srcset`. Reading
 * only `src` showed a blank box or nothing at all.
 */
export function imageSource(attrs: string): string | null {
  const attr = (name: string) => attrs.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1]?.trim() || null;
  const lazy = attr('data-src') ?? attr('data-lazy-src') ?? attr('data-original') ?? attr('data-full-url') ?? attr('data-lazy');
  const src = attr('src');
  const placeholder = !src || /^data:/i.test(src) || /(lazy|placeholder|blank|loading|spacer|grey|gray)[^/]*\.(gif|png|svg|jpe?g|webp)/i.test(src);
  if (lazy && !/^data:/i.test(lazy)) return lazy;
  if (!placeholder) return src;
  // The largest candidate of a srcset, when that is all there is.
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
function isAdImage(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (AD_HOSTNAMES.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  return /\/(ads?|banners?|advert[a-z]*|sponsor[a-z]*|promo)\//i.test(url.pathname) || /[_-](ad|banner)s?[_-]/i.test(url.pathname);
}

/**
 * The story's pictures, ready for the app: absolute, de-duplicated, no ads and no
 * placeholders. The worker parses without the page URL, so this runs where the URL
 * is known (readerService). A relative `src` used to reach the app as-is and render
 * nothing.
 */
export function finishImages(blocks: ReaderBlock[], pageUrl: string): ReaderBlock[] {
  const seen = new Set<string>();
  const out: ReaderBlock[] = [];
  for (const b of blocks) {
    if (b.type !== 'image') {
      out.push(b);
      continue;
    }
    let url: URL;
    try {
      url = new URL(b.url.replace(/&amp;/g, '&'), pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (isAdImage(url) || isChrome(url.toString(), null, null)) continue;
    // The same photo twice (the og lead and the body's copy, or two sizes of one
    // file): keyed by the file name without its size suffix.
    const key = url.pathname.replace(/[-_]\d{2,4}x\d{2,4}(?=\.\w+$)/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...b, url: url.toString() });
  }
  return out;
}

/** An embeddable video URL, only for the hosts the app's WebView can play. */
function videoSource(html: string): string | null {
  // A <video src> or a YouTube/Vimeo iframe. Anything else is not offered: an
  // unknown player rendered in a WebView is a blank box, which is worse than the
  // source page.
  const direct = html.match(/<video[^>]+src=["']([^"']+)["']/i)?.[1];
  if (direct) return direct;
  const iframe = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)?.[1];
  if (!iframe) return null;
  return /(?:youtube\.com|youtu\.be|youtube-nocookie\.com|player\.vimeo\.com|dailymotion\.com)/i.test(iframe)
    ? iframe
    : null;
}

/**
 * Break the extracted article into blocks.
 *
 * `html` is the publisher page. Readability is asked for its content so headings,
 * paragraphs, images and embeds keep their order — flattening to a string first
 * would lose exactly the structure a reader view exists to show.
 */
export function readerFromHtml(html: string, pageTitle?: string | null): ReaderArticle {
  // One parse serves both the body check and the blocks (see `parseArticle`).
  const stripped = stripScripts(html);
  const parsed = parseArticle(stripped);
  const bodyText = extractArticleText(html, { stripped, parsed });
  if (arabicLength(bodyText) < MIN_BODY_ARABIC) {
    return { title: null, blocks: [], readable: false, reason: 'thin' };
  }
  const blocks: ReaderBlock[] = [];
  try {
    const content = parsed?.content ?? '';
    // Walk the article container in document order, so a paragraph that follows an
    // image stays after it.
    const marks = [...content.matchAll(/<(h2|h3|p|img|figure|iframe|video)\b([^>]*)>/gi)];
    for (const mark of marks) {
      const tag = mark[1]!.toLowerCase();
      const attrs = mark[2] ?? '';
      if (tag === 'img') {
        const src = imageSource(attrs);
        if (!src) continue;
        const width = attrs.match(/width=["']?(\d+)/i)?.[1];
        const height = attrs.match(/height=["']?(\d+)/i)?.[1];
        if (isChrome(src, width ? Number(width) : null, height ? Number(height) : null)) continue;
        blocks.push({ type: 'image', url: src, caption: null });
        continue;
      }
      if (tag === 'iframe' || tag === 'video') {
        // The whole tag is needed: the source URL lives in the attributes.
        const start = mark.index ?? 0;
        const end = content.indexOf('>', start);
        const src = videoSource(content.slice(start, end + 1));
        if (src) blocks.push({ type: 'video', url: src });
        continue;
      }
      // Text: the tag's own inner text, up to its closing tag.
      const start = (mark.index ?? 0) + mark[0].length;
      const closeAt = content.indexOf(`</${tag}>`, start);
      if (closeAt < 0) continue;
      const text = content
        .slice(start, closeAt)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (arabicLength(text) < 20) continue;
      blocks.push({ type: tag === 'p' ? 'paragraph' : 'heading', text });
    }
    // The lead image lives on the page, not always inside Readability's content.
    // Also when the body's first picture comes after the text has started: the lead
    // photo usually sits above the article container, outside Readability's content.
    const firstImage = blocks.findIndex((b) => b.type === 'image');
    const firstText = blocks.findIndex((b) => b.type === 'paragraph');
    if (firstImage < 0 || (firstText >= 0 && firstImage > firstText)) {
      const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
      if (og && !isChrome(og, null, null)) blocks.unshift({ type: 'image', url: og, caption: null });
    }
  } catch {
    /* fall through to the flat body below */
  }

  if (!blocks.some((b) => b.type === 'paragraph')) {
    // No structure survived, but there IS a body: present it as paragraphs so the
    // reader still works rather than dropping to the browser for no reason.
    const fallback = bodyText
      .slice(0, MAX_BODY_CHARS)
      .split(/(?<=[.!?؟\u06D4])\s+/)
      .map((s) => s.trim())
      .filter((s) => arabicLength(s) >= 20);
    for (const text of fallback) blocks.push({ type: 'paragraph', text });
  }

  const title = (parsedTitle(pageTitle) ?? null);
  return { title, blocks, readable: blocks.length > 0 };
}

/**
 * The page's own headline, when it is a headline and not the site's name.
 *
 * Measured: several outlets send `"<headline> | <outlet>"`, and a few send only the
 * outlet name on an error page. Rejecting a title that is mostly the source name
 * keeps the reader from printing the brand as the story.
 */
function parsedTitle(title?: string | null): string | null {
  if (!title) return null;
  const first = title.split(/\s*[|–—-]\s*/)[0]?.trim() ?? '';
  if (arabicLength(first) < 15) return null;
  return first;
}
