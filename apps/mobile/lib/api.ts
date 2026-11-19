export const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'https://news.nileorbit.com';

/** The server's 403 for "signed in but email not proven yet". */
export const EMAIL_NOT_VERIFIED = 'EMAIL_NOT_VERIFIED';

/**
 * A failed API call that keeps the HTTP status and the server's error code, so
 * callers can tell "you need to verify your email" (403) apart from a real
 * network failure instead of guessing from a string.
 */
export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** True when the failure is the email-verification gate, not the network. */
export function isEmailNotVerified(err: unknown): boolean {
  return err instanceof ApiError && (err.code === EMAIL_NOT_VERIFIED || err.status === 403);
}

/** True when the request never reached the server (offline, timeout, DNS). */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (err instanceof Error && /Network request failed|Failed to fetch|timeout/i.test(err.message));
}

/**
 * Build the right error for a non-2xx response.
 * Reads the JSON body when it carries a `code` (the 403 gate does); otherwise
 * falls back to the plain status.
 */
export async function apiError(res: Response): Promise<ApiError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const body = (await res.json()) as { code?: string; error?: string };
    code = typeof body.code === 'string' ? body.code : undefined;
    message = typeof body.error === 'string' ? body.error : undefined;
  } catch {
    /* not JSON, or already consumed */
  }
  return new ApiError(res.status, message ?? `API error ${res.status}`, code);
}

/** Replace every `if (!res.ok) throw new Error(...)` with the typed version. */

export type ReactionType = 'like' | 'love' | 'wow' | 'sad' | 'angry';

export interface ReactionCounts {
  like: number;
  love: number;
  wow: number;
  sad: number;
  angry: number;
  total: number;
}

/** Emoji per type, matching the server's REACTION_EMOJI. */
export const REACTION_EMOJI: Record<ReactionType, string> = {
  like: '👍',
  love: '❤️',
  wow: '😮',
  sad: '😢',
  angry: '😡',
};

/** Arabic labels for accessibility and the picker. */
export const REACTION_LABEL: Record<ReactionType, string> = {
  like: 'إعجاب',
  love: 'حب',
  wow: 'اندهاش',
  sad: 'حزن',
  angry: 'غضب',
};

export const REACTION_ORDER: ReactionType[] = ['like', 'love', 'wow', 'sad', 'angry'];

export interface Article {
  id: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string;
  sourceId: string;
  sourceName: string;
  category: string;
  country: string;
  publishedAt: number;
  isBreaking: boolean;
  reactions?: ReactionCounts;
  myReaction?: ReactionType | null;
}

/**
 * Default feed. `token` is optional but must be sent when the caller has one:
 * without it the server cannot fill `myReaction`, so the card cannot show the
 * selected state.
 */
export async function fetchFeed(limit = 50, offset = 0, token?: string | null): Promise<Article[]> {
  const url = `${API_BASE}/api/feed?limit=${limit}&offset=${offset}`;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchArticle(id: string): Promise<Article> {
  const res = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(id)}`);
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article };
  return json.data;
}

/** Raised when the server refuses a resend because of the cooldown/daily cap. */
export class ResendRateLimited extends Error {
  retryAfterSeconds: number;
  remainingToday?: number;

  constructor(retryAfterSeconds: number, remainingToday?: number) {
    super(`resend limited for ${retryAfterSeconds}s`);
    this.name = 'ResendRateLimited';
    this.retryAfterSeconds = retryAfterSeconds;
    this.remainingToday = remainingToday;
  }
}

export interface ResendResult {
  sent: boolean;
  alreadyVerified: boolean;
  remainingToday?: number;
}

/**
 * Ask the server for a fresh verification link.
 * Throws ResendRateLimited when the cooldown or the daily cap applies.
 */
export async function resendVerification(token: string): Promise<ResendResult> {
  const res = await fetch(`${API_BASE}/api/auth/resend-verification`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    const json = (await res.json().catch(() => ({}))) as {
      retryAfterSeconds?: number;
      remainingToday?: number;
    };
    throw new ResendRateLimited(json.retryAfterSeconds ?? 60, json.remainingToday);
  }
  if (!res.ok) throw await apiError(res);

  const json = (await res.json()) as {
    data?: { sent?: boolean; alreadyVerified?: boolean; remainingToday?: number };
  };
  return {
    sent: json.data?.sent === true,
    alreadyVerified: json.data?.alreadyVerified === true,
    remainingToday: json.data?.remainingToday,
  };
}

export interface Category {
  id: string;
  name: string;
}

export interface SourceMeta {
  id: string;
  name: string;
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Category[] };
  return json.data;
}

export async function fetchTrending(limit = 20, token?: string | null): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/trending?limit=${limit}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchSourceArticles(
  sourceId: string,
  limit = 50,
  offset = 0,
  token?: string | null,
): Promise<{ source: SourceMeta; articles: Article[] }> {
  const res = await fetch(
    `${API_BASE}/api/sources/${encodeURIComponent(sourceId)}/articles?limit=${limit}&offset=${offset}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { source: SourceMeta; data: Article[] };
  return { source: json.source, articles: json.data };
}

export interface Source {
  id: string;
  name: string;
  country?: string;
}

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch(`${API_BASE}/api/sources`);
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Source[] };
  return json.data;
}

export async function fetchFollows(token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function followSource(sourceId: string, token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows/${encodeURIComponent(sourceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function unfollowSource(sourceId: string, token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function fetchFollowingFeed(token: string, limit = 50, offset = 0): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/feed/following?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchSavedArticles(token: string, limit = 50, offset = 0): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/saved?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

/**
 * Full-text search. Returns the current page plus the total match count
 * (the count is before limit/offset, so it can drive a "N results" label).
 */
export async function searchArticles(
  q: string,
  limit = 50,
  offset = 0,
  token?: string | null,
): Promise<{ articles: Article[]; total: number }> {
  const res = await fetch(
    `${API_BASE}/api/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
  );
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: Article[]; total?: number };
  return { articles: json.data, total: json.total ?? json.data.length };
}

export async function fetchIsArticleSaved(articleId: string, token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { saved: boolean } };
  return json.data.saved;
}

export async function saveArticle(articleId: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
}

export async function unsaveArticle(articleId: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  return `منذ ${months} شهر`;
}

const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** Absolute publish date, e.g. "16 نوفمبر 2026، 03:41 ص". */
export function fullDate(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? 'ص' : 'م';
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}، ${h12}:${mins} ${period}`;
}


/**
 * Set or replace the caller's reaction. Throws ApiError (403 when unverified)
 * so callers can show the verification gate rather than a network message.
 */
export async function putReaction(
  articleId: string,
  type: ReactionType,
  token: string,
): Promise<{ counts: ReactionCounts; myReaction: ReactionType }> {
  const res = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(articleId)}/reaction`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ type }),
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as {
    data: { counts: ReactionCounts; myReaction: ReactionType };
  };
  return json.data;
}

/** Remove the caller's reaction. */
export async function deleteReaction(
  articleId: string,
  token: string,
): Promise<{ counts: ReactionCounts; myReaction: null }> {
  const res = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(articleId)}/reaction`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { counts: ReactionCounts; myReaction: null } };
  return json.data;
}

/** Compact count for display: numbers under 1000 verbatim, else 1.2k. */
export function formatReactionCount(n: number): string {
  if (n < 1000) return String(n);
  const thousands = n / 1000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}k`;
}

/**
 * The feed-card capsule hides small counts to avoid clutter. The article reader
 * does NOT use this: it shows every count from 1 (see formatReactionTotal).
 */
export const REACTION_DISPLAY_THRESHOLD = 3;

/**
 * Arabic counted-noun form for reactions, which the user asked to be correct:
 *   1        -> «تفاعل واحد»
 *   2        -> «تفاعلان»
 *   3..10    -> «N تفاعلات»
 *   11+      -> «N تفاعلاً»   (the accusative singular after 11-99)
 *
 * Note the 3-10 range uses the plural تفاعلات and 11+ the singular تفاعلاً, per
 * standard Arabic; 100+ follows the same rule on its last two digits.
 */
export function formatReactionTotal(n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return 'تفاعل واحد';
  if (n === 2) return 'تفاعلان';

  // The counted form depends on the last two digits: 103 behaves like 3.
  const lastTwo = n % 100;
  const arabicNumber = toArabicDigits(n);
  if (lastTwo >= 3 && lastTwo <= 10) return `${arabicNumber} تفاعلات`;
  return `${arabicNumber} تفاعلاً`;
}

/** Western digits to Arabic-Indic, matching the rest of the UI. */
export function toArabicDigits(n: number): string {
  return String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}


/** One row of the grouped feed: a single article, or a same-story cluster. */
export type FeedRow =
  | { kind: 'article'; article: Article }
  | {
      kind: 'cluster';
      lead: Article;
      members: Article[];
      /** Number of distinct outlets covering the story. */
      sourceCount: number;
      isBreaking: boolean;
    };

/**
 * Grouped feed. Keeps the default /api/feed shape untouched; this is opt-in.
 * `total` is the article count, `totalRows` the number of pageable rows.
 */
export async function fetchGroupedFeed(
  limit = 50,
  offset = 0,
  token?: string | null,
): Promise<{ rows: FeedRow[]; total: number; totalRows: number }> {
  const res = await fetch(`${API_BASE}/api/feed?grouped=1&limit=${limit}&offset=${offset}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as {
    data: FeedRow[];
    total?: number;
    totalRows?: number;
  };
  return {
    rows: json.data,
    total: json.total ?? 0,
    totalRows: json.totalRows ?? json.data.length,
  };
}


export interface KeywordPrefs {
  keywords: Array<{ keyword: string; label: string; notify: boolean }>;
  mutedKeywords: string[];
  mutedSources: string[];
  limits: { keywords: number; mutedKeywords: number };
}

function authHeaders(token: string): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

export async function fetchPreferences(token: string): Promise<KeywordPrefs> {
  const res = await fetch(`${API_BASE}/api/preferences`, { headers: authHeaders(token) });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: KeywordPrefs };
  return json.data;
}

export async function addFollowedKeyword(
  token: string,
  keyword: string,
  notify = true,
): Promise<{ keyword: string; label: string; notify: boolean }[]> {
  const res = await fetch(`${API_BASE}/api/keywords`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({ keyword, notify }),
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { keywords: { keyword: string; label: string; notify: boolean }[] } };
  return json.data.keywords;
}

export async function removeFollowedKeyword(token: string, keyword: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/keywords/${encodeURIComponent(keyword)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw await apiError(res);
}

export async function setKeywordNotify(
  token: string,
  keyword: string,
  notify: boolean,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/keywords/${encodeURIComponent(keyword)}/notify`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ notify }),
  });
  if (!res.ok) throw await apiError(res);
}

export async function mute(token: string, body: { keyword?: string; sourceId?: string }): Promise<void> {
  const res = await fetch(`${API_BASE}/api/mutes`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
}

export async function unmute(
  token: string,
  params: { keyword?: string; sourceId?: string },
): Promise<void> {
  const q = params.keyword
    ? `keyword=${encodeURIComponent(params.keyword)}`
    : `sourceId=${encodeURIComponent(params.sourceId ?? '')}`;
  const res = await fetch(`${API_BASE}/api/mutes?${q}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw await apiError(res);
}


/** Fresh reaction counts for one article (public; myReaction when signed in). */
export async function fetchReactions(
  articleId: string,
  token?: string | null,
): Promise<{ counts: ReactionCounts; myReaction: ReactionType | null }> {
  const res = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(articleId)}/reactions`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as {
    data: { counts: ReactionCounts; myReaction: ReactionType | null };
  };
  return json.data;
}
