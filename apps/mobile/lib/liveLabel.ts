import type { FootballMatch } from './api';

/**
 * The live minute, exactly as far as the source goes (issue #36).
 *
 * RULES, all of them from measurements rather than preference:
 *
 *   * A minute is printed only when a source published one. The old rule was
 *     «مفيش دقيقة أحسن من دقيقة غلط», and it still holds — FilGoal's counter is not
 *     a match clock, so an Egyptian fixture still shows its state alone.
 *   * Published stoppage time is shown as sent (`90'+4'`). It is never converted to
 *     94, and never added up from the clock: that would be our arithmetic.
 *   * Between halves the match is live but not being played, so it reads «استراحة»
 *     with no minute. ESPN keeps a match "in" for 14-15 minutes there, and a
 *     frozen 45 beside a live dot reads as football being played.
 *   * With no source minute, the state word is shown alone.
 *
 * The output has two parts so a screen can style them apart:
 *   `minute` — `"74'"` or `"90'+4'"`, or null when nothing was published.
 *   `state`  — the half or state text («الشوط الثاني», «استراحة», «مباشر»).
 */
export function liveLabel(m: Pick<FootballMatch, 'status' | 'statusText' | 'minute' | 'minuteLabel' | 'half' | 'halftime'>): {
  minute: string | null;
  state: string;
} {
  const state =
    (m.halftime ? 'استراحة' : m.half?.trim()) || m.statusText?.trim() || 'مباشر';
  if (m.status !== 'live' || m.halftime) return { minute: null, state };
  // The label the provider sent wins over the number: it is their wording, and it
  // is the only place stoppage time appears.
  const minute = m.minuteLabel?.trim() || (m.minute ? `${m.minute}'` : null);
  return { minute, state };
}

/** The live line as one string, for a screen that has only one slot. */
export function liveText(m: Parameters<typeof liveLabel>[0]): string {
  const { minute, state } = liveLabel(m);
  return minute ? `الدقيقة ${minute} • ${state}` : state;
}
