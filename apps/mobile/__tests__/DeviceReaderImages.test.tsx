import { deviceBlocks, imageSource } from '../lib/deviceReader';

const para = (i: number) =>
  `<p>سجل الأهلي هدف الفوز في الدقيقة ${70 + i} من عمر المباراة بعد هجمة منظمة قادها لاعبو الوسط وسط حضور جماهيري كبير.</p>`;

describe('device reader pictures (#57)', () => {
  it('reads a lazy-loaded photo', () => {
    expect(imageSource(' src="data:image/gif;base64,R0lG" data-src="/up/1.jpg"')).toBe('/up/1.jpg');
  });

  it('keeps the story photos, drops ads and tiny icons, and leads with og:image', () => {
    const html =
      '<head><meta property="og:image" content="/up/lead.jpg"></head><body><article>' +
      para(1) +
      '<img src="/img/lazy.gif" data-src="/up/inline.jpg">' +
      '<img src="https://tpc.googlesyndication.com/simgad/1.jpg">' +
      '<img src="/share.png" width="24" height="24">' +
      para(2) +
      '</article></body>';
    const images = deviceBlocks(html, 'https://www.dostor.org/5000').filter((b) => b.type === 'image');
    expect(images.map((b) => (b as { url: string }).url)).toEqual([
      'https://www.dostor.org/up/lead.jpg',
      'https://www.dostor.org/up/inline.jpg',
    ]);
  });
});
