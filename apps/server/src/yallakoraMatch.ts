// Yallakora's match page: the scorer list and the line-up.
//
// MEASURED 2026-11-23 on a real finished Egyptian league fixture
// (البنك الأهلي 1-1 المصري, match 112045). Yallakora — a source we already read
// every minute and whose robots.txt permits us — publishes BOTH:
//
//   <div class="team teamA playerScorers">
//     <div class="matchScorer">
//       <div class="goal icon-goal ">
//         <a class="player" href="/…/player/61655/…">
//           <span class="playerName">أحمد ياسر ريان</span>
//           <span class="time">52</span>
//         </a>
//       </div>
//
// So «هدافين بدقائق» — which this project twice declared impossible — is
// available from a source we were already allowed to use. FilGoal's own page
// carries the same information only after the whistle (its live pages show a 7-0
// score with zero events); Yallakora has the scorer row on the match page.
//
// The `time` span is the goal's minute. It is read, never derived: a scorer with no
// minute renders without one rather than borrowing the match clock.

import { arabicChannel } from './football.js';

/** One goal, as the source lists it. */
export interface MatchGoal {
  /** Goal minute as published. Null when the row carries none. */
  minute: number | null;
  player: string;
  /** Which side scored: the page's `teamA` / `teamB` column. */
  side: 'A' | 'B';
  /** True for an own goal, which the page marks separately. */
  ownGoal: boolean;
}

function textOf(fragment: string): string {
  return fragment
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Every goal row on a Yallakora match page.
 *
 * Returns `[]` when the page has no scorer block (an unplayed match), which is the
 * honest empty answer the screen renders as "not published yet".
 */
export function parseYallakoraGoals(html: string): MatchGoal[] {
  if (!html) return [];
  const blocks = [...html.matchAll(/class="team team([AB]) playerScorers"([\s\S]*?)(?=<div class="team team[AB] playerScorers"|<div class="matcResultAction|$)/g)];
  const out: MatchGoal[] = [];
  for (const block of blocks) {
    const side = block[1] as 'A' | 'B';
    const body = block[2] ?? '';
    // Each scorer is an anchor carrying the player name and, usually, the minute.
    for (const anchor of body.matchAll(/<a class="player"[^>]*>([\s\S]*?)<\/a>/g)) {
      const inner = anchor[1] ?? '';
      const name = textOf((inner.match(/class="playerName">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
      if (!name) continue;
      const rawMinute = (inner.match(/class="time">\s*([^<]*?)\s*</) ?? [])[1] ?? '';
      const minute = /^\d{1,3}$/.test(rawMinute) && Number(rawMinute) <= 130 ? Number(rawMinute) : null;
      // An own goal is marked on the row rather than named differently.
      const ownGoal = /icon-own|ownGoal|own-goal/i.test(inner);
      out.push({ minute, player: name, side, ownGoal });
    }
  }
  return out;
}

/** One player as Yallakora's line-up lists them. */
export interface YallakoraPlayer {
  name: string;
  shirtNumber: number | null;
  /** «حارس مرمى», «مدافع», … when the page names a position. */
  position: string | null;
}

export interface YallakoraLineups {
  home: YallakoraPlayer[];
  away: YallakoraPlayer[];
}

/**
 * The two line-ups from a Yallakora match page.
 *
 * Measured on a played fixture: the formation tab carries eleven players a side
 * with a shirt number each. An unplayed match has the tab but no players, so this
 * returns null and the screen says the line-up is not announced yet.
 */
export function parseYallakoraLineups(html: string): YallakoraLineups | null {
  if (!html) return null;
  // The formation block holds the players under the pitch; the two sides are
  // marked `teamA` / `teamB`, the same way the scorer rows are.
  const side = (tag: 'A' | 'B'): YallakoraPlayer[] => {
    const re = new RegExp(
      `class="[^"]*team${tag}[^"]*(?:formation|lineup|teamList)[^"]*"([\\s\\S]*?)(?=class="[^"]*team(?:A|B)[^"]*(?:formation|lineup|teamList)|$)`,
      'i',
    );
    const body = (html.match(re) ?? [])[1] ?? '';
    const players: YallakoraPlayer[] = [];
    for (const row of body.matchAll(/class="[^"]*player[^"]*"[\s\S]{0,400}?<\/div>/g)) {
      const frag = row[0] ?? '';
      const name = textOf((frag.match(/class="[^"]*playerName[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
      if (!name) continue;
      const shirt = (frag.match(/class="[^"]*number[^"]*">\s*(\d{1,2})\s*</) ?? [])[1] ?? '';
      players.push({
        name,
        shirtNumber: /^\d{1,2}$/.test(shirt) ? Number(shirt) : null,
        position: null,
      });
    }
    return players;
  };
  const home = side('A');
  const away = side('B');
  if (!home.length && !away.length) return null;
  return { home, away };
}

/** The channel and commentator the match page names, when it names them. */
export function parseYallakoraMatchMeta(html: string): {
  channel: string | null;
  commentator: string | null;
} {
  if (!html) return { channel: null, commentator: null };
  const channelRaw =
    (html.match(/class="[^"]*channel[^"]*"[^>]*>([\s\S]{0,120}?)</) ?? [])[1] ?? '';
  const commentatorRaw =
    (html.match(/المعلق[^<]{0,10}<[^>]*>([^<]{2,40})</) ?? [])[1] ??
    (html.match(/class="[^"]*commentator[^"]*"[^>]*>([\s\S]{0,120}?)</) ?? [])[1] ??
    '';
  const channel = textOf(channelRaw);
  const commentator = textOf(commentatorRaw);
  return {
    channel: channel ? arabicChannel(channel) : null,
    commentator: commentator || null,
  };
}
