/**
 * The boot migration runs in the background in the server: the store answers as
 * loaded, and the fixes land once the slices are done. (The rest of the suite runs it
 * synchronously; this file runs it the way production does.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-migrate-'));
const savedEnv = process.env['NODE_ENV'];
let db: typeof import('../db.js');

const row = (i: number, title: string) => ({
  id: `m${i}`, title, summary: null, imageUrl: null, url: `https://example.test/m${i}`,
  sourceId: 'youm7', sourceName: 'اليوم السابع', category: 'politics', country: 'eg',
  publishedAt: 1_700_000_000_000 - i, isBreaking: false, fetchedAt: 1,
});

beforeAll(async () => {
  process.env['DATA_DIR'] = dir;
  process.env['NEWS_STORE'] = 'sqlite';
  process.env['NODE_ENV'] = 'production';
  const rows = Array.from({ length: 1000 }, (_, i) => row(i, `خبر عادي عن ${['الطقس', 'الاقتصاد', 'التعليم', 'الصحة'][i % 4]} في المحافظات`));
  rows[500] = row(500, 'الأهلي &amp; الزمالك');
  fs.writeFileSync(path.join(dir, 'news.json'), JSON.stringify(rows));
  db = await import('../db.js');
});

afterAll(() => {
  process.env['NODE_ENV'] = savedEnv;
  delete process.env['NEWS_STORE'];
  db._resetDbCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('background boot migration', () => {
  it('serves the store before the migration, then applies it and persists it', async () => {
    expect(db.getAllArticles()).toHaveLength(1000);
    // Not yet migrated: the load did not wait for it.
    expect(db.findArticleById('m500')?.title).toBe('الأهلي &amp; الزمالك');
    // A row inserted while the migration runs must survive it.
    db.insertArticles([{ ...row(2000, 'خبر جديد أثناء الترحيل') }]);
    const before = db.getStoreVersion();

    expect(await db.whenMigrated()).toBe(true);
    expect(db.findArticleById('m500')?.title).toBe('الأهلي & الزمالك');
    expect(db.findArticleById('m2000')).not.toBeNull();
    expect(db.getAllArticles()).toHaveLength(1001);
    expect(db.getStoreVersion()).toBeGreaterThan(before);

    // Persisted: the next boot reads the fixed row.
    db._resetDbCache();
    expect(db.findArticleById('m500')?.title).toBe('الأهلي & الزمالك');
    expect(await db.whenMigrated()).toBe(false);
  });
});
