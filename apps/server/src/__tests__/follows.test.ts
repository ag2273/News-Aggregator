import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import {
  getFollowedSources,
  followSource,
  unfollowSource,
  _resetFollowsCache,
} from '../follows.js';
import { getArticlesByFollowedSources } from '../ingest.js';
import { createToken } from '../auth.js';
import { createUser, _resetUsersCache } from '../users.js';
import { insertArticles } from '../db.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOLLOWS_FILE = path.resolve(__dirname, '../../../data/follows.json');
const USERS_FILE = path.resolve(__dirname, '../../../data/users.json');

describe('T5 follows store and endpoints', () => {
  const testUserId = 'test-user-uuid-123';
  let token: string;

  beforeEach(() => {
    if (fs.existsSync(FOLLOWS_FILE)) fs.unlinkSync(FOLLOWS_FILE);
    if (fs.existsSync(USERS_FILE)) fs.unlinkSync(USERS_FILE);
    _resetFollowsCache();
    _resetUsersCache();

    createUser({
      id: testUserId,
      email: 'follower@example.com',
      passwordHash: 'dummy',
      createdAt: Date.now(),
    });
    token = createToken(testUserId);
  });

  describe('pure follows store logic', () => {
    it('starts with empty follows for any user', () => {
      expect(getFollowedSources(testUserId)).toEqual([]);
    });

    it('follows sources idempotently', () => {
      followSource(testUserId, 'youm7');
      expect(getFollowedSources(testUserId)).toEqual(['youm7']);

      // Following again does not duplicate
      followSource(testUserId, 'youm7');
      expect(getFollowedSources(testUserId)).toEqual(['youm7']);

      followSource(testUserId, 'shorouk');
      expect(getFollowedSources(testUserId)).toContain('youm7');
      expect(getFollowedSources(testUserId)).toContain('shorouk');
    });

    it('unfollows sources idempotently', () => {
      followSource(testUserId, 'youm7');
      followSource(testUserId, 'masrawy');
      expect(getFollowedSources(testUserId)).toHaveLength(2);

      unfollowSource(testUserId, 'youm7');
      expect(getFollowedSources(testUserId)).toEqual(['masrawy']);

      // Unfollowing non-followed or already-unfollowed source is safe
      unfollowSource(testUserId, 'youm7');
      expect(getFollowedSources(testUserId)).toEqual(['masrawy']);
    });
  });

  describe('pure feed filtering (getArticlesByFollowedSources)', () => {
    it('returns empty array when sourceIds is empty', () => {
      expect(getArticlesByFollowedSources([])).toEqual([]);
    });

    it('filters articles to only matching followed sourceIds', () => {
      // Seed test articles
      const articles: Article[] = [
        {
          id: 'art-1',
          title: 'Youm7 News',
          summary: 'sum',
          imageUrl: null,
          url: 'http://youm7.com/1',
          sourceId: 'youm7',
          sourceName: 'اليوم السابع',
          category: 'egypt',
          country: 'EG',
          publishedAt: 1000,
          isBreaking: false,
        },
        {
          id: 'art-2',
          title: 'Ahram News',
          summary: 'sum',
          imageUrl: null,
          url: 'http://ahram.com/2',
          sourceId: 'ahram',
          sourceName: 'الأهرام',
          category: 'egypt',
          country: 'EG',
          publishedAt: 2000,
          isBreaking: false,
        },
      ];
      insertArticles(articles);

      const followed = getArticlesByFollowedSources(['youm7']);
      expect(followed.some((a) => a.sourceId === 'youm7')).toBe(true);
      expect(followed.every((a) => a.sourceId === 'youm7')).toBe(true);
    });
  });

  describe('/api/follows endpoints', () => {
    it('requires Bearer token on all endpoints', async () => {
      const getRes = await app.request('/api/follows');
      expect(getRes.status).toBe(401);

      const putRes = await app.request('/api/follows/youm7', { method: 'PUT' });
      expect(putRes.status).toBe(401);

      const delRes = await app.request('/api/follows/youm7', { method: 'DELETE' });
      expect(delRes.status).toBe(401);

      const feedRes = await app.request('/api/feed/following');
      expect(feedRes.status).toBe(401);
    });

    it('GET /api/follows returns followed sources list', async () => {
      const res = await app.request('/api/follows', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.sourceIds).toEqual([]);
    });

    it('PUT /api/follows/:sourceId follows a valid source or returns 404 for unknown', async () => {
      // Known source (e.g. youm7)
      const res = await app.request('/api/follows/youm7', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as any;
      expect(body.data.sourceIds).toContain('youm7');

      // Unknown source
      const badRes = await app.request('/api/follows/unknown-source-xyz', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(badRes.status).toBe(404);
    });

    it('DELETE /api/follows/:sourceId unfollows a source', async () => {
      await app.request('/api/follows/youm7', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      const del = await app.request('/api/follows/youm7', {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(del.status).toBe(200);
      const delBody = (await del.json()) as any;
      expect(delBody.data.sourceIds).not.toContain('youm7');
    });

    it('GET /api/feed/following returns articles from followed sources or empty when none', async () => {
      // Initially no follows -> empty array
      const emptyFeed = await app.request('/api/feed/following', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(emptyFeed.status).toBe(200);
      const emptyBody = (await emptyFeed.json()) as any;
      expect(emptyBody.data).toEqual([]);

      // Follow youm7
      await app.request('/api/follows/youm7', {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
      });

      const feed = await app.request('/api/feed/following', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(feed.status).toBe(200);
      const feedBody = (await feed.json()) as any;
      expect(Array.isArray(feedBody.data)).toBe(true);
      if (feedBody.data.length > 0) {
        expect(feedBody.data.every((a: any) => a.sourceId === 'youm7')).toBe(true);
      }
    });
  });
});
