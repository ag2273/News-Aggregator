// The reader route, as the APP calls it (#52).
//
// The first build accepted only `?url=`, while the app sent `?id=`, so every article
// answered 400 and fell through to the browser — which is why the user reported that
// reader mode never opened. This test drives the route exactly the way the app does,
// so that mismatch cannot come back.

import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../index.js';
import { insertArticles, _resetDbCache } from '../db.js';
import { resetReaderCache } from '../readerService.js';
import { resetCleanCache } from '../cleanPageService.js';

const article = (id: string) => ({
  id,
  title: 'خبر حقيقي للاختبار',
  summary: null,
  imageUrl: null,
  url: 'https://www.example.com/story/1',
  sourceId: 'youm7',
  sourceName: 'اليوم السابع',
  category: 'sports',
  country: 'EG',
  publishedAt: Date.now(),
  isBreaking: false,
});

beforeEach(() => {
  insertArticles([article('a1')]);
  _resetDbCache();
  resetReaderCache();
  resetCleanCache();
});

describe('GET /api/articles/reader', () => {
  it('accepts the article id the app sends, not just a url', async () => {
    // The bug: `?id=` answered 400 ("url must be http(s)") for every article.
    const res = await app.request('/api/articles/reader?id=a1');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { readable: boolean } };
    // The network is not reachable in a unit test, so `readable` is false — what
    // matters is that the route ACCEPTED the id and answered in the shape the app
    // expects instead of a 400.
    expect(typeof json.data.readable).toBe('boolean');
  });

  it('answers an unknown id truthfully instead of failing the request', async () => {
    const res = await app.request('/api/articles/reader?id=nope');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { readable: boolean; reason?: string } };
    expect(json.data.readable).toBe(false);
    expect(json.data.reason).toBe('unreachable');
  });

  it('still accepts a bare url for surfaces that have no stored id', async () => {
    const res = await app.request(
      `/api/articles/reader?url=${encodeURIComponent('https://www.example.com/story/2')}`,
    );
    expect(res.status).toBe(200);
  });

  it('refuses a non-http url rather than fetching something else', async () => {
    const res = await app.request('/api/articles/reader?url=file:///etc/passwd');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/articles/clean', () => {
  it('refuses a non-http url', async () => {
    const res = await app.request('/api/articles/clean?url=javascript:alert(1)');
    expect(res.status).toBe(400);
  });

  it('reports a publisher it cannot reach instead of serving an ad-laden page', async () => {
    // Measured in production: dostor.org resets TLS from this host. The route must
    // say so, and the app turns that into a plain note.
    const res = await app.request(
      `/api/articles/clean?url=${encodeURIComponent('https://this-host-does-not-exist.invalid/x')}`,
    );
    expect(res.status).toBe(502);
    const json = (await res.json()) as { code?: string };
    expect(json.code).toBe('NOT_REACHABLE');
  });
});
