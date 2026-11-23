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

/** The twice-daily digest topics, matching the server's ids. */
export type DigestTopic = 'egypt' | 'economy' | 'sports' | 'health' | 'tech' | 'misc';

/** Arabic labels for the picker, in the order the app shows them. */
export const DIGEST_TOPIC_LABEL: Record<DigestTopic, string> = {
  egypt: 'مصر',
  economy: 'اقتصاد',
  sports: 'رياضة',
  health: 'صحة',
  tech: 'تكنولوجيا',
  misc: 'منوعات',
};

export interface DigestItem {
  articleId: string;
  title: string;
  url: string;
  sourceName: string;
  sourceId: string;
  category: DigestTopic;
  summary: string;
  why: string;
  isBreaking: boolean;
  publishedAt: number;
  /** 'snippet' means the summary was built from the RSS excerpt, not the article. */
  textSource: 'full' | 'snippet';
  /** Distinct outlets covering this story; >1 is why it matters. */
  sourceCount?: number;
}

export interface DigestResponse {
  slot: string | null;
  builtAt: number | null;
  /** True before the first digest exists, so the screen can say so. */
  stale: boolean;
  topics: DigestTopic[];
  items: DigestItem[];
}

/** The digest for this reader (or the default topic mix for a guest). */
export async function fetchDigest(token?: string | null): Promise<DigestResponse> {
  const res = await fetch(`${API_BASE}/api/digest`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: DigestResponse };
  return json.data;
}

export interface DigestPrefs {
  topics: DigestTopic[];
  available: DigestTopic[];
  defaults: DigestTopic[];
}

export async function fetchDigestPrefs(token: string): Promise<DigestPrefs> {
  const res = await fetch(`${API_BASE}/api/digest/topics`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: DigestPrefs };
  return json.data;
}

/** Save the chosen topics. An empty list is respected, not replaced by defaults. */
export async function saveDigestTopics(token: string, topics: DigestTopic[]): Promise<DigestTopic[]> {
  const res = await fetch(`${API_BASE}/api/digest/topics`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ topics }),
  });
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { topics: DigestTopic[] } };
  return json.data.topics;
}

// --- Football: matches, standings, team follows ---

export type MatchStatus = 'live' | 'upcoming' | 'finished' | 'unknown';

export interface FootballMatch {
  id: string;
  competitionId: string;
  competitionName: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  statusText: string;
  kickoff: string | null;
  round: string | null;
  url?: string;
  minute: number | null;
  dataSource: 'yallakora' | 'filgoal' | 'espn';
  /** The competition's display rank, served by the API (Egypt first). */
  competitionPriority?: number;
  /** Broadcasting channel, when the source names one. */
  channel?: string | null;
  /** Crest URL on OUR server (`/api/football/logo/...`), never a source URL. */
  homeLogo?: string | null;
  awayLogo?: string | null;
  /** Stadium, when the source names one. */
  stadium?: string | null;
}

export interface MatchesDay {
  date: string;
  unavailable: boolean;
  fetchedAt: number;
  followedTeams: string[];
  /** Competition ids the caller follows; empty for a guest. */
  followedLeagues: string[];
  /** EVERY competition we cover, whether or not it plays today. */
  competitions: FootballCompetition[];
  matches: FootballMatch[];
}

export interface StandingRow {
  position: number;
  team: string;
  /** Crest on our own server, when the source has one. */
  logo?: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

export interface StandingsTable {
  competitionId: string;
  group: string | null;
  rows: StandingRow[];
  /** False when the source shows played/goals/points only — do not print W/D/L. */
  hasFullRecord: boolean;
}

/** A followed competition. Same switches as a team follow, minus goals. */
export interface LeagueFollow {
  competitionId: string;
  nameAr: string;
  notifyKickoff: boolean;
  notifyFinal: boolean;
}

export interface TeamFollow {
  name: string;
  competitionId: string;
  notifyKickoff: boolean;
  notifyGoals: boolean;
  notifyFinal: boolean;
}

export async function fetchMatches(date: string, token?: string | null): Promise<MatchesDay> {
  const res = await fetch(`${API_BASE}/api/football/matches?date=${encodeURIComponent(date)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: MatchesDay }).data;
}

/** One player in a line-up. */
export interface LineupPlayer {
  personId: string;
  name: string;
  position: string | null;
  shirtNumber: number | null;
  isStarter: boolean;
  minutesPlayed: number | null;
  teamId: string;
}

export interface Lineups {
  homeTeamId: string | null;
  awayTeamId: string | null;
  home: LineupPlayer[];
  away: LineupPlayer[];
}

/** What only the provider's match page knows. */
/** One row of the match timeline, as the source published it. */
export interface MatchEvent {
  /** Minute as published. Null for a status-only row (filtered out before render). */
  minute: number | null;
  /** «هدف», «بطاقة صفراء», … */
  type: string;
  /** Scorer or booked player, when the row names one. */
  player: string | null;
  /** Which column the page put it in; `r` is the home side in this RTL layout. */
  side: 'r' | 'l' | null;
}

export interface MatchDetail {
  commentator: string | null;
  channel: string | null;
  homeCoach: string | null;
  awayCoach: string | null;
  /** Null when the source publishes no line-up for this match. */
  lineups: Lineups | null;
  /**
   * The goal/card timeline, in the order the source lists it.
   *
   * Present for finished and in-play matches the source covers; empty when it
   * publishes none. An empty array is a fact, not a failure.
   */
  events?: MatchEvent[];
}

/** An article about one of a match's two clubs, from our own corpus. */
export interface MatchNews {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: number;
  /**
   * The article's lead image from the feed, when it carried one.
   *
   * Most Egyptian coverage has none, so the card draws the design's football
   * glyph rather than an empty box. Never invented.
   */
  imageUrl?: string | null;
  /** `both` when the article names the two clubs in the same piece. */
  team: 'home' | 'away' | 'both';
}

export async function fetchMatch(
  id: string,
  date: string,
): Promise<{
  match: FootballMatch;
  /** Commentator and coaches, when the provider publishes them. */
  detail: MatchDetail | null;
  news: MatchNews[];
  unavailable: boolean;
}> {
  const res = await fetch(
    `${API_BASE}/api/football/matches/${encodeURIComponent(id)}?date=${encodeURIComponent(date)}`,
  );
  if (!res.ok) throw await apiError(res);
  return (
    (await res.json()) as {
      data: { match: FootballMatch; detail: MatchDetail | null; news: MatchNews[]; unavailable: boolean };
    }
  ).data;
}

export async function fetchStandings(competitionId: string): Promise<{ unavailable: boolean; tables: StandingsTable[] }> {
  const res = await fetch(`${API_BASE}/api/football/standings?competition=${encodeURIComponent(competitionId)}`);
  if (!res.ok) throw await apiError(res);
  const json = (await res.json()) as { data: { unavailable: boolean; tables: StandingsTable[] } };
  return { unavailable: json.data.unavailable, tables: json.data.tables };
}

export async function fetchTeamFollows(token: string): Promise<TeamFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/follows`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { teams: TeamFollow[] } }).data.teams;
}

export async function followFootballTeam(
  token: string,
  team: string,
  competitionId = 'egyptian-premier',
): Promise<TeamFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/follows`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ team, competitionId }),
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { teams: TeamFollow[] } }).data.teams;
}

export async function unfollowFootballTeam(token: string, team: string): Promise<TeamFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/follows/${encodeURIComponent(team)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { teams: TeamFollow[] } }).data.teams;
}

export async function setFootballTeamNotify(
  token: string,
  team: string,
  prefs: { notifyKickoff?: boolean; notifyGoals?: boolean; notifyFinal?: boolean },
): Promise<TeamFollow> {
  const res = await fetch(`${API_BASE}/api/football/follows/${encodeURIComponent(team)}/notify`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { follow: TeamFollow } }).data.follow;
}

/** Teams offered as quick-pick chips, per the spec. */
export const POPULAR_TEAMS = [
  'الأهلي', 'الزمالك', 'بيراميدز', 'ليفربول', 'ريال مدريد',
  'برشلونة', 'مانشستر سيتي', 'أرسنال', 'الهلال', 'النصر', 'منتخب مصر',
] as const;

export interface FootballCompetition {
  id: string;
  nameAr: string;
  country: string;
  isCup: boolean;
  /** Display rank, Egypt first. Served, not computed, so #26 can reorder it. */
  priority?: number;
}

/** A club or national team offered on the follow screen. */
export interface CatalogTeam {
  name: string;
  competitionId: string;
  competitionName: string;
  section: 'egypt' | 'europe' | 'continental' | 'saudi' | 'national';
  /** Crest on our own server, or null when the source has none. */
  logo: string | null;
  /** League position from the cached table, when there is one. */
  position: number | null;
  /** Emoji flag for a national team; null for a club. */
  flag: string | null;
  nextMatch: { opponent: string; kickoff: string | null; isHome: boolean } | null;
}

export interface FollowCatalog {
  sections: Array<{ id: CatalogTeam['section']; title: string; teams: CatalogTeam[] }>;
}

/**
 * The follow screen's catalogue.
 *
 * The server builds it from the standings and days it already caches, so this
 * costs the reader one request and the sources nothing.
 */
export async function fetchFollowCatalog(): Promise<FollowCatalog> {
  const res = await fetch(`${API_BASE}/api/football/follow-catalog`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: FollowCatalog }).data;
}

/** Every competition we cover, as the server defines them (no stale copy here). */
/**
 * Whether a match the reader cares about is running right now.
 *
 * Cheap and honest: `live` is false unless a followed team or the Egyptian league
 * is actually playing, so the header dot is a signal rather than decoration.
 */
export async function fetchLiveStatus(
  token?: string | null,
): Promise<{ live: boolean; matches: Array<{ home: string; away: string; homeScore: number | null; awayScore: number | null }> }> {
  const res = await fetch(`${API_BASE}/api/football/live-status`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { live: boolean; matches: [] } }).data;
}

/**
 * The competitions we cover, in spec order, used when the server list cannot be
 * read. Without a fallback a failed request left the tab strip empty, which reads
 * to a reader as «the Egyptian league is not in this app».
 */
export const FALLBACK_COMPETITIONS: FootballCompetition[] = [
  { id: 'egyptian-premier', nameAr: 'الدوري المصري', country: 'EG', isCup: false },
  { id: 'egypt-cup', nameAr: 'كأس مصر', country: 'EG', isCup: true },
  { id: 'caf-champions', nameAr: 'دوري أبطال إفريقيا', country: 'AF', isCup: false },
  { id: 'caf-confederation', nameAr: 'كأس الكونفدرالية', country: 'AF', isCup: false },
  { id: 'uefa-champions', nameAr: 'دوري أبطال أوروبا', country: 'EU', isCup: false },
  { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', country: 'GB', isCup: false },
  { id: 'esp-la-liga', nameAr: 'الدوري الإسباني', country: 'ES', isCup: false },
  { id: 'ita-serie-a', nameAr: 'الدوري الإيطالي', country: 'IT', isCup: false },
  { id: 'ger-bundesliga', nameAr: 'الدوري الألماني', country: 'DE', isCup: false },
  { id: 'fra-ligue-1', nameAr: 'الدوري الفرنسي', country: 'FR', isCup: false },
  { id: 'saudi-pro-league', nameAr: 'الدوري السعودي', country: 'SA', isCup: false },
];

export async function fetchCompetitions(): Promise<FootballCompetition[]> {
  const res = await fetch(`${API_BASE}/api/football/competitions`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: FootballCompetition[] }).data;
}

// --- followed leagues ---

export async function fetchLeagueFollows(token: string): Promise<LeagueFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/league-follows`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { leagues: LeagueFollow[] } }).data.leagues;
}

export async function followLeague(token: string, competitionId: string): Promise<LeagueFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/league-follows`, {
    method: 'PUT',
    headers: authHeaders(token),
    body: JSON.stringify({ competitionId }),
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { leagues: LeagueFollow[] } }).data.leagues;
}

export async function unfollowLeague(token: string, competitionId: string): Promise<LeagueFollow[]> {
  const res = await fetch(`${API_BASE}/api/football/league-follows/${encodeURIComponent(competitionId)}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { leagues: LeagueFollow[] } }).data.leagues;
}

export async function setLeagueNotify(
  token: string,
  competitionId: string,
  prefs: { notifyKickoff?: boolean; notifyFinal?: boolean },
): Promise<LeagueFollow> {
  const res = await fetch(
    `${API_BASE}/api/football/league-follows/${encodeURIComponent(competitionId)}/notify`,
    { method: 'PUT', headers: authHeaders(token), body: JSON.stringify(prefs) },
  );
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: { league: LeagueFollow } }).data.league;
}

/** Absolute URL for a crest served by our own API. */
export function logoUrl(pathOrNull: string | null | undefined): string | null {
  if (!pathOrNull) return null;
  if (/^https?:/i.test(pathOrNull)) return pathOrNull;
  return `${API_BASE}${pathOrNull}`;
}

/** A club's page: fixtures, results, competitions and coverage. */
export interface TeamPage {
  name: string;
  logo: string | null;
  teamIds: string[];
  competitionIds: string[];
  upcoming: FootballMatch[];
  recent: FootballMatch[];
  news: MatchNews[];
}

export async function fetchTeamPage(name: string): Promise<TeamPage> {
  const res = await fetch(`${API_BASE}/api/football/teams/${encodeURIComponent(name)}`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: TeamPage }).data;
}

/** A competition's page: table, fixtures and results. */
export interface CompetitionPage {
  id: string;
  nameAr: string;
  isCup: boolean;
  priority: number;
  country: string;
  standings: StandingRow[] | null;
  standingsUnavailable: boolean;
  hasFullRecord: boolean;
  upcoming: FootballMatch[];
  recent: FootballMatch[];
}

export async function fetchCompetitionPage(id: string): Promise<CompetitionPage> {
  const res = await fetch(`${API_BASE}/api/football/competitions/${encodeURIComponent(id)}`);
  if (!res.ok) throw await apiError(res);
  return ((await res.json()) as { data: CompetitionPage }).data;
}
