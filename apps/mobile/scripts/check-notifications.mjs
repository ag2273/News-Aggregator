/**
 * Checks for the push failure classifier (the reason shown in the settings
 * screen). Run: pnpm --filter @news/mobile test:notifications
 *
 * The classification decides whether the user sees "not configured in this
 * build" or "check your connection", so the strings the native module actually
 * throws are the test input.
 */
import {
  classifyPushTokenError,
  classifyHttpStatus,
  PUSH_ERROR_MESSAGES,
} from '../lib/pushErrors.ts';

let failed = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );
}

console.log('— token errors (build/config vs network) —');
check(
  'native Firebase error is a config problem',
  classifyPushTokenError(
    new Error(
      'Unable to get Firebase Messaging instance. Did you configure `googleServicesFile` path in app config? Make sure to complete the guide at https://docs.expo.dev/push-notifications/fcm-credentials/ : Default FirebaseApp is not initialized in this process com.nileorbit.newsrator. Make sure to call FirebaseApp.initializeApp(Context) first.',
    ),
  ),
  'config',
);
check(
  'missing projectId is a config problem',
  classifyPushTokenError(
    Object.assign(new Error('No "projectId" found.'), {
      code: 'ERR_NOTIFICATIONS_NO_EXPERIENCE_ID',
    }),
  ),
  'config',
);
check(
  'expo network error is a network problem',
  classifyPushTokenError(
    Object.assign(new Error('Error encountered while fetching Expo token'), {
      code: 'ERR_NOTIFICATIONS_NETWORK_ERROR',
    }),
  ),
  'network',
);
check(
  'fetch failure message is a network problem',
  classifyPushTokenError(new Error('Failed to fetch')),
  'network',
);
check('unrecognised error stays unknown', classifyPushTokenError(new Error('boom')), 'unknown');
check('non-Error values do not throw', classifyPushTokenError(undefined), 'unknown');

console.log('— HTTP statuses —');
check('401 is an auth problem', classifyHttpStatus(401), 'auth');
check('403 is an auth problem', classifyHttpStatus(403), 'auth');
check('500 is a server problem', classifyHttpStatus(500), 'server');
check('404 is a server problem', classifyHttpStatus(404), 'server');

console.log('— copy —');
const kinds = ['config', 'permission', 'network', 'auth', 'server', 'unknown'];
check('every failure kind has Arabic copy', kinds.every((k) => typeof PUSH_ERROR_MESSAGES[k] === 'string' && PUSH_ERROR_MESSAGES[k].length > 0), true);
check(
  'the config message names the token/Firebase step, not the connection',
  /رمز الإشعارات|Firebase/.test(PUSH_ERROR_MESSAGES.config),
  true,
);
check('the config message does not blame the connection', /اتصال/.test(PUSH_ERROR_MESSAGES.config), false);
check(
  'the network message does mention the connection',
  /الإنترنت/.test(PUSH_ERROR_MESSAGES.network),
  true,
);
check('the permission message points at the system settings', /إعدادات النظام/.test(PUSH_ERROR_MESSAGES.permission), true);
check('the auth message asks for a new sign-in', /سجّل الدخول/.test(PUSH_ERROR_MESSAGES.auth), true);
check('every message is distinct', new Set(Object.values(PUSH_ERROR_MESSAGES)).size, kinds.length);

console.log(failed === 0 ? '\nall checks passed' : `\n${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
