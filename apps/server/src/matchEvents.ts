// Match events — the goal timeline — from the FilGoal match page.
//
// MEASURED, 2026-11-23. The earlier verdict on this ticket («events are impossible,
// no source publishes them») was WRONG, and this file is the correction.
//
// What the earlier measurement missed: it looked for `MatchEvents` / `Goals` in the
// page's JSON payload, found none, and stopped. The events are not in that payload —
// they are in the page's own markup, in a `match-events-container` list that we had
// never looked at because the rules were written against the JSON.
//
// Verified on real finished Egyptian league fixtures (2026-10-28):
//   الزمالك 2-1 المقاولون العرب  → 88' هدف شيكو بانزا, 57' هدف محمد عبد الناصر,
//                                 46' هدف محمد حمد, plus four yellow cards
//   البنك الأهلي 1-1 المصري       → 5 events
//   بيراميدز 2-1 وادي دجلة        → 6 events
//   مودرن سبورت 1-2 الأهلي        → 3 events
// The goals in each timeline reconcile with the published score, which is the check
// that matters: a timeline that disagrees with the score is worse than none.
//
// So the box DOES publish minute, event type and scorer for Egyptian football. The
// «بدون دقيقة» ceiling stays where it belongs — the live-score card, where the
// minute would have to be computed rather than read — but the archive is real data.

/** One line of the match timeline. */
export interface MatchEvent {
  /** Minute as published («88»). Null for a status-only row. */
  minute: number | null;
  /** The event's own label from the source: «هدف», «بطاقة صفراء», … */
  type: string;
  /** Scorer or booked player, when the row names one. */
  player: string | null;
  /**
   * Which side the row belongs to.
   *
   * The page marks it with `class="r"` or `class="l"`, which are the two columns.
   * The design file's own layout puts the home side in the right column for
   * Arabic (right-to-left), so `r` is home — but that is an inference about the
   * template, so the parser keeps the raw marker and `home` is resolved by the
   * caller against the page's home team id where the markup allows it.
   */
  side: 'r' | 'l' | null;
  /** Status rows («انتهت», «لم تبدأ», «استراحة») are markers, not events. */
  isStatus: boolean;
}

/**
 * Pull the timeline out of a match page's HTML.
 *
 * Returns `[]` when the page has no events block, or the block exists but carries
 * only status rows (an unplayed match). Both mean the same thing to the screen:
 * there is no timeline to show yet. It never invents a row.
 */
export function parseMatchEvents(html: string): MatchEvent[] {
  if (!html) return [];
  const start = html.indexOf('match-events-container');
  if (start < 0) return [];
  // The list ends with its own closing `</ul>`; slicing 8KB past the marker covers
  // a long match without risking a read of the whole page per row.
  const region = html.slice(start, start + 8000);

  const out: MatchEvent[] = [];
  for (const m of region.matchAll(/<li>([\s\S]*?)<\/li>/g)) {
    const body = m[1]!;
    const status = body.match(/<h3>\s*([^<]+?)\s*<\/h3>/);
    if (status) {
      out.push({
        minute: null,
        type: status[1]!.trim(),
        player: null,
        side: null,
        isStatus: true,
      });
      continue;
    }
    const minuteRaw = body.match(/<span[^>]*>\s*(\d{1,3})\s*<\/span>/);
    if (!minuteRaw) continue;
    const minute = Number(minuteRaw[1]);
    if (!Number.isFinite(minute) || minute < 0 || minute > 130) continue;

    const type = body.match(/alt="([^"]*)"/)?.[1]?.trim() ?? '';
    const player = body.match(/\/players\/\d+\/[^"]*">([^<]+)<\/a>/)?.[1]?.trim() ?? null;
    const side = body.match(/class="\s*([rl])\s*"/)?.[1] as 'r' | 'l' | undefined;
    // A row with no type is not an event we can describe, so it is dropped rather
    // than shown as an unlabelled minute.
    if (!type) continue;
    out.push({ minute, type, player, side: side ?? null, isStatus: false });
  }
  return out;
}

/** The played events only, newest-first as the page lists them. */
export function playableEvents(events: MatchEvent[]): MatchEvent[] {
  return events.filter((e) => !e.isStatus);
}
