// FilGoal ingestion: Egyptian results, and the richest per-match detail we have.
//
// Approved by the user for Egyptian results, and measured (2026-11-22) to be
// cleaner than Yallakora for that job: every match is a server-rendered block
// with a stable id, both team names, a real score, the status, the kickoff date
// and time, the stadium and the broadcasting channel.
//
// Three traps, all measured rather than assumed:
//
//   1. `?date=` DOES work, but only if you read the right container. The page
//      also renders a strip of featured/pinned matches above the day list, so
//      reading from the top of the document returns the same fixtures for every
//      date — which looked like "the date parameter is ignored". Everything is
//      read from `<div data-matches-scroller>`, stopping at the side column.
//   2. Two different markups exist on one page: the featured strip uses
//      `data-match-id` and `<span>` team names, while the day list uses
//      `<strong>` team names and carries the id in the match link and in
//      `data-matchId` inside `.mi_stats`. Parsing only the first shape returned
//      zero matches for a real day.
//   3. The competition is the nearest `<h6>` heading above each match, not an
//      attribute on the day list.
//
// Times here are already Cairo-local, written `DD-MM-YYYY - HH:MM`, so the date
// can be confirmed against the day we asked for.

import { getPage } from './football.js';

export const FILGOAL_BASE = 'https://www.filgoal.com';
export const FILGOAL_MATCHES = `${FILGOAL_BASE}/matches`;

/** FilGoal championship ids, measured from the page's own champion selector. */
export const FILGOAL_CHAMPIONS: Record<string, string> = {
  '1667': 'egyptian-premier',
  '1649': 'eng-premier',
  '1657': 'esp-la-liga',
  '1647': 'ita-serie-a',
  '1651': 'ger-bundesliga',
  '1658': 'fra-ligue-1',
  '1676': 'caf-champions',
  '1659': 'uefa-champions',
  '1661': 'saudi-pro-league',
  '1669': 'caf-confederation',
  '1666': 'eng-championship',
  '1678': 'tur-super-lig',
};

export interface FilGoalMatch {
  /** FilGoal's own match id — stable across pages, so it can key a notification. */
  matchId: string;
  competitionId: string;
  competitionName: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  status: 'live' | 'upcoming' | 'finished' | 'unknown';
  /** Arabic status exactly as the page words it («لم تبدأ», «مباشر»). */
  statusText: string;
  /** Cairo-local `HH:MM`. */
  kickoff: string | null;
  /** Cairo-local `YYYY-MM-DD` from the page's own stamp. */
  date: string | null;
  stadium: string | null;
  channel: string | null;
  url: string;
}

/** The day list only: strip the featured strip and the side column. */
export function scrollerRegion(html: string): string {
  const start = html.indexOf('data-matches-scroller');
  if (start < 0) return '';
  let region = html.slice(start);
  const side = region.indexOf('<div class="side">');
  if (side > 0) region = region.slice(0, side);
  return region;
}

function text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x9;|&#9;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The channel name as the page states it, translated.
 *
 * FilGoal writes «beIN SPORTS 1 HD» and «On Sport MAX» in Latin script inside
 * Arabic rows — the same defect as an English club name. A channel we do not
 * recognise keeps its name rather than being blanked.
 */
export function filGoalChannel(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/\s*HD\s*$/i, '').trim();
  const digits = cleaned.match(/(\d+)\s*$/)?.[1];
  if (/be\s*in/i.test(cleaned)) return digits ? `بي إن سبورتس ${digits}` : 'بي إن سبورتس';
  if (/^ssc/i.test(cleaned)) return digits ? `SSC ${digits}` : 'SSC';
  // «On Sport» and «On Sport MAX» are the Egyptian rights holder, أون سبورت.
  if (/^on\s*sport/i.test(cleaned)) {
    if (/max/i.test(cleaned)) return digits ? `أون سبورت ماكس ${digits}` : 'أون سبورت ماكس';
    return digits ? `أون سبورت ${digits}` : 'أون سبورت';
  }
  if (/^ontime|أون تايم/i.test(cleaned)) return digits ? `أون تايم سبورتس ${digits}` : 'أون تايم سبورتس';
  return cleaned;
}

/** Map the page's Arabic status word to our four states. */
export function filGoalStatus(word: string): FilGoalMatch['status'] {
  const w = word.trim();
  if (/انتهت|انتهي|نهاية المباراة|بعد التمديد|ركلات ترجيح/i.test(w)) return 'finished';
  if (/مباشر|الشوط|جارية|نصف|استراحة|دقيقة|\d+\s*'/.test(w)) return 'live';
  if (/لم تبدأ|لم تبدا|قادمة|تأجيل|مؤجلة|ملغاة|توقع المباراة/i.test(w)) return 'upcoming';
  return 'unknown';
}

/** Split one `cin_cntnr` block into its fields. */
export function parseFilGoalBlock(block: string, competitionName = ''): FilGoalMatch | null {
  // The id is in the match link, and again in `.mi_stats` as `data-matchId`.
  const matchId =
    (block.match(/data-matchId="(\d+)"/) ?? [])[1] ??
    (block.match(/href="\/matches\/(\d+)\//) ?? [])[1];
  if (!matchId) return null;

  // Day-list markup puts the names in `<strong>`, featured-strip markup in
  // `<span>`. Both are supported because both appear on the same page.
  const strongs = [...block.matchAll(/<strong>([^<]{2,40})<\/strong>/g)].map((m) => m[1]!.trim());
  const spans = [...block.matchAll(/<span>([^<]{2,40})<\/span>/g)].map((m) => m[1]!.trim());
  const names = strongs.length >= 2 ? strongs : spans;
  const home = names[0];
  const away = names[1];
  if (!home || !away) return null;

  const statusText = text((block.match(/class="status[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
  const status = filGoalStatus(statusText);

  // Score: the `<b>` next to each team, which holds " 2 " or just " - ".
  const scoreOf = (side: 'f' | 's'): number | null => {
    const row = block.match(new RegExp(`class="${side}"[\\s\\S]{0,600}?<\\/div>|<div class="${side}">[\\s\\S]{0,600}?<\\/div>`));
    const frag = row ? row[0] : '';
    const digits = text(frag).match(/\d+/);
    return digits ? Number(digits[0]) : null;
  };
  const homeScore = status === 'upcoming' ? null : scoreOf('f');
  const awayScore = status === 'upcoming' ? null : scoreOf('s');

  const stamp = block.match(/(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{1,2}):(\d{2})/);
  const kickoff = stamp ? `${stamp[4]!.padStart(2, '0')}:${stamp[5]}` : null;
  const date = stamp ? `${stamp[3]}-${stamp[2]}-${stamp[1]}` : null;

  const aux = block.slice(block.indexOf('class="match-aux"'));
  const auxSpans = [...aux.matchAll(/<\/svg>\s*([^<]{2,60}?)\s*<\/span>/g)].map((m) => m[1]!.trim());
  const stadium = auxSpans.find((s) => /استاد|ملعب|ستاد|arena|stadium/i.test(s)) ?? null;
  // The channel is the last screen-icon span before the calendar stamp.
  const channelCandidates = [...aux.matchAll(/fb_screen[^>]*><\/use><\/svg>\s*([^<]{2,40}?)\s*<\/span>/g)].map(
    (m) => m[1]!.trim(),
  );
  const channelRaw = channelCandidates.length ? channelCandidates[channelCandidates.length - 1]! : null;

  const href = (block.match(/href="(\/matches\/\d+[^"]*)"/) ?? [])[1];

  return {
    matchId,
    competitionId: FILGOAL_CHAMPIONS[(block.match(/data-champId="(\d+)"/) ?? [])[1] ?? ''] ?? 'other',
    competitionName: competitionName || 'بطولات أخرى',
    home,
    away,
    homeScore,
    awayScore,
    status,
    statusText,
    kickoff,
    date,
    stadium,
    channel: filGoalChannel(channelRaw),
    url: href ? `${FILGOAL_BASE}${href.split('?')[0]}` : '',
  };
}

/**
 * Parse one day's matches from the FilGoal matches page.
 *
 * `expectedDate` drops a block whose own stamp says another day: the featured
 * strip does exactly that, and keeping it would put tomorrow's match on today.
 */
export function parseFilGoalDay(html: string, expectedDate?: string): FilGoalMatch[] {
  const region = scrollerRegion(html);
  if (!region) return [];
  // Walk headings and match blocks together so each match inherits the nearest
  // competition heading above it.
  const marks: Array<{ at: number; heading?: string; match?: boolean }> = [];
  for (const m of region.matchAll(/<h6[^>]*>([\s\S]*?)<\/h6>/g)) {
    marks.push({ at: m.index!, heading: text(m[1]!) });
  }
  for (const m of region.matchAll(/<div class="cin_cntnr">/g)) marks.push({ at: m.index!, match: true });
  marks.sort((a, b) => a.at - b.at);

  const out: FilGoalMatch[] = [];
  let heading = '';
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i]!;
    if (mark.heading !== undefined) {
      heading = mark.heading;
      continue;
    }
    const end = marks[i + 1]?.at ?? region.length;
    const block = region.slice(mark.at, end);
    const parsed = parseFilGoalBlock(block, heading);
    if (!parsed) continue;
    if (expectedDate && parsed.date && parsed.date !== expectedDate) continue;
    out.push(parsed);
  }
  return out;
}

/** Fetch one FilGoal day. Returns null when the page could not be read. */
export async function fetchFilGoalDay(
  date: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FilGoalMatch[] | null> {
  const html = await getPage(`${FILGOAL_MATCHES}?date=${date}`, fetchImpl);
  if (!html) return null;
  return parseFilGoalDay(html, date);
}
