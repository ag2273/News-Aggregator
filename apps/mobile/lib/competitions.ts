// Display names for the competitions we link between pages.
//
// A small local map, used only for a chip whose label must render before the
// competition page's own response arrives. The server remains the source of truth
// for the list and the order; this is a label lookup, nothing more.

export const COMPETITION_LABELS: Record<string, string> = {
  'egyptian-premier': 'الدوري المصري',
  'egypt-cup': 'كأس مصر',
  'caf-champions': 'دوري أبطال إفريقيا',
  'caf-confederation': 'كأس الكونفدرالية',
  'uefa-champions': 'دوري أبطال أوروبا',
  'eng-premier': 'الدوري الإنجليزي',
  'esp-la-liga': 'الدوري الإسباني',
  'ita-serie-a': 'الدوري الإيطالي',
  'ger-bundesliga': 'الدوري الألماني',
  'fra-ligue-1': 'الدوري الفرنسي',
  'saudi-pro-league': 'الدوري السعودي',
  'egyptian-women': 'الدوري المصري للسيدات',
  'uefa-europa': 'الدوري الأوروبي',
  'uefa-conference': 'دوري المؤتمر الأوروبي',
  'fifa-u17-world-cup': 'كأس العالم تحت 17',
  'tur-super-lig': 'الدوري التركي',
  'eng-championship': 'دوري البطولة الإنجليزية',
};

export function competitionName(id: string): string {
  // A competition we do not cover carries its own name in its id («other:…»).
  if (id.startsWith('other:')) return id.slice('other:'.length);
  return COMPETITION_LABELS[id] ?? id;
}
