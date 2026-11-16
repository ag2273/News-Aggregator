/**
 * Swipe decision for the hero deck.
 * Pure + worklet-safe so the Pan handler and the tests share one rule.
 *
 * Direction is the physical finger direction in screen coordinates:
 *   +1 = the finger moved right  → NEXT article
 *   -1 = the finger moved left   → PREVIOUS article
 *
 * IMPORTANT: worklets run on the UI thread. They must not take module constants
 * as *default parameter values* — babel turns those into bare identifiers that
 * are only bound inside the worklet body, so the call throws ReferenceError on
 * the UI thread and the app dies. Thresholds are therefore plain literals
 * inside the body; the exported constants below must stay in sync with them
 * (scripts/check-swipe.mjs asserts that).
 */

export const SWIPE_DISTANCE = 90;
export const SWIPE_VELOCITY = 700;

export const SHEET_DISMISS_DISTANCE = 120;
export const SHEET_DISMISS_VELOCITY = 700;

export type SwipeDirection = -1 | 0 | 1;

/**
 * @returns 1 = swipe right, -1 = swipe left, 0 = below threshold (snap back)
 */
export function swipeOutcome(translationX: number, velocityX: number): SwipeDirection {
  'worklet';
  const far = Math.abs(translationX) > 90;
  const fast = Math.abs(velocityX) > 700;
  if (!far && !fast) return 0;

  // A slow long drag follows the finger; a fast flick follows the velocity.
  const leading = Math.sign(translationX) !== 0 ? translationX : velocityX;
  const dir = Math.sign(leading);
  return dir === 0 ? 0 : dir > 0 ? 1 : -1;
}

/**
 * Downward drag decision for the article sheet modal.
 * Pure + worklet-safe so the Pan handler and the tests share one rule.
 *
 * Dismisses if:
 * 1. Dragged downward past 120px (translationY > 120)
 * 2. Flicked downward with velocity > 700 and positive travel (translationY > 0)
 *
 * NOTE: thresholds are literals inside the body to prevent worklet closure/default-param crashes.
 */
export function sheetDismissOutcome(translationY: number, velocityY: number): boolean {
  'worklet';
  if (translationY <= 0) return false;
  const far = translationY > 120;
  const fast = velocityY > 700;
  return far || fast;
}

/**
 * Which deck index a swipe lands on, or null when the swipe should snap back.
 * Right (+1) goes forward, left (-1) goes back; both are clamped to the feed.
 */
export function deckStep(
  current: number,
  direction: SwipeDirection,
  total: number,
): number | null {
  'worklet';
  if (direction === 0) return null;
  const next = current + direction;
  if (next < 0 || next >= total) return null;
  return next;
}
