// Matching a match's two teams against our own news corpus.
//
// The naive version of this shipped and was wrong in three visible ways, all
// measured on production articles:
//
//   1. «البنك الأهلي» — the National Bank of Egypt — linked to an Ahly match.
//   2. «جامعة أسيوط الأهلية» matched because `includes('الاهلي')` is a substring
//      test and «الاهليه» contains «الاهلي».
//   3. An article naming both clubs was labelled "home" because home was checked
//      first, so the away side's coverage looked like the home side's.
//
// So: match on whole Arabic words at word boundaries, reject phrases that make a
// name mean something else, and report when an article covers both teams.
//
// Everything here is pure and synchronous — it reads nothing, fetches nothing,
// and makes no AI call. The corpus is passed in.

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
 * Combinations that make a club's name mean something else.
 *
 * Keyed by the normalised token, valued by normalised phrases that must not
 * appear immediately before it. «البنك الاهلي» is a bank; «الجامعه الاهليه» is a
 * university; «النادي الاهلي» is the club and is allowed.
 */
const FALSE_FRIENDS: Record<string, string[]> = {
  الاهلي: [
    'البنك', 'بنك', 'الجامعه', 'جامعه', 'المدرسه', 'مدرسه',
    'الشركه', 'شركه', 'المستشفي', 'مستشفي', 'فندق',
  ],
  الاتحاد: ['بنك', 'البنك', 'شركه', 'الشركه', 'نقابه', 'النقابه'],
  الاسماعيلي: ['بنك', 'البنك'],
  المصري: ['البنك', 'بنك', 'الدولي'],
  الزمالك: [],
  الهلال: ['الهلال', 'الاحمر'],
};

/**
 * Words that identify a club, excluding generic football filler.
 *
 * One- and two-letter fragments are dropped: «ر.» for ريال and «إف» in
 * «باريس إف سي» would otherwise match half the corpus.
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

/**
 * Does the text mention this team at all?
 *
 * The first identifying word decides, and only when it is not part of a phrase
 * that means something else. A club with two identifying words («ريال مدريد»)
 * matches when its distinctive word appears (§«مدريد» alone is enough in Arabic
 * sport coverage), as long as it is a whole word.
 */
/** Strip the Arabic prefixes that attach to a word without changing which word it is. */
export function stripPrefixes(word: string): string {
  // «بالبنك» is «ب» + «البنك»: a preposition glued to the definite article.
  return word
    .replace(/^(?:و|ف|ب|ل|ك)(?=ال)/, '')
    .replace(/^(?:و|ف)(?=.)/, '');
}

export function mentionsTeam(text: string, team: string, words: string[] = teamWords(team)): boolean {
  const haystack = normalizeArabic(text);
  if (!haystack) return false;
  const tokens = haystack.split(' ');
  for (const word of words) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== word) continue;
      // The token before it must not turn it into a different name. Arabic glues
      // prepositions onto the following word («بالبنك الأهلي» = «ب» + «البنك»), so
      // both the bare and prefix-stripped forms are checked.
      const before = i > 0 ? tokens[i - 1]! : '';
      const bad = FALSE_FRIENDS[word];
      if (bad && (bad.includes(before) || bad.includes(stripPrefixes(before)))) continue;
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
