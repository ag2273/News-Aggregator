/**
 * Swipe decision for the hero deck.
 * Pure + worklet-safe so the Pan handler and tests share one rule.
 */

export const SWIPE_DISTANCE = 90;
export const SWIPE_VELOCITY = 700;

export type SwipeDirection = -1 | 0 | 1;

/**
 * @returns 1 = flick right, -1 = flick left, 0 = below threshold (snap back)
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
