import { describe, it, expect, beforeEach } from 'vitest';
import type { Article } from '../types.js';
import {
  askBreaking,
  buildBreakingPrompt,
  parseBreakingVerdict,
  _resetBreakingVerdicts,
} from '../breakingAi.js';

const sample: Article = {
  id: 'b1',
  title: 'عاجل | مقتل 13 جنديا بهجوم مسلحين في النيجر',
  summary: 'قتل 13 جنديا في هجوم شنه مسلحون على موقع عسكري.',
  imageUrl: null,
  url: 'https://example.com/b1',
  sourceId: 'rt-arabic',
  sourceName: 'RT',
  category: 'misc',
  country: 'RU',
  publishedAt: Date.now(),
  isBreaking: true,
};

function reply(content: string, status = 200): typeof fetch {
  return (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
      text: async () => content,
    }) as unknown as Response) as unknown as typeof fetch;
}

describe('breakingAi', () => {
  beforeEach(() => _resetBreakingVerdicts());

  it('parses plain, fenced and chatty JSON', () => {
    expect(parseBreakingVerdict('{"breaking": true}')).toBe(true);
    expect(parseBreakingVerdict('```json\n{"breaking": false}\n```')).toBe(false);
    expect(parseBreakingVerdict('الإجابة: {"breaking": true} لأن...')).toBe(true);
    expect(parseBreakingVerdict('maybe')).toBeNull();
    expect(parseBreakingVerdict('')).toBeNull();
  });

  it('sends title, source and snippet only', () => {
    const p = buildBreakingPrompt(sample);
    expect(p).toContain(sample.title);
    expect(p).toContain('RT');
    expect(p).toContain('المقتطف');
  });

  it('returns null without an API key', async () => {
    expect(await askBreaking(sample, { apiKey: null, fetchImpl: reply('{"breaking": true}') })).toBeNull();
  });

  it('returns the model verdict', async () => {
    expect(await askBreaking(sample, { apiKey: 'k', fetchImpl: reply('{"breaking": false}') })).toBe(false);
    expect(await askBreaking(sample, { apiKey: 'k', fetchImpl: reply('{"breaking": true}') })).toBe(true);
  });

  it('a provider error is null, never a veto', async () => {
    expect(await askBreaking(sample, { apiKey: 'k', fetchImpl: reply('bad', 403) })).toBeNull();
    const thrower = (async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await askBreaking(sample, { apiKey: 'k', fetchImpl: thrower })).toBeNull();
  });
});
