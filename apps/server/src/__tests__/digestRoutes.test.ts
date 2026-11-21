/**
 * Digest HTTP surface: the newest digest filtered to the reader's topics, the
 * topic preference, and a build route that only the admin can trigger.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { createUser, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import { hashAdminPassword } from '../adminReactions.js';
import {
  saveDigest,
  _resetDigestCache,
  setTopics,
  DEFAULT_TOPICS,
  type StoredDigest,
} from '../digestStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const HASH_FILE = path.join(DATA_DIR, 'admin-password.hash');
const PASSWORD = 'test-admin-pass-123';

function reset(): void {
  for (const f of ['users.json', 'digests.json', 'admin-password.hash']) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetDigestCache();
  delete process.env['ADMIN_PASSWORD_HASH_FILE'];
}

function seedDigest(): void {
  const item = (id: string, category: string, breaking = false) => ({
    articleId: id,
    title: `خبر ${id}`,
    url: `https://example.com/${id}`,
    sourceName: 'الجزيرة',
    sourceId: 'aljazeera',
    category: category as never,
    summary: 'ملخص الخبر',
    why: 'سبب الأهمية',
    isBreaking: breaking,
    publishedAt: Date.now(),
    textSource: 'full' as const,
  });
  const digest: StoredDigest = {
    slot: '2026-11-21T09:00',
    builtAt: Date.now(),
    considered: 5,
    analysed: 5,
    failedSources: {},
    model: 'test-model',
    items: [item('e1', 'egypt'), item('s1', 'sports'), item('t1', 'tech', true)],
  };
  saveDigest(digest);
}

function signedIn(): string {
  const user = createUser({
    id: 'digest-user-1',
    email: 'digest@secret-domain.example',
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: true,
  });
  return createToken(user.id);
}

beforeEach(reset);

describe('digest routes', () => {
  it('serves the newest digest to a guest with the default topics', async () => {
    seedDigest();
    const res = await app.request('/api/digest');
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as {
      data: { slot: string; stale: boolean; topics: string[]; items: Array<{ articleId: string }> };
    };
    expect(data.slot).toBe('2026-11-21T09:00');
    expect(data.stale).toBe(false);
    // Sport is off by default, so its story is not in a guest digest.
    expect(data.items.map((i) => i.articleId)).not.toContain('s1');
    expect(data.topics).toEqual(DEFAULT_TOPICS);
  });

  it('returns an empty, explicitly stale digest before the first build', async () => {
    const res = await app.request('/api/digest');
    const { data } = (await res.json()) as { data: { stale: boolean; items: unknown[] } };
    // The app must show its "not yet" state, never a blank page with no flag.
    expect(data.stale).toBe(true);
    expect(data.items).toEqual([]);
  });

  it("filters to the signed-in reader's topics", async () => {
    seedDigest();
    const token = signedIn();
    await app.request('/api/digest/topics', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['sports'] }),
    });
    const res = await app.request('/api/digest', { headers: { Authorization: `Bearer ${token}` } });
    const { data } = (await res.json()) as { data: { items: Array<{ articleId: string }> } };
    expect(data.items.map((i) => i.articleId)).toContain('s1');
    expect(data.items.map((i) => i.articleId)).not.toContain('e1');
  });

  it('reports the available topics and the defaults', async () => {
    const token = signedIn();
    const res = await app.request('/api/digest/topics', { headers: { Authorization: `Bearer ${token}` } });
    const { data } = (await res.json()) as { data: { topics: string[]; available: string[]; defaults: string[] } };
    expect(data.available).toContain('egypt');
    expect(data.available).toContain('sports');
    expect(data.defaults).not.toContain('sports');
  });

  it('rejects a topic body that is not an array', async () => {
    const token = signedIn();
    const res = await app.request('/api/digest/topics', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: 'egypt' }),
    });
    expect(res.status).toBe(400);
  });

  it('keeps topics per reader', async () => {
    seedDigest();
    const token = signedIn();
    await app.request('/api/digest/topics', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ topics: ['tech'] }),
    });
    const mine = await app.request('/api/digest', { headers: { Authorization: `Bearer ${token}` } });
    const theirs = await app.request('/api/digest');
    const a = (await mine.json()) as { data: { items: Array<{ articleId: string }> } };
    const b = (await theirs.json()) as { data: { items: Array<{ articleId: string }> } };
    expect(a.data.items.map((i) => i.articleId)).toEqual(['t1']);
    expect(b.data.items.map((i) => i.articleId)).not.toEqual(['t1']);
  });

  it('requires auth to change topics', async () => {
    const res = await app.request('/api/digest/topics', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topics: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('refuses a build when the admin page is disabled', async () => {
    // No hash configured means the route is closed, not open.
    const res = await app.request('/api/digest/build', { method: 'POST' });
    expect(res.status).toBe(503);
  });

  it('refuses a build without admin credentials', async () => {
    fs.writeFileSync(HASH_FILE, hashAdminPassword(PASSWORD));
    process.env['ADMIN_PASSWORD_HASH_FILE'] = HASH_FILE;
    const res = await app.request('/api/digest/build', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('puts a breaking story first in the served digest', async () => {
    seedDigest();
    const res = await app.request('/api/digest');
    const { data } = (await res.json()) as { data: { items: Array<{ articleId: string; isBreaking: boolean }> } };
    expect(data.items[0].articleId).toBe('t1');
    expect(data.items[0].isBreaking).toBe(true);
  });

  it('tracks the origin of each summary, so the UI cannot overstate', async () => {
    seedDigest();
    const res = await app.request('/api/digest');
    const { data } = (await res.json()) as { data: { items: Array<{ textSource: string }> } };
    expect(data.items.every((i) => i.textSource === 'full')).toBe(true);
  });

  it('never leaks an identity through the digest payload', async () => {
    seedDigest();
    const token = signedIn();
    const res = await app.request('/api/digest', { headers: { Authorization: `Bearer ${token}` } });
    const body = await res.text();
    expect(body).not.toContain('digest@secret-domain.example');
    expect(body).not.toContain('digest-user-1');
  });
});
