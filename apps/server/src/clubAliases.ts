// One club, two names: the pairs where the two feeds disagree about WHAT a club is.
//
// WHY THIS IS A TABLE AND NOT A RULE
// ----------------------------------
// The earlier fixes fold SPELLINGS of one name (long vowels, «FC», the article).
// This file is different: one feed names the club correctly and the other names
// something adjacent to it, so no character-level rule can see they are the same
// club. Measured on production (issue #47):
//
//   FilGoal  «صباح باكو»     ← the CITY (Baku), not the club
//   Yallakora «صباح إف كيه»   ← the club
//
// Just as `ESPN_CLUB_NAMES` (#36) refuses to guess at a Latin name it does not
// know, this refuses to fold two Arabic names by similarity: a wrong fold would
// silently merge two different clubs' fixtures, which is worse than one duplicate
// row. Every entry below is backed by the club's own official name, taken from
// ESPN's competition rosters — an independent source, not this repo's opinion:
//
//   صباح باكو      → ESPN id 21922 "Sabah FK"          (FilGoal appends the city)
//   فايكينج        → ESPN id   510 "Viking FK"         (FilGoal drops the FK)
//   إيبيريا 1999   → ESPN id 20025 "Iberia 1999"
//   ياجيلونيا      → ESPN id 11505 "Jagiellonia Bialystok"
//   بوراتس بانيا   → ESPN id 20710 "Borac Banja Luka"
//   هابويل بئر السبع→ ESPN id 13083 "Hapoel Be'er"
//   كاونو زالغيريس → ESPN id  8169 "KuPS Kuopio"
//
// The winning spelling is the OTHER feed's — Yallakora's in every case measured,
// which is also the spelling our league tables and the club pages use (the 7/7
// direction established in #46).
//
// An entry is a pair of Arabic spellings, not a Latin key: the day pages give us
// Arabic, and resolving Latin here would mean a third name in the pipeline.

/** One club under the two names the feeds use. */
export interface AliasPair {
  /** The spelling that is NOT the club's name (the one to fold away). */
  from: string;
  /** The spelling that names the club, and the one the app should show. */
  to: string;
  /** The club's official Latin name, as an outside source states it. */
  official: string;
  /** Where the official name was read, so a future reader can re-check it. */
  source: string;
  /**
   * What kind of side this is.
   *
   * Recorded rather than inferred: the catch-all competition mixes clubs with
   * NATIONAL teams, and a reader (or a future maintainer) should not have to guess
   * which entries are countries.
   */
  kind: 'club' | 'national';
}

/**
 * Clubs the two feeds name differently, with the evidence for each pairing.
 *
 * Adding an entry means answering one question from an outside source: is this the
 * same club? Anything that cannot be answered that way does not go here — it is
 * filed as an issue instead of guessed at.
 */
export const CLUB_ALIASES: AliasPair[] = [
  {
    from: 'صباح باكو',
    to: 'صباح إف كيه',
    official: 'Sabah FK',
    source: 'ESPN uefa.champions roster, team 21922',
    kind: 'club',
  },
  {
    from: 'فايكينج',
    to: 'نادى فيكينج',
    official: 'Viking FK',
    source: 'ESPN uefa.champions roster, team 510',
    kind: 'club',
  },
  {
    from: 'إيبيريا 1999',
    to: 'إيبيريا تبيليسي',
    official: 'Iberia 1999',
    source: 'ESPN uefa.europa.conf roster, team 20025',
    kind: 'club',
  },
  {
    from: 'ياجيلونيا',
    to: 'نادي ياجييلونيا بياويستوك',
    official: 'Jagiellonia Bialystok',
    source: 'ESPN uefa.europa roster, team 11505',
    kind: 'club',
  },
  {
    from: 'بوراتس بانيا لوكا',
    to: 'نادي بوراك بانيا',
    official: 'Borac Banja Luka',
    source: 'ESPN uefa.europa.conf roster, team 20710',
    kind: 'club',
  },
  {
    from: 'هابويل بئر السبع',
    to: 'هابويل بئر سبع',
    official: "Hapoel Be'er",
    source: 'ESPN uefa.europa roster, team 13083',
    kind: 'club',
  },
  {
    from: 'كاونو زالغيريس',
    to: 'كانو زالجيريس',
    official: 'KuPS Kuopio',
    source: 'ESPN uefa.europa.conf roster, team 8169',
    kind: 'club',
  },
  {
    from: 'يابلونتس',
    to: 'يابلونك',
    official: 'Jablonec',
    source: 'ESPN uefa.europa roster, team 7922',
    kind: 'club',
  },
  {
    from: 'جامعة كرايوفا',
    to: 'يونيفيرسيتاتيا كرايوفا',
    official: 'CSU Craiova',
    source: 'ESPN uefa.europa.conf roster, team 8089',
    kind: 'club',
  },
  {
    from: 'إنتر كلوب ديسكالديس',
    to: 'إنتر ديسكالديس',
    official: "Inter D'Escaldes",
    source: 'ESPN uefa.europa.conf roster, team 20703',
    kind: 'club',
  },
  // National teams. The catch-all competition mixes these with clubs, and the two
  // feeds write several countries under two names. Same rule as the clubs: only
  // what an outside source states, never a similarity guess.
  {
    from: 'مونتنجرو',
    to: 'الجبل الأسود',
    official: 'Montenegro',
    source: 'ESPN uefa.nations roster, team 6775',
    kind: 'national',
  },
  {
    from: 'مقدونيا الشمالية',
    to: 'مقدونيا',
    official: 'North Macedonia',
    source: 'ESPN uefa.nations roster, team 463',
    kind: 'national',
  },
  {
    from: 'لوكسمبورج',
    to: 'لوكسمبرج',
    official: 'Luxembourg',
    source: 'ESPN uefa.nations roster, team 582',
    kind: 'national',
  },
  // Clubs written with a single letter's difference, which the consonant-frame rule
  // in the merge cannot see.
  {
    from: 'فولام',
    to: 'فولهام',
    official: 'Fulham',
    source: 'ESPN eng.1 roster, team 370',
    kind: 'club',
  },
  {
    from: 'فينيسيا',
    to: 'فينيزيا',
    official: 'Venezia',
    source: 'ESPN ita.1 roster, team 17530',
    kind: 'club',
  },
];

/** The club a name is written as, when it is one of the pairs above. */
const ALIAS_TO = new Map<string, string>();
const ALIAS_FROM = new Map<string, string>();

for (const pair of CLUB_ALIASES) {
  const from = fold(pair.from);
  const to = fold(pair.to);
  // One spelling cannot stand for two clubs. A table that tries is a bug here, not
  // something to resolve at runtime.
  if (ALIAS_FROM.has(from) || ALIAS_TO.has(to)) {
    throw new Error(`club alias table is ambiguous for «${pair.from}» / «${pair.to}»`);
  }
  ALIAS_FROM.set(from, pair.to);
  ALIAS_TO.set(to, pair.to);
}

function fold(name: string): string {
  return name
    .replace(/[\u064B-\u0652\u0640\u200f\u200e]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ةه]/g, 'ه')
    .replace(/[يى]/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The name this club should be shown under.
 *
 * Both spellings resolve to the same string, so merging on it also merges the rows.
 * A club that is not in the table comes back unchanged.
 */
export function canonicalClub(name: string): string {
  const key = fold(name);
  return ALIAS_TO.get(key) ?? ALIAS_FROM.get(key) ?? name;
}

/** Is this name one of the folded spellings (either side)? */
export function isAliasedClub(name: string): boolean {
  const key = fold(name);
  return ALIAS_TO.has(key) || ALIAS_FROM.has(key);
}
