import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env['DATA_DIR'] = fs.mkdtempSync(path.join(os.tmpdir(), 'source-icons-'));
const mod = await import('../sourceIcons.js');
const { iconLinks, findSourceIcon, getSourceIcon, pngSize, SOURCE_COLORS, _resetSourceIcons } = mod;
const { SOURCES } = await import('../types.js');

/** A PNG header of the given size (enough for type and size detection). */
function png(side: number): Buffer {
  const b = Buffer.alloc(40);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(side, 16);
  b.writeUInt32BE(side, 20);
  return b;
}

beforeEach(() => _resetSourceIcons());

describe('source icons', () => {
  it('every source has a colour', () => {
    for (const s of SOURCES) expect(SOURCE_COLORS[s.id], s.id).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('prefers apple-touch-icon, then a large rel=icon, and skips svg and small icons', () => {
    const html =
      '<head><link rel="icon" href="/favicon-16.png" sizes="16x16"><link rel="icon" href="/i192.png" sizes="192x192">' +
      '<link rel="icon" href="/logo.svg" sizes="512x512"><link rel="apple-touch-icon" href="/apple.png"></head>';
    expect(iconLinks(html, 'https://www.youm7.com/')).toEqual(['https://www.youm7.com/apple.png', 'https://www.youm7.com/i192.png']);
  });

  it('reads a PNG size from its header', () => {
    expect(pngSize(png(180))).toEqual({ w: 180, h: 180 });
  });

  it('falls back to the favicon service, and refuses a tiny image', async () => {
    const asked: string[] = [];
    const got = await findSourceIcon('https://www.dostor.org', {
      fetchHtml: async () => ({ ok: true, text: '<head><link rel="apple-touch-icon" href="/a.png"></head>' }),
      fetchBytes: async (u) => (asked.push(u), u.includes('s2/favicons') ? png(128) : png(16)),
    });
    expect(got && pngSize(got)).toEqual({ w: 128, h: 128 });
    expect(asked[0]).toBe('https://www.dostor.org/a.png');
  });

  it('fetches once, then serves from cache; unknown sources get nothing', async () => {
    let calls = 0;
    const deps = {
      fetchHtml: async () => ({ ok: true, text: '<head><link rel="apple-touch-icon" href="/a.png"></head>' }),
      fetchBytes: async () => (calls++, png(180)),
    };
    expect((await getSourceIcon('youm7', deps))?.contentType).toBe('image/png');
    expect((await getSourceIcon('youm7', deps))?.contentType).toBe('image/png');
    expect(calls).toBe(1);
    expect(await getSourceIcon('nope', deps)).toBeNull();
  });
});
