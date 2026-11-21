// Full article text: resolving the publisher URL and extracting the body.
//
// Why this exists: the app stores a ~78-character RSS snippet, which is not enough
// to summarise a story. The digest needs the article itself.
//
// Two things make that hard, and both are handled here rather than worked around:
//
// 1. Five of the ten sources (المصري اليوم، اليوم السابع، مصراوي، الأهرام، العربية)
//    are Google-News-only. Their own RSS now answers with HTML, and the publisher
//    URL is NOT inside the Google News article token — current Google encodes it
//    server-side. The supported way to recover it is the `batchexecute` RPC with
//    the page's `data-n-a-sg` signature; `resolveGoogleNewsUrl` does exactly that.
// 2. Several outlets answer 403 to a bare client but 200 to a browser-like
//    request. `BROWSER_HEADERS` is not decoration: without `Referer` and the
//    `Sec-Fetch-*` pair الأهرام and العربية refuse the page.
//
// Extraction is Mozilla Readability over linkedom (small, no jsdom), so menu and
// CSS chrome does not end up in the text we pay the AI to read.

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { Agent, request } from 'undici';

/**
 * Browsers negotiate HTTP/2; Node's built-in `fetch` (undici under the hood) and
 * curl default to HTTP/1.1, and three of these publishers answer **403 to
 * HTTP/1.1 while serving 200 over HTTP/2** on the identical URL, same IP, same
 * headers. Measured: العربية and الأهرام 403 on every HTTP/1.1 attempt and 200 on
 * every HTTP/2 one. So the transport is part of the fix, not a detail.
 */
export const H2_ENABLED = true;

/**
 * Per-page deadline. A digest builds 30 of these in parallel and must finish
 * inside the hour between slots, so one unresponsive publisher cannot hold the
 * whole run: measured, a single hung connection stalled it indefinitely.
 */
export const PAGE_TIMEOUT_MS = 20_000;

/**
 * One shared HTTP/2-capable dispatcher for the whole process. The deadlines are
 * on the agent, not per request: creating an Agent per call would leak sockets,
 * and undici's `request` has no per-call signal.
 */
export const h2Agent = new Agent({
  allowH2: H2_ENABLED,
  connections: 4,
  headersTimeout: PAGE_TIMEOUT_MS,
  bodyTimeout: PAGE_TIMEOUT_MS,
});

/**
 * Hosts that answer 403 over HTTP/2 but 200 over HTTP/1.1 (bbc.com) — the mirror
 * of the behaviour above, so the preference is per host, not global.
 */
export const HTTP1_ONLY_HOSTS = ['www.bbc.com', 'bbc.com'];

export function prefersHttp1(url: string): boolean {
  try {
    return HTTP1_ONLY_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Fetch a page the way a browser would: HTTP/2 first (see `h2Agent`), following
 * redirects — undici's low-level `request` does not, and Google's article pages
 * answer 302 — then one HTTP/1.1 retry. `fetchImpl` is injectable so tests never
 * touch the network.
 */
export async function fetchPage(
  url: string,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; status: number; text: string }> {
  if (fetchImpl) {
    const res = await fetchImpl(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  }
  if (prefersHttp1(url)) {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  }
  let current = url;
  for (let hop = 0; hop < 5; hop += 1) {
    let res: Awaited<ReturnType<typeof request>>;
    try {
      res = await request(current, { headers: BROWSER_HEADERS, dispatcher: h2Agent });
    } catch {
      // A connection-level failure is worth exactly one fallback attempt.
      const fallback = await fetch(current, { headers: BROWSER_HEADERS, redirect: 'follow' });
      return { ok: fallback.ok, status: fallback.status, text: await fallback.text() };
    }
    const { statusCode } = res;
    if (statusCode >= 300 && statusCode < 400) {
      const location = res.headers.location;
      await res.body.dump();
      if (!location) return { ok: false, status: statusCode, text: '' };
      current = new URL(String(location), current).toString();
      continue;
    }
    return {
      ok: statusCode >= 200 && statusCode < 300,
      status: statusCode,
      text: await res.body.text(),
    };
  }
  return { ok: false, status: 310, text: '' };
}

/** A browser-shaped request. Cloudflare-class filters reject anything less. */
export const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ar,en-US;q=0.7,en;q=0.5',
  Referer: 'https://news.google.com/',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'cross-site',
  'Sec-Fetch-Dest': 'document',
};

/** Below this many Arabic characters a page is a block page or an empty shell. */
export const MIN_BODY_ARABIC = 200;

/** Enough context for a summary; more only costs tokens. */
export const MAX_BODY_CHARS = 6000;

export type TextSource = 'full' | 'snippet';

export interface ArticleText {
  text: string;
  source: TextSource;
  /** The publisher URL actually fetched, when it could be resolved. */
  resolvedUrl: string | null;
  /** Why the full text was not available, for the digest log (never user-facing). */
  reason?: string;
}

export function isGoogleNewsUrl(url: string): boolean {
  return /^https?:\/\/news\.google\.com\//i.test(url);
}

/** Count Arabic letters, the only signal that a page has real body text. */
export function arabicLength(text: string): number {
  const m = text.match(/[\u0600-\u06FF]/g);
  return m ? m.length : 0;
}

/**
 * Ask Google's batchexecute endpoint for the publisher URL behind a Google News
 * article link. Returns null when the page carries no signature or the RPC
 * answers nothing usable — the caller then falls back to the snippet.
 */
export async function resolveGoogleNewsUrl(
  articleUrl: string,
  fetchImpl: typeof fetch = fetch,
  attempts = 3,
): Promise<string | null> {
  if (!isGoogleNewsUrl(articleUrl)) return articleUrl;
  const token = articleUrl.split('/articles/')[1]?.split('?')[0];
  if (!token) return null;

  let html: string;
  try {
    const page = await fetchPage(articleUrl, fetchImpl === fetch ? undefined : fetchImpl);
    if (!page.ok) return null;
    html = page.text;
  } catch {
    return null;
  }

  const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1];
  const id = html.match(/data-n-a-id="([^"]+)"/)?.[1] ?? token;
  if (!sig || !ts) return null;

  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'EG:ar', null, 1, null, null, null, null, null, 0, 1],
      'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, ts, sig,
  ]);
  const body = `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await fetchImpl('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': BROWSER_HEADERS['User-Agent'] as string,
        },
        body,
      });
      // 429 here is pacing, not a refusal: back off and retry.
      if (res.status === 429 || res.status >= 500) {
        if (attempt === attempts - 1) return null;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const parsed = await res.text();
      const direct = parsed.match(/"garturlres","(.*?)"/);
      const escaped = parsed.match(/\\"garturlres\\",\\"(.*?)\\"/);
      const raw = direct?.[1] ?? escaped?.[1];
      if (!raw) return null;
      const url = raw.replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      return /^https?:\/\//.test(url) ? url : null;
    } catch {
      if (attempt === attempts - 1) return null;
    }
  }
  return null;
}

/**
 * The length of the block that reproduces `text` exactly (text = block * n), or 0.
 * Used for bodies an outlet renders twice, which otherwise double the cost.
 */
export function repeatedPeriod(text: string): number {
  const body = text.trim();
  // A body rendered twice is the same paragraph block back-to-back. Compare the
  // halves loosely: whitespace at the cut is not a difference. No length floor —
  // short duplicates are exactly the common case here.
  for (const parts of [2, 3]) {
    const size = Math.floor(body.length / parts);
    if (size < 40) continue;
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    const first = norm(body.slice(0, size));
    let same = true;
    for (let i = 1; i < parts && same; i += 1) {
      const slice = norm(body.slice(i * size, (i + 1) * size));
      // Allow the final slice to be shorter (an uneven cut).
      const shorter = first.length <= slice.length ? first : slice;
      const longer = first.length <= slice.length ? slice : first;
      if (!longer.startsWith(shorter.slice(0, Math.max(0, shorter.length - 8)))) same = false;
    }
    if (same) return size;
  }
  return 0;
}

/** Drop repeated paragraphs, keeping first-seen order. */
function dedupe(parts: string[]): string[] {
  const seen = new Set<string>();
  return parts.filter((p) => (seen.has(p) ? false : (seen.add(p), true)));
}

/** Paragraph text worth keeping: Arabic, long enough to be a sentence. */
function paragraphTexts(html: string): string[] {
  const out: string[] = [];
  const blocks = html.matchAll(/<(?:p|h2|h3)[^>]*>([\s\S]*?)<\/(?:p|h2|h3)>/gi);
  for (const m of blocks) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z#0-9]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (arabicLength(text) >= 30) out.push(text);
  }
  return out;
}

/**
 * Remove what is not the article: JSON-LD schema blobs, URLs, and repeated outlet
 * signage. Measured on production pages, several bodies began with a ~500-char
 * `{"@context":"https://schema.org"...}` block, which then became the first thing
 * the model read and the text a duplicate comparison was made on.
 */
export function stripBoilerplate(text: string): string {
  let out = text;
  // Embedded data objects, repeatedly: schema blobs nest.
  for (let i = 0; i < 6; i += 1) {
    const next = out.replace(/\{\s*"[^{}]*\}/g, ' ');
    if (next === out) break;
    out = next;
  }
  return out
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s*\|\s*(?:أخبار|الجزيرة نت|المصري اليوم|اليوم السابع|بوابة الأهرام|سكاي نيوز عربية|العربية|آر تي عربي|بي بي سي عربي|سي إن إن عربي|مصراوي|Masrawy)\s*/g, ' . ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The article body, without menu chrome. Empty string when the page has none.
 *
 * Readability is the primary path, but it refuses some pages that plainly have a
 * body (a template it does not recognise). Those fall back to their paragraphs,
 * de-duplicated because several outlets render the body twice.
 */
export function extractArticleText(html: string): string {
  const strippedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  try {
    const { document } = parseHTML(strippedHtml);
    // Readability needs a documentURI to resolve relative links; without it some
    // pages parse but yield an empty article.
    const article = new Readability(document as unknown as Document, { charThreshold: 100 }).parse();
    // Prefer its HTML so the body can be de-duplicated: several outlets render the
    // same article twice, and identical paragraphs would be paid for twice.
    const fromContent = article?.content ? paragraphTexts(article.content) : [];
    const unique = dedupe(fromContent);
    if (unique.length && arabicLength(unique.join(' ')) >= MIN_BODY_ARABIC) {
      return stripBoilerplate(unique.join(' '));
    }
    const text = (article?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text) {
      // A single string, so it must be split before de-duplicating: a body
      // rendered twice is the same block back-to-back. Find the smallest period
      // that reproduces the whole text (only worth trying for long bodies).
      const clean = stripBoilerplate(text);
      const period = repeatedPeriod(clean);
      if (period) return stripBoilerplate(clean.slice(0, period).trim());
      const sentences = text
        .split(/(?<=[.!?؟\u06D4])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      return stripBoilerplate(dedupe(sentences).join(' '));
    }
  } catch {
    /* fall through to the crude extraction */
  }
  const paragraphs = paragraphTexts(strippedHtml);
  if (paragraphs.length) {
    const joined = stripBoilerplate(dedupe(paragraphs).join(' '));
    if (arabicLength(joined) >= MIN_BODY_ARABIC) return joined;
  }
  // Block-page or unusual markup: last resort, still strip scripts and styles.
  const stripped = strippedHtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const clean = stripBoilerplate(stripped);
  // A "page" that is 137k of scripts and 38 Arabic letters is a photo gallery or a
  // block page. Return nothing so the caller falls back to the snippet instead of
  // summarising JavaScript.
  if (arabicLength(clean) < MIN_BODY_ARABIC) return '';
  return clean;
}

/**
 * Full text for one article, with honest provenance.
 *
 * Never throws: a digest must survive one unreachable publisher. `fallback` is
 * the stored snippet, which is returned (labelled `snippet`) when the page cannot
 * be read, so the caller always has something to summarise.
 */
export async function fetchArticleText(
  article: { url: string; summary: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<ArticleText> {
  const snippet = (article.summary ?? '').trim();
  let resolved: string | null = null;
  try {
    resolved = isGoogleNewsUrl(article.url)
      ? await resolveGoogleNewsUrl(article.url, fetchImpl)
      : article.url;
    if (!resolved) {
      return {
        text: snippet,
        source: 'snippet',
        resolvedUrl: null,
        reason: 'could not resolve publisher URL',
      };
    }
    const res = await fetchPage(resolved, fetchImpl === fetch ? undefined : fetchImpl);
    if (!res.ok) {
      return {
        text: snippet,
        source: 'snippet',
        resolvedUrl: resolved,
        reason: `publisher answered ${res.status}`,
      };
    }
    const html = res.text;
    const body = extractArticleText(html);
    if (arabicLength(body) < MIN_BODY_ARABIC) {
      return {
        text: snippet,
        source: 'snippet',
        resolvedUrl: resolved,
        reason: `body too thin (${arabicLength(body)} Arabic chars)`,
      };
    }
    return {
      text: body.slice(0, MAX_BODY_CHARS),
      source: 'full',
      resolvedUrl: resolved,
    };
  } catch (err) {
    return {
      text: snippet,
      source: 'snippet',
      resolvedUrl: resolved,
      reason: err instanceof Error ? err.message.slice(0, 120) : 'fetch failed',
    };
  }
}
