// Team pages: one club's fixtures, results and coverage.
//
// The ids we already store are enough — a team shows up in the day rows as
// `homeTeamId`/`awayTeamId` (FilGoal) or through the standings row's `teamId`
// (Yallakora) — so this needs no new ingest. It reads the cached days the app is
// already fetching, which keeps it polite: no extra request to a source for a page
// a reader opens.
//
// Everything is derived from what we already hold, so nothing here can invent a
// match that did not happen.

import { normalizeTeam, type MatchRow } from './football.js';
import { COMPETITIONS } from './football.js';
import { getCachedDay } from './footballStore.js';
import { relatedNews } from './matchNews.js';
import { getAllArticles } from './db.js';

export interface TeamPage {
  name: string;
  /** Crest on our own server, when a day row carried one. */
  logo: string | null;
  /** Provider ids seen for this club, so a follow can be keyed stably. */
  teamIds: string[];
  /** Competitions this club has appeared in, Egypt first. */
  competitionIds: string[];
  upcoming: MatchRow[];
  recent: MatchRow[];
  news: ReturnType<typeof relatedNews>;
}

/** Every cached day, newest fetch first, so a page reflects what we hold. */
function cachedMatches(): MatchRow[] {
  const out: MatchRow[] = [];
  // The store keeps at most a week of days; that is what a team page can honestly
  // show, and it is exactly the window a reader cares about.
  const today = Date.now();
  for (let offset = -6; offset <= 6; offset += 1) {
    const d = new Date(today + offset * 86_400_000 + 2 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const day = getCachedDay(key);
    if (day && !day.unavailable) out.push(...day.matches);
  }
  return out;
}

const sameTeam = (a: string, b: string): boolean => normalizeTeam(a) === normalizeTeam(b);

/**
 * Build a team page from the cached days.
 *
 * `name` is the display name the reader tapped. Matching is by normalised name,
 * which is the same rule the match-news matcher uses, so a page and its news agree
 * about which club they are describing.
 */
export function buildTeamPage(name: string, options: { matches?: MatchRow[] } = {}): TeamPage {
  const all = options.matches ?? cachedMatches();
  const mine = all.filter((m) => sameTeam(m.home, name) || sameTeam(m.away, name));

  const teamIds = new Set<string>();
  const competitionIds = new Set<string>();
  let logo: string | null = null;
  for (const m of mine) {
    const isHome = sameTeam(m.home, name);
    if (m.homeTeamId) teamIds.add(m.homeTeamId);
    if (m.awayTeamId) teamIds.add(m.awayTeamId);
    if (isHome && m.homeLogo) logo = m.homeLogo;
    if (!isHome && m.awayLogo) logo = m.awayLogo;
    if (m.competitionId && m.competitionId !== 'other') competitionIds.add(m.competitionId);
  }

  // A finished match belongs to `recent`, anything else to `upcoming`; a live
  // match is neither, and belongs at the top of what is happening now.
  const upcoming = mine
    .filter((m) => m.status === 'upcoming' || m.status === 'live')
    .sort((a, b) => (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99'));
  const recent = mine
    .filter((m) => m.status === 'finished')
    .sort((a, b) => (b.kickoff ?? '').localeCompare(a.kickoff ?? ''));

  const ordered = [...competitionIds].sort((a, b) => {
    const pa = COMPETITIONS.find((c) => c.id === a)?.priority ?? 99;
    const pb = COMPETITIONS.find((c) => c.id === b)?.priority ?? 99;
    return pa - pb;
  });

  // News for the club on its own: both sides of the pair are the same club, which
  // is how `relatedNews` is already used for a match.
  const country = COMPETITIONS.find((c) => c.id === ordered[0])?.country;
  const news = relatedNews(name, name, {
    limit: 10,
    articles: getAllArticles(),
    country,
  });

  return {
    name,
    logo,
    teamIds: [...teamIds],
    competitionIds: ordered,
    upcoming,
    recent,
    news,
  };
}
