// The AI pass: one model call per candidate story, never per user.
//
// Cost shape is the whole point: a digest of N candidates is N calls no matter
// how many readers there are, so the bill is flat as the app grows. Each call
// gets the article's text and returns a small JSON record the digest is assembled
// from.
//
// Privacy: only article text (public news) and the topic list ever leave. No
// account, email, install id or IP is attached, and `x-cmd-zdr: 1` is sent on
// every request so the provider is asked to retain nothing and train on nothing.

import fs from 'node:fs';

export const DEFAULT_API_BASE = 'https://api.commandcode.ai/provider/v1';
export const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';
export const DEFAULT_KEY_FILE = '/data/secrets/commandcode-api-key';

/**
 * A real User-Agent is mandatory: the endpoint sits behind Cloudflare and answers
 * `403 error code: 1010` to Python's and Node's default agents. Measured.
 */
export const AI_USER_AGENT = 'news-aggregator/1.0 (+https://news.nileorbit.com)';

/** Candidates sent to the model per digest. Beyond this the digest is not short. */
export const MAX_CANDIDATES = 30;

/** Bounded retries: a digest that fails must not hang the scheduler. */
export const AI_ATTEMPTS = 3;

/** Give up on one story after this long; the digest continues without it. */
export const AI_TIMEOUT_MS = 45_000;

export interface StoryVerdict {
  /** Whether an editor would put this in front of a reader today. */
  important: boolean;
  /** One of the app's category ids. */
  category: string;
  /** One or two Arabic sentences. */
  summary: string;
  /** One short Arabic sentence: why it matters. */
  why: string;
}

/** The topic ids the app offers; anything else is coerced to `misc`. */
export const TOPIC_IDS = ['egypt', 'economy', 'sports', 'health', 'tech', 'misc'] as const;
export type TopicId = (typeof TOPIC_IDS)[number];

export function normalizeTopic(value: unknown): TopicId {
  return typeof value === 'string' && (TOPIC_IDS as readonly string[]).includes(value)
    ? (value as TopicId)
    : 'misc';
}

/**
 * Load the API key: env first, then the mounted secret file (same pattern as the
 * Resend and Firebase keys). Returns null with one warning — never throws, and
 * never logs the value.
 */
export function loadApiKey(
  filePath: string = process.env['COMMANDCODE_API_KEY_FILE'] || DEFAULT_KEY_FILE,
): string | null {
  const fromEnv = process.env['COMMANDCODE_API_KEY'];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const key = fs.readFileSync(filePath, 'utf8').trim();
    if (!key) {
      console.warn(`[digest] ${filePath} is empty — the digest cannot be built`);
      return null;
    }
    return key;
  } catch {
    console.warn(
      `[digest] no Command Code API key (env COMMANDCODE_API_KEY or ${filePath}) — ` +
        'the twice-daily digest is disabled; the app keeps the previous one.',
    );
    return null;
  }
}

export const SYSTEM_PROMPT = `أنت محرر أخبار عربي محترف يجهّز خلاصة يومية لقرّاء مصريين وعرب.

اقرأ الخبر كاملًا ثم أعد JSON فقط، بدون أي كلام آخر، بالشكل:
{"important": true أو false, "category": "egypt|economy|sports|health|tech|misc", "summary": "جملة أو اثنتان", "why": "جملة قصيرة"}

قواعد:
- important = true لأي خبر له وزن إخباري حقيقي: سياسة، اقتصاد، أمن، حرب، كوارث، قرارات كبرى، إنجازات علمية مهمة، أحداث إقليمية تؤثر على المنطقة.
- important = false فقط للترفيه الخفيف، نتائج المباريات الروتينية، أسعار يومية، قصص إنسانية صغيرة، محتوى محلي أجنبي بلا صلة، والمقالات التحليلية القديمة.
- كن متوسطًا لا متشددًا: معظم أخبار السياسة والاقتصاد والأمن مهمة.
- summary: بالعربية الفصحى المبسطة، من النص نفسه فقط. لا تخترع تفاصيل أو أرقامًا غير موجودة فيه.
- why: لماذا يهم القارئ العربي تحديدًا.
- category: اختر التصنيف الأنسب من القائمة حرفيًا.`;

/** The user message for one story. Text is capped by the fetcher, not here. */
export function buildPrompt(title: string, sourceName: string, text: string): string {
  return `العنوان: ${title}\nالمصدر: ${sourceName}\n\nالنص:\n${text}`;
}

/**
 * Pull the JSON object out of a model reply. Models sometimes wrap it in a code
 * fence or add a sentence; a digest must not fail over formatting.
 */
export function parseVerdict(reply: string): StoryVerdict | null {
  if (!reply) return null;
  const fenced = reply.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : reply).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj['summary'] === 'string' ? obj['summary'].trim() : '';
  // A record with no summary is useless to the reader: treat it as a failure.
  if (!summary) return null;
  return {
    important: obj['important'] === true,
    category: normalizeTopic(obj['category']),
    summary: summary.slice(0, 400),
    why: typeof obj['why'] === 'string' ? obj['why'].trim().slice(0, 240) : '',
  };
}

export interface AiCallResult {
  verdict: StoryVerdict | null;
  /** Token usage when the provider reports it, for the cost log. */
  usage?: { prompt: number; completion: number };
  error?: string;
}

/**
 * One story → one verdict. Never throws: a single unusable story must not fail a
 * whole digest. Retries only on transport/5xx/429, never on a bad parse (that
 * would pay twice for the same nonsense).
 */
export async function analyzeStory(
  story: { title: string; sourceName: string; text: string },
  options: {
    apiKey?: string | null;
    fetchImpl?: typeof fetch;
    model?: string;
    baseUrl?: string;
  } = {},
): Promise<AiCallResult> {
  const apiKey = options.apiKey === undefined ? loadApiKey() : options.apiKey;
  if (!apiKey) return { verdict: null, error: 'no API key' };
  const fetchImpl = options.fetchImpl ?? fetch;
  const model = options.model ?? process.env['DIGEST_AI_MODEL'] ?? DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? process.env['DIGEST_AI_BASE'] ?? DEFAULT_API_BASE).replace(/\/$/, '');

  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(story.title, story.sourceName, story.text) },
    ],
    temperature: 0.1,
    max_tokens: 400,
  });

  let lastError = '';
  for (let attempt = 0; attempt < AI_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetchImpl(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': AI_USER_AGENT,
          // Zero data retention, no training. Refused rather than downgraded.
          'x-cmd-zdr': '1',
        },
        body,
        signal: AbortSignal.timeout(AI_TIMEOUT_MS),
      });
      if (res.status === 429 || res.status >= 500) {
        lastError = `provider answered ${res.status}`;
        if (attempt < AI_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
          continue;
        }
        return { verdict: null, error: lastError };
      }
      if (!res.ok) {
        // 400/403 are permanent: retrying the same body only burns quota.
        const brief = await res.text().catch(() => '');
        return { verdict: null, error: `provider answered ${res.status} ${brief.slice(0, 120)}` };
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const reply = json.choices?.[0]?.message?.content ?? '';
      const verdict = parseVerdict(reply);
      return {
        verdict,
        usage: json.usage
          ? { prompt: json.usage.prompt_tokens ?? 0, completion: json.usage.completion_tokens ?? 0 }
          : undefined,
        error: verdict ? undefined : 'unparseable reply',
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 120) : 'request failed';
      if (attempt < AI_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
    }
  }
  return { verdict: null, error: lastError || 'failed' };
}

/**
 * Run the pass over selected candidates with a hard concurrency cap, so one slow
 * provider cannot open 30 sockets at once.
 */
export async function analyzeCandidates<T extends { title: string; sourceName: string; text: string }>(
  stories: T[],
  options: { apiKey?: string | null; fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<Array<{ story: T; result: AiCallResult }>> {
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const out: Array<{ story: T; result: AiCallResult }> = new Array(stories.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= stories.length) return;
      out[index] = { story: stories[index] as T, result: await analyzeStory(stories[index] as T, options) };
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, stories.length) }, worker));
  return out;
}
