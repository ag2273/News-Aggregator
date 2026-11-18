/**
 * Pure keyboard geometry, kept free of React Native imports so it can be
 * checked in Node (scripts/check-keyboard.mjs).
 */

/**
 * How much of the keyboard actually covers the app.
 *
 * Edge-to-edge (what this app builds with): the window keeps its height, so the
 * keyboard covers all of it and the form needs that much padding.
 * A window that resizes instead shrinks by the keyboard height, so nothing is
 * left uncovered — padding it again would push the form up twice.
 */
export function keyboardOverlap(
  keyboardHeight: number,
  windowHeight: number,
  restingWindowHeight: number,
): number {
  if (keyboardHeight <= 0) return 0;
  const shrink = Math.max(0, restingWindowHeight - windowHeight);
  return Math.max(0, keyboardHeight - shrink);
}
