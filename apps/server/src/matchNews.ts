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
 * Words that mark an article as being about women's football.
 *
 * Measured: the women's league files its clubs as «الأهلي | سيدات», so the club
 * words are identical to the men's side and a men's «الأهلي يهزم الزمالك» article
 * matched a women's fixture. Gender is the only thing that separates them, so it
 * is compared explicitly, in both directions.
 */
const WOMEN_WORDS = /سيدات|نساء|للسيدات|women/i;

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
  // Gender words are not identities: «سيدات» says which side, not which club, and
  // leaving it in the word list made «الأهلي للسيدات» match only on «للسيدات»,
  // which a headline writes with a different prefix («للسيدات» vs «سيدات»).
  // Which side it is, is decided by the gender rule in `mentionsTeam`.
  const generic = new Set([
    'منتخب', 'فريق', 'نادي', 'نادى', 'كلوب', 'club', 'fc', 'اف', 'سي',
    'سيدات', 'للسيدات', 'نساء', 'women',
  ]);
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
/**
 * Words that make a shared name a COMPANY rather than a club.
 *
 * Measured: «إنتر ستيت جاز سيستمز» (Inter State Gas Systems) is a Pakistani
 * company, and it put an energy-investment article on an Italian football match.
 */
const COMPANY_TAILS = new Set([
  'ستيت', 'جاز', 'للطاقه', 'للطاقة', 'للصناعه', 'للصناعة', 'للتجاره', 'للتجارة',
  'القابضه', 'القابضة', 'للاستثمار', 'للمقاولات', 'للتامين', 'للتأمين',
  'جروب', 'گروب', 'هولدنج', 'سيستمز', 'كومباني', 'انترناشونال',
]);

/**
 * Second words that turn a shared first word into a DIFFERENT club.
 *
 * «إنتر ميامي» is not «إنتر ميلان»: the tail is what distinguishes them, so a
 * match on the shared head alone is rejected when one of these follows it.
 */
const OTHER_CLUB_TAILS = new Set([
  'ميامي', 'ميلان', 'مدريد', 'مانشستر', 'يونايتد', 'سيتي', 'باريس', 'جده',
  'الرياض', 'ابوظبي', 'دبي', 'الدوحه', 'نيويورك', 'لوس', 'انجلوس',
]);

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
  // A conjunction is glued to the next word in Arabic: «وادي دجلة والاتحاد
  // السكندري» writes the club as «والاتحاد». Comparing prefix-stripped forms on
  // BOTH sides lets the full name match there, which is exactly the coverage we
  // want — while still requiring every word of the name, so a fragment cannot
  // match.
  const strip = (w: string): string => stripPrefixes(w);
  for (let i = 0; i + sequence.length <= tokens.length; i += 1) {
    if (sequence.every((w, k) => strip(tokens[i + k]!) === strip(w))) return true;
  }
  return false;
}

/**
 * Is this a club whose name doubles as a place or an ordinary word?
 *
 * «وادي دجلة» is a valley as well as a club, «مدينة» is a city, «شباب» is a youth
 * side. For those the name alone is not enough: the article must also be about
 * football. Measured on a real article — «عميد هندسة عين شمس يقضي يوماً... في وادي
 * دجلة» — the ground's name appeared with no club in it.
 */
function needsFootballContext(words: string[]): boolean {
  // Deliberately NO `stripPrefixes` here. «وادي» *begins* with و, so stripping a
  // leading conjunction turns it into «ادي» and it stops being a place word — the
  // bug that let a university trip article match the club.
  return words.some((w) => PLACE_WORDS.has(w));
}

/** Sports that are not football, as the sources name them. */
const OTHER_SPORT = /(?:^| )(?:ال|لل|بال|كال)?(?:سله|سلة|يد|طائره|طائرة|تنس|سباحه|سباحة|جودو|ملاكمه|ملاكمة)(?: |$)/;

function hasFootballContext(haystack: string): boolean {
  // A different sport is not football, however much of this vocabulary it shares.
  // Measured on production: «الاتحاد السكندري … دوري المرتبط لكرة السلة» and «كرة
  // اليد» were served as football coverage because they contain «الدوري». A club is
  // a football club in this app, so an article that names another sport is out.
  if (/ (السله|السلة|اليد|الطائره|الطائرة|التنس|السباحه|السباحة|الجودو|الملاكمة) /.test(` ${haystack} `)) {
    return false;
  }
  // «كرة» alone is ambiguous — «كرة السلة», «كرة اليد» — so the sport word above is
  // the real test; dropping bare «كورة/كورة» from the positive list keeps this
  // honest instead of letting a compound through on the first word.
  // Club-football signals. Squad and transfer vocabulary is included because a real
  // club story often names no match: «وادي دجلة يضم مهاجما جديدا» is about the club
  // and says nothing else on this list. Deliberately NOT «دوري» alone — that also
  // matches «بدوري اليد», a handball league, which is not this club's coverage.
  return / (الدوري|الممتاز|مباراه|مباراة|مباريات|فريق|نادى|نادي|الاهلي|الزمالك|هدف|اهداف|ملعب|كوره|كورة|انتقال|انتقالات|اصابه|مهاجم|مدافع|لاعب|لاعبين|مدرب|تشكيل|ضم|يضم|تعاقد|اختبار|مواجهه|مواجهة|قمة|لقاء) /.test(
    ` ${haystack} `,
  );
}

export function mentionsTeam(
  text: string,
  team: string,
  words: string[] = teamWords(team),
  /** The competition's country, used to break ties between same-named clubs. */
  country?: string,
): boolean {
  return mentionsTeamIn(text, normalizeArabic(text), team, words, country);
}

/**
 * `mentionsTeam` over text that is already normalised.
 *
 * The match centre runs this over the whole corpus on every open, and normalising
 * each article's text was most of the cost (measured on 21k rows: ~0.45s of a
 * ~1.2s blocking scan). `relatedNews` normalises each row once and reuses it.
 */
function mentionsTeamIn(
  text: string,
  haystack: string,
  team: string,
  words: string[],
  // Kept for signature parity with `mentionsTeam`; see the country note in step 2.
  _country?: string,
): boolean {
  if (!haystack || !words.length) return false;
  const tokens = haystack.split(' ');

  // 0. Gender must agree. A women's side and a men's side share every club word,
  //    so without this a men's «الأهلي يهزم الزمالك» headline is coverage of
  //    «الأهلي | سيدات». The marker is in the name, and it must also be in the
  //    text (or absent from both — most coverage names neither).
  const teamIsWomen = WOMEN_WORDS.test(team);
  const textIsWomen = WOMEN_WORDS.test(`${text} ${haystack}`);
  if (teamIsWomen !== textIsWomen) return false;

  // A different sport is not this club's football coverage, whatever else it shares.
  // Measured on production (#43): three basketball stories about «الاتحاد السكندري»
  // reached a football match because they name the club and contain «الدوري» —
  // «دوري المرتبط لكرة السلة». A club here is a football club, so this applies to
  // every match, not only to place-named clubs.
  if (OTHER_SPORT.test(haystack)) return false;

  // Distinctive words first: a club with any non-generic word is matched only by
  // those, never by the generic part. This is the fix for the European Union.
  // A club whose whole name is a place («وادي دجلة») must be matched on the name as
  // written. Dropping its place word left only «دجلة», which then matched the valley
  // in an article about a university trip — the #43 failure. So place-named clubs
  // keep every word.
  const placeNamed = needsFootballContext(words);
  const distinctive = words.filter((w) => !isInstitutional(w) && !PLACE_WORDS.has(w));
  const searchWords = placeNamed
    ? words
    : distinctive.length
      ? distinctive
      : words.filter((w) => !PLACE_WORDS.has(w));
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
    if (words.length > 1 && hasSequence(tokens, words)) {
      if (needsFootballContext(words) && !hasFootballContext(haystack)) return false;
      return true;
    }
    // A single shared word is judged by what it is NOT: it must appear somewhere
    // that is not a false friend. «إنتر» alone never matches «إنتر ميامي» because
    // the next word is ميامي, not Italy; «الاهلي» never matches «البنك الأهلي».
    if (words.length === 1) {
      const only = words[0]!;
      for (let i = 0; i < tokens.length; i += 1) {
        if (tokens[i] !== only) continue;
        if (isFalseFriend(tokens, i, only)) continue;
        // The word right after it can name a different club: «إنتر ميامي» is not
        // «إنتر ميلان», and the tail is the only thing that tells them apart.
        const after = tokens[i + 1] ?? '';
        if (OTHER_CLUB_TAILS.has(after) || SHARED_PREFIX_WORDS.has(after)) continue;
        if (COMPANY_TAILS.has(after)) continue;
        return true;
      }
      return false;
    }
    // NO short-form fallback. The user's standing rule (#43) is that a multi-word
    // club matches its FULL name: «الاتحاد السكندري» is not «الاتحاد».
    //
    // This used to accept the first word when the article named the competition's
    // country, which looked reasonable and was measurably wrong: «وزير الرياضة يبحث
    // مع مجلس إدارة الاتحاد العام لمراكز شباب مصر» mentions مصر, so a ministry's
    // story was served as coverage of a club. A country word is not a club.
    //
    // «إنتر ميلان» is the case this fallback was originally written for, and it
    // still works through the full-name check above — that is what the user asked
    // for, and it is the only thing that belongs here.
    return false;
  }

  // 3. A MULTI-WORD club is matched on its full name, never on a fragment.
  //
  //    This is the user's standing rule (issue #43) and it replaces the old
  //    "any identifying word" test, which was measurably wrong: «أبو ظبي تعلن عن
  //    استثمار جديد» matched «أبو قير للأسمدة» because the two share «أبو», and
  //    «كليوباترا تطلق منتجاً» matched «سيراميكا كليوباترا». A fragment is not a
  //    club.
  //
  //    The whole normalised name must appear as a contiguous run of tokens. Word
  //    order is kept, which is how the name is written, and no looser test is
  //    attempted — a near-miss is a different club.
  if (searchWords.length > 1) {
    if (!hasSequence(tokens, searchWords)) return false;
    // A club whose name IS a place needs football context to be the club.
    // Measured: «عميد هندسة عين شمس يقضي يوماً مع طلاب الجوالة في وادي دجلة» names
    // the club's ground, not the club. «وادي دجلة» also names a valley, «مدينة»
    // a city and «شباب» a youth side, so containing the words is not enough on its
    // own — the article must also be about football.
    if (needsFootballContext(words) && !hasFootballContext(haystack)) return false;
    return true;
  }

  // 4. A ONE-WORD club can only be matched as that whole word, with the
  //    false-friend phrases rejected — «الاتحاد» alone is a union, «الأهلي» alone
  //    is a bank. There is no shorter fragment to fall back to.
  const only = searchWords[0]!;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== only) continue;
    if (isFalseFriend(tokens, i, only)) continue;
    return true;
  }
  return false;
}

export interface ArticleLike {
  id: string;
  title: string;
  summary: string | null;
  /** The article's own lead image, when the feed carried one. */
  imageUrl?: string | null;
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
  /**
   * The article's lead image, passed through from the corpus.
   *
   * Null for most Egyptian coverage: our feeds carry a `media:content` for some
   * outlets and none for others, so the card draws the design's football glyph
   * instead of an empty grey box. Never invented, never a source page scrape.
   */
  imageUrl: string | null;
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
  options: {
    limit?: number;
    articles?: readonly ArticleLike[];
    country?: string;
    /**
     * The corpus is already newest-first (the store's order). The scan can then stop
     * at the `limit`-th hit, because later rows can only be older — the result is
     * identical to scanning everything and sorting.
     */
    newestFirst?: boolean;
  } = {},
): RelatedArticle[] {
  const articles = options.articles ?? [];
  const limit = options.limit ?? 10;
  const homeWords = teamWords(home);
  const sameTeam = home === away;
  const awayWords = sameTeam ? homeWords : teamWords(away);
  // Every accepting path in `mentionsTeam` needs one of the name's words (prefix-
  // stripped) to occur in the normalised text, so a plain substring test on these
  // rejects almost the whole corpus before the full rules run.
  const needles = [...new Set([...homeWords, ...awayWords].map(stripPrefixes).filter(Boolean))];

  // Rows the word index already covers are candidates only when one of their tokens
  // matches a needle exactly; a row the index has not seen yet falls back to the
  // substring test (and is indexed on the way).
  const candidates = new Set<object>();
  for (const n of needles) for (const row of tokenIndex.get(n) ?? []) candidates.add(row);

  const hits: RelatedArticle[] = [];
  for (const article of articles) {
    if (indexedRows.has(article)) {
      if (!candidates.has(article)) continue;
    } else {
      indexRow(article);
      const haystack = normalizedArticleText(article);
      if (!needles.some((n) => haystack.includes(n))) continue;
    }
    const haystack = normalizedArticleText(article);
    const text = `${article.title} ${article.summary ?? ''}`;
    const inHome = mentionsTeamIn(text, haystack, home, homeWords, options.country);
    const inAway = sameTeam ? inHome : mentionsTeamIn(text, haystack, away, awayWords, options.country);
    if (!inHome && !inAway) continue;
    hits.push({
      id: article.id,
      title: stripPublisher(article.title, article.sourceName),
      sourceName: article.sourceName,
      url: article.url,
      publishedAt: article.publishedAt,
      imageUrl: article.imageUrl ?? null,
      team: inHome && inAway ? 'both' : inHome ? 'home' : 'away',
    });
    if (options.newestFirst && hits.length >= limit) break;
  }
  return hits.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, limit);
}

/**
 * Normalised title + summary, computed once per stored row.
 *
 * Keyed by the row object: the store replaces a row object whenever its text
 * changes (migration builds new objects), so a cached entry can never be stale,
 * and a row dropped from the store takes its entry with it.
 */
const normalizedCache = new WeakMap<object, string>();

function normalizedArticleText(article: ArticleLike): string {
  let haystack = normalizedCache.get(article);
  if (haystack === undefined) {
    haystack = normalizeArabic(`${article.title} ${article.summary ?? ''}`);
    normalizedCache.set(article, haystack);
  }
  return haystack;
}

/**
 * Word index: prefix-stripped token → the rows containing it.
 *
 * Every accepting path in `mentionsTeam` compares `stripPrefixes(token)` with
 * `stripPrefixes(word)` (or the raw forms, which implies it), so a row is only ever
 * a match if one of its stripped tokens equals one of the name's stripped words.
 * Looking those up replaces a substring scan of the whole corpus (~130ms per open
 * for a rarely covered club on the e2-micro) with a few set lookups.
 *
 * Holds the rows strongly, so it must be reset when rows leave the store
 * (`resetRelatedNewsIndex`, called after a retention prune).
 */
let tokenIndex = new Map<string, Set<object>>();
let indexedRows = new WeakSet<object>();

function indexRow(article: ArticleLike): void {
  if (indexedRows.has(article)) return;
  indexedRows.add(article);
  for (const token of normalizedArticleText(article).split(' ')) {
    const key = stripPrefixes(token);
    if (!key) continue;
    let set = tokenIndex.get(key);
    if (!set) {
      set = new Set();
      tokenIndex.set(key, set);
    }
    set.add(article);
  }
}

/** Forget the word index (after rows were removed from the store). */
export function resetRelatedNewsIndex(): void {
  tokenIndex = new Map();
  indexedRows = new WeakSet();
}

/**
 * Fill the normalised-text cache in small slices, yielding between them, so the
 * first match opened after a boot or a refresh does not pay for the whole corpus.
 */
export function warmRelatedNews(articles: readonly ArticleLike[], chunk = 500): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const step = (): void => {
      const end = Math.min(articles.length, i + chunk);
      for (; i < end; i++) indexRow(articles[i]!);
      if (i < articles.length) setImmediate(step);
      else resolve();
    };
    setImmediate(step);
  });
}
