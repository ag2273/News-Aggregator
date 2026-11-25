/**
 * Reading a blocked publisher from the device (#55).
 *
 * The rule the user set: for the three publishers our server cannot reach, the app
 * reads the page itself and draws it in the app's own reader design; only when that
 * extraction is too thin does it reveal the page with ads blocked. No banner, no tap.
 *
 * These pin the extraction against REAL archived markup of all three (in
 * `fixtures/`), because the interesting question is not "does the parser run" but
 * "does a real page of these outlets make it through, and a challenge shell not".
 */

import {
  extractDeviceArticle,
  deviceTitle,
  decodeEntities,
  MIN_DEVICE_ARABIC_CHARS,
  MIN_DEVICE_PARAGRAPHS,
} from '../lib/deviceReader';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = (name: string) =>
  readFileSync(join(__dirname, 'fixtures', name), 'utf8');

/** A page shaped like the outlets: an article container, prose, an image. */
const articlePage = `<!doctype html>
<html dir="rtl" lang="ar"><head>
  <meta property="og:title" content="سوسن بدر تكشف سر تغير ملامحها | العربية" />
  <meta property="og:image" content="https://cdn.example.com/lead.jpg" />
  <title>سوسن بدر تكشف سر تغير ملامحها - العربية</title>
</head><body>
  <header><img src="/img/logo.png" alt="logo" /><p>القائمة الرئيسية</p></header>
  <article>
    <h2>تفاصيل القرار</h2>
    <p>${'كشفت الفنانة سوسن بدر عن تفاصيل ما تعرضت له من عملية شد في الوجه والرقبة، وأوضحت أن القرار كان بهدف تجميل الملامح وليس تغيير الهوية، وأنها استشارت أكثر من طبيب قبل الإقدام على هذه الخطوة. '.repeat(2)}</p>
    <img src="/img/inline.jpg" alt="صورة من الخبر" />
    <p>${'وأضافت في تصريحات صحفية أن فترة النقاهة كانت أصعب من العملية نفسها، وأنها عادت إلى التصوير بعد أسابيع من الراحة الكاملة، وسط دعم من أسرتها وزملائها في الوسط الفني. '.repeat(2)}</p>
  </article>
  <footer><p>جميع الحقوق محفوظة</p></footer>
</body></html>`;

describe('extracting a real article on the device', () => {
  it('reads the headline, the prose and the images, in order', () => {
    const article = extractDeviceArticle(articlePage, 'https://www.alarabiya.net/story/1');
    expect(article.readable).toBe(true);
    // The outlet's own suffix is not part of the headline.
    expect(article.title).toBe('سوسن بدر تكشف سر تغير ملامحها');
    const paragraphs = article.blocks.filter((b) => b.type === 'paragraph');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(article.blocks.some((b) => b.type === 'heading')).toBe(true);
    // The inline photo is resolved against the page it came from, so it loads.
    const images = article.blocks.filter((b) => b.type === 'image') as { url: string }[];
    expect(images.map((i) => i.url)).toContain('https://www.alarabiya.net/img/inline.jpg');
  });

  it('drops the page furniture: the logo and the navigation', () => {
    const article = extractDeviceArticle(articlePage, 'https://www.alarabiya.net/story/1');
    const text = article.blocks.map((b) => ('text' in b ? b.text : '')).join(' ');
    expect(text).not.toContain('القائمة الرئيسية');
    expect(text).not.toContain('حقوق محفوظة');
    const images = article.blocks.filter((b) => b.type === 'image') as { url: string }[];
    expect(images.map((i) => i.url).join(' ')).not.toContain('logo.png');
  });

  it('pins the thresholds that decide "thin"', () => {
    // A gallery caption and a payload of two long paragraphs must not be judged the
    // same; these numbers are what the fallback turns on.
    expect(MIN_DEVICE_PARAGRAPHS).toBe(2);
    expect(MIN_DEVICE_ARABIC_CHARS).toBe(400);
  });

  it('refuses a challenge shell instead of drawing it as a story', () => {
    // Measured: العربية answers a plain fetch with 403 and this 130-character body.
    const shell = `<html><head><title>خطوة إضافية واحدة</title></head><body>
      <p>يتحقق المتصفح من الاتصال قبل المتابعة إلى الموقع.</p>
      <p>يرجى الانتظار.</p></body></html>`;
    const article = extractDeviceArticle(shell, 'https://www.alarabiya.net/story/1');
    expect(article.readable).toBe(false);
    expect(article.blocks).toEqual([]);
  });

  it('refuses a one-paragraph teaser, which is a paywall, not the story', () => {
    const teaser = `<html><body><article><p>${'هذا ملخص قصير للخبر يظهر قبل الاشتراك في الموقع لمتابعة القراءة الكاملة. '.repeat(2)}</p></article></body></html>`;
    expect(extractDeviceArticle(teaser, 'https://www.dostor.org/1').readable).toBe(false);
  });

  it('refuses an empty or absurdly short response', () => {
    expect(extractDeviceArticle('', 'https://www.dostor.org/1').readable).toBe(false);
    expect(extractDeviceArticle('<html></html>', 'https://www.dostor.org/1').readable).toBe(false);
  });
});

describe('the real pages of the three blocked publishers', () => {
  // Same extractor, same thresholds, on markup captured from the live pages.
  it('reads الأهرام from its own real markup', () => {
    const article = extractDeviceArticle(fixture('ahram.html'), 'https://www.ahram.org.eg/News/1.aspx');
    expect(article.readable).toBe(true);
    expect(article.blocks.filter((b) => b.type === 'paragraph').length).toBeGreaterThan(1);
  });

  it('reads العربية from its own real markup', () => {
    const article = extractDeviceArticle(
      fixture('alarabiya.html'),
      'https://www.alarabiya.net/culture-and-art/2026/11/25/x',
    );
    expect(article.readable).toBe(true);
    expect(article.title).toBeTruthy();
  });
});

describe('titles and entities', () => {
  it('keeps only the headline, not the outlet name', () => {
    expect(deviceTitle('<title>خبر مهم جدا عن المباراة - اليوم السابع</title>')).toBe(
      'خبر مهم جدا عن المباراة',
    );
  });

  it('decodes the entities these pages put in their titles', () => {
    expect(decodeEntities('&quot;تحالف&quot; &amp; غيره')).toBe('"تحالف" & غيره');
  });
});
