// Matching a match's two teams against our own news corpus.
//
// Every rule here exists because the naive version shipped and was visibly
// wrong on production articles:
//
//   1. «البنك الأهلي» — the National Bank of Egypt — linked to an Ahly match.
//   2. «جامعة أسيوط الأهلية» matched because `includes('الاهلي')` is a substring
//      test and «الأهلية» contains «الأهلي».
//   3. An article naming both clubs was labelled "home", because home was tested
//      first, so the away side's coverage read as the home side's.
//   4. **The big one**: a match «وادي دجلة × الاتحاد السكندري» returned ten
//      articles, every one of them about the European Union (الاتحاد الأوروبي) or
//      a workers' union (الاتحاد العام للنقابات). One generic word is not a club.
//
// The rule that fixes (4): a club is identified by its DISTINCTIVE word, not by
// any word it happens to contain. «الاتحاد السكندري» is identified by «السكندري»
// in corpus text, because «الاتحاد» alone is the union and the EU. When a name
// has more than one word, the words are tried in order of how much they narrow
// the club down — and a word shared by ordinary news (الاتحاد، الأهلي، المصري،
// الزمالك as an institution) only counts when nothing more specific is available
// AND it is not part of a phrase that means something else.
//
// If honest matching yields few or no articles, the tab shows few or none. An
// empty news tab is correct behavior; wrong articles are not.
//
// Everything here is pure and synchronous: it reads nothing, fetches nothing, and
// makes no AI call. The corpus is passed in.

/** Normalise the same way `normalizeForSearch` does, so both sides agree. */
export function normalizeArabic(input: string): string {
  return input
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    .replace(/\u0640/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064A')
    .replace(/\u0629/g, '\u0647')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Words that name an institution, a competition or a country rather than a club.
 *
 * Measured on the production corpus: «الاتحاد الأوروبي», «الاتحاد المصري لتمويل
 * المشروعات», «الاتحاد العام للنقابات», «اتحاد الكرة» all carried «الاتحاد».
 * These cannot identify a club on their own.
 */
const INSTITUTIONAL_WORDS = new Set([
  'الاتحاد',
  'اتحاد',
  'الاهلي',
  'اهلي',
  'المصري',
  'مصري',
  'الزمالك',
  'زمالك',
  'الاسماعيلي',
  'اسماعيلي',
  'الاولمبي',
  'اولمبي',
  'الدولي',
  'دولي',
  'الوطني',
  'وطني',
  'العام',
  'عام',
  'المحلي',
  'محلي',
  'العربي',
  'عربي',
  'الافريقي',
  'افريقي',
  'الاوروبي',
  'اوروبي',
]);

/**
 * Phrases that make a club's name mean something else.
 *
 * Keyed by the normalised token, valued by normalised words that must not appear
 * immediately before it. Arabic glues prepositions onto the next word («بالبنك
 * الأهلي» = «ب» + «البنك»), so the check strips those prefixes.
 */
const FALSE_FRIENDS: Record<string, string[]> = {
  الاهلي: [
    'البنك', 'بنك', 'الجامعه', 'جامعه', 'المدرسه', 'مدرسه',
    'الشركه', 'شركه', 'المستشفي', 'مستشفي', 'فندق', 'الحي', 'حي',
  ],
  الاتحاد: [
    'بنك', 'البنك', 'شركه', 'الشركه', 'نقابه', 'النقابه', 'الاوروبي',
    'الافريقي', 'الدولي', 'العام', 'المصري', 'الرياضي', 'الرياضيه',
    'الاسلامي', 'العربي', 'الوطني', 'الاشتراكي', 'السوفيتي',
  ],
  المصري: ['البنك', 'بنك', 'الدولي', 'العام', 'الوطني', 'القومي'],
  الاسماعيلي: ['بنك', 'البنك', 'المذهب', 'المدرسه'],
  الهلال: ['الاحمر', 'الاحمر'],
  الزمالك: [],
};

/** Strip the Arabic prefixes that attach to a word without changing which word it is. */
export function stripPrefixes(word: string): string {
  return word
    .replace(/^(?:و|ف|ب|ل|ك)(?=ال)/, '')
    .replace(/^(?:و|ف)(?=.)/, '');
}

/**
 * Words that identify a club in a headline without matching half the corpus.
 *
 * One- and two-letter fragments are dropped: «ر.» for ريال and «إف» in
 * «باريس إف سي» would otherwise match everything.
 */
export function teamWords(name: string): string[] {
  const generic = new Set(['منتخب', 'فريق', 'نادي', 'نادى', 'كلوب', 'club', 'fc', 'اف', 'سي']);
  return normalizeArabic(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !generic.has(w));
}

/** Does `haystack` contain `word` as a whole word? */
function hasWord(haystack: string, word: string): boolean {
  // Space-padded comparison avoids \b, which does not treat Arabic letters as
  // word characters in JavaScript.
  return ` ${haystack} `.includes(` ${word} `);
}

/** Is this word too generic to identify a club by itself? */
function isInstitutional(word: string): boolean {
  return INSTITUTIONAL_WORDS.has(word) || INSTITUTIONAL_WORDS.has(stripPrefixes(word));
}

/** Does the word appear in a phrase that turns it into another institution? */
function isFalseFriend(tokens: string[], index: number, word: string): boolean {
  const bad = FALSE_FRIENDS[word];
  if (!bad) return false;
  const before = index > 0 ? tokens[index - 1]! : '';
  // Look two tokens back as well: «الاتحاد الأوروبي» has a two-word tail and
  // «الاتحاد العام للنقابات» puts a word between the two.
  const before2 = index > 1 ? tokens[index - 2]! : '';
  const candidates = [before, before2, stripPrefixes(before), stripPrefixes(before2)];
  return candidates.some((c) => c && bad.includes(c));
}

/**
 * Does the text mention this team at all?
 *
 * A club is identified by its most distinctive word. For «الاتحاد السكندري» that
 * is «السكندري», because «الاتحاد» alone is the European Union. Only when the name
 * has no distinctive word at all does a generic one count — and then only when it
 * is not part of the phrases in FALSE_FRIENDS.
 */
export function mentionsTeam(text: string, team: string, words: string[] = teamWords(team)): boolean {
  const haystack = normalizeArabic(text);
  if (!haystack || !words.length) return false;
  const tokens = haystack.split(' ');

  // Distinctive words first: a club with any non-generic word is matched only by
  // those, never by the generic part. This is the fix for the European Union.
  const distinctive = words.filter((w) => !isInstitutional(w));
  const searchWords = distinctive.length ? distinctive : words;

  for (const word of searchWords) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== word) continue;
      if (isInstitutional(word) && isFalseFriend(tokens, i, word)) continue;
      // A generic word only ever matched by being allowed above, so if it got
      // here with a false friend in front of it, it is a different institution.
      if (!isInstitutional(word) && isFalseFriend(tokens, i, word)) continue;
      return true;
    }
  }
  return false;
}

export interface ArticleLike {
  id: string;
  title: string;
  summary: string | null;
  sourceName: string;
  url: string;
  publishedAt: number;
}

export interface RelatedArticle {
  id: string;
  title: string;
  sourceName: string;
  url: string;
  publishedAt: number;
  /** `both` when the article names the two clubs in one headline or summary. */
  team: 'home' | 'away' | 'both';
}

/**
 * Articles about either team, newest first.
 *
 * Summaries count as well as titles: Egyptian coverage often names the club only
 * in the summary. Ordering is by publication time so the match centre reads like
 * a live feed.
 */
export function relatedNews(
  home: string,
  away: string,
  options: { limit?: number; articles?: ArticleLike[] } = {},
): RelatedArticle[] {
  const articles = options.articles ?? [];
  const limit = options.limit ?? 10;
  const homeWords = teamWords(home);
  const awayWords = teamWords(away);

  const hits: RelatedArticle[] = [];
  for (const article of articles) {
    const text = `${article.title} ${article.summary ?? ''}`;
    const inHome = mentionsTeam(text, home, homeWords);
    const inAway = mentionsTeam(text, away, awayWords);
    if (!inHome && !inAway) continue;
    hits.push({
      id: article.id,
      title: article.title,
      sourceName: article.sourceName,
      url: article.url,
      publishedAt: article.publishedAt,
      team: inHome && inAway ? 'both' : inHome ? 'home' : 'away',
    });
  }
  return hits.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
}
