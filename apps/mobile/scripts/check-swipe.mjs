/**
 * Repeatable check for the hero-deck swipe decision.
 * Run: pnpm --filter @news/mobile test:swipe
 */
import { swipeOutcome, SWIPE_DISTANCE, SWIPE_VELOCITY } from '../lib/swipe.ts';

const cases = [
  ['small slow nudge snaps back', 40, 100, 0],
  ['exactly at the distance threshold snaps back', SWIPE_DISTANCE, 0, 0],
  ['long drag right advances', 140, 0, 1],
  ['long drag left advances', -140, 0, -1],
  ['fast flick right with short travel advances', 30, SWIPE_VELOCITY + 500, 1],
  ['fast flick left with short travel advances', -30, -(SWIPE_VELOCITY + 500), -1],
  ['a far drag wins over opposite velocity', 120, -2000, 1],
  ['no movement snaps back', 0, 0, 0],
];

let failed = 0;
for (const [name, tx, vx, want] of cases) {
  const got = swipeOutcome(tx, vx);
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: tx=${tx} vx=${vx} -> ${got} (want ${want})`);
}

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
