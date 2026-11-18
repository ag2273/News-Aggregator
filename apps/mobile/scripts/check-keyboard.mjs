/**
 * Checks for the auth-form keyboard geometry.
 * Run: pnpm --filter @news/mobile test:keyboard
 *
 * The bug: the keyboard covered the password field on Android. The form pads
 * itself by this overlap, so the numbers must be right in both window modes.
 */
import { keyboardOverlap } from '../lib/keyboardMath.ts';

let failed = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

const WINDOW = 800;
const KEYBOARD = 300;

console.log('— no keyboard —');
check('hidden keyboard needs no padding', keyboardOverlap(0, WINDOW, WINDOW), 0);

console.log('— edge-to-edge (what this build does) —');
check(
  'window keeps its height, so the whole keyboard overlaps',
  keyboardOverlap(KEYBOARD, WINDOW, WINDOW),
  KEYBOARD,
);
check(
  'a taller keyboard overlaps more',
  keyboardOverlap(420, WINDOW, WINDOW),
  420,
);

console.log('— resizing window —');
check(
  'window shrank by the keyboard, so nothing is left uncovered',
  keyboardOverlap(KEYBOARD, WINDOW - KEYBOARD, WINDOW),
  0,
);
check(
  'window shrank less than the keyboard: pad the difference only',
  keyboardOverlap(KEYBOARD, WINDOW - 100, WINDOW),
  200,
);
check(
  'window grew while the keyboard is up: never negative',
  keyboardOverlap(KEYBOARD, WINDOW + 50, WINDOW),
  KEYBOARD,
);
check('negative keyboard height is ignored', keyboardOverlap(-10, WINDOW, WINDOW), 0);

console.log('— the reported bug —');
// Sign-up screen: name + email + password + submit. In an 800dp window the
// password field ends ~470dp down and the submit button ~540dp down, while a
// 300dp keyboard hides everything below ~500dp.
//
// Without the padding the ScrollView is 800dp tall and its content is only
// ~560dp, so it believes everything fits and cannot scroll at all: the button
// stays under the keyboard. Padding by the overlap makes the content taller
// than the viewport, which is what allows it to scroll above the keyboard.
const WINDOW_H = 800;
const KB = 300;
const BASE = 20;
const passwordBottom = 470;
const submitBottom = 540;

function reachable(bottom, overlap) {
  const viewport = WINDOW_H;
  const content = bottom + BASE + overlap;
  const maxScroll = Math.max(0, content - viewport);
  const needed = Math.max(0, bottom - (WINDOW_H - KB));
  return maxScroll >= needed;
}

check('password field is reachable without padding', reachable(passwordBottom, 0), true);
check('submit button is NOT reachable without padding', reachable(submitBottom, 0), false);
check(
  'submit button IS reachable with the overlap padding',
  reachable(submitBottom, keyboardOverlap(KB, WINDOW_H, WINDOW_H)),
  true,
);

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
