/**
 * Checks for the account screen's sign-out row.
 * Run: pnpm --filter @news/mobile test:account
 *
 * The bug: the button read "تسجيل" instead of "تسجيل الخروج" on a real phone.
 * The label fits horizontally (measured with the real Cairo 700 font: ~105dp at
 * 14sp, up to ~211dp at 2x font scale, inside ~277dp of usable row width), so it
 * was not width-clipped. The row was a fixed 48dp tall; at large font scales the
 * Arabic label wraps to a second line, which the fixed height cut off — leaving
 * the first word visible.
 *
 * So the invariant is: the row must size to its content (no fixed height) and
 * the label must be allowed one line.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const account = fs.readFileSync(path.join(__dirname, '../app/account.tsx'), 'utf8');

let failed = 0;

function check(name, got, want = true) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

/** Pull the signOutBtn style block out of the file. */
function styleBlock(name) {
  const start = account.indexOf(`  ${name}: {`);
  if (start === -1) return '';
  const end = account.indexOf('\n  },', start);
  return account.slice(start, end === -1 ? undefined : end);
}

console.log('— the sign-out row sizes to its content —');
const btn = styleBlock('signOutBtn');
check('signOutBtn style exists', btn.length > 0);
check('no fixed height that clips a wrapped line', /(^|\s)height:\s*\d/.test(btn), false);
check('uses a minimum height instead', /minHeight:\s*\d+/.test(btn));
check('has vertical padding so extra lines have room', /paddingVertical:\s*\d+/.test(btn));

console.log('— the label stays on one line and cannot shrink —');
const text = styleBlock('signOutText');
check('signOutText style exists', text.length > 0);
check('label does not shrink', /flexShrink:\s*0/.test(text));

// The whole button element, so attributes above the icon are included.
const btnStart = account.lastIndexOf('<TouchableOpacity', account.indexOf('styles.signOutBtn'));
const signOutJsx = account.slice(btnStart, account.indexOf('</TouchableOpacity>', btnStart));
check('label has numberOfLines={1}', /numberOfLines=\{1\}/.test(signOutJsx));
check('full Arabic label is present', signOutJsx.includes('تسجيل الخروج'));
check(
  'the button has an accessibility label with the full text',
  /accessibilityLabel="تسجيل الخروج"/.test(signOutJsx),
);

console.log('— the app name is used as the home title —');
const home = fs.readFileSync(path.join(__dirname, '../app/index.tsx'), 'utf8');
check('home header no longer says مركز الأخبار', home.includes('مركز الأخبار'), false);
check('home header says رئيس التحرير', /<Text[\s\S]{0,220}رئيس التحرير/.test(home));
check('the title can shrink instead of clipping', /adjustsFontSizeToFit/.test(home));
check('the title is limited to one line', /numberOfLines=\{1\}/.test(home));
check('its wrapper may shrink in the row', /headerTitleWrap:\s*\{[^}]*flex:\s*1/.test(home));

check(
  'the account card uses the app name too',
  account.includes('رئيس التحرير - الحساب الشخصي'),
);
check('no leftover مركز الأخبار in the account screen', account.includes('مركز الأخبار'), false);

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
