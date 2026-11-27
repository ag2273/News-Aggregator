// The story's own pictures in the reader, without ads (#57 follow-up).
import { describe, it, expect } from 'vitest';
import { readerFromHtml, imageSource, finishImages } from '../reader.js';
import type { ReaderBlock } from '../reader.js';

const para = (i: number) =>
  `<p>سجل الأهلي هدف الفوز في الدقيقة ${70 + i} من عمر المباراة بعد هجمة منظمة قادها لاعبو الوسط، وسط حضور جماهيري كبير في استاد القاهرة الدولي مساء اليوم.</p>`;
const page = (body: string) => `<!doctype html><html dir="rtl"><head><title>خبر</title>
  <meta property="og:image" content="/upload/lead.jpg" /></head><body><article>${body}</article></body></html>`;
const urls = (blocks: ReaderBlock[]) => blocks.filter((b) => b.type === 'image').map((b) => (b as { url: string }).url);

describe('imageSource', () => {
  it('reads the lazy-loaded photo behind a placeholder src', () => {
    expect(imageSource(' src="data:image/gif;base64,R0lG" data-src="/up/1.jpg"')).toBe('/up/1.jpg');
    expect(imageSource(' src="/img/lazy-load.png" data-original="https://c.test/2.jpg"')).toBe('https://c.test/2.jpg');
    expect(imageSource(' src="/img/blank.gif" srcset="/a-300.jpg 300w, /a-900.jpg 900w"')).toBe('/a-900.jpg');
    expect(imageSource(' src="https://c.test/3.jpg"')).toBe('https://c.test/3.jpg');
    expect(imageSource(' src="data:image/gif;base64,R0lG"')).toBeNull();
  });
});

describe('finishImages', () => {
  it('makes images absolute, drops ads and duplicates, keeps text in order', () => {
    const blocks: ReaderBlock[] = [
      { type: 'image', url: '/upload/lead.jpg', caption: null },
      { type: 'paragraph', text: 'نص' },
      { type: 'image', url: 'https://tpc.googlesyndication.com/simgad/123.jpg', caption: null },
      { type: 'image', url: 'https://www.youm7.com/ads/banner-1.jpg', caption: null },
      { type: 'image', url: '/upload/lead-300x200.jpg', caption: null },
      { type: 'image', url: '/upload/second.jpg', caption: 'تعليق' },
    ];
    const out = finishImages(blocks, 'https://www.youm7.com/story/2026/11/26/1');
    expect(urls(out)).toEqual(['https://www.youm7.com/upload/lead.jpg', 'https://www.youm7.com/upload/second.jpg']);
    expect(out[1]).toEqual({ type: 'paragraph', text: 'نص' });
  });
});

describe('reader extraction with lazy images', () => {
  it("keeps the body's lazy photo and puts the og lead first when the body has none before the text", () => {
    const body = Array.from({ length: 4 }, (_, i) => para(i)).join('') +
      '<figure><img src="data:image/gif;base64,R0lG" data-src="https://c.test/inline.jpg" width="800" height="450"></figure>' +
      Array.from({ length: 4 }, (_, i) => para(i + 4)).join('') +
      '<img src="https://c.test/share.png" width="32" height="32">';
    const article = readerFromHtml(page(body), null);
    const found = urls(finishImages(article.blocks, 'https://c.test/story/1'));
    expect(found).toEqual(['https://c.test/upload/lead.jpg', 'https://c.test/inline.jpg']);
  });
});
