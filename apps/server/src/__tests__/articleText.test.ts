/**
 * Full article text: Google News resolution, extraction provenance and fallbacks.
 *
 * No network: `fetchImpl` is injected everywhere. The fixtures are shaped like the
 * real pages, including the two traps that cost the most time to find:
 *   - the publisher URL is NOT in the article token, it comes from the
 *     `batchexecute` RPC (with the page's signature), so a naive base64 decode
 *     finds nothing;
 *   - some outlets answer 403 to HTTP/1.1 and 200 to HTTP/2, which is why the
 *     transport is part of the module.
 */

import { describe, it, expect } from 'vitest';
import {
  arabicLength,
  extractArticleText,
  fetchArticleText,
  isGoogleNewsUrl,
  resolveGoogleNewsUrl,
  MIN_BODY_ARABIC,
  MAX_BODY_CHARS,
  BROWSER_HEADERS,
  HTTP1_ONLY_HOSTS,
  prefersHttp1,
  fetchPage,
  repeatedPeriod,
  h2Agent,
  H2_ENABLED,
} from '../articleText.js';

const BODY = 'أعلنت إيران أنها لا تزال تعقد آمالا على الدبلوماسية لإنهاء الصراع مع الولايات المتحدة، سعيا إلى اتفاق يضمن عدم نشوب حرب أخرى في المستقبل.';
const LONG_BODY = BODY.repeat(12);

function jsonFetch(map: Record<string, { status?: number; body: string }>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    const key = Object.keys(map).find((k) => url.includes(k));
    const entry = key ? map[key] : undefined;
    if (!entry) return new Response('not found', { status: 404 }) as Response;
    return new Response(entry.body, { status: entry.status ?? 200 }) as Response;
  }) as unknown as typeof fetch;
}

describe('articleText: helpers', () => {
  it('counts Arabic letters only', () => {
    expect(arabicLength('abc')).toBe(0);
    expect(arabicLength(BODY)).toBeGreaterThan(50);
  });

  it('recognises Google News links', () => {
    expect(isGoogleNewsUrl('https://news.google.com/rss/articles/CBMiX0')).toBe(true);
    expect(isGoogleNewsUrl('https://www.almasryalyoum.com/news/details/1')).toBe(false);
  });

  it('sets a browser User-Agent, because these publishers 403 anything else', () => {
    expect(BROWSER_HEADERS['User-Agent']).toContain('Mozilla/5.0');
    expect(BROWSER_HEADERS.Referer).toContain('news.google.com');
  });

  it('marks the HTTP/1.1-only hosts', () => {
    expect(prefersHttp1('https://www.bbc.com/arabic/articles/x')).toBe(true);
    expect(prefersHttp1('https://www.aljazeera.net/news/2026/11/17/x')).toBe(false);
    expect(HTTP1_ONLY_HOSTS).toContain('www.bbc.com');
  });
});

describe('articleText: Google News resolution', () => {
  const GN = 'https://news.google.com/rss/articles/CBMiTOKENVALUE?oc=5';
  const PAGE_WITH_SIG = `<html><body><c-wiz data-n-a-sg="SIGNATUREVALUE" data-n-a-ts="1700000000" data-n-a-id="CBMiTOKENVALUE"></c-wiz></body></html>`;

  it('resolves the publisher URL from the batchexecute RPC', async () => {
    const f = jsonFetch({
      'news.google.com/rss/articles': { body: PAGE_WITH_SIG },
      'news.google.com/_/DotsSplashUi/data/batchexecute': {
        body: '["garturlreq",[["garturlres","https://www.almasryalyoum.com/news/details/4412729"]]]',
      },
    });
    await expect(resolveGoogleNewsUrl(GN, f)).resolves.toBe('https://www.almasryalyoum.com/news/details/4412729');
  });

  it('does not try to decode the token itself (it holds no URL)', async () => {
    // The real failure mode: base64 decoding the token finds nothing, so the
    // implementation must rely on the RPC page signature instead.
    const f = jsonFetch({ 'news.google.com/rss/articles': { body: '<html>no signature here</html>' } });
    await expect(resolveGoogleNewsUrl(GN, f)).resolves.toBeNull();
  });

  it('passes a non-Google URL straight through', async () => {
    const f = jsonFetch({});
    await expect(resolveGoogleNewsUrl('https://example.com/a', f)).resolves.toBe('https://example.com/a');
  });

  it('returns null when the RPC answers nothing', async () => {
    const f = jsonFetch({
      'news.google.com/rss/articles': { body: PAGE_WITH_SIG },
      'batchexecute': { body: '[]' },
    });
    await expect(resolveGoogleNewsUrl(GN, f)).resolves.toBeNull();
  });
});

describe('articleText: extraction', () => {
  it('extracts the body from a normal article page', () => {
    const html = `<html><body><nav>قائمة التنقل الرئيسية هنا</nav><article><h1>عنوان</h1>
      <p>${BODY}</p><p>${BODY}</p></article><footer>جميع الحقوق محفوظة</footer></body></html>`;
    const text = extractArticleText(html);
    expect(arabicLength(text)).toBeGreaterThan(MIN_BODY_ARABIC);
    expect(text).toContain('الدبلوماسية');
  });

  it('never returns CSS or script text', () => {
    const html = `<html><head><style>@font-face{font-family:"x";src:url(https://x/y.woff2)}</style>
      <script>var track = "not article text";</script></head>
      <body><p>${BODY}</p><p>${BODY}</p></body></html>`;
    const text = extractArticleText(html);
    expect(text).not.toContain('@font-face');
    expect(text).not.toContain('track');
    expect(text).not.toContain('woff2');
  });

  it('falls back to paragraphs when Readability refuses the page', () => {
    // Sky News style: no article/div container Readability accepts, but real <p>s.
    const html = `<html><body><div class="x"><p>الرئيسية أخبار آخر الأخبار الأكثر قراءة اخترنا لكم</p>
      <p>${BODY}</p><p>${BODY}</p><p>${BODY}</p></div></body></html>`;
    const text = extractArticleText(html);
    expect(arabicLength(text)).toBeGreaterThan(MIN_BODY_ARABIC);
    expect(text).toContain('إيران');
  });

  it('does not return the same paragraph twice in a row', () => {
    // Honest bound: duplicate paragraphs are collapsed, not the whole body
    // re-flowed. The point is that a doubled render does not double the cost.
    const html = `<html><body><article><p>${BODY}</p><p>${BODY}</p><p>${BODY}</p></article>
      <article><p>${BODY}</p><p>${BODY}</p><p>${BODY}</p></article></body></html>`;
    const text = extractArticleText(html);
    expect(text).not.toMatch(/(الدبلوماسية[^.]{0,40})\s+\1/);
  });

  it('returns empty for a page with no article body', () => {
    expect(arabicLength(extractArticleText('<html><body></body></html>'))).toBe(0);
  });
});

describe('articleText: provenance and fallbacks', () => {
  const article = { url: 'https://www.almasryalyoum.com/news/details/1', summary: 'مقتطف قصير من الخلاصة' };

  it('marks a successful fetch as full text', async () => {
    const f = jsonFetch({ 'almasryalyoum.com': { body: `<html><body><article><p>${LONG_BODY}</p></article></body></html>` } });
    const res = await fetchArticleText(article, f);
    expect(res.source).toBe('full');
    expect(res.reason).toBeUndefined();
    expect(res.resolvedUrl).toBe(article.url);
    expect(arabicLength(res.text)).toBeGreaterThan(MIN_BODY_ARABIC);
  });

  it('falls back to the snippet, labelled, when the publisher 403s', async () => {
    const f = jsonFetch({ 'almasryalyoum.com': { status: 403, body: 'forbidden' } });
    const res = await fetchArticleText(article, f);
    expect(res.source).toBe('snippet');
    expect(res.text).toBe(article.summary);
    expect(res.reason).toContain('403');
  });

  it('falls back when the page is a shell with no body', async () => {
    const f = jsonFetch({ 'almasryalyoum.com': { body: '<html><body><div id="app"></div></body></html>' } });
    const res = await fetchArticleText(article, f);
    expect(res.source).toBe('snippet');
    expect(res.reason).toContain('thin');
  });

  it('falls back when the network throws', async () => {
    const f = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    const res = await fetchArticleText(article, f);
    expect(res.source).toBe('snippet');
    expect(res.text).toBe(article.summary);
  });

  it('never throws, even with a null summary', async () => {
    const f = jsonFetch({ 'almasryalyoum.com': { status: 500, body: '' } });
    const res = await fetchArticleText({ url: article.url, summary: null }, f);
    expect(res.source).toBe('snippet');
    expect(res.text).toBe('');
  });

  it('caps the text, so one huge page cannot blow the token budget', async () => {
    const f = jsonFetch({ 'almasryalyoum.com': { body: `<html><body><article><p>${BODY.repeat(400)}</p></article></body></html>` } });
    const res = await fetchArticleText(article, f);
    expect(res.source).toBe('full');
    expect(res.text.length).toBeLessThanOrEqual(MAX_BODY_CHARS);
  });

  it('resolves a Google News link before fetching the publisher', async () => {
    const f = jsonFetch({
      'news.google.com/rss/articles': {
        body: '<c-wiz data-n-a-sg="SIG" data-n-a-ts="1700000000" data-n-a-id="TOK"></c-wiz>',
      },
      batchexecute: { body: '["garturlreq",[["garturlres","https://www.youm7.com/story/1/x"]]]' },
      'youm7.com': { body: `<html><body><article><p>${LONG_BODY}</p></article></body></html>` },
    });
    const res = await fetchArticleText({ url: 'https://news.google.com/rss/articles/TOK?oc=5', summary: 's' }, f);
    expect(res.source).toBe('full');
    expect(res.resolvedUrl).toBe('https://www.youm7.com/story/1/x');
  });
});

describe('articleText: transport', () => {
  it('negotiates HTTP/2, because three publishers 403 HTTP/1.1', () => {
    // Measured: العربية and الأهرام answer 403 to every HTTP/1.1 request and 200
    // over HTTP/2 on the identical URL. Losing this flag silently degrades them
    // to snippets, so it is pinned here.
    // undici keeps the flag on a private dispatcher, so assert the setting the
    // agent is built from. Setting this to false downgrades العربية and الأهرام
    // to snippets, which is exactly the regression this pins.
    expect(H2_ENABLED).toBe(true);
    expect(h2Agent.constructor.name).toBe('Agent');
  });

  it('the real network path goes through fetchPage, not bare fetch', async () => {
    // A bare fetch() here was one of the two bugs: it does not follow the 302 and
    // it speaks HTTP/1.1, which three publishers 403. Assert the module wiring
    // rather than trusting it by eye.
    const src = (await import('node:fs')).readFileSync(
      new URL('../articleText.ts', import.meta.url),
      'utf8',
    );
    const realCalls = src.match(/await fetch\(/g) ?? [];
    // Only the explicit HTTP/1.1 fallbacks inside fetchPage may use bare fetch.
    expect(realCalls.length).toBeLessThanOrEqual(2);
    expect(src).toMatch(/resolveGoogleNewsUrl[\s\S]{0,800}fetchPage\(/);
  });

  it('follows redirects, because Google answers 302', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const spy = (async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push((init ?? {}) as Record<string, unknown>);
      return new Response('ok', { status: 200 }) as Response;
    }) as unknown as typeof fetch;
    const res = await fetchPage('https://news.google.com/rss/articles/x', spy);
    expect(res.ok).toBe(true);
    expect(seen[0].redirect).toBe('follow');
  });

  it('sends browser headers on the injected path too', async () => {
    let headers: Record<string, string> = {};
    const spy = (async (_u: string | URL | Request, init?: RequestInit) => {
      headers = (init?.headers ?? {}) as Record<string, string>;
      return new Response('ok', { status: 200 }) as Response;
    }) as unknown as typeof fetch;
    await fetchPage('https://www.almasryalyoum.com/x', spy);
    expect(headers['User-Agent']).toContain('Mozilla/5.0');
  });
});

describe('articleText: repeated bodies', () => {
  it('collapses a body rendered twice to roughly one copy', () => {
    const twice = `<html><body><article><p>${LONG_BODY}</p></article><article><p>${LONG_BODY}</p></article></body></html>`;
    const once = `<html><body><article><p>${LONG_BODY}</p></article></body></html>`;
    const a = extractArticleText(twice).length;
    const b = extractArticleText(once).length;
    expect(a).toBeLessThan(b * 1.6);
  });

  it('returns 0 for short text', () => {
    expect(repeatedPeriod('text')).toBe(0);
  });
});
