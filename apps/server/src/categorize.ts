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
    // Latin-script tech words: Arabic tech outlets write "Xiaomi", "iPhone",
    // "GTA" untranslated, and the list was Arabic-only.
    'xiaomi', 'iphone', 'ipad', 'samsung', 'galaxy', 'android', 'windows',
    'microsoft', 'google', 'apple', 'nvidia', 'intel', 'amd', 'qualcomm',
    'playstation', 'xbox', 'nintendo', 'steam', 'gta', 'metacritic',
    'chatgpt', 'openai', 'tesla', 'huawei', 'oppo', 'vivo', 'realme',
    'laptop', 'gpu', 'cpu', 'ssd', 'usb', 'wifi', 'ios',
    // Named titles and products from the live tech feeds that carry no Arabic
    // tech word at all ("غراند ثفت أوتو", "تنزيل ببجي موبايل").
    'غراند ثفت أوتو', 'ببجي', 'بوبجي', 'فورتنايت', 'ماين كرافت', 'روبلوكس',
    'هوانغ', 'إنفيديا', 'واتساب', 'تويتر', 'فيسبوك', 'دوج كوين', 'بتكوين',
    'كريبتو', 'بلوكتشين', 'تيك توك', 'يوتيوب', 'إنستغرام', 'سناب شات',
    'ببجي موبايل', 'mobile lite', 'super mario', 'resident evil', 'pubg',
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
    // Added 2026-11-21 with the tech sources. Measured: reviews and news from
    // عرب هاردوير / عرب جيمرز were landing in `misc` because the list had no
    // gaming or hardware vocabulary — "مراجعة لعبة Grand Theft Auto 6" scored
    // misc even though the outlet is a tech site.
    'لعبة',
    'ألعاب',
    'الألعاب',
    'جيمر',
    'جيمنج',
    'بلايستيشن',
    'بلاي ستيشن',
    'إكس بوكس',
    'نينتندو',
    'ستيم',
    'معالج',
    'كرت شاشة',
    'لابتوب',
    'حاسوب',
    'كمبيوتر',
    'أندرويد',
    'ويندوز',
    'مايكروسوفت',
    'أوبن إيه آي',
    'شات جي بي تي',
    'تطبيقات',
    'ذكاء اصطناعي',
    'انترنت',
    'سوفتوير',
    'هاردوير',
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
  // Lowercased once: the vocabulary has Latin tech words ("Xiaomi", "iPhone",
  // "GTA") and a case-sensitive match missed every one of them at the start of a
  // headline or in an all-caps spelling.
  const text = `${title ?? ''} ${summary ?? ''}`.toLowerCase();
  for (const id of CATEGORY_ORDER) {
    const words = KEYWORDS[id];
    if (words.some((w) => text.includes(w.toLowerCase()))) return id;
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
 * History: the original rule was `title.includes('عاجل')` plus two live-blog
 * words. On 7 days of production titles that flagged 21 articles and most were
 * ordinary news that merely mentioned urgency ("تحرك عاجل من السلطات", "قرار
 * عاجل من الأعلى للإعلام"), while "لحظة بلحظة" caught sport live blogs.
 *
 * Second iteration trusted only an explicit alert LABEL. Measured on 7 days:
 * 10 articles, ~1.4/day, all from الجزيرة/العربية, and ZERO from the Egyptian
 * sources — because المصري اليوم / الأهرام / مصراوي / اليوم السابع never tag
 * breaking news at all. Their "عاجل" always appears inside a compound
 * ("تحرك عاجل", "تحذير عاجل", "قرار عاجل", "بيان عاجل"), which is ordinary news.
 *
 * This iteration keeps the label rule and adds ONE data-driven tier: a narrow
 * catastrophic-incident pattern, because that is how those sources do signal it
 * ("تحطم طائرة عسكرية ومقتل 19"). Everything is measured — see the notes on
 * each list — and deliberately rejected signals are documented at the bottom.
 *
 * A false positive here is a notification on a real phone, so precision wins.
 */

/** Alert markers that must stand at the START of the title. */
const BREAKING_PREFIXES = ['عاجل', 'BREAKING', 'breaking'] as const;

/** Emoji used as an alert bullet. */
const BREAKING_BULLETS = ['🔴', '🚨'] as const;

/**
 * Catastrophe nouns. Deliberately narrow: only events that are news by
 * themselves. Measured on 7 days this appears ~4 times/day across all sources,
 * so it is the incident signal, not the decision on its own.
 */
const CATASTROPHE_NOUNS = [
  'تحطم طائرة',
  'سقوط طائرة',
  'تحطم مروحية',
  'غرق سفينة',
  'غرق عبارة',
  'انفجار',
  'انفجارات',
  'زلزال',
  'فيضانات',
  'انهيار منزل',
  'حريق هائل',
  'هجوم',
  'قصف',
  'غارات',
  'تفجير',
  // Added 2026-11-21 after the hold-out screen: everyday war wording the first
  // list missed, which left ~1.8 genuinely breaking stories/day unflagged.
  'هجمات',
  'إطلاق نار',
  'اطلاق نار',
  'مجزرة',
  'اشتباكات',
  'ضربات',
  'تصادم قطارين',
] as const;

/** Human cost words; a catastrophe needs one to count as an incident. */
const CASUALTY_WORDS = [
  'مقتل',
  'قتلى',
  'قتيل',
  'إصابة',
  'اصابة',
  'إصابات',
  'جرحى',
  'ضحايا',
  'وفيات',
  'مفقودين',
  'مصرع',
  'لا ناجين',
  'غرق',
  'انتشال جثة',
  // The verb, not just the noun: "غارات الجيش السوداني تقتل 37 مدنيا" carries
  // no noun form of a casualty word at all.
  'تقتل',
  'أسفر عن مقتل',
  'سقط',
] as const;

/**
 * A labelled alert whose headline is a holding statement, denial or scheduled
 * event is not an event: "عاجل | وزير النقل: لم يحدد بعد السبب", "عاجل | ترمب
 * يصل إلى الصين لحضور قمة". Measured: these are 3 of the 4 false positives the
 * label tier produced in 7 days.
 */
const NON_EVENT_ALERT = [
  'لم يحدد',
  'لم يتحدد',
  'لم يلحق',
  'لم يعرف بعد',
  'لا ضرر',
  'لم يصل',
  'ينفي',
  'نفى',
  'نفت',
  'تنفي',
  'نفي',
  'تكذيب',
  'مرتقب',
  'مقرر',
  'سيلقي',
  'يلتقي',
  'لحضور',
  // Added 2026-11-21: the exact shapes behind all five label-tier false
  // positives in the 3.25-day re-measurement — a condemnation, a faction
  // statement about future channels, a charge sheet, and one specific
  // second-hand claim. Attribution wording ("عن مسؤولين", "عن مصادر") is NOT
  // used: it also appears on genuine official-sourced breaking news, and
  // excluding it cost a real flag.
  'ندين',
  'ستعالج',
  'تهمة',
  'محكمة العدل',
  'سئم الحرب',
  // Added 2026-11-24 from the hold-out label audit (TASK 1b): an outlet that
  // prefixes EVERY headline with «عاجل|» or a red bullet still marks ordinary
  // copy that way. Measured on real headlines: a weather warning, a currency
  // price move, and three market-update posts all fired purely on the label.
  // These are not events an editor interrupts for.
  'حالة الطقس',
  'الطقس اليوم',
  'الأرصاد',
  'سعر الدولار',
  'الأسواق',
  'أسواق الخليج',
  'البورصة',
  'تحديثات مباشرة',
  'جلسة اليوم',
  // A labelled announcement of a visit or a date is not an event: measured on a
  // real «عاجل.. أمير قطر في القاهرة خلال الساعات القادمة», which carries no
  // casualty and no toll at all.
  'في القاهرة خلال',
  'خلال الساعات القادمة',
  'زيارة رسمية',
] as const;

/**
 * Toll at or above which an incident is worth a notification. Three is the line
 * between a routine local accident and something an editor would interrupt for;
 * measured, this leaves ~1 incident flag per day across all sources.
 */
export const INCIDENT_MIN_TOLL = 3;

/**
 * Routine-coverage markers. A title carrying any of these is a police blotter
 * entry, a government service story, a scheduled event or a feature — not
 * breaking news. Measured: excluding them removes the "ضبط 445 كجم" and
 * "حملة أمنية" flood that a bare casualty rule sweeps in.
 */
const ROUTINE_MARKERS = [
  'ضبط',
  'القبض',
  'اعتقال',
  'حملة',
  'حملات',
  'قضية',
  'قضايا',
  'متهم',
  'متهمين',
  'سائق',
  'مخدرات',
  'بلطجة',
  'تسول',
  'سرقة',
  'إحراز',
  'رقابة',
  'تموين',
  'أسعار',
  'مستشفى',
  'مدرسة',
  'جامعة',
  'محافظ',
  'وزير',
  'برلمان',
  'محكمة',
  'حبس',
  'حكم',
  'قرار',
  'تحرك',
  'تحذير',
  'نداء',
  'بيان',
  'رسالة',
  'دراسة',
  'تقرير',
  'حوار',
  'مقابلة',
  'رأي',
] as const;

/**
 * Sport and lifestyle markers. Measured false positives without this list:
 * "أتلتيكو مدريد يعلن تفاصيل إصابة لوكمان" (a football injury report) and
 * "«طري وغرقان في التتبيلة».. طريقة تحضير الباذنجان" (a recipe).
 */
const NOT_NEWS_MARKERS = [
  'ملعب',
  'لاعب',
  'مباراة',
  'الدوري',
  'منتخب',
  'كأس',
  'بطولة',
  'يوفنتوس',
  'ريال مدريد',
  'برشلونة',
  'الأهلي',
  'الزمالك',
  'ليفربول',
  'تشيلسي',
  'طريقة',
  'وصفة',
  'أعراض',
  'علامات',
  'نصائح',
  'فوائد',
  'أضرار',
  'زى النهارده',
  'زي النهارده',
  'في مثل هذا اليوم',
  'ذكرى',
] as const;

/**
 * Deliberately NOT used (each measured on 7 days, each rejected):
 *  - "عاجل" anywhere with a separator: 10 hits, all already caught as a label,
 *    0 from Egyptian sources.
 *  - "(عاجل)" / "[عاجل]" / "خبر عاجل" / "بيان عاجل" / "بيان رسمي": 0 hits.
 *  - Strong noun anywhere (انفجار/اغتيال/فيضانات): 28 hits but mostly analysis
 *    and retrospectives ("الكونغرس يكرم السادات بعد 45 عاما على اغتياله").
 *  - Strong noun at title START: 0 hits — these sources never write that way.
 *  - Bare verb+number ("ضبط 445 كجم", "إصابة 3 أشخاص بحريق شقة"): 41 hits, 30
 *    from Egypt, mostly blotter; alone it is several notifications a day for
 *    routine crime.
 *  - Every casualty event without a scale test: 64 hits = 9.1/day but only 66%
 *    precise (sport injuries, recipes, local incidents) — below the 85% bar.
 *  - RSS categories/tags: الجزيرة sends أخبار/اقتصاد/رياضة, CNN sends topic
 *    tags, Sky sends "Home", RT/BBC send none — no urgency signal.
 *  - Cross-source burst (>=3 outlets, 30min, 3+ shared title tokens): 4 clusters
 *    in 7 days and still flagged a scheduled Trump arrival; 6-word headline
 *    prefixes across 3+ sources: 0. Needs NLP to be safe.
 *  - Live-coverage wording (لحظة بلحظة, تغطية مباشرة): sport live blogs.
 */

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
 * Incident tier, third pass — and the version that ships.
 *
 * Two earlier attempts failed on hand-labelling, and the numbers are the reason
 * this one is shaped the way it is:
 *  - words matched anywhere (31 flags, 52% precision): "ماذا حدث في جريمة
 *    كرداسة" matched قتل, "سقوط ضحايا" matched ضحايا, "غرق سفينة شحن" matched
 *    غرق;
 *  - structural shapes with no toll threshold (24 flags, 46%): still swept in
 *    "إصابة 3 أشخاص بحريق شقة" and a 5.9-magnitude quake with no casualties.
 *
 * So an incident must be a CATASTROPHE with a human cost AND a toll of at least
 * three (or a mass word). Three is the line between a routine local accident and
 * something an editor would interrupt for. Measured: 6 flags in 7 days.
 *
 * The toll is read from the number nearest the casualty wording, and cargo
 * tonnage ("3 آلاف طن") is not a toll.
 */
export function isIncidentTitle(title: string): boolean {
  if (NOT_NEWS_MARKERS.some((m) => title.includes(m))) return false;
  if (ROUTINE_MARKERS.some((m) => title.includes(m))) return false;
  // A question or a retrospective is not an incident report.
  if (title.includes('؟')) return false;

  const hasCatastrophe = CATASTROPHE_NOUNS.some((n) => title.includes(n));
  if (!hasCatastrophe) return false;
  if (!CASUALTY_WORDS.some((w) => title.includes(w))) return false;

  return casualtyToll(title) >= INCIDENT_MIN_TOLL;
}

/** Arabic-Indic digits to ASCII, so a toll written "١٩" is readable. */
function toAsciiDigits(text: string): string {
  return text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/**
 * The human toll stated in a title: the first number after a casualty word, or a
 * mass word ("عشرات" = 30, "مئات" = 300). Cargo tonnage is excluded.
 *
 * The number is read on EITHER side of the casualty word. Arabic headlines write
 * both "مقتل 19 مدنيا" and "6 قتلى في غزة", and reading only the trailing form
 * scored the second one as zero — a measured miss on 3 of 6 stories.
 */
export function casualtyToll(title: string): number {
  const t = toAsciiDigits(title);
  const afterCasualty = t.match(
    /(?:مقتل|مصرع|إصابة|اصابة|قتل|وفاة|غرق|قتلى|جرحى|ضحايا)[^\d]{0,18}(\d+|عشرات|العشرات|المئات|مئات)/,
  );
  const massFirst = t.match(/(?:عشرات|العشرات|المئات|مئات)[^\d]{0,15}(?:قتلى|مصابين|جرحى|ضحايا)/);
  // Leading form: "6 قتلى", "19 مدنيا", "7 مدنيين وإصابة 4".
  const beforeCasualty = t.match(
    /(?:^|[^\d])(\d+|عشرات|العشرات|المئات|مئات)\s*(?:شخصا|شخصًا|أشخاص|مدنيا|مدنيين|قتيل|قتلى|مصاب|مصابين|جرحى|ضحايا|عنصر|عناصر|طالب|طالبة|تلميذ|تلميذة|عاملا|عمال)?[^\d]{0,10}(?:مقتل|قتلى|قتيل|مصرع|إصابة|جرحى|ضحايا|وفيات|تقتل)/,
  );
  const raw = afterCasualty?.[1] ?? beforeCasualty?.[1];
  if (!raw) return massFirst ? 30 : 0;
  if (/عشرات|العشرات/.test(raw)) return 30;
  if (/المئات|مئات/.test(raw)) return 300;
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  // "غرق سفينة تحمل 3 آلاف طن من القمح": the number is cargo weight, not people,
  // and it can sit before the casualty word, so scan the whole title for a
  // tonnage phrase touching that number.
  if (/\d+\s*(?:ألف|آلاف|الف)?\s*طن/.test(t)) return 0;
  return value;
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
  // coverage: the outlet itself is calling this breaking. But a label on a
  // holding statement or a scheduled event is not news.
  if (hasAlertBullet || isAlertPrefix(normalized) || hasTrailingAlertLabel(title)) {
    return !NON_EVENT_ALERT.some((m) => title.includes(m));
  }

  return isIncidentTitle(title);
}
