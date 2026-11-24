/**
 * The source gate in front of rule G (issues #43 / TASK 1b).
 *
 * Rule G decides whether a headline reads as breaking; this gate decides whether
 * the outlet that printed it is allowed to set the flag at all. Both must agree, so
 * these pin the gate on its own: an unvetted source cannot get a flag into the
 * store, and a source enabled after the hold-out audit can.
 */

import { describe, it, expect } from 'vitest';
import { applySourceBreaking } from '../ingest.js';
import { detectBreaking } from '../categorize.js';
import { SOURCES } from '../types.js';

const rows = (): Array<{ id: string; isBreaking: boolean }> => [
  { id: 'a', isBreaking: true },
  { id: 'b', isBreaking: false },
];

describe('source breaking gate', () => {
  it('clears the flag for a source that is not vetted', () => {
    expect(applySourceBreaking(rows(), { breaking: false }).every((r) => !r.isBreaking)).toBe(true);
  });

  it('leaves the flag alone for a vetted source', () => {
    expect(applySourceBreaking(rows(), { breaking: true })).toEqual(rows());
  });

  it('honours the sources enabled by the hold-out audit', () => {
    // الخليج was gated off until its two real incident headlines were reviewed
    // (11 قتيلاً في هجوم روسي / 60 قتيلاً بهجمات انتقامية). It must now be able to
    // set the flag, and the bulk of sources must still be unable to.
    const enabled = new Set(SOURCES.filter((s) => s.breaking).map((s) => s.id));
    expect(enabled.has('alkhaleej')).toBe(true);

    const khaleej = SOURCES.find((s) => s.id === 'alkhaleej')!;
    expect(applySourceBreaking(rows(), khaleej).some((r) => r.isBreaking)).toBe(true);

    // Still gated: a source whose only candidate flag was a label-tier false
    // positive (a weather warning, a currency move).
    const watan = SOURCES.find((s) => s.id === 'elwatannews')!;
    expect(watan.breaking).toBe(false);
    expect(applySourceBreaking(rows(), watan).every((r) => !r.isBreaking)).toBe(true);
  });

  it('does not gate the majority of sources on', () => {
    // The audit flipped ONE source. A future edit that flips many at once would be
    // changing the precision of the whole feed without new evidence.
    const enabled = SOURCES.filter((s) => s.breaking).length;
    expect(enabled).toBe(11);
    expect(SOURCES.length).toBe(29);
  });

describe('labelled headlines that are not events', () => {
  it('does not fire on an outlet that labels ordinary copy «عاجل»', () => {
    // Measured on real headlines from the hold-out audit: an outlet prefixes every
    // story with «عاجل|», so a weather warning and a currency move both fired on the
    // label alone. Neither is something an editor interrupts for.
    expect(detectBreaking('عاجل| حالة الطقس اليوم.. «الأرصاد» تحذر من الشبورة')).toBe(false);
    expect(detectBreaking('عاجل| انخفاض سعر الدولار مقابل الجنيه في البنوك')).toBe(false);
    // A red bullet on a market update is the same shape.
    expect(detectBreaking('🔴مكاسب شبه جماعية للأسواق الخليجية (تحديثات مباشرة)')).toBe(false);
    // A labelled visit announcement carries no casualty and no toll.
    expect(detectBreaking('عاجل.. أمير قطر في القاهرة خلال الساعات القادمة')).toBe(false);
  });

  it('still fires on the real incidents from the same audit', () => {
    expect(detectBreaking('أوكرانيا: 11 قتيلاً في هجوم روسي على بلدة ديمر')).toBe(true);
    expect(detectBreaking('60 قتيلاً بهجمات انتقامية في نيجيريا')).toBe(true);
    expect(detectBreaking('الحوثيون: مقتل عشرات المدنيين في غارات سعودية')).toBe(true);
  });
});
});
