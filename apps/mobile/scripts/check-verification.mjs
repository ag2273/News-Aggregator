/**
 * Checks for the unverified-account UX.
 * Run: pnpm --filter @news/mobile test:verification
 *
 * The bug this pins: an unverified account's gated screens called gated
 * endpoints, got 403 EMAIL_NOT_VERIFIED, and showed "تحقق من الاتصال" — blaming
 * the connection for something the app already knew. Three invariants:
 *
 *  (a) a gated screen must not call a gated endpoint while unverified;
 *  (b) a 403 EMAIL_NOT_VERIFIED must never produce connection wording;
 *  (c) account.tsx renders a distinct pending vs verified status.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError, isEmailNotVerified, isNetworkFailure } from '../lib/api.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let failed = 0;
function check(name, got, want = true) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

console.log('— error classification —');
check(
  'a 403 gate is recognised as verification, not network',
  isEmailNotVerified(new ApiError(403, 'Email verification required', 'EMAIL_NOT_VERIFIED')),
);
check('a 403 without a code still counts as the gate', isEmailNotVerified(new ApiError(403, 'Forbidden')));
check('a 500 is not the gate', isEmailNotVerified(new ApiError(500, 'boom')), false);
check('a fetch TypeError is a network failure', isNetworkFailure(new TypeError('Network request failed')));
check('an offline message is a network failure', isNetworkFailure(new Error('Failed to fetch')));
check('a 403 is NOT a network failure', isNetworkFailure(new ApiError(403, 'gate')), false);
check(
  'a plain API error is not treated as the gate',
  isEmailNotVerified(new Error('API error 403')),
  false,
);

console.log('— (a) gated screens do not fetch while unverified —');
/** Every screen that talks to an account-bound endpoint. */
const gatedScreens = [
  ['app/saved.tsx', 'fetchSavedArticles'],
  ['app/following.tsx', 'fetchFollowingFeed'],
  ['app/sources.tsx', 'fetchFollows'],
];

for (const [file, fn] of gatedScreens) {
  const src = read(file);
  check(`${file} reads emailVerified from useAuth`, /emailVerified\s*\}\s*=\s*useAuth\(\)/.test(src));
  // The guard must appear before the gated call inside the loader. The call may
  // be awaited directly or passed to Promise.all, so match either.
  const guardIdx = src.indexOf('if (!emailVerified)');
  const callIdx = src.search(new RegExp(`(await |\\s)${fn}\\(`));
  check(`${file} returns before calling ${fn}`, guardIdx !== -1 && callIdx !== -1 && guardIdx < callIdx);
  check(`${file} renders the locked state`, /<VerificationGate/.test(src));
  check(`${file} no longer shows the old banner too`, /<VerifyBanner/.test(src), false);
  check(
    `${file} maps the gate before setting any error text`,
    /isEmailNotVerified\(err\)/.test(src),
  );
}

console.log('— (a2) source screen: follow is gated, articles are not —');
const sourceScreen = read('app/source/[id].tsx');
check('reads emailVerified', /emailVerified\s*\}\s*=\s*useAuth\(\)/.test(sourceScreen));
// The follow-state sync must not call the gated endpoint while unverified.
const syncGuard = sourceScreen.indexOf('if (!token || !id || !emailVerified)');
const syncCall = sourceScreen.indexOf('fetchFollows(token)', syncGuard === -1 ? 0 : syncGuard);
check(
  'does not fetch /api/follows while unverified',
  syncGuard !== -1 && syncCall !== -1 && syncGuard < syncCall,
);
check('re-syncs when verification lands', /\[token, id, emailVerified\]/.test(sourceScreen));
// Tapping متابعة must open the explanation, before any follow/unfollow request.
const toggleIdx = sourceScreen.indexOf('const handleToggleFollow');
const gateInHandler = sourceScreen.indexOf('if (!emailVerified)', toggleIdx);
const followCall = sourceScreen.indexOf('followSource(id, token)', toggleIdx);
check(
  'tapping متابعة is gated before the request',
  gateInHandler !== -1 && followCall !== -1 && gateInHandler < followCall,
);
check('opens the calm sheet', /setVerifySheetOpen\(true\)/.test(sourceScreen));
check('renders the gate in a sheet', /<Modal[\s\S]{0,1200}<VerificationGate/.test(sourceScreen));
check('classifies a gate answer in the toggle catch', /isEmailNotVerified\(err\)/.test(sourceScreen));
check('public article list still loads without the gate', /fetchSourceArticles\(id/.test(sourceScreen));
// The articles list must not be replaced by the locked state.
check('article list is not hidden behind the gate', /<VerificationGate/.test(sourceScreen) && /data=\{articles\}/.test(sourceScreen));

console.log('— (b) 403 never produces connection wording —');
const connectionWording = /تحقق من الاتصال|تحقّق من الاتصال|من الإنترنت/;
const forbidden = /تحقق من الاتصال|تحقّق من الاتصال/; // the exact phrase the user objected to
const auditSites = [
  'app/index.tsx',
  'app/trending.tsx',
  'app/search.tsx',
  'app/sources.tsx',
  'app/source/[id].tsx',
  'app/saved.tsx',
  'app/following.tsx',
  'app/article.tsx',
];
for (const file of auditSites) {
  const src = read(file);
  // Wherever a camera-visible error is set, connection wording must be behind
  // isNetworkFailure — i.e. no unconditional connection string.
  const lines = src.split('\n');
  let offending = 0;
  lines.forEach((line, i) => {
    if (!forbidden.test(line)) return;
    // It is fine inside an isNetworkFailure branch (checked within 3 lines above).
    const context = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!/isNetworkFailure/.test(context)) offending++;
  });
  check(`${file} has no unconditional connection message`, offending, 0);
  // And any error it shows is classified.
  if (/setError\(/.test(src) && /catch \(err\)/.test(src)) {
    check(`${file} classifies its catch`, /isNetworkFailure\(err\)/.test(src));
  }
}
check(
  'the app still has a real network message somewhere',
  read('app/saved.tsx').includes('تعذّر الاتصال بالخادم'),
);

console.log('— (c) account screen status —');
const account = read('app/account.tsx');
check('uses emailVerified', /emailVerified\s*\}\s*=\s*useAuth\(\)/.test(account));
check('shows the pending title', account.includes('في انتظار التوثيق'));
check('shows the verified badge', account.includes('موثّق ✓'));
check('pending state names the email', /افتح الرابط اللي بعتناه على/.test(account));
check('pending state offers resend', /accessibilityLabel="إعادة إرسال الرابط"/.test(account));
check('pending state offers the re-check', /accessibilityLabel="تحققت"/.test(account));
check('pending badge uses an amber tone', /const AMBER = '#F59E0B'/.test(account));
check('the two states are exclusive', /\{emailVerified \? \(/.test(account));

console.log('— no regressions in the sign-out row —');
check('sign-out still sizes to content', /minHeight: 48/.test(account));
check('sign-out label still one line', /numberOfLines=\{1\}/.test(account));

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
