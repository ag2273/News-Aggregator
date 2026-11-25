// Reader mode and its fallback (issue #51).
//
// The rules under test are the user's own: reader view first, the source page in an
// ad-blocked WebView only when the reader view cannot be produced. Nothing here
// asserts on a design; it asserts on what the reader gets and what is stripped.

import { describe, it, expect } from 'vitest';
import { readerFromHtml } from '../reader.js';

/** A publisher page shaped like the real ones we measured (Sky News Arabia, Youm7). */
const articlePage = (body: string) => `<!doctype html>
<html dir="rtl" lang="ar"><head>
  <title>الأهلي يحسم القمة بهدف قاتل | اليوم السابع</title>
  <meta property="og:image" content="https://cdn.example.com/lead.jpg" />
</head><body>
  <header><img src="https://cdn.example.com/logo-site.png" /><nav>القائمة</nav></header>
  <article>
    <h2>ملخص المباراة</h2>
    ${body}
  </article>
  <aside><img src="https://ads.example.com/300x250.png" /></aside>
  <footer>كل الحقوق محفوظة</footer>
</body></html>`;

/** Long enough to pass the extractor's minimum body length (200 Arabic letters). */
const longBody = Array.from({ length: 8 }, (_, i) =>
  `<p>سجل الأهلي هدف الفوز في الدقيقة ${70 + i} من عمر المباراة بعد هجمة منظمة قادها لاعبو الوسط، وسط حضور جماهيري كبير في استاد القاهرة الدولي مساء اليوم.</p>`,
).join('\n');

describe('reader extraction', () => {
  it('turns a real article page into ordered blocks', () => {
    const article = readerFromHtml(articlePage(longBody), null);
    expect(article.readable).toBe(true);
    expect(article.blocks.length).toBeGreaterThan(4);
    // Paragraph text is the publisher's own, not a summary of it.
    const paragraphs = article.blocks.filter((b) => b.type === 'paragraph');
    expect(paragraphs.length).toBeGreaterThan(4);
    expect((paragraphs[0] as { text: string }).text).toContain('الأهلي');
  });

  it('keeps the page’s headline but drops the outlet suffix', () => {
    const article = readerFromHtml(articlePage(longBody), 'الأهلي يحسم القمة بهدف قاتل | اليوم السابع');
    expect(article.title).toBe('الأهلي يحسم القمة بهدف قاتل');
  });

  it('drops the outlet’s own chrome instead of putting it in the story', () => {
    const article = readerFromHtml(articlePage(longBody), null);
    const images = article.blocks.filter((b) => b.type === 'image').map((b) => (b as { url: string }).url);
    // The site logo and the ad banner are not the article's images.
    expect(images.some((u) => /logo-site/.test(u))).toBe(false);
    expect(images.some((u) => /300x250/.test(u))).toBe(false);
  });

  it('reports «thin» rather than rendering an empty reader', () => {
    // A bot wall or a photo gallery: markup, almost no Arabic body.
    const article = readerFromHtml('<html><body><div id="x">قليل</div></body></html>', null);
    expect(article.readable).toBe(false);
    expect(article.reason).toBe('thin');
    expect(article.blocks).toHaveLength(0);
  });

  it('offers a video the app can open, and not an unknown player', () => {
    const withVideo = articlePage(
      `${longBody}<iframe src="https://www.youtube.com/embed/b84mGs1jG6Y"></iframe>`,
    );
    const article = readerFromHtml(withVideo, null);
    const videos = article.blocks.filter((b) => b.type === 'video');
    expect(videos).toHaveLength(1);
    expect((videos[0] as { url: string }).url).toContain('youtube.com/embed');

    // An unknown player is NOT offered: a blank WebView box is worse than the
    // source page, which the app falls back to.
    const unknownPlayer = articlePage(
      `${longBody}<iframe src="https://player.example-unknown.com/embed/1"></iframe>`,
    );
    expect(readerFromHtml(unknownPlayer, null).blocks.filter((b) => b.type === 'video')).toHaveLength(0);
  });

  it('still produces paragraphs when the structure cannot be walked', () => {
    // Readability refuses some templates; the body is real, so the reader must work
    // rather than send the reader to the browser for no reason.
    const flat = `<html><body><div>${longBody.replace(/<\/?p>/g, ' ')}</div></body></html>`;
    const article = readerFromHtml(flat, null);
    expect(article.readable).toBe(true);
    expect(article.blocks.filter((b) => b.type === 'paragraph').length).toBeGreaterThan(0);
  });
});
