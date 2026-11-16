/**
 * Repeatable checks for the hero-deck swipe decision.
 * Run: pnpm --filter @news/mobile test:swipe
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  swipeOutcome,
  deckStep,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
} from '../lib/swipe.ts';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failed = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

console.log('— thresholds —');
// The worklet body uses literals (it cannot capture module constants), so the
// exported constants must keep matching them.
check('SWIPE_DISTANCE matches the worklet literal', SWIPE_DISTANCE, 90);
check('SWIPE_VELOCITY matches the worklet literal', SWIPE_VELOCITY, 700);

console.log('— threshold + direction (swipeOutcome) —');
check('small slow nudge snaps back', swipeOutcome(40, 100), 0);
check('exactly at the distance threshold snaps back', swipeOutcome(SWIPE_DISTANCE, 0), 0);
check('one past the threshold swipes right', swipeOutcome(SWIPE_DISTANCE + 1, 0), 1);
check('long drag right = +1', swipeOutcome(140, 0), 1);
check('long drag left = -1', swipeOutcome(-140, 0), -1);
check('fast flick right with short travel = +1', swipeOutcome(30, SWIPE_VELOCITY + 500), 1);
check('fast flick left with short travel = -1', swipeOutcome(-30, -(SWIPE_VELOCITY + 500)), -1);
check('a far drag wins over opposite velocity', swipeOutcome(120, -2000), 1);
check('no movement snaps back', swipeOutcome(0, 0), 0);

console.log('— index step (deckStep): right = next, left = previous —');
check('right swipe advances one', deckStep(0, 1, 20), 1);
check('left swipe goes back one', deckStep(3, -1, 20), 2);
check('left swipe at the first card does nothing', deckStep(0, -1, 20), null);
check('right swipe at the last card does nothing', deckStep(19, 1, 20), null);
check('right swipe from the second-to-last works', deckStep(18, 1, 20), 19);
check('left swipe from the last card works', deckStep(19, -1, 20), 18);
check('snap-back never moves the index', deckStep(7, 0, 20), null);
check('empty feed never moves', deckStep(0, 1, 0), null);

// Regression guard for the 5158c1b crash: a worklet must not reference module
// constants from its parameter defaults — babel emits those as bare identifiers
// that only exist inside the worklet body, so the call throws on the UI thread.
console.log('— emitted worklet safety —');
const babel = require('@babel/core');
const file = path.join(__dirname, '..', 'lib', 'swipe.ts');
const out = babel.transformFileSync(file, {
  presets: ['babel-preset-expo'],
  filename: file,
  caller: { name: 'metro', platform: 'ios', isDev: false },
});
const code = out.code;
check(
  'no worklet parameter default reads a module constant',
  /=\s*[^,)=]*\bSWIPE_(DISTANCE|VELOCITY)\b/.test(
    code.slice(code.indexOf('function swipeOutcome'), code.indexOf('__workletHash')),
  ),
  false,
);
check(
  'no closure capture of the threshold constants',
  /__closure=\[[^\]]*SWIPE_/.test(code),
  false,
);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
