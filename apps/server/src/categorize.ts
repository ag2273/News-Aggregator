// Category model + Arabic keyword classifier for the news aggregator.
// English code, Arabic keywords. Deterministic, offline, no scraping.

export interface Category {
  id: string;
  name: string; // English label
  nameAr: string; // Arabic display label
}

export const CATEGORIES: Category[] = [
  { id: 'egypt', name: 'Egypt', nameAr: 'مصر' },
  { id: 'economy', name: 'Economy', nameAr: 'اقتصاد' },
  { id: 'sports', name: 'Sports', nameAr: 'رياضة' },
  { id: 'health', name: 'Health', nameAr: 'صحة' },
  { id: 'tech', name: 'Technology', nameAr: 'تكنولوجيا' },
  { id: 'misc', name: 'Miscellaneous', nameAr: 'منوعات' },
];

// Classification order: specific domains first, then the catch-all "egypt"
// (the word "مصر" appears in nearly every article), then "misc" fallback.
const CATEGORY_ORDER = ['tech', 'sports', 'health', 'economy', 'egypt'] as const;

const KEYWORDS: Record<(typeof CATEGORY_ORDER)[number], string[]> = {
  tech: [
    'تكنولوجيا',
    'تقنية',
    'الذكاء الاصطناعي',
    'هاتف',
    'آيفون',
    'سامسونج',
    'إنترنت',
    'تطبيق',
    'برمجيات',
    'أمن سيبراني',
    'سايبر',
    'فضائي',
    'ناسا',
    'روبوت',
    'شريحة',
    'منصة',
    'جوجل',
    'ميتا',
    'تسلا',
  ],
  sports: [
    'كرة القدم',
    'مباراة',
    'الدوري',
    'منتخب',
    'كأس',
    'هدف',
    'لاعب',
    'مدرب',
    'رياضة',
    'أولمبياد',
    'تنس',
    'بطولة',
    'ملعب',
    'الزمالك',
    'بيراميدز',
  ],
  health: [
    'صحة',
    'كورونا',
    'فيروس',
    'مستشفى',
    'دواء',
    'لقاح',
    'طبيب',
    'مرض',
    'وزارة الصحة',
    'وباء',
    'سرطان',
    'تغذية',
  ],
  economy: [
    'اقتصاد',
    'البورصة',
    'الجنيه',
    'الدولار',
    'أسعار',
    'استثمار',
    'بنك',
    'المركزي',
    'تضخم',
    'النفط',
    'الذهب',
    'عملة',
    'صندوق النقد',
    'تجارة',
    'ميزانية',
    'ضرائب',
    'الغاز',
  ],
  egypt: [
    'مصر',
    'القاهرة',
    'الرئيس',
    'البرلمان',
    'الحكومة',
    'الداخلية',
    'الوزراء',
    'النواب',
    'السيسي',
    'وزارة',
    'محافظ',
    'الجيش',
    'مجلس النواب',
  ],
};

export function categorize(title: string, summary?: string | null): string {
  const text = `${title ?? ''} ${summary ?? ''}`;
  for (const id of CATEGORY_ORDER) {
    const words = KEYWORDS[id];
    if (words.some((w) => text.includes(w))) return id;
  }
  return 'misc';
}

/** Map any stored category value to a known category id (legacy 'general' → classify/misc). */
export function normalizeCategory(category: string | undefined | null): string {
  if (category && CATEGORIES.some((c) => c.id === category)) return category;
  return 'misc';
}

/**
 * Breaking detection.
 *
 * The old rule was `title.includes('عاجل')` plus two live-blog words. On 7 days
 * of production titles that flagged 21 articles, and most were ordinary news
 * that merely contained the word — "تحرك عاجل من السلطات", "قرار عاجل من
 * الأعلى للإعلام", "نداء عاجل للمواطنين" — while a real "عاجل | ..." alert was
 * flagged for the same reason but "لحظة بلحظة" also caught sports live blogs
 * ("مباشر مباراة ... لحظة بلحظة"), which are not breaking news.
 *
 * The marker has to say "this is an alert", not merely mention urgency. So:
 *  - عاجل counts only as a PREFIX of the title (optionally after a bullet/emoji),
 *    which is how Arabic outlets label an alert: "عاجل |", "عاجل:", "عاجل -";
 *  - a red bullet at the start of the title counts (🔴 / 🚨 used as an alert mark);
 *  - "BREAKING" as a prefix covers the English feeds;
 *  - live-blog words are excluded: they mark continuous coverage, not a single
 *    breaking event, and they are overwhelmingly sport.
 */

/** Alert markers that must stand at the START of the title. */
const BREAKING_PREFIXES = ['عاجل', 'BREAKING', 'breaking'] as const;

/** Emoji used as an alert bullet. */
const BREAKING_BULLETS = ['🔴', '🚨'] as const;

/** Strip leading whitespace, bullets and emoji, and normalise Arabic letters. */
export function normalizeBreakingTitle(title: string): string {
  let t = title.trim();
  // Drop leading alert bullets so the word behind them can be examined.
  for (const bullet of BREAKING_BULLETS) {
    while (t.startsWith(bullet)) t = t.slice(bullet.length).trimStart();
  }
  // Strip a leading dash/pipe left over from feed formatting.
  t = t.replace(/^[-–—|:،]\s*/, '');
  return t;
}

/**
 * True when the title is punctuated as an alert: "عاجل | ...", "عاجل: ...",
 * "عاجل.. ...", "عاجل. ...". The separator is what makes it a label; the word
 * alone mid-sentence ("تحرك عاجل من ...") is ordinary news.
 */
function isAlertPrefix(normalized: string): boolean {
  for (const word of BREAKING_PREFIXES) {
    if (!normalized.startsWith(word)) continue;
    const rest = normalized.slice(word.length);
    // An alert label is followed by punctuation or whitespace, not by a letter:
    // "عاجل | ..." yes, "عاجلة" or "عاجلًا" no.
    if (rest.length === 0) return true;
    return /^[\s|:،,\-–—!.]/.test(rest);
  }
  return false;
}

/**
 * Google News titles are "headline - outlet - عاجل" when the outlet tagged them,
 * so the alert label can also sit at the END. Only an exact trailing label
 * counts; "- عاجلة" or a headline that happens to end with the word does not.
 */
function hasTrailingAlertLabel(title: string): boolean {
  return /(?:^|\s)-\s*عاجل\s*(?:-\s*[^-]{1,40})?$/.test(title.trim());
}

/**
 * Detect if an article title represents breaking news.
 * Conservative on purpose: a false positive becomes a notification.
 */
export function detectBreaking(title: string | undefined | null): boolean {
  if (!title) return false;

  // A red bullet at the very start is an editorial alert mark.
  const trimmed = title.trim();
  const hasAlertBullet = BREAKING_BULLETS.some((b) => trimmed.startsWith(b));

  const normalized = normalizeBreakingTitle(title);

  // An explicit alert label wins even when the headline also mentions live
  // coverage: the outlet itself is calling this breaking.
  if (hasAlertBullet || isAlertPrefix(normalized) || hasTrailingAlertLabel(title)) return true;

  // Live-coverage wording ("لحظة بلحظة", "تغطية مباشرة") is deliberately NOT in
  // the alert set: in production it was almost always a sport live blog, not a
  // breaking event.
  return false;
}
