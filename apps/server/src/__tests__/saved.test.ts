import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import {
  getSavedArticleIds,
  isArticleSaved,
  saveArticle,
  unsaveArticle,
  _resetSavedCache,
} from '../saved.js';
import { createToken } from '../auth.js';
import { createUser, _resetUsersCache } from '../users.js';
import { insertArticles } from '../db.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const SAVED_FILE = path.join(DATA_DIR, 'saved.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

describe('T6 saved articles store and endpoints', () => {
  const testUserId = 'test-user-saved-123';
  let token: string;

  const testArticle1: Article = {
    id: 'test-art-1',
    title: 'First Test Article',
    summary: 'Summary 1',
    imageUrl: null,
    url: 'https://example.com/art1',
    sourceId: 'youm7',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt: 1000,
    isBreaking: false,
  };

  const testArticle2: Article = {
    id: 'test-art-2',
    title: 'Second Test Article',
    summary: 'Summary 2',
    imageUrl: null,
    url: 'https://example.com/art2',
    sourceId: 'shorouk',
    sourceName: 'الشروق',
    category: 'tech',
    country: 'EG',
    publishedAt: 2000,
    isBreaking: false,
  };

  beforeEach(() => {
    try { fs.rmSync(SAVED_FILE, { force: true }); } catch {}
    try { fs.rmSync(USERS_FILE, { force: true }); } catch {}
    _resetSavedCache();
    _resetUsersCache();

    insertArticles([testArticle1, testArticle2]);

    createUser({
      id: testUserId,
      email: 'saver@example.com',
      passwordHash: 'dummy',
      createdAt: Date.now(),
      emailVerified: true,
    });
    token = createToken(testUserId);
  });

  describe('pure saved store logic', () => {
    it('starts with empty saved list for any user', () => {
      expect(getSavedArticleIds(testUserId)).toEqual([]);
      expect(isArticleSaved(testUserId, 'test-art-1')).toBe(false);
    });

    it('saves articles idempotently and newest first', () => {
      saveArticle(testUserId, 'test-art-1');
      expect(getSavedArticleIds(testUserId)).toEqual(['test-art-1']);
      expect(isArticleSaved(testUserId, 'test-art-1')).toBe(true);

      // Save again should not duplicate
      saveArticle(testUserId, 'test-art-1');
      expect(getSavedArticleIds(testUserId)).toEqual(['test-art-1']);

      // Save second article -> should be at the front (newest saved first)
      saveArticle(testUserId, 'test-art-2');
      expect(getSavedArticleIds(testUserId)).toEqual(['test-art-2', 'test-art-1']);
    });

    it('unsaves articles idempotently', () => {
      saveArticle(testUserId, 'test-art-1');
      saveArticle(testUserId, 'test-art-2');

      unsaveArticle(testUserId, 'test-art-1');
      expect(getSavedArticleIds(testUserId)).toEqual(['test-art-2']);
      expect(isArticleSaved(testUserId, 'test-art-1')).toBe(false);

      // Unsave again is safe
      unsaveArticle(testUserId, 'test-art-1');
      expect(getSavedArticleIds(testUserId)).toEqual(['test-art-2']);
    });
  });

  describe('/api/saved endpoints', () => {
    it('requires Bearer token on all endpoints', async () => {
      const getRes = await app.request('/api/saved');
      expect(getRes.status).toBe(401);

      const statusRes = await app.request('/api/saved/test-art-1');
      expect(statusRes.status).toBe(401);

      const putRes = await app.request('/api/saved/test-art-1', { method: 'PUT' });
      expect(putRes.status).toBe(401);

      const delRes = await app.request('/api/saved/test-art-1', { method: 'DELETE' });
      expect(delRes.status).toBe(401);
    });

    it('PUT /api/saved/:articleId saves an existing article or returns 404', async () => {
      // 404 for unknown article
      const badRes = await app.request('/api/saved/non-existent-article-id', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(badRes.status).toBe(404);

      // 200 for valid article
      const goodRes = await app.request('/api/saved/test-art-1', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(goodRes.status).toBe(200);
      const body = (await goodRes.json()) as any;
      expect(body.data.saved).toBe(true);
    });

    it('GET /api/saved/:articleId returns saved boolean status', async () => {
      const beforeRes = await app.request('/api/saved/test-art-1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(beforeRes.status).toBe(200);
      expect((await beforeRes.json()) as any).toEqual({ data: { saved: false } });

      await app.request('/api/saved/test-art-1', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      const afterRes = await app.request('/api/saved/test-art-1', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(afterRes.status).toBe(200);
      expect((await afterRes.json()) as any).toEqual({ data: { saved: true } });
    });

    it('GET /api/saved returns full article objects in newest-saved-first order', async () => {
      // Save art1 then art2
      await app.request('/api/saved/test-art-1', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      await app.request('/api/saved/test-art-2', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      const res = await app.request('/api/saved', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe('test-art-2');
      expect(body.data[0].title).toBe('Second Test Article');
      expect(body.data[1].id).toBe('test-art-1');
      expect(body.data[1].title).toBe('First Test Article');
    });

    it('DELETE /api/saved/:articleId unsaves an article and empties the list', async () => {
      await app.request('/api/saved/test-art-1', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      const delRes = await app.request('/api/saved/test-art-1', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(delRes.status).toBe(200);

      const listRes = await app.request('/api/saved', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const listBody = (await listRes.json()) as any;
      expect(listBody.data).toEqual([]);
    });
  });
});
