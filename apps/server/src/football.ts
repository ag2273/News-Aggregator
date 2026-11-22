// Football data ingestion: Yallakora (Egyptian + Arab) and ESPN (world).
//
// Yallakora is scraped, not an API. That is deliberate and approved: their
// robots.txt allows everything except login, account and a few internal data
// paths. What that costs us is fragility — their routes move — so every fetch
// path is isolated here, and a failure returns "unavailable" rather than
// throwing. Measured routes (2026-11-22):
//   fixtures:  /matches-center?date=YYYY-MM-DD   (matches grouped under <h2> league names)
//   standings: /tour/<id>                        (idor 160 = الدوري المصري)
// A league's match group is identified by the <h2> that precedes its rows.

import { stripBoilerplate } from './articleText.js';

/** Competitions the app shows. `yallakoraTourId` is only set where measured. */
export interface Competition {
  id: string;
  nameAr: string;
  provider: 'yallakora' | 'espn';
  /** Yallakora `/tour/<id>`, when known. */
  yallakoraTourId?: string;
  /** ESPN league slug, e.g. `ksa.1`. */
  espnSlug?: string;
  country: string;
}

export const COMPETITIONS: Competition[] = [
  { id: 'egyptian-premier', nameAr: 'الدوري المصري', provider: 'yallakora', yallakoraTourId: '160', country: 'EG' },
  { id: 'egypt-cup', nameAr: 'كأس مصر', provider: 'yallakora', country: 'EG' },
  { id: 'saudi-pro-league', nameAr: 'دوري روشن السعودي', provider: 'espn', espnSlug: 'ksa.1', country: 'SA' },
  { id: 'caf-champions', nameAr: 'دوري أبطال إفريقيا', provider: 'espn', espnSlug: 'caf.champions', country: 'AF' },
  { id: 'uefa-champions', nameAr: 'دوري أبطال أوروبا', provider: 'espn', espnSlug: 'uefa.champions', country: 'EU' },
  { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', provider: 'espn', espnSlug: 'eng.1', country: 'GB' },
  { id: 'esp-la-liga', nameAr: 'الدوري الإسباني', provider: 'espn', espnSlug: 'esp.1', country: 'ES' },
  { id: 'ita-serie-a', nameAr: 'الدوري الإيطالي', provider: 'espn', espnSlug: 'ita.1', country: 'IT' },
  { id: 'ger-bundesliga', nameAr: 'الدوري الألماني', provider: 'espn', espnSlug: 'ger.1', country: 'DE' },
  { id: 'fra-ligue-1', nameAr: 'الدوري الفرنسي', provider: 'espn', espnSlug: 'fra.1', country: 'FR' },
];

export type MatchStatus = 'live' | 'upcoming' | 'finished' | 'unknown';

export interface MatchRow {
  id: string;
  competitionId: string;
  competitionName: string;
  home: string;
  away: string;
  /** Null until the match starts. */
  homeScore: number | null;
  awayScore: number | null;
  status: MatchStatus;
  /** Arabic status as the source words it («لم تبدأ», «انتهت», "67'"). */
  statusText: string;
  /** Cairo-local kickoff as the source shows it (hh:mm). */
  kickoff: string | null;
  round: string | null;
  /** Detail page, relative to the provider. */
  url?: string;
  /** Minute for a live match, when the source gives one. */
  minute: number | null;
}

export interface StandingRow {
  position: number;
  team: string;
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
  /** Yallakora splits some competitions into groups; null is the whole table. */
  group: string | null;
  rows: StandingRow[];
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export const YALLAKORA_BASE = 'https://www.yallakora.com';
export const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

/** A page fetch with a deadline. One slow source must not stall a refresh. */
export async function getPage(url: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/json' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** `YYYY-MM-DD` for a Cairo-local day offset from today. */
export function cairoDate(daysFromToday = 0, now: number = Date.now()): string {
  const local = new Date(now + 2 * 60 * 60 * 1000 + daysFromToday * 86_400_000);
  return local.toISOString().slice(0, 10);
}

function textOf(html: string): string {
  return stripBoilerplate(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

/** Map the Arabic status word to our four states. */
export function statusOf(word: string): MatchStatus {
  const w = word.trim();
  if (/انتهت|نهاية|FT/i.test(w)) return 'finished';
  if (/لم تبدأ|قادمة|الآن|تأجيل/.test(w) && /لم تبدأ|قادمة|تأجيل/.test(w)) return 'upcoming';
  if (/مباشر|جارية|\d+/.test(w)) return 'live';
  return 'unknown';
}

/**
 * Parse one day's fixtures from the matches-center page.
 *
 * Every match sits in `<div class="allData">`, and the competition is the text of
 * the last `<h2>` before it. Measured: 22 matches on a normal day, with
 * «الدوري المصري» grouping 4 of them.
 */
export function parseYallakoraDay(
  html: string,
  date: string,
  competitions: Competition[] = COMPETITIONS,
): MatchRow[] {
  // Each match block runs from its own `<div class="allData">` to the next one.
  // (Indexing from the page start each time finds only the first block — measured
  // 0 rows.) The competition is the last `<h2>` text before the block.
  const positions: number[] = [];
  for (const m of html.matchAll(/<div class="allData">/g)) positions.push(m.index!);
  const headings = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({
    at: m.index!,
    name: textOf(m[1]!).trim(),
  }));
  const rows: MatchRow[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    const start = positions[i]!;
    const block = html.slice(start, positions[i + 1] ?? html.length);
    const league = headings.filter((h) => h.at < start).pop()?.name ?? '';
    // Cloudflare injects a <script> tag between the class and the team name in
    // some responses, so the window has to be wide enough to pass it.
    const teams = [
      ...block.matchAll(/class="teams team[AB]"[\s\S]{0,2000}?<p>([^<]{2,60})<\/p>/g),
    ].map((m) => m[1]!.trim());
    if (teams.length < 2) continue;
    const scores = [...block.matchAll(/class="score">\s*([^<]*?)\s*</g)].map((m) => m[1]!.trim());
    const statusWord = (block.match(/class="matchStatus">\s*<span>\s*([^<]+?)\s*</) ?? [])[1] ?? '';
    const round = (block.match(/class="date">\s*([^<]+?)\s*</) ?? [])[1]?.trim() ?? null;
    const time = (block.match(/class="time">\s*([^<]+?)\s*</) ?? [])[1]?.trim() ?? null;
    const link = (block.match(/href="([^"]*\/match\/[^"]+)"/) ?? [])[1];
    const comp = competitions.find((c) => c.provider === 'yallakora' && league.includes(c.nameAr));
    const numeric = (v: string | undefined): number | null =>
      /^\d+$/.test((v ?? '').trim()) ? Number(v!.trim()) : null;
    rows.push({
      id: `yk-${date}-${rows.length + 1}`,
      competitionId: comp?.id ?? 'other',
      competitionName: league || 'بطولات أخرى',
      home: teams[0]!,
      away: teams[1]!,
      homeScore: numeric(scores[0]),
      awayScore: numeric(scores[1]),
      status: statusOf(statusWord),
      statusText: statusWord.trim(),
      kickoff: time,
      round,
      url: link ? `${YALLAKORA_BASE}${link}` : undefined,
      minute: null,
    });
  }
  return rows;
}

/**
 * Parse a Yallakora competition page's group standings.
 *
 * Measured markup: `<div class="wRow">` per team, then an `item team` with the
 * name in `<p>`, then four `item dtls` cells: لعب, له, عليه, النقاط.
 */
export function parseYallakoraStandings(html: string, competitionId: string): StandingsTable[] {
  const tables: StandingsTable[] = [];
  const groupHeadings = [...html.matchAll(/المجموعة\s*(\d+)/g)].map((m) => `المجموعة ${m[1]}`);
  const rows: StandingRow[] = [];
  for (const m of html.matchAll(/class="item team">([\s\S]{0,800}?)<p>([^<]+)<\/p>([\s\S]{0,900}?)(?=<div class="wRow">|$)/g)) {
    const cells = [...(m[3] ?? '').matchAll(/class="item dtls">\s*([^<]*?)\s*</g)].map((x) =>
      Number(x[1]!.trim()),
    );
    if (cells.length < 4) continue;
    rows.push({
      position: rows.length + 1,
      team: m[2]!.trim(),
      played: cells[0]!,
      goalsFor: cells[1]!,
      goalsAgainst: cells[2]!,
      points: cells[3]!,
      // Yallakora's group table shows only these four columns; W/D/L stay 0 so the
      // API shape is stable and the app can fall back to points and goal diff.
      won: 0,
      drawn: 0,
      lost: 0,
    });
  }
  if (rows.length) {
    tables.push({ competitionId, group: groupHeadings[0] ?? null, rows });
  }
  return tables;
}

/**
 * Parse one ESPN scoreboard day.
 *
 * Fetched from `/scoreboard?dates=YYYYMMDD`. Returns the same MatchRow shape, so
 * the API and app never learn which provider a match came from.
 */
export function parseEspnScoreboard(json: unknown, competition: Competition): MatchRow[] {
  const events = ((json as { events?: unknown[] }).events ?? []) as Array<Record<string, any>>;
  const out: MatchRow[] = [];
  for (const event of events) {
    const competitionBlock = (event['competitions'] as Array<Record<string, any>> | undefined)?.[0];
    if (!competitionBlock) continue;
    const competitors = (competitionBlock['competitors'] as Array<Record<string, any>> | undefined) ?? [];
    const home = competitors.find((c) => c['homeAway'] === 'home');
    const away = competitors.find((c) => c['homeAway'] === 'away');
    if (!home || !away) continue;
    const state = String(competitionBlock['status']?.['type']?.['state'] ?? '');
    const detail = String(competitionBlock['status']?.['type']?.['detail'] ?? '');
    const clock = competitionBlock['status']?.['displayClock'];
    // ESPN sends "0" for a match that has not started: report null instead, so
    // the app shows a kickoff time rather than a false 0-0.
    const finished = state === 'post';
    const score = (c: Record<string, any> | undefined): number | null => {
      if (!finished && state !== 'in') return null;
      const raw = c?.['score'];
      return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
    };
    out.push({
      id: `espn-${event['id']}`,
      competitionId: competition.id,
      competitionName: competition.nameAr,
      home: String(home['team']?.['displayName'] ?? ''),
      away: String(away['team']?.['displayName'] ?? ''),
      homeScore: score(home),
      awayScore: score(away),
      status: state === 'in' ? 'live' : state === 'post' ? 'finished' : 'upcoming',
      // Arabic, like every other user-visible string: the app never renders the
      // English "Sun, November 22nd at 9:00 AM EST" ESPN sends.
      statusText: state === 'in' ? 'مباشر' : state === 'post' ? 'انتهت' : 'لم تبدأ',
      kickoff: String(event['date'] ?? '').slice(11, 16) || null,
      round: null,
      minute: state === 'in' && typeof clock === 'string' ? Number(clock.replace(/[^\d]/g, '')) || null : null,
    });
  }
  return out;
}

/** Normalised team name for matching a match against our news corpus. */
export function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that identify a club in a headline without matching half the corpus. */
export function teamTokens(name: string): string[] {
  const n = normalizeTeam(name);
  return n
    .split(' ')
    .filter((w) => w.length >= 3 && !['منتخب', 'فريق', 'نادي', 'club'].includes(w));
}
