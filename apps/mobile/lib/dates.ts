// Cairo day handling for the match screens.
//
// One definition, used by the matches screen, the upcoming screen and the
// header. The older code had this copied per screen, which is how a date ribbon
// and its heading drift apart.

/** Cairo-local `YYYY-MM-DD`, offset by whole days. */
export function cairoDay(offset = 0): string {
  return new Date(Date.now() + 2 * 60 * 60 * 1000 + offset * 86_400_000).toISOString().slice(0, 10);
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'إبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];
const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

/**
 * `اليوم ٢٢ نوفمبر` / `أمس` / `غداً` / a weekday name.
 *
 * Arabic-Indic digits in the label, as the spec writes the ribbon, while the
 * machine-readable date stays ASCII.
 */
export function ribbonLabel(offset: number, date: string): string {
  const day = toArabicDigits(date.slice(8, 10));
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? '';
  if (offset === 0) return `اليوم ${day} ${month}`;
  if (offset === -1) return 'أمس';
  if (offset === 1) return 'غداً';
  if (offset === -2) return `قبل يومين`;
  if (offset === 2) return `بعد غد`;
  const d = new Date(`${date}T12:00:00Z`);
  return WEEKDAYS[d.getUTCDay()] ?? `${day} ${month}`;
}

/** Western digits to Arabic-Indic, for display only. */
export function toArabicDigits(input: string): string {
  return input.replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
}
