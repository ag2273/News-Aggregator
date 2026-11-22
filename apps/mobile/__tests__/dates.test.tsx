import { cairoDay, ribbonLabel, toArabicDigits } from '../lib/dates';

describe('Cairo day labels', () => {
  it('renders the four cases the spec names', () => {
    expect(ribbonLabel(-1, '2026-11-21')).toBe('أمس');
    expect(ribbonLabel(1, '2026-11-23')).toBe('غداً');
    expect(ribbonLabel(2, '2026-11-24')).toBe('بعد غد');
  });

  it('writes today with Arabic-Indic digits and an Arabic month', () => {
    expect(ribbonLabel(0, '2026-11-22')).toBe('اليوم ٢٢ نوفمبر');
  });

  it('falls back to a weekday name for the far end of the ribbon', () => {
    // 2026-11-26 is a Thursday.
    expect(ribbonLabel(4, '2026-11-26')).toBe('الخميس');
  });

  it('converts digits for display only', () => {
    expect(toArabicDigits('2026')).toBe('٢٠٢٦');
  });

  it('produces a machine-readable Cairo date', () => {
    expect(cairoDay(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Two consecutive offsets differ by exactly one day.
    const a = new Date(`${cairoDay(0)}T00:00:00Z`).getTime();
    const b = new Date(`${cairoDay(1)}T00:00:00Z`).getTime();
    expect(b - a).toBe(86_400_000);
  });
});
