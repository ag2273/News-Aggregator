// AI second opinion on a breaking candidate, right before it becomes a push.
//
// The title rule in categorize.ts decides what is a CANDIDATE. It is cheap and
// measured, but it cannot tell an event from a statement that an outlet happened
// to label «عاجل:» (measured on 2026-11-27: «عاجل: الخطيب: التأشيرة السياحية
// السعودية من الأكثر تنافسية» went out as breaking). This pass asks the same
// model the digest uses one yes/no question per candidate.
//
// Cost: only rule-flagged articles reach it, ~2-6 a day across all sources, and
// only the title and RSS snippet are sent (no page fetch), so it is a few hundred
// tokens a day.
//
// Failure policy: when the model is unreachable, has no key, or answers
// nonsense, the rule's decision stands. The AI can only VETO an alert; an outage
// must never silence breaking news.
//
// Privacy: public article text only, no user data, `x-cmd-zdr: 1` as in digestAi.

import type { Article } from './types.js';
import {
  AI_USER_AGENT,
  DEFAULT_API_BASE,
  DEFAULT_MODEL,
  loadApiKey,
} from './digestAi.js';

export const BREAKING_SYSTEM_PROMPT = `أنت محرر أخبار عاجلة في تطبيق أخبار عربي. كل تنبيه عاجل بيرن على موبايل القارئ، فالتنبيه الغلط مزعج.

هتوصلك عنوان خبر ومقتطف منه. قرر: هل ده خبر عاجل يستاهل نقاطع القارئ بتنبيه دلوقتي؟

عاجل (true): حدث وقع للتو وله وزن كبير: هجوم أو قصف أو حادث بضحايا، كارثة طبيعية، اغتيال أو وفاة شخصية كبيرة، إعلان حرب أو هدنة أو اتفاق كبير، قرار حكومي مفاجئ يمس الناس مباشرة، تطور أمني أو سياسي إقليمي كبير.
مش عاجل (false): تصريح عادي أو رأي أو إشادة، أرقام وإحصاءات وخطط، زيارات ومواعيد مقررة، أسعار وأسواق وطقس، نفي أو تكذيب، أخبار رياضة ومنوعات، تقارير وتحليلات، حادث محلي صغير.

أعد JSON فقط بالشكل: {"breaking": true أو false}`;

export const BREAKING_AI_TIMEOUT_MS = 20_000;
export const BREAKING_AI_ATTEMPTS = 2;

/** The model's answer: true/false, or null when it could not be asked or parsed. */
export type BreakingVerdict = boolean | null;

export type ConfirmBreaking = (article: Article) => Promise<BreakingVerdict>;

export function buildBreakingPrompt(article: Pick<Article, 'title' | 'summary' | 'sourceName'>): string {
  const snippet = (article.summary ?? '').replace(/\s+/g, ' ').trim().slice(0, 600);
  return `العنوان: ${article.title}\nالمصدر: ${article.sourceName}${snippet ? `\nالمقتطف: ${snippet}` : ''}`;
}

/** Read `{"breaking": bool}` out of a reply; anything else is null. */
export function parseBreakingVerdict(reply: string): BreakingVerdict {
  if (!reply) return null;
  const start = reply.indexOf('{');
  const end = reply.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(reply.slice(start, end + 1)) as Record<string, unknown>;
      if (typeof obj['breaking'] === 'boolean') return obj['breaking'];
    } catch {
      /* fall through */
    }
  }
  const m = reply.match(/"breaking"\s*:\s*(true|false)/i);
  return m ? m[1]!.toLowerCase() === 'true' : null;
}

/**
 * Ask the model about one candidate. Never throws. Retries once on a transport
 * error, 429 or 5xx; a 4xx or an unparseable reply is final (null).
 */
export async function askBreaking(
  article: Article,
  options: { apiKey?: string | null; fetchImpl?: typeof fetch; model?: string; baseUrl?: string } = {},
): Promise<BreakingVerdict> {
  const apiKey = options.apiKey === undefined ? loadApiKey() : options.apiKey;
  if (!apiKey) return null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? process.env['BREAKING_AI_MODEL'] ?? process.env['DIGEST_AI_MODEL'] ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? process.env['DIGEST_AI_BASE'] ?? DEFAULT_API_BASE).replace(/\/$/, '');
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: BREAKING_SYSTEM_PROMPT },
      { role: 'user', content: buildBreakingPrompt(article) },
    ],
    temperature: 0,
    max_tokens: 60,
  });

  for (let attempt = 0; attempt < BREAKING_AI_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': AI_USER_AGENT,
          'x-cmd-zdr': '1',
        },
        body,
        signal: AbortSignal.timeout(BREAKING_AI_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        if (attempt < BREAKING_AI_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      return parseBreakingVerdict(json.choices?.[0]?.message?.content ?? '');
    } catch {
      if (attempt < BREAKING_AI_ATTEMPTS - 1) continue;
    }
  }
  return null;
}

/** Verdicts already paid for, so a retried push run does not ask twice. */
const verdictCache = new Map<string, BreakingVerdict>();
const VERDICT_CACHE_MAX = 2_000;

/** The default confirmer: cached `askBreaking`. Null answers are not cached. */
export const confirmBreakingWithAi: ConfirmBreaking = async (article) => {
  if (verdictCache.has(article.id)) return verdictCache.get(article.id)!;
  const verdict = await askBreaking(article);
  if (verdict !== null) {
    verdictCache.set(article.id, verdict);
    if (verdictCache.size > VERDICT_CACHE_MAX) {
      const oldest = verdictCache.keys().next().value;
      if (oldest !== undefined) verdictCache.delete(oldest);
    }
  }
  return verdict;
};

/** Tests only. */
export function _resetBreakingVerdicts(): void {
  verdictCache.clear();
}
