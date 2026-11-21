/**
 * Digest storage and building: Cairo slot timing, candidate selection, the
 * previous-digest-on-failure rule, and per-reader topic filtering.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  slotKeyFor,
  dueSlot,
  slotDueAt,
  saveDigest,
  latestDigest,
  digestForSlot,
  topicsFor,
  setTopics,
  digestForTopics,
  allDigests,
  DEFAULT_TOPICS,
  DIGEST_ITEMS,
  KEEP_DIGESTS,
  CAIRO_OFFSET_MS,
  _resetDigestCache,
  type StoredDigest,
} from '../digestStore.js';
import {
  selectCandidates,
  groupByStory,
  buildDigest,
  describeBuild,
  MAX_PER_SOURCE,
} from '../digest.js';
import type { Article } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');

function reset(): void {
  try {
    fs.rmSync(path.join(DATA_DIR, 'digests.json'), { force: true });
  } catch {
    /* ignore */
  }
  _resetDigestCache();
}

/** A UTC instant that is 09:00 in Cairo. */
const AT_09 = Date.UTC(2026, 10, 21, 7, 0); // 09:00 Cairo (UTC+2)
const AT_18 = Date.UTC(2026, 10, 21, 16, 0); // 18:00 Cairo

beforeEach(reset);

describe('digestStore: Cairo slots', () => {
  it('keys a slot by the Cairo local date and time', () => {
    expect(slotKeyFor(AT_09, '09:00')).toBe('2026-11-21T09:00');
    expect(slotKeyFor(AT_18, '18:00')).toBe('2026-11-21T18:00');
    // 22:30 UTC is already the next Cairo day.
    expect(slotKeyFor(Date.UTC(2026, 10, 21, 22, 30), '09:00')).toBe('2026-11-22T09:00');
  });

  it('reports the most recent due slot, and none before 09:00', () => {
    // 06:00 Cairo — nothing is due yet.
    expect(dueSlot(Date.UTC(2026, 10, 21, 4, 0))).toBeNull();
    // 10:00 Cairo — the morning slot.
    expect(dueSlot(Date.UTC(2026, 10, 21, 8, 0))?.slot).toBe('09:00');
    // 19:00 Cairo — the evening slot wins.
    expect(dueSlot(Date.UTC(2026, 10, 21, 17, 0))?.slot).toBe('18:00');
    // 23:59 Cairo — still evening, same day key.
    expect(dueSlot(Date.UTC(2026, 10, 21, 21, 59))?.key).toBe('2026-11-21T18:00');
  });

  it('computes when a slot became due, in real time', () => {
    expect(slotDueAt(AT_09 + 3_600_000, '09:00')).toBe(AT_09);
    expect(slotDueAt(AT_18, '18:00')).toBe(AT_18);
    // The difference is the Cairo offset, not zero.
    expect(CAIRO_OFFSET_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('a slot fires once: the same key is returned for the whole window', () => {
    // The scheduler idempotency depends on this.
    const early = dueSlot(Date.UTC(2026, 10, 21, 7, 1))?.key;
    const late = dueSlot(Date.UTC(2026, 10, 21, 8, 55))?.key;
    expect(early).toBe(late);
  });
});

describe('digestStore: storage', () => {
  function digest(slot: string, items: StoredDigest['items'] = []): StoredDigest {
    return {
      slot,
      builtAt: Date.now(),
      considered: 10,
      analysed: 10,
      failedSources: {},
      model: 'test',
      items,
    };
  }

  it('returns the newest digest as the one to serve', () => {
    saveDigest(digest('2026-11-21T09:00'));
    saveDigest(digest('2026-11-21T18:00'));
    expect(latestDigest()?.slot).toBe('2026-11-21T18:00');
    expect(digestForSlot('2026-11-21T09:00')?.slot).toBe('2026-11-21T09:00');
  });

  it('replaces the same slot instead of duplicating it', () => {
    saveDigest(digest('2026-11-21T09:00', []));
    saveDigest(digest('2026-11-21T09:00', []));
    expect(allDigests()).toHaveLength(1);
  });

  it('prunes old digests so the file stays bounded', () => {
    for (let i = 0; i < KEEP_DIGESTS + 6; i += 1) {
      const day = String(10 + i).padStart(2, '0');
      saveDigest(digest(`2026-11-${day}T09:00`));
    }
    expect(allDigests().length).toBe(KEEP_DIGESTS);
    // The newest survived.
    expect(latestDigest()?.slot).toContain('2026-11-');
  });

  it('returns null (not an error) when nothing was ever built', () => {
    expect(latestDigest()).toBeNull();
  });
});

describe('digestStore: topics', () => {
  it('defaults to everything except sport', () => {
    expect(DEFAULT_TOPICS).not.toContain('sports');
    expect(DEFAULT_TOPICS).toContain('egypt');
    expect(topicsFor(null)).toEqual(DEFAULT_TOPICS);
    expect(topicsFor('never-chose')).toEqual(DEFAULT_TOPICS);
  });

  it('stores a choice and drops unknown ids', () => {
    expect(setTopics('u1', ['egypt', 'sports'])).toEqual(['egypt', 'sports']);
    expect(topicsFor('u1')).toEqual(['egypt', 'sports']);
    setTopics('u1', ['egypt', 'nonsense' as never]);
    expect(topicsFor('u1')).toEqual(['egypt']);
  });

  it('respects an empty choice rather than silently re-enabling defaults', () => {
    setTopics('u2', []);
    expect(topicsFor('u2')).toEqual([]);
  });

  it("filters a digest to the reader's topics, capped", () => {
    const items = [
      ...Array.from({ length: 9 }, (_, i) => ({
        articleId: `a${i}`,
        title: `خبر ${i}`,
        url: `https://x/${i}`,
        sourceName: 'الجزيرة',
        sourceId: 'aljazeera',
        category: 'egypt' as const,
        summary: 'ملخص',
        why: 'سبب',
        isBreaking: false,
        publishedAt: 1000 - i,
        textSource: 'full' as const,
      })),
      {
        articleId: 'sport-1',
        title: 'خبر رياضي',
        url: 'https://x/s',
        sourceName: 'الجزيرة',
        sourceId: 'aljazeera',
        category: 'sports' as const,
        summary: 'ملخص',
        why: 'سبب',
        isBreaking: false,
        publishedAt: 2000,
        textSource: 'full' as const,
      },
    ];
    const digest = {
      slot: '2026-11-21T09:00',
      builtAt: 1,
      considered: 10,
      analysed: 10,
      failedSources: {},
      model: 't',
      items,
    };
    const filtered = digestForTopics(digest, ['egypt']);
    expect(filtered).toHaveLength(DIGEST_ITEMS);
    expect(filtered.some((i) => i.category === 'sports')).toBe(false);
    // Nothing for a topic with no stories.
    expect(digestForTopics(digest, ['health'])).toEqual([]);
    expect(digestForTopics(null, ['egypt'])).toEqual([]);
  });

  it('puts breaking stories first in a reader digest', () => {
    const base = {
      url: 'https://x',
      sourceName: 'الجزيرة',
      sourceId: 'aljazeera',
      category: 'egypt' as const,
      summary: 'ملخص',
      why: 'سبب',
      textSource: 'full' as const,
    };
    const digest = {
      slot: 's',
      builtAt: 1,
      considered: 2,
      analysed: 2,
      failedSources: {},
      model: 't',
      items: [
        { ...base, articleId: 'old', title: 'قديم', isBreaking: false, publishedAt: 9000 },
        { ...base, articleId: 'brk', title: 'عاجل', isBreaking: true, publishedAt: 1000 },
      ],
    };
    expect(digestForTopics(digest, ['egypt']).map((i) => i.articleId)).toEqual(['brk', 'old']);
  });
});

describe('digest: candidate selection', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0);
  function article(id: string, sourceId: string, publishedAt: number, isBreaking = false): Article {
    return {
      id,
      title: `خبر ${id}`,
      summary: 'ملخص',
      imageUrl: null,
      url: `https://x/${id}`,
      sourceId,
      sourceName: sourceId,
      category: 'egypt',
      country: 'EG',
      publishedAt,
      isBreaking,
    };
  }

  it('only takes stories inside the window', () => {
    const chosen = selectCandidates(
      [article('new', 'youm7', now - 60_000), article('old', 'youm7', now - 30 * 60 * 60 * 1000)],
      { now },
    );
    expect(chosen.map((a) => a.id)).toEqual(['new']);
  });

  it('keeps every breaking story even when a newer routine one exists', () => {
    // Selection ranks breaking first so none is squeezed out by the per-source cap,
    // then restores recency order for display.
    const chosen = selectCandidates(
      [
        article('routine', 'youm7', now - 1000),
        article('breaking', 'aljazeera', now - 5000, true),
      ],
      { now },
    );
    expect(chosen).toHaveLength(2);
    // Both survive; display order is newest-first.
    expect(chosen.map((a) => a.id)).toEqual(['routine', 'breaking']);
  });

  it('does not let a flood of routine stories crowd out a breaking one', () => {
    const routine = Array.from({ length: 20 }, (_, i) => article(`r${i}`, 'youm7', now - i * 1000));
    const chosen = selectCandidates([...routine, article('brk', 'aljazeera', now - 60_000, true)], {
      now,
      limit: 5,
    });
    // The breaking story made the cut despite being older than most.
    expect(chosen.some((a) => a.id === 'brk')).toBe(true);
  });

  it('caps one outlet so it cannot fill the digest', () => {
    const many = Array.from({ length: 12 }, (_, i) => article(`y${i}`, 'youm7', now - i * 1000));
    const chosen = selectCandidates(many, { now });
    expect(chosen.length).toBe(MAX_PER_SOURCE);
  });

  it('respects the total cap', () => {
    const many = Array.from({ length: 60 }, (_, i) => article(`a${i}`, `s${i}`, now - i * 1000));
    expect(selectCandidates(many, { now, limit: 5 })).toHaveLength(5);
  });
});

describe('digest: building and failure policy', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0);
  function article(id: string, publishedAt = now - 60_000): Article {
    return {
      id,
      title: `عنوان ${id}`,
      summary: 'مقتطف',
      imageUrl: null,
      url: `https://example.com/${id}`,
      sourceId: 'youm7',
      sourceName: 'اليوم السابع',
      category: 'egypt',
      country: 'EG',
      publishedAt,
      isBreaking: false,
    };
  }

  const fullText = async () => ({
    text: 'نص المقال الكامل '.repeat(40),
    source: 'full' as const,
    resolvedUrl: 'https://example.com',
  });

  function aiFetch(map: (title: string) => string) {
    return (async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      const prompt = body.messages[1].content;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: map(prompt) } }] }),
        { status: 200 },
      ) as Response;
    }) as unknown as typeof fetch;
  }

  const verdict = (important: boolean) =>
    JSON.stringify({ important, category: 'egypt', summary: 'ملخص الخبر', why: 'سبب الأهمية' });

  it('builds and stores a digest from important stories', async () => {
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1'), article('a2')],
      apiKey: 'k',
      fetchText: fullText,
      fetchImpl: aiFetch(() => verdict(true)),
    });
    expect(res.digest?.items).toHaveLength(2);
    expect(res.digest?.items[0].textSource).toBe('full');
    expect(latestDigest()?.slot).toBe('2026-11-21T09:00');
  });

  it('drops stories the model judges unimportant', async () => {
    let n = 0;
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1'), article('a2')],
      apiKey: 'k',
      fetchText: fullText,
      fetchImpl: aiFetch(() => verdict(n++ === 0)),
    });
    expect(res.digest?.items).toHaveLength(1);
  });

  it('keeps the previous digest when every model call fails', async () => {
    const first = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1')],
      apiKey: 'k',
      fetchText: fullText,
      fetchImpl: aiFetch(() => verdict(true)),
    });
    expect(first.digest).not.toBeNull();

    const failing = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    const second = await buildDigest({
      slot: '18:00',
      now: now + 9 * 60 * 60 * 1000,
      articles: [article('a2')],
      apiKey: 'k',
      fetchText: fullText,
      fetchImpl: failing,
    });
    expect(second.digest).toBeNull();
    expect(second.error).toContain('every model call failed');
    // The morning digest is still what the app serves.
    expect(latestDigest()?.slot).toBe('2026-11-21T09:00');
    expect(describeBuild(second, '18:00')).toContain('keeping the previous digest');
  });

  it('reports a missing key as a failure, not a crash', async () => {
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1')],
      apiKey: null,
      fetchText: fullText,
    });
    expect(res.digest).toBeNull();
    expect(res.error).toContain('every model call failed');
  });

  it('records which sources could not give full text', async () => {
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1')],
      apiKey: 'k',
      fetchText: async () => ({
        text: 'مقتطف قصير',
        source: 'snippet' as const,
        resolvedUrl: null,
        reason: 'thin',
      }),
      fetchImpl: aiFetch(() => verdict(true)),
    });
    expect(res.digest?.items[0].textSource).toBe('snippet');
    expect(res.digest?.failedSources.youm7).toBe(1);
    // The log names the source, so a silent downgrade is visible.
    expect(describeBuild(res, '09:00')).toContain('youm7:1');
  });

  it('returns no candidates rather than an empty digest', async () => {
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('old', now - 40 * 60 * 60 * 1000)],
      apiKey: 'k',
      fetchText: fullText,
    });
    expect(res.digest).toBeNull();
    expect(res.error).toBe('no candidates in the window');
  });

  it('survives a text fetch that throws', async () => {
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [article('a1')],
      apiKey: 'k',
      fetchText: async () => {
        throw new Error('boom');
      },
      fetchImpl: aiFetch(() => verdict(true)),
    });
    expect(res.digest?.items).toHaveLength(1);
    expect(res.digest?.items[0].textSource).toBe('snippet');
  });

describe('digest: cross-source repetition as an importance signal', () => {
  const now = Date.UTC(2026, 10, 21, 12, 0);
  function article(
    id: string,
    sourceId: string,
    sourceName: string,
    title: string,
    publishedAt = now - 60_000,
  ): Article {
    return {
      id,
      title,
      summary: 'ملخص',
      imageUrl: null,
      url: `https://example.com/${id}`,
      sourceId,
      sourceName,
      category: 'egypt',
      country: 'EG',
      publishedAt,
      isBreaking: false,
    };
  }

  // The same event, as three outlets worded it.
  const shared = 'مقتل 7 مدنيين وإصابة 4 آخرين في هجمات أوكرانية على لوغانسك خلال يوم';

  it('groups one story covered by three outlets into a single candidate', () => {
    const groups = groupByStory([
      article('a', 'rt-arabic', 'آر تي عربي', shared),
      article('b', 'aljazeera', 'الجزيرة', shared),
      article('c', 'skynews-arabia', 'سكاي نيوز عربية', shared),
      article('d', 'youm7', 'اليوم السابع', 'خبر مختلف تمامًا عن الاقتصاد المصري وأسعار الفائدة'),
    ]);
    expect(groups).toHaveLength(2);
    const multi = groups.find((g) => g.members.length > 1);
    expect(multi?.sourceCount).toBe(3);
    expect(multi?.members).toHaveLength(3);
    // The other outlets are available for the prompt.
    expect(multi?.otherSources.length).toBe(2);
  });

  it('sends the source count to the model, so the judgement can weigh it', async () => {
    const prompts: string[] = [];
    const aiFetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      prompts.push(body.messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  important: true,
                  category: 'misc',
                  summary: 'ملخص',
                  why: 'سبب',
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ) as Response;
    }) as unknown as typeof fetch;

    await buildDigest({
      slot: '09:00',
      now,
      articles: [
        article('a', 'rt-arabic', 'آر تي عربي', shared),
        article('b', 'aljazeera', 'الجزيرة', shared),
        article('c', 'skynews-arabia', 'سكاي نيوز عربية', shared),
      ],
      apiKey: 'k',
      fetchText: async () => ({ text: 'نص كامل '.repeat(50), source: 'full' as const, resolvedUrl: 'u' }),
      fetchImpl: aiFetch,
    });

    // One call for the story, not one per outlet.
    expect(prompts).toHaveLength(1);
    // ...and the prompt states the coverage explicitly.
    expect(prompts[0]).toContain('3 مصادر مستقلة');
  });

  it('stores one digest item per story, carrying its source count', async () => {
    const aiFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ important: true, category: 'misc', summary: 'ملخص', why: 'سبب' }),
              },
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const res = await buildDigest({
      slot: '09:00',
      now,
      articles: [
        article('a', 'rt-arabic', 'آر تي عربي', shared),
        article('b', 'aljazeera', 'الجزيرة', shared),
        article('c', 'skynews-arabia', 'سكاي نيوز عربية', shared),
      ],
      apiKey: 'k',
      fetchText: async () => ({ text: 'نص كامل '.repeat(50), source: 'full' as const, resolvedUrl: 'u' }),
      fetchImpl: aiFetch,
    });
    // The same story three times is ONE item.
    expect(res.digest?.items).toHaveLength(1);
    expect(res.digest?.items[0].sourceCount).toBe(3);
  });

  it('sends no coverage line for a story only one outlet carried', async () => {
    const prompts: string[] = [];
    const aiFetch = (async (_u: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
      prompts.push(body.messages[1].content);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ important: true, category: 'egypt', summary: 'س', why: 'و' }) } }],
        }),
        { status: 200 },
      ) as Response;
    }) as unknown as typeof fetch;
    await buildDigest({
      slot: '09:00',
      now,
      articles: [article('solo', 'youm7', 'اليوم السابع', 'خبر منفرد عن أسعار الذهب في مصر اليوم')],
      apiKey: 'k',
      fetchText: async () => ({ text: 'نص كامل '.repeat(50), source: 'full' as const, resolvedUrl: 'u' }),
      fetchImpl: aiFetch,
    });
    expect(prompts[0]).not.toContain('مصادر مستقلة');
  });

  it('does not merge two different stories that share a word', () => {
    const groups = groupByStory([
      article('a', 'youm7', 'اليوم السابع', 'ارتفاع أسعار الذهب في مصر اليوم بعد قرار البنك المركزي'),
      article('b', 'almasry', 'المصري اليوم', 'اجتماع مجلس الوزراء لمناقشة موازنة التعليم الجديدة'),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.sourceCount === 1)).toBe(true);
  });
});
});
