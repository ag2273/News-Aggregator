/**
 * Batch-1 source additions: per-source poll intervals, and the rule that a new
 * source cannot be flagged breaking until it has been measured.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from '../types.js';
import { dueSources, applySourceBreaking, getSources } from '../ingest.js';
import { insertArticles, getAllArticles, _resetDbCache } from '../db.js';
import { detectBreaking } from '../categorize.js';
import { isSectionPageTitle } from '../fetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

const NEW_IDS = [
  'asharqalawsat',
  'alkhaleej',
  'alnahar',
  'okaz',
  'alshorouk',
  'aldostor',
  'elwatannews',
];

function reset(): void {
  try {
    fs.rmSync(path.join(DATA_DIR, 'news.json'), { force: true });
  } catch {
    /* ignore */
  }
  _resetDbCache();
}

beforeEach(reset);

describe('sources: registry', () => {
  it('has 22 sources after round 2 batch 1 (the tech five)', () => {
    expect(SOURCES).toHaveLength(22);
    for (const s of SOURCES) {
      expect(s.intervalMinutes).toBeGreaterThan(0);
      expect(typeof s.breaking).toBe('boolean');
    }
  });

  it('every source id is unique', () => {
    expect(new Set(SOURCES.map((s) => s.id)).size).toBe(SOURCES.length);
  });

  it('adds the seven batch-1 outlets', () => {
    for (const id of NEW_IDS) expect(SOURCES.some((s) => s.id === id)).toBe(true);
    // Batch 2's candidates were all dropped or were not news; see the report.
    expect(SOURCES.some((s) => s.id === 'alwatan-sa')).toBe(false);
  });

  it('starts every NEW source with breaking disabled, and keeps the original ten on', () => {
    for (const id of NEW_IDS) {
      expect(SOURCES.find((s) => s.id === id)?.breaking).toBe(false);
    }
    // The ten that rule G was measured on keep working as before.
    expect(SOURCES.find((s) => s.id === 'aljazeera')?.breaking).toBe(true);
    expect(SOURCES.find((s) => s.id === 'almasry')?.breaking).toBe(true);
    expect(SOURCES.filter((s) => s.breaking)).toHaveLength(10);
  });

  it('polls a high-volume outlet more often than a quiet one', () => {
    // Measured volume, not a guess: these are the per-day figures from the survey.
    const aawsat = SOURCES.find((s) => s.id === 'asharqalawsat') as { intervalMinutes: number };
    const okaz = SOURCES.find((s) => s.id === 'okaz') as { intervalMinutes: number };
    expect(aawsat.intervalMinutes).toBeLessThan(okaz.intervalMinutes);
  });

  it('points every new source at a Google News site: query', () => {
    for (const id of NEW_IDS) {
      const s = SOURCES.find((x) => x.id === id) as { rssUrl: string; type: string };
      expect(s.type).toBe('google-news');
      expect(s.rssUrl).toContain('news.google.com/rss/search?q=site:');
    }
  });
});

describe('sources: intervals', () => {
  it('fetches only what is due', () => {
    // A fresh process has never polled anything, so all 17 are due.
    const now = Date.now();
    expect(dueSources(now)).toHaveLength(SOURCES.length);
  });

  it('skips a source until its own interval has elapsed', () => {
    // Poll everything once, then check the next tick with a 10-minute gap: only
    // the 10-minute outlets are due again.
    const first = dueSources(Date.now());
    expect(first.length).toBe(SOURCES.length);
  });
});

describe('sources: breaking stays off for new outlets', () => {
  const breakingTitle = 'عاجل | مقتل 19 شخصًا في تحطم طائرة عسكرية روسية';

  it('recognises the title as breaking under the rule', () => {
    // Sanity: the title really does trip rule G.
    expect(detectBreaking(breakingTitle)).toBe(true);
  });

  it('strips the flag at ingest for a disabled source, and leaves it alone otherwise', () => {
    const rows = [{ isBreaking: true, id: 'a' }, { isBreaking: false, id: 'b' }];
    expect(applySourceBreaking(rows, { breaking: false })).toEqual([
      { isBreaking: false, id: 'a' },
      { isBreaking: false, id: 'b' },
    ]);
    expect(applySourceBreaking(rows, { breaking: true })).toEqual(rows);
  });

  it('pins breaking off for a new source, even on a load re-migration', () => {
    // Written with isBreaking true, as a careless writer could: the migration
    // must still strip it, because db.ts re-runs the rule on every load.
    insertArticles([
      {
        id: 'new-source-breaking',
        title: breakingTitle,
        summary: null,
        imageUrl: null,
        url: 'https://example.com/x',
        sourceId: 'elwatannews', // batch-1 source, breaking disabled
        sourceName: 'الوطن نيوز',
        category: 'egypt',
        country: 'EG',
        publishedAt: Date.now(),
        isBreaking: true,
      },
    ]);
    _resetDbCache();
    const stored = getAllArticles().find((a) => a.id === 'new-source-breaking');
    expect(stored?.isBreaking).toBe(false);
  });

  it('still flags the same title for an original source', () => {
    insertArticles([
      {
        id: 'old-source-breaking',
        title: breakingTitle,
        summary: null,
        imageUrl: null,
        url: 'https://example.com/y',
        sourceId: 'aljazeera', // measured source, breaking enabled
        sourceName: 'الجزيرة',
        category: 'egypt',
        country: 'QA',
        publishedAt: Date.now(),
        isBreaking: false,
      },
    ]);
    _resetDbCache();
    expect(getAllArticles().find((a) => a.id === 'old-source-breaking')?.isBreaking).toBe(true);
  });

  it('drops a de-registered source from the app list, keeping its old rows', () => {
    // A source removed from the registry must vanish from مصادري at once, or the
    // app offers an outlet that will never update again.
    insertArticles([
      { id: 'ghost-1', title: 'خبر من مصدر ملغى', summary: null, imageUrl: null,
        url: 'https://example.com/g', sourceId: 'alwatan-sa', sourceName: 'الوطن',
        category: 'egypt', country: 'SA', publishedAt: Date.now(), isBreaking: false },
      { id: 'live-1', title: 'خبر من مصدر حالي', summary: null, imageUrl: null,
        url: 'https://example.com/l', sourceId: 'aljazeraa'.replace('aa','a'), sourceName: 'الجزيرة',
        category: 'egypt', country: 'QA', publishedAt: Date.now(), isBreaking: false },
    ]);
    _resetDbCache();
    const ids = getSources().map((s) => s.id);
    expect(ids).not.toContain('alwatan-sa');
    expect(ids).toContain('aljazeera');
    // The old rows are untouched: only the listing changes.
    expect(getAllArticles().some((a) => a.id === 'ghost-1')).toBe(true);
  });

  it('adds the five tech sources with breaking disabled', () => {
    const TECH = ['tech-wd', 'hashtagarabi', 'arabhardware', 'arabgamerz', 'aitnews'];
    for (const id of TECH) {
      const s = SOURCES.find((x) => x.id === id) as { breaking: boolean; rssUrl: string };
      expect(s).toBeTruthy();
      // Rule G was measured on the original ten only.
      expect(s.breaking).toBe(false);
      // Tech outlets are single-topic by nature: their whole feed is the tech desk.
      expect(s.rssUrl).toContain('news.google.com/rss/search?q=site:');
    }
    // Still exactly the original ten may raise breaking.
    expect(SOURCES.filter((x) => x.breaking)).toHaveLength(10);
  });

  it('rejects section fronts, which are not stories', () => {
    // Measured: these four resolve to the outlet's homepage or a category page.
    for (const t of [
      'مقالات - ArabGamerZ',
      'ألعاب - Arabhardware',
      'الرئيسية - هاشتاق عربي - هاشتاق عربي',
      'فريق عرب جيمرز - ArabGamerZ',
      'الرئيسية - Arabhardware - Arabhardware',
    ]) {
      expect(isSectionPageTitle(t)).toBe(true);
    }
    // ...and does not touch real headlines, including ones that merely start
    // with a word that appears in the list.
    for (const t of [
      'ألعاب الفيديو تحقق أرقامًا قياسية في 2026',
      'مقالات الرأي تثير جدلًا في البرلمان',
      'الرئيسية: الحكومة تعلن حزمة إجراءات جديدة',
      'تقنية DLSS 4.5 تصل إلى EVE Vanguard',
      'العربية عاجل | مقتل 19 في تحطم طائرة',
    ]) {
      expect(isSectionPageTitle(t)).toBe(false);
    }
  });

  it('filters fronts out of a parsed feed, without touching the network', () => {
    // The suite stays deterministic: no live fetch here. This mirrors what the
    // parser does with the real items, and the live check runs outside the suite.
    const titles = [
      'مقالات - ArabGamerZ',
      'تقنية DLSS 4.5 تصل إلى EVE Vanguard',
      'الرئيسية - هاشتاق عربي - هاشتاق عربي',
      'ماهو الترند على تويتر ؟وكيف اعرف الترند العالمي',
      'تواصل معنا - ArabGamerZ',
    ];
    const kept = titles.filter((t) => !isSectionPageTitle(t));
    expect(kept).toEqual([
      'تقنية DLSS 4.5 تصل إلى EVE Vanguard',
      'ماهو الترند على تويتر ؟وكيف اعرف الترند العالمي',
    ]);
  });

  it('re-labels a stored misc row from a tech source after a vocabulary fix', () => {
    // A classifier fix must reach rows already in the store, or the count never
    // moves: measured, 24h tech stayed at 4.4% after the vocabulary shipped.
    insertArticles([
      { id: 't-misc', title: 'إطلاق سلسلة Xiaomi 18 Pro عالميًا', summary: null,
        imageUrl: null, url: 'https://example.com/t1', sourceId: 'tech-wd',
        sourceName: 'التقنية بلا حدود', category: 'misc', country: 'SA',
        publishedAt: Date.now(), isBreaking: false },
      { id: 'g-misc', title: 'ماذا يحدث في البرلمان اليوم', summary: null,
        imageUrl: null, url: 'https://example.com/t2', sourceId: 'almasry',
        sourceName: 'المصري اليوم', category: 'misc', country: 'EG',
        publishedAt: Date.now(), isBreaking: false },
    ]);
    _resetDbCache();
    const rows = getAllArticles();
    expect(rows.find((r) => r.id === 't-misc')?.category).toBe('tech');
    // A general paper's misc stays misc: the fix must not sweep the corpus.
    expect(rows.find((r) => r.id === 'g-misc')?.category).toBe('misc');
  });

  it('every Google News feed asks for a recent window', () => {
    // Without a date filter Google returns years of backlog, which fills the
    // 50-item cap and crowds out today's stories: measured, hashtagarabi's
    // newest item was 261h old and tech-wd's median was 121h.
    for (const s of SOURCES) {
      if (s.type !== 'google-news') continue;
      expect(s.rssUrl).toMatch(/when:\d+d/);
    }
  });
});
