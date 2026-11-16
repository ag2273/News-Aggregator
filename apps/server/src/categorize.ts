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
