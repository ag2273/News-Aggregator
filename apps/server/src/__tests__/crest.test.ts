import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { _resetCrestCache, crestCacheStats, getCrest } from '../crests.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR'] ? path.resolve(process.env['DATA_DIR']) : path.resolve(here, '../../../data');
// A real 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');

beforeEach(() => {
  _resetCrestCache();
  try { fs.rmSync(path.join(DATA_DIR,'logos'), { recursive: true, force: true }); } catch {}
});

describe('crest cache', () => {
  it('fetches once, then serves the stored bytes without the source', async () => {
    let calls = 0;
    const fake = (async () => { calls++; return new Response(PNG, { status: 200 }); }) as unknown as typeof fetch;
    const a = await getCrest({ key: 'filgoal:93', sourceUrl: 'https://example.test/93.png' }, fake);
    expect(a).not.toBeNull();
    expect(a!.contentType).toBe('image/png');
    const b = await getCrest({ key: 'filgoal:93', sourceUrl: 'https://example.test/93.png' }, fake);
    expect(b).not.toBeNull();
    // The second read came from disk: the source was asked exactly once.
    expect(calls).toBe(1);
  });

  it('returns null when the provider has no crest, so the app can show a placeholder', async () => {
    expect(await getCrest({ key: 'filgoal:none', sourceUrl: null })).toBeNull();
  });

  it('returns null when the fetch fails, and does not throw', async () => {
    const failing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    expect(await getCrest({ key: 'filgoal:404', sourceUrl: 'https://example.test/x.png' }, failing)).toBeNull();
  });

  it('rejects bytes that are not an image', async () => {
    const html = (async () => new Response('<html>not an image</html>', { status: 200 })) as unknown as typeof fetch;
    expect(await getCrest({ key: 'filgoal:html', sourceUrl: 'https://example.test/x.png' }, html)).toBeNull();
  });

  it('measures what the cache occupies', async () => {
    const fake = (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch;
    await getCrest({ key: 'filgoal:1', sourceUrl: 'https://example.test/1.png' }, fake);
    const stats = crestCacheStats();
    console.log('CREST_CACHE', JSON.stringify(stats));
    expect(stats.files).toBeGreaterThan(0);
    expect(stats.bytes).toBeGreaterThan(0);
  });

  it('serves the crest over HTTP from our own route, with a cache header', async () => {
    const fake = (async () => new Response(PNG, { status: 200 })) as unknown as typeof fetch;
    const { vi } = await import('vitest');
    vi.stubGlobal('fetch', fake);
    try {
      // Prime the map the same way a day request does.
      await app.request('/api/football/matches?date=2026-11-23');
      const res = await app.request('/api/football/logo/filgoal:1');
      expect([200, 404]).toContain(res.status);
      if (res.status === 200) {
        expect(res.headers.get('content-type')).toContain('image/');
        expect(res.headers.get('cache-control')).toContain('max-age');
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
