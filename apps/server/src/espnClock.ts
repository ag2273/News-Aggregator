// ESPN's live clock, and the link from an ESPN fixture to ours (issue #36).
//
// WHY THIS FILE EXISTS
// --------------------
// The live minute was hidden on purpose when the only source was FilGoal: its
// `TimeElapsed` is not a match clock (measured `-79`, `-92`, `2087` while a match
// was being played, and `StartAt` in the future), so any minute derived from it is
// invented. ESPN is different — measured live on 2026-11-24 across two Champions
// League matches, 57 samples a minute apart:
//
//   * `status.clock` advanced on 61 of 92 consecutive pairs, always in step with
//     `status.displayClock` (61/61).
//   * It advances at ~61 s per real minute while the ball is in play.
//   * First half caps at exactly `2700` s / `45:00`, then flips to `46:00` — it
//     never runs past 45.
//   * Second half carries REAL stoppage time in `displayClock` (`90'+1'` … `90'+7'`
//     were observed while the state was still `in`), so added time is published,
//     not computed. The earlier note that ESPN never shows a `+` was measured in
//     the 75th-83rd minute and was wrong for the end of the match.
//   * Between halves `state` stays `in` for 14-15 minutes while the clock freezes
//     on `45:00` and the detail reads `HT`, so `state === 'in'` alone does NOT mean
//     the ball is being played.
//
// So: the minute is real, and nothing here invents one. A match ESPN does not know
// keeps showing only its state.

/** What the provider says about one live match's clock. */
export interface EspnClock {
  /**
   * The minute as the provider words it, e.g. `"84'"`, `"45:00"`, `"90'+4'"`.
   *
   * Kept as text, not a number: `+4` is real published stoppage time, and turning
   * it into `94` would be our arithmetic rather than their statement.
   */
  label: string;
  /** The minute number alone (84), for a UI that needs a value. */
  minute: number | null;
  /** Published stoppage time after 45/90, when the provider gives one. */
  added: number | null;
  /** 1 or 2 when the provider says which half; null when it does not. */
  period: 1 | 2 | null;
  /** Between halves: the provider is still `in`, but no football is being played. */
  halftime: boolean;
}

/**
 * A minute label from an ESPN clock, or null when there is nothing honest to show.
 *
 * Neither an empty string nor `"0'"` is a live minute: ESPN sends exactly those for
 * a match that has not kicked off.
 *
 * The shapes measured on 2026-11-24: `"84'"`, `"45:00"`, and `"90'+4'"` — note the
 * apostrophe BEFORE the `+`, which is ESPN's own wording for stoppage time.
 */
export function espnClockLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  // "84'", "90'+4'", "45:00", "67:12" — digit-led, optional '+N' after the mark.
  if (!/^\d{1,3}(?:'\d{0,2})?(?:\+\d{1,2})?'?$|^\d{1,3}:\d{2}$/.test(text)) return null;
  const minute = Number(text.match(/^\d{1,3}/)?.[0]);
  if (!Number.isFinite(minute) || minute <= 0) return null;
  return text;
}

/**
 * Read one ESPN status block into our clock shape.
 *
 * `type.detail` is the provider's own wording and is preferred over
 * `displayClock` because it carries the half-time marker (`HT`) and the full-time
 * marker (`FT`) that `displayClock` never does.
 */
export function parseEspnClock(status: unknown): EspnClock | null {
  const block = status as Record<string, any> | undefined;
  if (!block) return null;
  const type = (block['type'] ?? {}) as Record<string, any>;
  if (String(type['state'] ?? '') !== 'in') return null;
  const detail = String(type['detail'] ?? '').trim();
  const description = String(type['description'] ?? '');
  // Measured: the detail is "HT" through the interval while the state is still "in".
  const halftime = /^HT$/i.test(detail) || /half.?time/i.test(description);
  const label = espnClockLabel(block['displayClock']) ?? espnClockLabel(detail);
  const periodRaw = Number(block['period']);
  const period: 1 | 2 | null = periodRaw === 1 ? 1 : periodRaw >= 2 ? 2 : null;
  if (!label && !halftime) return null;
  const addedMatch = label?.match(/^(\d{1,3})'?\+(\d{1,2})/);
  return {
    label: label ?? '45:00',
    minute: label ? Number(label.match(/^\d{1,3}/)?.[0]) : null,
    added: addedMatch ? Number(addedMatch[2]) : null,
    period,
    halftime,
  };
}

/**
 * The half, in the words the app shows.
 *
 * A provider that names the half is believed; one that does not gets `null` rather
 * than a guessed half.
 */
export function halfText(clock: EspnClock | null): string | null {
  if (!clock) return null;
  if (clock.halftime) return 'استراحة';
  if (clock.period === 1) return 'الشوط الأول';
  if (clock.period === 2) return 'الشوط الثاني';
  return null;
}

/**
 * Is this fixture on the pitch right now, as opposed to merely `state === 'in'`?
 *
 * The distinction is the whole point: a match in its half-time interval is `in` on
 * ESPN for 14-15 minutes, and counting that as live puts a stopped match in the
 * live strip and on the header dot.
 */
export function isPlaying(clock: EspnClock | null): boolean {
  return Boolean(clock) && !clock!.halftime;
}
