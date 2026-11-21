/**
 * Digest AI pass: prompt shape, JSON tolerance, retries, privacy headers, and the
 * cost property that matters most — one model call per STORY, not per reader.
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeStory,
  analyzeCandidates,
  parseVerdict,
  normalizeTopic,
  loadApiKey,
  DEFAULT_KEY_FILE,
  AI_USER_AGENT,
  SYSTEM_PROMPT,
  MAX_CANDIDATES,
  AI_ATTEMPTS,
} from '../digestAi.js';

const STORY = {
  title: 'مقتل 7 مدنيين وإصابة 4 آخرين في هجمات أوكرانية على لوغانسك',
  sourceName: 'آر تي عربي',
  text: 'قتل سبعة مدنيين وأصيب أربعة آخرون في هجمات على منطقة لوغانسك خلال اليوم، حسب ما أعلنت السلطات المحلية.',
};

const GOOD_REPLY = JSON.stringify({
  important: true,
  category: 'misc',
  summary: 'مقتل 7 مدنيين وإصابة 4 في هجمات على لوغانسك، حسب السلطات المحلية.',
  why: 'خبر أمني ميداني من حرب مستمرة تتابعها المنطقة.',
});

/** A fetch that answers with one chat completion. */
function aiFetch(reply: string, status = 200, usage = { prompt_tokens: 2500, completion_tokens: 140 }) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: reply } }],
        usage,
      }),
      { status },
    ) as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('digestAi: key loading', () => {
  it('prefers the env var, then the mounted file', () => {
    const before = process.env['COMMANDCODE_API_KEY'];
    process.env['COMMANDCODE_API_KEY'] = '  key-from-env  ';
    expect(loadApiKey()).toBe('key-from-env');
    if (before === undefined) delete process.env['COMMANDCODE_API_KEY'];
    else process.env['COMMANDCODE_API_KEY'] = before;
  });

  it('returns null (never throws) when there is no key', () => {
    const before = process.env['COMMANDCODE_API_KEY'];
    delete process.env['COMMANDCODE_API_KEY'];
    expect(loadApiKey('/definitely/not/here')).toBeNull();
    if (before !== undefined) process.env['COMMANDCODE_API_KEY'] = before;
  });

  it('points at the mounted secret by default', () => {
    expect(DEFAULT_KEY_FILE).toBe('/data/secrets/commandcode-api-key');
  });
});

describe('digestAi: parsing model replies', () => {
  it('parses a plain JSON reply', () => {
    expect(parseVerdict(GOOD_REPLY)).toEqual({
      important: true,
      category: 'misc',
      summary: expect.any(String),
      why: expect.any(String),
    });
  });

  it('tolerates a fenced code block', () => {
    expect(parseVerdict('```json\n' + GOOD_REPLY + '\n```')?.important).toBe(true);
  });

  it('tolerates a sentence before the JSON', () => {
    expect(parseVerdict('إليك التحليل:\n' + GOOD_REPLY)?.summary).toContain('لوغانسك');
  });

  it('rejects a reply with no usable summary', () => {
    expect(parseVerdict('{"important":true,"category":"misc"}')).toBeNull();
    expect(parseVerdict('not json at all')).toBeNull();
    expect(parseVerdict('')).toBeNull();
  });

  it('coerces an unknown category to misc and truncates long fields', () => {
    const v = parseVerdict(
      JSON.stringify({ important: false, category: 'weather', summary: 'س'.repeat(900), why: 'و'.repeat(900) }),
    );
    expect(v?.category).toBe('misc');
    expect(v?.summary.length).toBeLessThanOrEqual(400);
    expect(v?.why.length).toBeLessThanOrEqual(240);
  });

  it('only accepts the six real topics', () => {
    expect(normalizeTopic('egypt')).toBe('egypt');
    expect(normalizeTopic('sports')).toBe('sports');
    expect(normalizeTopic('politics')).toBe('misc');
    expect(normalizeTopic(undefined)).toBe('misc');
  });
});

describe('digestAi: the request', () => {
  it('sends the article text, a real User-Agent and zero-data-retention', async () => {
    const { impl, calls } = aiFetch(GOOD_REPLY);
    await analyzeStory(STORY, { apiKey: 'test-key', fetchImpl: impl });
    const [{ url, init }] = calls;
    const headers = init.headers as Record<string, string>;
    expect(url).toContain('/chat/completions');
    expect(headers['Authorization']).toBe('Bearer test-key');
    expect(headers['User-Agent']).toBe(AI_USER_AGENT);
    // Cloudflare answers 403/1010 to a default agent, so this header is required.
    expect(headers['User-Agent']).toContain('news-aggregator');
    expect(headers['x-cmd-zdr']).toBe('1');
    const body = JSON.parse(String(init.body)) as { messages: Array<{ role: string; content: string }> };
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(body.messages[1].content).toContain(STORY.text);
  });

  it('never puts an identity in the prompt', async () => {
    const { impl, calls } = aiFetch(GOOD_REPLY);
    await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    const body = String(calls[0].init.body);
    expect(body).not.toMatch(/user-?id|install|@|Bearer test-key.*Bearer/i);
    expect(body).not.toContain('test-key');
  });

  it('returns no verdict and no error when there is no key', async () => {
    const { impl, calls } = aiFetch(GOOD_REPLY);
    await expect(analyzeStory(STORY, { apiKey: null, fetchImpl: impl })).resolves.toMatchObject({
      verdict: null,
      error: 'no API key',
    });
    expect(calls).toHaveLength(0);
  });

  it('reports token usage so cost can be logged', async () => {
    const { impl } = aiFetch(GOOD_REPLY);
    const res = await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    expect(res.usage).toEqual({ prompt: 2500, completion: 140 });
  });

  it('retries a 429, then succeeds', async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      if (n === 1) return new Response('busy', { status: 429 }) as Response;
      return new Response(JSON.stringify({ choices: [{ message: { content: GOOD_REPLY } }] }), {
        status: 200,
      }) as Response;
    }) as unknown as typeof fetch;
    const res = await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    expect(res.verdict?.important).toBe(true);
    expect(n).toBe(2);
  });

  it('gives up after a bounded number of retries', async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      return new Response('busy', { status: 503 }) as Response;
    }) as unknown as typeof fetch;
    const res = await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    expect(res.verdict).toBeNull();
    expect(res.error).toContain('503');
    expect(n).toBe(AI_ATTEMPTS);
  });

  it('does not retry a permanent 400 (that would pay twice)', async () => {
    let n = 0;
    const impl = (async () => {
      n += 1;
      return new Response('bad request', { status: 400 }) as Response;
    }) as unknown as typeof fetch;
    await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    expect(n).toBe(1);
  });

  it('survives a thrown request', async () => {
    const impl = (async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    const res = await analyzeStory(STORY, { apiKey: 'k', fetchImpl: impl });
    expect(res.verdict).toBeNull();
    expect(res.error).toContain('network down');
  });
});

describe('digestAi: cost is one call per story, not per reader', () => {
  it('makes exactly one successful call per story', async () => {
    const { impl, calls } = aiFetch(GOOD_REPLY);
    const stories = Array.from({ length: 7 }, (_, i) => ({ ...STORY, title: `${STORY.title} ${i}` }));
    const out = await analyzeCandidates(stories, { apiKey: 'k', fetchImpl: impl, concurrency: 3 });
    expect(out).toHaveLength(7);
    expect(calls).toHaveLength(7);
    expect(out.every((o) => o.result.verdict?.important)).toBe(true);
  });

  it('caps candidates so a digest stays short and affordable', () => {
    expect(MAX_CANDIDATES).toBeLessThanOrEqual(30);
  });
});
