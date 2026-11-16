/**
 * Swipe decision for the hero deck.
 * Pure + worklet-safe so the Pan handler and the tests share one rule.
 *
 * Direction is the physical finger direction in screen coordinates:
 *   +1 = the finger moved right  → NEXT article
 *   -1 = the finger moved left   → PREVIOUS article
 */

export const SWIPE_DISTANCE = 90;
export const SWIPE_VELOCITY = 700;

export type SwipeDirection = -1 | 0 | 1;

/**
 * @returns 1 = swipe right, -1 = swipe left, 0 = below threshold (snap back)
 */
export function swipeOutcome(
  translationX: number,
  velocityX: number,
  distance: number = SWIPE_DISTANCE,
  velocity: number = SWIPE_VELOCITY,
): SwipeDirection {
  'worklet';
  const far = Math.abs(translationX) > distance;
  const fast = Math.abs(velocityX) > velocity;
  if (!far && !fast) return 0;

  // A slow long drag follows the finger; a fast flick follows the velocity.
  const leading = Math.sign(translationX) !== 0 ? translationX : velocityX;
  const dir = Math.sign(leading);
  return dir === 0 ? 0 : (dir > 0 ? 1 : -1);
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
