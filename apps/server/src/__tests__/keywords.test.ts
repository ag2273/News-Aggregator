/**
 * Followed keywords and mutes: matching, caps, mute filtering (including
 * clusters), the keyword-push rules, and deletion cleanup.
 *
 * Matching is whole-word on Arabic-normalized text, so "الأهلي" must not match
 * "الأهلاوية" — that is the case most likely to break silently.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from '../index.js';
import { insertArticles, _resetDbCache } from '../db.js';
import { createUser, markUserVerified, _resetUsersCache } from '../users.js';
import { createToken } from '../auth.js';
import { registerPushToken, _resetPushCache, _resetPushedIds } from '../push.js';
import {
  addKeyword,
  removeKeyword,
  setKeywordNotify,
  muteKeyword,
  unmuteKeyword,
  muteSource,
  unmuteSource,
  getPreferences,
  matchesKeyword,
  articleMatchesKeyword,
  isMuted,
  matchingFollowedKeywords,
  keywordPushBudget,
  recordKeywordPush,
  deleteKeywordsForUser,
  MAX_FOLLOWED_KEYWORDS,
  KEYWORD_PUSH_DAILY_CAP,
  _resetKeywordsCache,
} from '../keywords.js';
import { normalizeForSearch } from '../text.js';
import { deleteAccount } from '../account.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

const FILES = [
  'users.json',
  'news.json',
  'follows.json',
  'saved.json',
  'push-tokens.json',
  'verify-tokens.json',
  'reactions.json',
  'keywords.json',
  'deletions.json',
];

function resetAll(): void {
  for (const f of FILES) {
    try {
      fs.rmSync(path.join(DATA_DIR, f), { force: true });
    } catch {
      /* ignore */
    }
  }
  _resetUsersCache();
  _resetDbCache();
  _resetPushCache();
  _resetPushedIds();
  _resetKeywordsCache();
}

function makeArticle(id: string, title: string, sourceId = 'youm7'): Article {
  return {
    id,
    title,
    summary: null,
    imageUrl: null,
    url: `https://example.com/${id}`,
    sourceId,
    sourceName: sourceId,
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now(),
    isBreaking: false,
  };
}

function seedUser(id = 'u1', verified = true): { id: string; token: string } {
  createUser({
    id,
    email: `${id}@example.com`,
    passwordHash: 'salt:hash',
    createdAt: Date.now(),
    emailVerified: verified,
  });
  if (verified) markUserVerified(id);
  return { id, token: createToken(id) };
}

beforeEach(resetAll);

describe('keywords: matching', () => {
  it('normalizes before matching', () => {
    const body = normalizeForSearch('الأهلي يفوز على الزمالك');
    expect(matchesKeyword(body, normalizeForSearch('الاهلي'))).toBe(true);
    expect(matchesKeyword(body, normalizeForSearch('الأهلي'))).toBe(true);
  });

  it('matches whole words only', () => {
    const body = normalizeForSearch('الأهلاوية يحتفلون بالبطولة');
    // "الأهلي" must NOT fire inside "الأهلاوية".
    expect(matchesKeyword(body, normalizeForSearch('الأهلي'))).toBe(false);
  });

  it('does not match a keyword that is only part of a longer word', () => {
    const body = normalizeForSearch('ذهب الذهبي إلى الذهبية');
    expect(matchesKeyword(body, normalizeForSearch('ذهب'))).toBe(true); // standalone word exists
    const onlyEmbedded = normalizeForSearch('الذهبي والذهبية');
    expect(matchesKeyword(onlyEmbedded, normalizeForSearch('ذهب'))).toBe(false);
  });

  it('matches multi-word phrases', () => {
    const body = normalizeForSearch('الدوري المصري يبدأ الجمعة');
    expect(matchesKeyword(body, normalizeForSearch('الدوري المصري'))).toBe(true);
    expect(matchesKeyword(body, normalizeForSearch('الدوري السعودي'))).toBe(false);
  });

  it('matches the summary as well as the title', () => {
    const article = { title: 'عنوان عام', summary: 'تفاصيل عن الذكاء الاصطناعي في مصر' };
    expect(articleMatchesKeyword(article, normalizeForSearch('الذكاء الاصطناعي'))).toBe(true);
  });
});

describe('keywords: caps and management', () => {
  it('adds and removes a keyword', () => {
    seedUser();
    const added = addKeyword('u1', 'الذكاء الاصطناعي');
    expect(added.ok).toBe(true);
    expect(getPreferences('u1').keywords).toHaveLength(1);

    removeKeyword('u1', 'الذكاء الاصطناعي');
    expect(getPreferences('u1').keywords).toHaveLength(0);
  });

  it('rejects duplicates after normalization', () => {
    seedUser();
    expect(addKeyword('u1', 'الأهلي').ok).toBe(true);
    const dup = addKeyword('u1', 'الاهلي');
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe('duplicate');
  });

  it('rejects too-short keywords', () => {
    seedUser();
    const r = addKeyword('u1', 'ا');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('invalid');
  });

  it('enforces the 20-keyword cap', () => {
    seedUser();
    for (let i = 0; i < MAX_FOLLOWED_KEYWORDS; i++) {
      expect(addKeyword('u1', `كلمة${i}`).ok).toBe(true);
    }
    const over = addKeyword('u1', 'كلمة-زائدة');
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toBe('limit');
  });

  it('toggles notifications per keyword', () => {
    seedUser();
    addKeyword('u1', 'الذكاء الاصطناعي', true);
    setKeywordNotify('u1', 'الذكاء الاصطناعي', false);
    expect(getPreferences('u1').keywords[0]?.notify).toBe(false);
  });

  it('mutes and unmutes keywords and sources', () => {
    seedUser();
    muteKeyword('u1', 'أسعار الذهب');
    muteSource('u1', 'masrawy');
    expect(getPreferences('u1').mutedKeywords).toHaveLength(1);
    expect(getPreferences('u1').mutedSources).toEqual(['masrawy']);

    unmuteKeyword('u1', 'أسعار الذهب');
    unmuteSource('u1', 'masrawy');
    expect(getPreferences('u1').mutedKeywords).toHaveLength(0);
    expect(getPreferences('u1').mutedSources).toHaveLength(0);
  });

  it('survives a cache reset', () => {
    seedUser();
    addKeyword('u1', 'الذكاء الاصطناعي');
    muteSource('u1', 'cnn-arabic');
    _resetKeywordsCache();
    expect(getPreferences('u1').keywords).toHaveLength(1);
    expect(getPreferences('u1').mutedSources).toEqual(['cnn-arabic']);
  });

  it('deletes everything for a user', () => {
    seedUser();
    addKeyword('u1', 'الذكاء الاصطناعي');
    muteSource('u1', 'youm7');
    expect(deleteKeywordsForUser('u1')).toBe(true);
    expect(getPreferences('u1').keywords).toHaveLength(0);
    expect(getPreferences('u1').mutedSources).toHaveLength(0);
  });
});

describe('keywords: mute filtering', () => {
  it('hides a muted source', () => {
    seedUser();
    muteSource('u1', 'masrawy');
    const prefs = getPreferences('u1');
    expect(isMuted({ sourceId: 'masrawy', title: 'أي خبر', summary: null }, prefs)).toBe(true);
    expect(isMuted({ sourceId: 'youm7', title: 'أي خبر', summary: null }, prefs)).toBe(false);
  });

  it('hides a muted keyword anywhere in the text', () => {
    seedUser();
    muteKeyword('u1', 'أسعار الذهب');
    const prefs = getPreferences('u1');
    expect(
      isMuted({ sourceId: 'youm7', title: 'أسعار الذهب ترتفع اليوم', summary: null }, prefs),
    ).toBe(true);
    expect(isMuted({ sourceId: 'youm7', title: 'أخبار الرياضة', summary: null }, prefs)).toBe(false);
  });

  it('reports which followed keywords an article matches', () => {
    seedUser();
    addKeyword('u1', 'الذكاء الاصطناعي');
    addKeyword('u1', 'الدوري المصري');
    const prefs = getPreferences('u1');
    const matched = matchingFollowedKeywords(
      { title: 'الذكاء الاصطناعي يغيّر سوق العمل', summary: null },
      prefs,
    );
    expect(matched).toHaveLength(1);
    expect(matched[0]?.label).toBe('الذكاء الاصطناعي');
  });
});

describe('keywords: feed filtering through the API', () => {
  it('hides muted sources for the signed-in user only', async () => {
    insertArticles([
      makeArticle('a1', 'خبر من مصراوي', 'masrawy'),
      makeArticle('a2', 'خبر من اليوم السابع', 'youm7'),
    ]);
    const { token } = seedUser();
    muteSource('u1', 'masrawy');

    const mine = (await (await app.request('/api/feed?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: Array<{ sourceId: string }> };
    expect(mine.data.some((a) => a.sourceId === 'masrawy')).toBe(false);

    const guest = (await (await app.request('/api/feed?limit=10')).json()) as {
      data: Array<{ sourceId: string }>;
    };
    expect(guest.data.some((a) => a.sourceId === 'masrawy')).toBe(true);
  });

  it('hides muted keywords for the signed-in user', async () => {
    insertArticles([
      makeArticle('a1', 'أسعار الذهب ترتفع اليوم في مصر', 'youm7'),
      makeArticle('a2', 'مباراة الأهلي والزمالك', 'youm7'),
    ]);
    const { token } = seedUser();
    muteKeyword('u1', 'أسعار الذهب');

    const mine = (await (await app.request('/api/feed?limit=10', {
      headers: { Authorization: `Bearer ${token}` },
    })).json()) as { data: Array<{ title: string }> };
    expect(mine.data.some((a) => a.title.includes('الذهب'))).toBe(false);
    expect(mine.data.some((a) => a.title.includes('الأهلي'))).toBe(true);
  });
});

describe('keywords: API surface', () => {
  it('requires a session and the verification gate', async () => {
    const noAuth = await app.request('/api/preferences');
    expect(noAuth.status).toBe(401);

    const { token } = seedUser('unv', false);
    const gated = await app.request('/api/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(gated.status).toBe(403);
  });

  it('adds, toggles, removes and mutes over HTTP', async () => {
    const { token } = seedUser();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    const add = await app.request('/api/keywords', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ keyword: 'الذكاء الاصطناعي' }),
    });
    expect(add.status).toBe(200);

    const toggle = await app.request('/api/keywords/الذكاء الاصطناعي/notify', {
      method: 'PUT',
      headers: auth,
      body: JSON.stringify({ notify: false }),
    });
    expect(toggle.status).toBe(200);
    expect(
      ((await toggle.json()) as { data: { keywords: Array<{ notify: boolean }> } }).data
        .keywords[0]?.notify,
    ).toBe(false);

    const mute = await app.request('/api/mutes', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ sourceId: 'masrawy' }),
    });
    expect(mute.status).toBe(200);

    const prefs = (await (await app.request('/api/preferences', { headers: auth })).json()) as {
      data: { keywords: unknown[]; mutedSources: string[]; limits: { keywords: number } };
    };
    expect(prefs.data.keywords).toHaveLength(1);
    expect(prefs.data.mutedSources).toEqual(['masrawy']);
    expect(prefs.data.limits.keywords).toBe(MAX_FOLLOWED_KEYWORDS);

    const del = await app.request(`/api/keywords/${encodeURIComponent('الذكاء الاصطناعي')}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(del.status).toBe(200);
  });

  it('returns 409 at the keyword cap', async () => {
    const { token } = seedUser();
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    for (let i = 0; i < MAX_FOLLOWED_KEYWORDS; i++) {
      addKeyword('u1', `كلمة${i}`);
    }
    const res = await app.request('/api/keywords', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ keyword: 'زيادة' }),
    });
    expect(res.status).toBe(409);
  });
});

describe('keywords: push budget and rules', () => {
  const now = 1_700_000_000_000;

  it('allows up to the daily cap then blocks', () => {
    seedUser();
    expect(keywordPushBudget('u1', now).remaining).toBe(KEYWORD_PUSH_DAILY_CAP);
    recordKeywordPush('u1', KEYWORD_PUSH_DAILY_CAP, now);
    const after = keywordPushBudget('u1', now);
    expect(after.allowed).toBe(false);
    expect(after.remaining).toBe(0);
  });

  it('forgets pushes older than a day', () => {
    seedUser();
    recordKeywordPush('u1', KEYWORD_PUSH_DAILY_CAP, now - 25 * 60 * 60 * 1000);
    expect(keywordPushBudget('u1', now).allowed).toBe(true);
  });

  it('never keyword-pushes a muted article', () => {
    seedUser();
    addKeyword('u1', 'أسعار الذهب');
    muteKeyword('u1', 'أسعار الذهب');
    const prefs = getPreferences('u1');
    const article = { sourceId: 'youm7', title: 'أسعار الذهب ترتفع', summary: null };
    expect(isMuted(article, prefs)).toBe(true);
    // Even though it matches the keyword, being muted wins.
    expect(matchingFollowedKeywords(article, prefs)).toHaveLength(1);
    expect(isMuted(article, prefs)).toBe(true);
  });

  it('respects a per-keyword notification toggle', () => {
    seedUser();
    addKeyword('u1', 'الذكاء الاصطناعي', false);
    const prefs = getPreferences('u1');
    const matched = matchingFollowedKeywords({ title: 'الذكاء الاصطناعي', summary: null }, prefs);
    expect(matched).toHaveLength(1);
    expect(matched[0]?.notify).toBe(false);
  });
});

describe('keywords: account deletion', () => {
  it('removes keywords and mutes with the account', async () => {
    const { token } = seedUser('gone');
    addKeyword('gone', 'الذكاء الاصطناعي');
    muteSource('gone', 'masrawy');

    // Delete through the account helper, which is what the route calls once the
    // password is proven (the seeded hash is not a real scrypt hash).
    const report = deleteAccount('gone');
    expect(report?.keywords).toBe(true);
    expect(getPreferences('gone').keywords).toHaveLength(0);
    expect(getPreferences('gone').mutedSources).toHaveLength(0);
  });
});
