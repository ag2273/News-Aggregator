/**
 * Repeatable checks for the hero-deck swipe decision.
 * Run: pnpm --filter @news/mobile test:swipe
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  swipeOutcome,
  deckStep,
  sheetDismissOutcome,
  SWIPE_DISTANCE,
  SWIPE_VELOCITY,
  SHEET_DISMISS_DISTANCE,
  SHEET_DISMISS_VELOCITY,
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
check('SHEET_DISMISS_DISTANCE matches the worklet literal', SHEET_DISMISS_DISTANCE, 120);
check('SHEET_DISMISS_VELOCITY matches the worklet literal', SHEET_DISMISS_VELOCITY, 700);

console.log('— sheet dismiss (sheetDismissOutcome) —');
check('sheet: small slow nudge snaps back', sheetDismissOutcome(40, 100), false);
check('sheet: exactly at distance threshold snaps back', sheetDismissOutcome(SHEET_DISMISS_DISTANCE, 0), false);
check('sheet: one past threshold dismisses', sheetDismissOutcome(SHEET_DISMISS_DISTANCE + 1, 0), true);
check('sheet: long drag down dismisses', sheetDismissOutcome(160, 0), true);
check('sheet: fast downward flick with short travel dismisses', sheetDismissOutcome(20, SHEET_DISMISS_VELOCITY + 200), true);
check('sheet: upward drag never dismisses', sheetDismissOutcome(-50, 0), false);
check('sheet: fast upward flick never dismisses', sheetDismissOutcome(-20, -(SHEET_DISMISS_VELOCITY + 200)), false);
check('sheet: far downward drag wins over upward velocity', sheetDismissOutcome(150, -500), true);
check('sheet: zero movement snaps back', sheetDismissOutcome(0, 0), false);

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

console.log('— index step (deckStep): RTL feed, left = next, right = previous —');
check('left swipe advances one', deckStep(3, -1, 20), 4);
check('left swipe from the first card advances one', deckStep(0, -1, 20), 1);
check('right swipe goes back one', deckStep(3, 1, 20), 2);
check('right swipe at the first card does nothing', deckStep(0, 1, 20), null);
check('left swipe at the last card does nothing', deckStep(19, -1, 20), null);
check('right swipe from the last card works', deckStep(19, 1, 20), 18);
check('left swipe from the second-to-last works', deckStep(18, -1, 20), 19);
check('snap-back never moves the index', deckStep(7, 0, 20), null);
check('empty feed never moves', deckStep(0, 1, 0), null);
check('empty feed never moves (left)', deckStep(0, -1, 0), null);

// Regression guard for the RTL deck wiring: the reveal styles must follow the
// same rule as deckStep, and a slightly diagonal drag must still activate the pan.
console.log('— HeroDeck RTL reveal wiring —');
const heroDeckSource = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'HeroDeck.tsx'),
  'utf-8',
);
const nextStyleSrc = heroDeckSource.slice(
  heroDeckSource.indexOf('const nextCardStyle'),
  heroDeckSource.indexOf('const prevCardStyle'),
);
const prevStyleSrc = heroDeckSource.slice(
  heroDeckSource.indexOf('const prevCardStyle'),
  heroDeckSource.indexOf('const stripStyles'),
);
check('next card is revealed by a left drag (tx < 0)', nextStyleSrc.includes('Math.min(-tx.value / width'), true);
check('prev card is revealed by a right drag (tx > 0)', prevStyleSrc.includes('Math.min(tx.value / width'), true);
check('pan no longer fails on a slightly diagonal drag', heroDeckSource.includes('failOffsetY'), false);
check('pan keeps activeOffsetX for horizontal activation', heroDeckSource.includes('activeOffsetX([-10, 10])'), true);

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
  /=\s*[^,)=]*\b(SWIPE|SHEET)_(DISTANCE|VELOCITY)\b/.test(
    code.slice(code.indexOf('function swipeOutcome'), code.indexOf('__workletHash')),
  ) ||
  /=\s*[^,)=]*\b(SWIPE|SHEET)_(DISTANCE|VELOCITY)\b/.test(
    code.slice(code.indexOf('function sheetDismissOutcome'), code.lastIndexOf('__workletHash')),
  ),
  false,
);
check(
  'no closure capture of the threshold constants',
  /__closure=\[[^\]]*(SWIPE|SHEET)_/.test(code),
  false,
);

console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
