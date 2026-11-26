/**
 * The SQLite backend of the article store (news.db).
 *
 * The rest of the suite runs on the json backend (its fixtures reset the store by
 * deleting news.json), so this file pins the sqlite one on its own data dir: the
 * one-time import of news.json, inserts and prunes that survive a restart, and the
 * migration writing only what it changed.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-sqlite-'));
let db: typeof import('../db.js');

const row = (i: number, publishedAt = 1_700_000_000_000 + i) => ({
  id: `id${i}`,
  title: `عنوان الخبر رقم ${i}`,
  summary: null,
  imageUrl: null,
  url: `https://example.test/${i}`,
  sourceId: 'youm7',
  sourceName: 'اليوم السابع',
  category: 'politics',
  country: 'eg',
  publishedAt,
  isBreaking: false,
  fetchedAt: 1,
});

beforeAll(async () => {
  process.env['DATA_DIR'] = dir;
  process.env['NEWS_STORE'] = 'sqlite';
  // An existing deployment: a news.json with rows, no news.db yet.
  fs.writeFileSync(path.join(dir, 'news.json'), JSON.stringify([row(1), row(2)]));
  db = await import('../db.js');
});

afterAll(() => {
  db._resetDbCache();
  delete process.env['NEWS_STORE'];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('sqlite article store', () => {
  it('imports news.json on the first boot and keeps the file', () => {
    expect(db.getAllArticles().map((a) => a.id).sort()).toEqual(['id1', 'id2']);
    expect(fs.existsSync(path.join(dir, 'news.db'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'news.json'))).toBe(true);
  });

  it('keeps inserted rows across a restart, and ignores a url it already has', () => {
    expect(db.insertArticles([row(3), row(1)])).toBe(1);
    db._resetDbCache();
    expect(db.getAllArticles().map((a) => a.id).sort()).toEqual(['id1', 'id2', 'id3']);
    expect(db.findArticleById('id3')?.title).toBe('عنوان الخبر رقم 3');
  });

  it('does not re-import news.json once the database has rows', () => {
    fs.writeFileSync(path.join(dir, 'news.json'), JSON.stringify([row(9)]));
    db._resetDbCache();
    expect(db.findArticleById('id9')).toBeNull();
  });

  it('persists a prune, keeping the protected ids', () => {
    db.insertArticles([row(4, 10), row(5, 20)]);
    const removed = db.pruneArticles(1_000, new Set(['id5']));
    expect(removed).toBe(1);
    db._resetDbCache();
    const ids = db.getAllArticles().map((a) => a.id);
    expect(ids).toContain('id5');
    expect(ids).not.toContain('id4');
  });

  it('writes the migration back: a decoded title survives the next boot', () => {
    db.insertArticles([{ ...row(6), title: 'الأهلي &amp; الزمالك' }]);
    db._resetDbCache();
    expect(db.findArticleById('id6')?.title).toBe('الأهلي & الزمالك');
  });

  it('stores a found picture in place, without a store version bump, and keeps it across a restart', () => {
    db.insertArticles([row(7)]);
    const before = db.getStoreVersion();
    const live = db.findArticleById('id7');
    expect(db.setArticleImages(new Map([['https://example.test/7', 'https://img.test/7.jpg']]))).toBe(1);
    expect(db.getStoreVersion()).toBe(before);
    expect(live?.imageUrl).toBe('https://img.test/7.jpg');
    expect(db.setArticleImages(new Map([['https://example.test/7', 'https://img.test/7.jpg']]))).toBe(0);
    db._resetDbCache();
    expect(db.findArticleById('id7')?.imageUrl).toBe('https://img.test/7.jpg');
  });
});
