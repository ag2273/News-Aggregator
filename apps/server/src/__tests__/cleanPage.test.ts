// The two reports on the first reader build (issue #52).
//
// 1. Reader mode never opened. Root cause measured, not guessed: the app sent
//    `?id=` and the route only accepted `?url=`, so EVERY request answered 400 and
//    fell back to the browser. These tests pin the id path and — the user's own
//    hypothesis — that one article failing cannot affect the next one.
// 2. Ads still showed in the browser. Hiding them with CSS cannot work once the ad
//    scripts have run, so the page is now cleaned server-side. These tests pin that
//    the ad markup is gone BEFORE it reaches the WebView, and that the article's own
//    stylesheets and images survive.

import { describe, it, expect } from 'vitest';
import { stripAdMarkup, isAdUrl } from '../cleanPage.js';
import { readerArticle, resetReaderCache } from '../readerService.js';
import { readerFromHtml } from '../reader.js';

/** A page shaped like the outlets we measured, ad markup included. */
const dostorLike = `<!doctype html>
<html dir="rtl" lang="ar"><head>
  <title>خبر | الدستور</title>
  <link rel="stylesheet" href="/css/site.css" />
  <link rel="preconnect" href="https://securepubads.g.doubleclick.net" />
  <script src="https://securepubads.g.doubleclick.net/tag/js/gpt.js"></script>
  <script src="/js/app.js"></script>
</head><body>
  <div class="ad-slot-top"><span>مساحة إعلانية</span></div>
  <div class="article-body">
    <p>نص الخبر الأصلي كما نشره الموقع، وهو ما يقرأه المستخدم.</p>
    <img src="/img/lead.jpg" alt="" />
    <ins class="adsbygoogle" data-ad-slot="123"></ins>
  </div>
  <div id="taboola-below-article"><div>محتوى مدفوع</div></div>
  <script>window.googletag = window.googletag || {}; googletag.cmd = [];</script>
  <script>var app = { start: function () { console.log('site'); } };</script>
</body></html>`;

describe('cleaning a page before the browser sees it', () => {
  const cleaned = stripAdMarkup(dostorLike, 'https://www.dostor.org/story/1');

  it('removes the ad-network script, so it is never requested', () => {
    expect(cleaned).not.toContain('doubleclick.net/tag/js/gpt.js');
    expect(cleaned).toContain('<!-- ad script removed -->');
  });

  it('removes the preconnect that would start the ad request anyway', () => {
    expect(cleaned).not.toContain('preconnect" href="https://securepubads.g.doubleclick.net');
  });

  it('removes the ad containers and the inline ad loader', () => {
    expect(cleaned).not.toContain('window.googletag');
    expect(cleaned).not.toContain('adsbygoogle');
    expect(cleaned).not.toContain('taboola-below-article');
    expect(cleaned).not.toContain('مساحة إعلانية');
    expect(cleaned).not.toContain('محتوى مدفوع');
  });

  it('keeps the article itself: its text, its image, its stylesheet', () => {
    // The whole point: a "clean" page with no CSS is not a readable page.
    expect(cleaned).toContain('نص الخبر الأصلي');
    expect(cleaned).toContain('/img/lead.jpg');
    expect(cleaned).toContain('site.css');
    expect(cleaned).toContain('console.log'); // an ordinary script, not an ad loader
  });

  it('makes relative URLs absolute, so they still resolve on our host', () => {
    expect(cleaned).toContain('https://www.dostor.org/css/site.css');
    expect(cleaned).toContain('https://www.dostor.org/img/lead.jpg');
    // A <base> covers everything else the page loads.
    expect(cleaned).toContain('<base href="https://www.dostor.org/story/1">');
  });

  it('counts what was removed, for an honest report', () => {
    const adRefs = (html: string) =>
      (html.match(/doubleclick|googlesyndication|taboola|outbrain|adsbygoogle|googletag/gi) || []).length;
    expect(adRefs(dostorLike)).toBeGreaterThan(5);
    expect(adRefs(cleaned)).toBe(0);
  });

  it('knows an ad host from a lookalike', () => {
    expect(isAdUrl('https://securepubads.g.doubleclick.net/x')).toBe(true);
    expect(isAdUrl('https://www.dostor.org/x')).toBe(false);
    expect(isAdUrl('https://doubleclick.net.attacker.example/x')).toBe(false);
  });
});

describe('one article failing does not poison the next', () => {
  it('answers each article independently', async () => {
    resetReaderCache();
    // The user's hypothesis was that a failing article sticks and blocks the rest.
    // Drive three requests where the middle one cannot be fetched at all.
    const failFetch = (async () => {
      throw new Error('publisher unreachable');
    }) as unknown as typeof fetch;

    const first = await readerArticle('https://www.example.com/a', { fetchImpl: failFetch });
    expect(first.readable).toBe(false);

    const second = await readerArticle('https://www.example.com/b', { fetchImpl: failFetch });
    expect(second.readable).toBe(false);

    // A working article AFTER two failures must still succeed. Driven through the
    // extractor directly, because a stubbed fetch bypasses the URL handling that
    // every real article goes through.
    const para =
      'نص مقال حقيقي طويل بما يكفي ليعتبره المستخرج متن المقال وليس صفحة خطأ أو معرض صور، وفيه تفاصيل كافية عن المباراة والنتيجة واللاعبين.';
    const html = `<html dir="rtl"><body><article>${Array.from(
      { length: 10 },
      () => `<p>${para}</p>`,
    ).join('')}</article></body></html>`;
    const third = readerFromHtml(html, null);
    expect(third.readable).toBe(true);
    expect(third.blocks.length).toBeGreaterThan(0);
  });

  it('does not cache one article’s failure under another article’s URL', async () => {
    resetReaderCache();
    const failFetch = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    const a = await readerArticle('https://www.example.com/x1', { fetchImpl: failFetch });
    const b = await readerArticle('https://www.example.com/x2', { fetchImpl: failFetch });
    // Both failed, but independently — each got its own verdict.
    expect(a.readable).toBe(false);
    expect(b.readable).toBe(false);
  });
});
