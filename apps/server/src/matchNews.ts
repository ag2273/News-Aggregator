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
/**
 * Words that are part of a place or a company rather than a club: «وادي» matches
 * «وادي السيليكون» (Silicon Valley) and «وادي السير» (a Jordanian town). A club
 * whose only other word is such a word needs its full name.
 */
const PLACE_WORDS = new Set(['وادي', 'وادى', 'مدينه', 'مدينة', 'شباب', 'اتحاد', 'نادي']);

/**
 * Club names that are also ordinary institutional nouns, with no distinctive word
 * of their own to fall back on.
 *
 * «الجمارك» (customs) is the whole name of a real club and also the name of an
 * authority: on a real fixture, all eight articles were about Egypt's customs
 * service. There is no second word to lean on, so the honest answer is to match
 * it only when the club's own context appears — and otherwise show no articles.
 */
const AMBIGUOUS_ONLY_NAMES = new Set(['الجمارك', 'الشرطه', 'البنك', 'المصرف']);

/**
 * Words that place an article in a competition's country.
 *
 * Used only to disambiguate a club whose short name is shared («إنتر» in Italy vs
 * «إنتر» in MLS). Never used to add an article that does not name the club.
 */
const COUNTRY_WORDS: Record<string, string[]> = {
  IT: ['ايطاليا', 'الايطالي', 'الكالتشيو', 'سيري', 'ميلانو', 'تورينو'],
  US: ['امريكا', 'الامريكي', 'ميامي', 'الدوري الامريكي', 'mls'],
  ES: ['اسبانيا', 'الاسباني', 'الليجا', 'مدريد', 'برشلونه'],
  GB: ['انجلترا', 'الانجليزي', 'البريميرليج', 'لندن'],
  DE: ['المانيا', 'الالماني', 'البوندسليجا'],
  FR: ['فرنسا', 'الفرنسي', 'ليج', 'باريس'],
  SA: ['السعوديه', 'السعودي', 'روشن', 'الرياض'],
  EG: ['مصر', 'المصري', 'القاهره', 'الاسكندريه'],
};

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
  // Measured on a real match «الجمارك × شباب بلوزداد»: all eight articles were
  // about مصر's customs authority (مصلحة الجمارك), not the Mauritanian club.
  الجمارك: ['مصلحه', 'مصلحة', 'مصر', 'المصريه', 'المصري', 'عن', 'من', 'في', 'باسم'],
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
/**
 * Words that begin many club names and identify none of them on their own.
 *
 * Measured: «إنتر ميلان» and «إنتر ميامي» share «إنتر», so an Italian match pulled
 * six MLS articles about Inter Miami. «إنتر», «مانشستر», «ريال», «باريس»,
 * «الاتحاد» and «الوداد» are all prefixes of more than one club.
 */
const SHARED_PREFIX_WORDS = new Set([
  'انتر', 'مانشستر', 'ريال', 'باريس', 'اتلتيكو', 'بايرن', 'روما', 'ميلان',
  'الاتحاد', 'الوداد', 'الاهلي', 'الشباب', 'التعاون', 'الاتفاق', 'سموحه',
]);

/**
 * A club whose name has a shared first word is matched on the FULL name.
 *
 * «إنتر ميلان» must not match a text that only says «إنتر», because that word also
 * begins «إنتر ميامي». Anything whose first word is in SHARED_PREFIX_WORDS needs
 * its second word too, in order and adjacent.
 */
export function needsFullName(words: string[]): boolean {
  // A single-word name can be just as shared: the API calls Inter «إنتر», and that
  // one word also names Inter Miami. Measured on production, «إنتر ميلان» was fine
  // but «إنتر» alone still pulled seven MLS articles.
  if (words.length === 1) return SHARED_PREFIX_WORDS.has(words[0]!);
  if (words.length < 2) return false;
  return SHARED_PREFIX_WORDS.has(words[0]!) || words.some((w) => SHARED_PREFIX_WORDS.has(w));
}

/** Does the haystack contain this exact run of tokens, in order? */
function hasSequence(tokens: string[], sequence: string[]): boolean {
  if (!sequence.length) return false;
  for (let i = 0; i + sequence.length <= tokens.length; i += 1) {
    if (sequence.every((w, k) => tokens[i + k] === w)) return true;
  }
  return false;
}

export function mentionsTeam(
  text: string,
  team: string,
  words: string[] = teamWords(team),
  /** The competition's country, used to break ties between same-named clubs. */
  country?: string,
): boolean {
  const haystack = normalizeArabic(text);
  if (!haystack || !words.length) return false;
  const tokens = haystack.split(' ');

  // Distinctive words first: a club with any non-generic word is matched only by
  // those, never by the generic part. This is the fix for the European Union.
  const distinctive = words.filter((w) => !isInstitutional(w) && !PLACE_WORDS.has(w));
  const searchWords = distinctive.length ? distinctive : words.filter((w) => !PLACE_WORDS.has(w));
  if (!searchWords.length) return false;

  // 1. A name that is only ever an institution cannot identify a club, unless the
  //    text also says نادي/فريق/مباراة. Runs first, because «الأهلي» is both a bank
  //    and a club prefix and the bank must be rejected before anything accepts it.
  if (searchWords.every((w) => AMBIGUOUS_ONLY_NAMES.has(w) || AMBIGUOUS_ONLY_NAMES.has(stripPrefixes(w)))) {
    const clubWord = / (نادي|نادى|فريق|مباراه|مباراة|ملعب) /.test(` ${haystack} `);
    if (!clubWord) return false;
  }

  // 2. A shared first word is not an identity. «إنتر ميلان» only matches «إنتر
  //    ميلان»; «ريال مدريد» stays out of «ريال سوسيداد» coverage.
  if (needsFullName(words)) {
    // Only a genuine multi-word name can be satisfied by "the whole name appears".
    // A one-word name would otherwise match here and skip the checks below.
    if (words.length > 1 && hasSequence(tokens, words)) return true;
    // A single shared word is judged by what it is NOT: it must appear somewhere
    // that is not a false friend. «إنتر» alone never matches «إنتر ميامي» because
    // the next word is ميامي, not Italy; «الاهلي» never matches «البنك الأهلي».
    if (words.length === 1) {
      const only = words[0]!;
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i] !== only) continue;
        if (isFalseFriend(tokens, i, only)) continue;
        // The word right after it can name a different club: «إنتر ميامي».
        const after = tokens[i + 1] ?? '';
        if (SHARED_PREFIX_WORDS.has(after)) continue;
        return true;
      }
      return false;
    }
    // The short form («إنتر» for «إنتر ميلان») is accepted only when the article
    // itself places the club in the competition's country.
    const hint = country ? COUNTRY_WORDS[country] : undefined;
    if (hint && hint.some((h) => hasWord(haystack, h))) {
      const first = words[0]!;
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i] === first && !isFalseFriend(tokens, i, first)) return true;
      }
    }
    return false;
  }

  // 3. Ordinary names match on any identifying word, as a whole word, with the
  //    false-friend phrases rejected.
  for (const word of searchWords) {
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i] !== word) continue;
      if (isFalseFriend(tokens, i, word)) continue;
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

/**
 * A title with the source's trailing site-name or URL removed.
 *
 * Measured on production: Google-News style titles arrive as
 * «الجمارك تحذر ... - www.dostor.org» and «... - المصري اليوم». The trailing
 * fragment is the publisher, and the card already prints the source name above
 * the title, so the tail is duplicated noise — and when it is a bare URL it
 * reads as a broken title.
 */
export function cleanTitle(title: string): string {
  let out = title.trim();
  // A trailing «- domain.tld» or «- www.domain.tld», with or without a scheme.
  out = out.replace(/\s*[-–|]\s*(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+\/?\s*$/i, '').trim();
  // A trailing «– Site Name» is the publisher; a short Arabic tail after a dash is
  // only stripped when it matches the article's own source name.
  return out;
}

/** Drop a trailing publisher tail when it duplicates `sourceName`. */
export function stripPublisher(title: string, sourceName: string): string {
  const cleaned = cleanTitle(title);
  if (!sourceName) return cleaned;
  const tail = cleaned.match(/\s*[-–|]\s*([^-–|]{2,40})$/);
  if (tail && tail[1]!.trim() === sourceName.trim()) {
    return cleaned.slice(0, tail.index).trim();
  }
  return cleaned;
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
  options: { limit?: number; articles?: ArticleLike[]; country?: string } = {},
): RelatedArticle[] {
  const articles = options.articles ?? [];
  const limit = options.limit ?? 10;
  const homeWords = teamWords(home);
  const awayWords = teamWords(away);

  const hits: RelatedArticle[] = [];
  for (const article of articles) {
    const text = `${article.title} ${article.summary ?? ''}`;
    const inHome = mentionsTeam(text, home, homeWords, options.country);
    const inAway = mentionsTeam(text, away, awayWords, options.country);
    if (!inHome && !inAway) continue;
    hits.push({
      id: article.id,
      title: stripPublisher(article.title, article.sourceName),
      sourceName: article.sourceName,
      url: article.url,
      publishedAt: article.publishedAt,
      team: inHome && inAway ? 'both' : inHome ? 'home' : 'away',
    });
  }
  return hits.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
}
