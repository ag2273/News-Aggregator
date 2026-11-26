import { describe, it, expect, beforeEach } from 'vitest';
import { extractOgImage, isNotAPhoto, enrichImages, pickCandidates, _resetImageEnrich } from '../imageEnrich.js';
import type { StoredArticle } from '../db.js';

const NOW = 1_800_000_000_000;
const row = (i: number, over: Partial<StoredArticle> = {}): StoredArticle => ({
  id: `id${i}`,
  title: `خبر ${i}`,
  summary: null,
  imageUrl: null,
  url: `https://news.google.com/rss/articles/tok${i}`,
  sourceId: 'dostor',
  sourceName: 'الدستور',
  category: 'misc',
  country: 'eg',
  publishedAt: NOW - i * 60_000,
  isBreaking: false,
  fetchedAt: NOW,
  ...over,
});
const page = (img: string) =>
  `<html><head><title>x</title><meta content="${img}" property="og:image"></head><body><img src="/logo.png"></body></html>`;

beforeEach(() => _resetImageEnrich());

describe('extractOgImage', () => {
  it('reads og:image in either attribute order and makes it absolute', () => {
    expect(extractOgImage('<head><meta property="og:image" content="/up/1.jpg"></head>', 'https://www.dostor.org/5000')).toBe(
      'https://www.dostor.org/up/1.jpg',
    );
    expect(extractOgImage(page('https://img.test/a.jpg?w=1&amp;h=2'), 'https://x.test/')).toBe('https://img.test/a.jpg?w=1&h=2');
  });
  it('falls back to twitter:image, and skips logos', () => {
    const html =
      '<head><meta property="og:image" content="https://x.test/images/site-logo.png">' +
      '<meta name="twitter:image" content="https://x.test/uploads/fire.jpg"></head>';
    expect(extractOgImage(html, 'https://x.test/')).toBe('https://x.test/uploads/fire.jpg');
  });
  it('ignores the body and returns null when the head has no image', () => {
    expect(extractOgImage('<head></head><body><meta property="og:image" content="https://x.test/a.jpg"></body>', 'https://x.test/')).toBeNull();
  });
  it('rejects Google artwork and icons', () => {
    expect(isNotAPhoto('https://lh3.googleusercontent.com/abc=s0-w300')).toBe(true);
    expect(isNotAPhoto('https://x.test/favicon.ico')).toBe(true);
    expect(isNotAPhoto('https://x.test/uploads/2026/11/fire.jpg')).toBe(false);
  });
});

describe('pickCandidates', () => {
  it('takes only recent imageless rows, newest first, up to the limit', () => {
    const rows = [row(1), row(2, { imageUrl: 'https://x/a.jpg' }), row(3), row(4, { publishedAt: NOW - 3 * 86_400_000 })];
    expect(pickCandidates(rows, NOW, 10).map((r) => r.id)).toEqual(['id1', 'id3']);
    expect(pickCandidates(rows, NOW, 1).map((r) => r.id)).toEqual(['id1']);
  });
});

describe('enrichImages', () => {
  it('stores the publisher image, two pages at a time, and does not retry soon', async () => {
    const rows = [row(1), row(2), row(3)];
    let inFlight = 0;
    let peak = 0;
    let saved = new Map<string, string | null>();
    const deps = {
      now: () => NOW,
      resolve: async (u: string) => u.replace('https://news.google.com/rss/articles/', 'https://www.dostor.org/'),
      fetchHtml: async (u: string) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return { ok: true, text: page(`${u}/photo.jpg`) };
      },
      save: (m: ReadonlyMap<string, string | null>) => {
        saved = new Map(m);
        return m.size;
      },
    };
    expect(await enrichImages(rows, deps)).toBe(3);
    expect(peak).toBe(2);
    expect(saved.get(rows[0]!.url)).toBe('https://www.dostor.org/tok1/photo.jpg');
    // Tried already: a second pass right away fetches nothing.
    let fetched = 0;
    await enrichImages(rows, { ...deps, fetchHtml: async () => (fetched++, { ok: true, text: '' }) });
    expect(fetched).toBe(0);
  });

  it("treats one image on two different pages as the outlet's default", async () => {
    const rows = [row(1), row(2), row(3)];
    let saved = new Map<string, string | null>();
    await enrichImages(rows, {
      now: () => NOW,
      resolve: async (u: string) => u.replace('https://news.google.com/rss/articles/', 'https://www.dostor.org/'),
      fetchHtml: async (u: string) => ({
        ok: true,
        text: page(u.endsWith('tok3') ? 'https://x.test/real.jpg' : 'https://x.test/share-card.jpg'),
      }),
      save: (m) => {
        saved = new Map(m);
        return m.size;
      },
    });
    expect(saved.get(rows[0]!.url)).toBeNull();
    expect(saved.get(rows[1]!.url)).toBeNull();
    expect(saved.get(rows[2]!.url)).toBe('https://x.test/real.jpg');
  });

  it('does not call two links to the same page a default', async () => {
    const rows = [row(1), row(2)];
    let saved = new Map<string, string | null>();
    await enrichImages(rows, {
      now: () => NOW,
      resolve: async () => 'https://www.dostor.org/same',
      fetchHtml: async () => ({ ok: true, text: page('https://x.test/fire.jpg') }),
      save: (m) => {
        saved = new Map(m);
        return m.size;
      },
    });
    expect([...saved.values()]).toEqual(['https://x.test/fire.jpg', 'https://x.test/fire.jpg']);
  });

  it('survives a failing resolve or fetch', async () => {
    const got = await enrichImages([row(1), row(2)], {
      now: () => NOW,
      resolve: async (u) => (u.endsWith('1') ? null : u),
      fetchHtml: async () => {
        throw new Error('boom');
      },
      save: () => 0,
    });
    expect(got).toBe(0);
  });
});
