// Football data ingestion: Yallakora for every competition, ESPN as the fallback.
//
// Yallakora is scraped, not an API. That is deliberate and approved: their
// robots.txt allows everything except login, account and a few internal data
// paths. What that costs us is fragility — their routes move — so every fetch
// path is isolated here, and a failure returns "unavailable" rather than
// throwing.
//
// Why Yallakora first rather than ESPN: ESPN sends English team names
// ("Liverpool", "Barcelona") and UTC kickoffs, so an Arabic-only app would show
// Latin filler and be two hours early in Cairo. Yallakora is Arabic native
// («ليفربول», «برشلونة»), already Cairo-local, and carries real live states
// («مباشر», «الشوط الثاني»). ESPN is kept as the fallback for the day
// Yallakora blocks us — with a name map so the fallback is still Arabic.
//
// Measured routes (2026-11-22):
//   fixtures:   /matches-center?date=YYYY-MM-DD  (matches under <h2> league names)
//   standings:  /tour-standing/<id>  full table, 7 columns (played, W, D, L, for,
//                                    against, points), for leagues
//               /tour/<id>           league phase or Egyptian league, 4 columns
//                                    (played, for, against, points)
// Neither route is reliable alone: /tour-standing returns all-zero rows for the
// Egyptian league and the Champions League, and /tour has only 4 real rows for
// the European leagues. So standings fall through from one to the other.

import { stripBoilerplate } from './articleText.js';

/** Competitions the app shows, in the order the spec ranks them. */
export interface Competition {
  id: string;
  nameAr: string;
  /** Yallakora competition name, matched against the `<h2>` grouping heading. */
  yallakoraName: string;
  /** Yallakora `/tour-standing/<id>`. */
  yallakoraTourId: string;
  /** ESPN league slug, used only when Yallakora gives us nothing. */
  espnSlug?: string;
  country: string;
  /** Cup competitions have no league table at all. */
  isCup?: boolean;
}

export const COMPETITIONS: Competition[] = [
  { id: 'egyptian-premier', nameAr: 'الدوري المصري', yallakoraName: 'الدوري المصري', yallakoraTourId: '160', country: 'EG' },
  { id: 'egypt-cup', nameAr: 'كأس مصر', yallakoraName: 'كأس مصر', yallakoraTourId: '111', country: 'EG', isCup: true },
  { id: 'caf-champions', nameAr: 'دوري أبطال إفريقيا', yallakoraName: 'دوري أبطال أفريقيا', yallakoraTourId: '87', espnSlug: 'caf.champions', country: 'AF' },
  { id: 'uefa-champions', nameAr: 'دوري أبطال أوروبا', yallakoraName: 'دوري أبطال أوروبا', yallakoraTourId: '105', espnSlug: 'uefa.champions', country: 'EU' },
  { id: 'eng-premier', nameAr: 'الدوري الإنجليزي', yallakoraName: 'الدوري الإنجليزي', yallakoraTourId: '93', espnSlug: 'eng.1', country: 'GB' },
  { id: 'esp-la-liga', nameAr: 'الدوري الإسباني', yallakoraName: 'الدوري الإسباني', yallakoraTourId: '101', espnSlug: 'esp.1', country: 'ES' },
  { id: 'ita-serie-a', nameAr: 'الدوري الإيطالي', yallakoraName: 'الدوري الإيطالي', yallakoraTourId: '100', espnSlug: 'ita.1', country: 'IT' },
  { id: 'ger-bundesliga', nameAr: 'الدوري الألماني', yallakoraName: 'الدوري الألماني', yallakoraTourId: '98', espnSlug: 'ger.1', country: 'DE' },
  { id: 'fra-ligue-1', nameAr: 'الدوري الفرنسي', yallakoraName: 'الدوري الفرنسي', yallakoraTourId: '95', espnSlug: 'fra.1', country: 'FR' },
  { id: 'saudi-pro-league', nameAr: 'الدوري السعودي', yallakoraName: 'الدوري السعودي', yallakoraTourId: '102', espnSlug: 'ksa.1', country: 'SA' },
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
  /** Arabic status as the source words it («لم تبدأ», «انتهت», «الشوط الثاني»). */
  statusText: string;
  /** Cairo-local kickoff as the source shows it (hh:mm). */
  kickoff: string | null;
  round: string | null;
  /** Detail page, absolute. */
  url?: string;
  /** Minute for a live match, when the source gives one. */
  minute: number | null;
  /** Which provider this row came from, so the UI can be honest if it matters. */
  dataSource: 'yallakora' | 'espn';
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
  /** False when the source shows played/goals/points only (no W/D/L). */
  hasFullRecord: boolean;
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

/** `HH:MM` Cairo-local from an ISO instant, e.g. ESPN's `2026-11-22T14:00Z`. */
export function cairoClock(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const local = new Date(ms + 2 * 60 * 60 * 1000);
  return local.toISOString().slice(11, 16);
}

function textOf(html: string): string {
  return stripBoilerplate(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '));
}

/**
 * Map the Arabic status word to our four states.
 *
 * Measured vocabulary from 24 days of pages: «لم تبدأ» (319), «انتهت» (219),
 * «مباشر» (2), «الشوط الثاني» (1). Anything with a minute or a half in it is live.
 */
export function statusOf(word: string): MatchStatus {
  const w = word.trim();
  if (/انتهت|نهاية|انتهي|FT/i.test(w)) return 'finished';
  if (/مباشر|الشوط|جارية|نصف|دقيقة|\d+\s*'/.test(w)) return 'live';
  if (/لم تبدأ|قادمة|تأجيل|مؤجلة|لم تبدا/.test(w)) return 'upcoming';
  return 'unknown';
}

/**
 * Leagues on the matches page that are not football.
 *
 * Yallakora's day page mixes sports: «كرة يد - السوبر المصري» appeared as a
 * grouping heading with real match rows under it. A football scores screen must
 * not list a handball final.
 */
export function isFootballLeague(name: string): boolean {
  return !/كرة يد|كرة سلة|طائرة|سلة|يد -|تنس|سباحة|ألعاب/.test(name);
}

/** `1`-indexed competition lookup by the source's league heading. */
export function competitionForLeague(league: string): Competition | undefined {
  return COMPETITIONS.find((c) => league.includes(c.yallakoraName));
}

/**
 * Parse one day's fixtures from the matches-center page.
 *
 * Every match sits in `<div class="allData">` and the competition is the text of
 * the last `<h2>` before it. Measured: 29-30 matches on a normal day, 4 of them
 * in «الدوري المصري».
 */
export function parseYallakoraDay(html: string, date: string): MatchRow[] {
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
    // Skip handball, basketball and anything else that is not football.
    if (league && !isFootballLeague(league)) continue;
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
    const link = (block.match(/href="([^"]*\/match\/[^"]+?)"/) ?? [])[1];
    const comp = competitionForLeague(league);
    const numeric = (v: string | undefined): number | null =>
      /^\d+$/.test((v ?? '').trim()) ? Number(v!.trim()) : null;
    const status = statusOf(statusWord);
    rows.push({
      id: `yk-${date}-${rows.length + 1}`,
      competitionId: comp?.id ?? 'other',
      competitionName: comp?.nameAr ?? (league || 'بطولات أخرى'),
      home: teams[0]!,
      away: teams[1]!,
      // A score only means something once the match has started.
      homeScore: status === 'upcoming' ? null : numeric(scores[0]),
      awayScore: status === 'upcoming' ? null : numeric(scores[1]),
      status,
      statusText: statusWord.trim(),
      kickoff: time,
      round,
      url: link ? `${YALLAKORA_BASE}${link.split('#')[0]}` : undefined,
      minute: minuteOf(statusWord),
      dataSource: 'yallakora',
    });
  }
  return rows;
}

/** A minute inside the status word, when the source gives one. */
export function minuteOf(word: string): number | null {
  const m = word.match(/(\d{1,3})\s*'/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 && n <= 130 ? n : null;
}

interface WRow {
  position: string | null;
  team: string;
  cells: string[];
}

/**
 * Every `<div class="wRow">` on a Yallakora competition page.
 *
 * Split on the next row's position rather than a lookahead: the last row of a
 * table is followed by closing divs, and a lookahead bounded by them dropped the
 * 20th team of the English table (measured: 19 of 20).
 */
export function parseWrows(html: string): WRow[] {
  const positions: number[] = [];
  for (const m of html.matchAll(/<div class="wRow"/g)) positions.push(m.index!);
  const out: WRow[] = [];
  for (let i = 0; i < positions.length; i += 1) {
    const start = positions[i]!;
    const block = html.slice(start, positions[i + 1] ?? start + 4000);
    const team = (block.match(/class="item team">[\s\S]{0,900}?<p[^>]*>([^<]+)<\/p>/) ?? [])[1];
    if (!team) continue;
    const cells = [...block.matchAll(/class="item dtls">\s*([^<]*?)\s*</g)].map((x) => x[1]!.trim());
    const position = (block.match(/class="item arrng">\s*([^<]*?)\s*</) ?? [])[1]?.trim() ?? null;
    out.push({ position, team: team.trim(), cells });
  }
  return out;
}

function groupOf(html: string, at: number): string | null {
  // The latest group heading before the row, by position. A fixed-size window is
  // wrong: rows further than the window from their heading lost it, which split
  // the Egyptian league into 4 + 16.
  const headingRe = /المجموعة\s*(\d+)/g;
  let last: { at: number; label: string } | null = null;
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(html)) && m.index < at) {
    last = { at: m.index, label: `المجموعة ${m[1]}` };
  }
  return last?.label ?? null;
}

/**
 * Standings from a `/tour-standing/<id>` page: played, W, D, L, for, against, points.
 *
 * Returns null when the page has no real numbers — the Egyptian league and the
 * Champions League both come back as all-zero rows, and an all-zero table shown as
 * fact would be worse than saying it is unavailable.
 */
export function parseFullStandings(html: string, competitionId: string): StandingsTable[] {
  const rows: StandingRow[] = [];
  for (const row of parseWrows(html)) {
    if (row.cells.length < 7) continue;
    const n = row.cells.map((c) => (c === '' ? 0 : Number(c)));
    if (n.some((x) => !Number.isFinite(x))) continue;
    rows.push({
      position: row.position ? Number(row.position) : rows.length + 1,
      team: row.team,
      played: n[0]!,
      won: n[1]!,
      drawn: n[2]!,
      lost: n[3]!,
      goalsFor: n[4]!,
      goalsAgainst: n[5]!,
      points: n[6]!,
    });
  }
  const meaningful = rows.length > 0 && rows.some((r) => r.played > 0 || r.points > 0);
  if (!meaningful) return [];
  return [{ competitionId, group: null, rows, hasFullRecord: true }];
}

/**
 * Standings from a `/tour/<id>` page: 4 columns (played, for, against, points).
 *
 * This is the only real table for the Egyptian league, and the league-phase table
 * for the Champions League and the CAF competition.
 */
export function parseYallakoraStandings(html: string, competitionId: string): StandingsTable[] {
  const positions: number[] = [];
  for (const m of html.matchAll(/<div class="wRow"/g)) positions.push(m.index!);
  const byGroup = new Map<string | null, StandingRow[]>();
  positions.forEach((at, i) => {
    const block = html.slice(at, positions[i + 1] ?? at + 4000);
    const team = (block.match(/class="item team">[\s\S]{0,900}?<p[^>]*>([^<]+)<\/p>/) ?? [])[1];
    if (!team) return;
    const cells = [...block.matchAll(/class="item dtls">\s*([^<]*?)\s*</g)].map((x) => Number(x[1]!.trim()));
    if (cells.length < 4 || cells.some((x) => !Number.isFinite(x))) return;
    const group = groupOf(html, at);
    const list = byGroup.get(group) ?? [];
    list.push({
      position: list.length + 1,
      team: team.trim(),
      played: cells[0]!,
      goalsFor: cells[1]!,
      goalsAgainst: cells[2]!,
      points: cells[3]!,
      // The 4-column source has no W/D/L; zeros here mean "not shown", and
      // `hasFullRecord` tells the app not to print them as real zeros.
      won: 0,
      drawn: 0,
      lost: 0,
    });
    byGroup.set(group, list);
  });
  const tables: StandingsTable[] = [];
  for (const [group, allRows] of byGroup) {
    if (!allRows.length) continue;
    // A page can append an all-zero qualification table after the real one (the
    // Champions League does: a duplicate «لاسك لينز» with 0/0/0/0). Rows with no
    // games played are dropped when the same table also has real rows, and teams
    // are de-duplicated keeping the first — the higher position.
    const hasReal = allRows.some((r) => r.played > 0 || r.points > 0);
    const seen = new Set<string>();
    const rows = allRows.filter((r) => {
      if (hasReal && r.played === 0 && r.points === 0) return false;
      if (seen.has(r.team)) return false;
      seen.add(r.team);
      return true;
    });
    if (!rows.length) continue;
    if (!hasReal) continue;
    rows.forEach((r, i) => {
      r.position = i + 1;
    });
    tables.push({ competitionId, group, rows, hasFullRecord: false });
  }
  // A group label only means something when there are several tables. The
  // Champions League league phase is one table of 36 under a «المجموعة 1» column
  // header, and the Egyptian league is one table of 20; labelling either as
  // «المجموعة 1» would be false. Real group stages keep their labels.
  if (tables.length === 1) tables[0]!.group = null;
  return tables;
}

/**
 * Parse one ESPN scoreboard day — the fallback only.
 *
 * ESPN sends English names and UTC kickoffs, so every name goes through the
 * Arabic map and every time is shifted to Cairo. Anything unmapped keeps its
 * English name rather than showing a blank.
 */
export function parseEspnScoreboard(json: unknown, competition: Competition): MatchRow[] {
  const events = ((json as { events?: unknown[] }).events ?? []) as Array<Record<string, any>>;
  const out: MatchRow[] = [];
  for (const event of events) {
    const block = (event['competitions'] as Array<Record<string, any>> | undefined)?.[0];
    if (!block) continue;
    const competitors = (block['competitors'] as Array<Record<string, any>> | undefined) ?? [];
    const home = competitors.find((c) => c['homeAway'] === 'home');
    const away = competitors.find((c) => c['homeAway'] === 'away');
    if (!home || !away) continue;
    const state = String(block['status']?.['type']?.['state'] ?? '');
    const clock = block['status']?.['displayClock'];
    const finished = state === 'post';
    // ESPN sends "0" for a match that has not started: report null instead, so
    // the app shows a kickoff time rather than a false 0-0.
    const score = (c: Record<string, any> | undefined): number | null => {
      if (!finished && state !== 'in') return null;
      const raw = c?.['score'];
      return typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : null;
    };
    out.push({
      id: `espn-${event['id']}`,
      competitionId: competition.id,
      competitionName: competition.nameAr,
      home: arabicTeam(String(home['team']?.['displayName'] ?? '')),
      away: arabicTeam(String(away['team']?.['displayName'] ?? '')),
      homeScore: score(home),
      awayScore: score(away),
      status: state === 'in' ? 'live' : state === 'post' ? 'finished' : 'upcoming',
      // Arabic, like every other user-visible string: the app never renders the
      // English "Sun, November 22nd at 9:00 AM EST" ESPN sends.
      statusText: state === 'in' ? 'مباشر' : state === 'post' ? 'انتهت' : 'لم تبدأ',
      kickoff: cairoClock(String(event['date'] ?? '')),
      round: null,
      minute: state === 'in' && typeof clock === 'string' ? Number(clock.replace(/[^\d]/g, '')) || null : null,
      dataSource: 'espn',
    });
  }
  return out;
}

/**
 * Arabic club names for the ESPN fallback.
 *
 * Only the clubs that appear in our eight competitions, and only as a safety net:
 * the primary source already speaks Arabic. A missing entry falls back to the
 * English name, which is ugly but not blank, and the app is honest about the
 * provider.
 */
export const ESPN_TEAM_AR: Record<string, string> = {
  'Liverpool': 'ليفربول',
  'Manchester United': 'مانشستر يونايتد',
  'Manchester City': 'مانشستر سيتي',
  'Arsenal': 'أرسنال',
  'Chelsea': 'تشيلسي',
  'Tottenham Hotspur': 'توتنهام هوتسبر',
  'Newcastle United': 'نيوكاسل يونايتد',
  'Aston Villa': 'أستون فيلا',
  'Brighton & Hove Albion': 'برايتون',
  'West Ham United': 'وست هام يونايتد',
  'Everton': 'إيفرتون',
  'Crystal Palace': 'كريستال بالاس',
  'Fulham': 'فولهام',
  'Brentford': 'برينتفورد',
  'Nottingham Forest': 'نوتينجهام فورست',
  'Wolverhampton Wanderers': 'وولفرهامبتون',
  'Bournemouth': 'بورنموث',
  'Leeds United': 'ليدز يونايتد',
  'Sunderland': 'سندرلاند',
  'Burnley': 'بيرنلي',
  'Real Madrid': 'ريال مدريد',
  'Barcelona': 'برشلونة',
  'Atletico Madrid': 'اتلتيكو مدريد',
  'Sevilla': 'إشبيلية',
  'Real Sociedad': 'ريال سوسيداد',
  'Villarreal': 'فياريال',
  'Real Betis': 'ريال بيتيس',
  'Valencia': 'فالنسيا',
  'Athletic Bilbao': 'أتلتيك بيلباو',
  'Juventus': 'يوفنتوس',
  'Inter Milan': 'إنتر ميلان',
  'AC Milan': 'ميلان',
  'Napoli': 'نابولي',
  'Roma': 'روما',
  'Lazio': 'لاتسيو',
  'Atalanta': 'أتالانتا',
  'Fiorentina': 'فيورنتينا',
  'Bayern Munich': 'بايرن ميونخ',
  'Borussia Dortmund': 'بروسيا دورتموند',
  'RB Leipzig': 'لايبزيج',
  'Bayer Leverkusen': 'باير ليفركوزن',
  'Eintracht Frankfurt': 'آينتراخت فرانكفورت',
  'Paris Saint-Germain': 'باريس سان جيرمان',
  'Marseille': 'مارسيليا',
  'Lyon': 'ليون',
  'Monaco': 'موناكو',
  'Lille': 'ليل',
  'Al Hilal': 'الهلال',
  'Al Nassr': 'النصر',
  'Al Ittihad': 'الاتحاد',
  'Al Ahli': 'الأهلي',
  'Al Shabab': 'الشباب',
  'Al Ettifaq': 'الاتفاق',
  'Al Taawoun': 'التعاون',
  'Al Fateh': 'الفتح',
  'Damac': 'ضمك',
  'Al Khaleej': 'الخليج',
  'Al Fayha': 'الفيحاء',
  'Al Riyadh': 'الرياض',
  'Al Okhdood': 'الأخدود',
  'Al Qadsiah': 'القادسية',
  'Al Najma': 'النجمة',
  'Al Kholood': 'الخلود',
  'Al Orobah': 'العروبة',
  'Al Raed': 'الرائد',
  'Al Wehda': 'الوحدة',
};

/** Arabic name for an ESPN club, or the original when we have no entry. */
export function arabicTeam(name: string): string {
  return ESPN_TEAM_AR[name] ?? name;
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
