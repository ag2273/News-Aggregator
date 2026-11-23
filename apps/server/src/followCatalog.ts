// The follow screen's catalogue: the clubs a reader can follow, by section.
//
// Built from data we already hold — the cached standings (name, crest, position)
// and the cached days (next fixture) — so opening the screen costs no source
// request and nothing here can invent a club. The sections are the app's
// hierarchy: Egyptian clubs, then the big European leagues, then the Arab ones,
// then national teams.
//
// National teams are the one fixed list. They are not clubs and no source we
// cache publishes a squad list for them, so the set is explicit and each one
// carries its flag. A national team with no fixture on the cached days says so
// rather than showing a made-up friendly.

import { COMPETITIONS, type MatchRow } from './football.js';
import { competitionOrderFor } from './competitionOrder.js';
import { getCachedDay, getCachedStandings } from './footballStore.js';

/**
 * Sections, in the approved design file's own order and numbering.
 *
 * The file draws 1️⃣ Egyptian clubs, 2️⃣ big European clubs, 4️⃣ the Saudi league,
 * then the national teams, with 3️⃣ reserved for the continental clubs. It skips
 * 3️⃣ on the day it was written because that day listed none, so an empty section
 * stays empty rather than being renamed.
 */
export type CatalogSection = 'egypt' | 'europe' | 'continental' | 'saudi' | 'national';

export interface CatalogTeam {
  name: string;
  competitionId: string;
  competitionName: string;
  section: CatalogSection;
  /** Crest on our own server, or null when the source has none. */
  logo: string | null;
  /** League position from the cached table, when the source publishes one. */
  position: number | null;
  /** Emoji flag for a national team; null for a club. */
  flag: string | null;
  /** The club's next fixture inside the cached window, when there is one. */
  nextMatch: { opponent: string; kickoff: string | null; isHome: boolean } | null;
}

/**
 * National teams the reader can follow.
 *
 * Egypt is named in full («منتخب مصر») because «منتخب» alone told the reader
 * nothing — the design's own finding. The set is deliberately small: these are
 * the teams an Arabic football reader follows, and each one is a real side.
 */
const NATIONAL_TEAMS: Array<{ name: string; flag: string }> = [
  { name: 'منتخب مصر', flag: '🇪🇬' },
  { name: 'منتخب السعودية', flag: '🇸🇦' },
  { name: 'منتخب المغرب', flag: '🇲🇦' },
  { name: 'منتخب الجزائر', flag: '🇩🇿' },
  { name: 'منتخب تونس', flag: '🇹🇳' },
];

/** Which section a competition belongs to, from its served priority/country. */
function sectionOf(competitionId: string, country: string): CatalogSection {
  if (competitionId === 'egyptian-premier' || competitionId === 'egypt-cup') return 'egypt';
  // The Saudi league is its own section in the design, not part of «العربية».
  if (competitionId === 'saudi-pro-league') return 'saudi';
  if (country === 'GB' || country === 'ES' || country === 'IT') return 'europe';
  // The continental competitions the file reserves 3️⃣ for.
  if (country === 'AF' || country === 'EU' || competitionId.startsWith('caf-')) return 'continental';
  if (country === 'SA') return 'saudi';
  return 'europe';
}

/** Every cached match, so a club's next fixture can be found without a fetch. */
function cachedMatches(): MatchRow[] {
  const out: MatchRow[] = [];
  const today = Date.now();
  for (let offset = -1; offset <= 3; offset += 1) {
    const key = new Date(today + offset * 86_400_000 + 2 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const day = getCachedDay(key);
    if (day && !day.unavailable) out.push(...day.matches);
  }
  return out;
}

const sameTeam = (a: string, b: string): boolean =>
  a.replace(/\s+/g, ' ').trim() === b.replace(/\s+/g, ' ').trim();

/**
 * The catalogue.
 *
 * A league whose table has not been fetched yet contributes nothing rather than a
 * guessed list: the app asks for the table it already shows on the standings
 * screen, so by the time a reader opens follow they have been warmed.
 */
export function buildFollowCatalog(
  options: { matches?: MatchRow[]; userId?: string | null } = {},
): {
  sections: Array<{ id: CatalogSection; title: string; teams: CatalogTeam[] }>;
} {
  const matches = options.matches ?? cachedMatches();
  const bySection: Record<CatalogSection, CatalogTeam[]> = {
    egypt: [],
    europe: [],
    continental: [],
    saudi: [],
    national: [],
  };

  // The reader's own order when they arranged one (#26). The sections keep their
  // fixed hierarchy — that is a layout, not a ranking — but a club's position inside
  // its section follows the order the reader expects from every other screen.
  const ordered = competitionOrderFor(options.userId ?? null);

  for (const competition of ordered) {
    const table = getCachedStandings(competition.id)?.tables?.[0];
    if (!table || table.rows.length === 0) continue;
    const section = sectionOf(competition.id, competition.country);
    for (const row of table.rows) {
      // The next fixture for this club inside the cached window.
      const next = matches
        .filter(
          (m) =>
            (m.status === 'upcoming' || m.status === 'live') &&
            (sameTeam(m.home, row.team) || sameTeam(m.away, row.team)),
        )
        .sort((a, b) => (a.kickoff ?? '99:99').localeCompare(b.kickoff ?? '99:99'))[0];
      const isHome = next ? sameTeam(next.home, row.team) : false;
      bySection[section].push({
        name: row.team,
        competitionId: competition.id,
        competitionName: competition.nameAr,
        section,
        logo: row.logo ?? null,
        position: row.position ?? null,
        flag: null,
        nextMatch: next
          ? { opponent: isHome ? next.away : next.home, kickoff: next.kickoff, isHome }
          : null,
      });
    }
  }

  bySection.national = NATIONAL_TEAMS.map((n) => ({
    name: n.name,
    // A national team is followed for its own window; there is no league table.
    competitionId: 'national',
    competitionName: 'المنتخبات الوطنية',
    section: 'national' as const,
    logo: null,
    position: null,
    flag: n.flag,
    nextMatch: null,
  }));

  // Titles and numbering come from the approved design file, verbatim.
  return {
    sections: [
      { id: 'egypt' as const, title: '1️⃣ 🇪🇬 أندية الدوري المصري الممتاز', teams: bySection.egypt },
      { id: 'europe' as const, title: '2️⃣ 🏴󠁧󠁢󠁥󠁮󠁧󠁿 كبار أوروبا (الإنجليزي والإسباني والإيطالي)', teams: bySection.europe },
      { id: 'continental' as const, title: '3️⃣ 🏆 البطولات القارية', teams: bySection.continental },
      { id: 'saudi' as const, title: '4️⃣ 🇸🇦 دوري روشن السعودي للمحترفين', teams: bySection.saudi },
      { id: 'national' as const, title: '🌍 المنتخبات الوطنية والعربية', teams: bySection.national },
    ].filter((s) => s.teams.length > 0),
  };
}
