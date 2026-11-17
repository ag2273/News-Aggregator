// HTML entity decoding for RSS titles/summaries.
// Feeds routinely ship &nbsp;, &quot;, &#8230; etc. in plain-text fields.

const NAMED: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  euro: '€',
  pound: '£',
};

export function decodeHtmlEntities(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (match, name: string) => NAMED[name] ?? match)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/**
 * Search normalizer: makes Arabic (and Latin) text comparable.
 *
 * RSS headlines mix orthography freely — أ/إ/آ vs ا, ة vs ه, ى vs ي — and
 * carry optional tashkeel (harakat) and tatweel. Users type whichever form
 * they prefer, so both sides of a substring match go through this first.
 * Latin text is lowercased so `Google` matches `google`.
 */
export function normalizeForSearch(input: string | null | undefined): string {
  if (!input) return '';
  return decodeHtmlEntities(input)
    // Arabic diacritics: tashkeel, superscript alef, Quranic marks.
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
    // Tatweel (kashida) is decorative only.
    .replace(/\u0640/g, '')
    // Alef variants -> bare alef: أ إ آ ٱ -> ا
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    // Alef maqsura -> yeh: ى -> ي
    .replace(/\u0649/g, '\u064A')
    // Teh marbuta -> heh: ة -> ه
    .replace(/\u0629/g, '\u0647')
    // Western Arabic-Indic digits -> ASCII, so "٢٠٢٤" matches "2024".
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
