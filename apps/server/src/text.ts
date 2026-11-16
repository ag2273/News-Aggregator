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
