/**
 * Push tests: matching rules, the token registry, and the FCM HTTP v1 sender.
 *
 * The network is always a stub `fetch`, so these run offline. The service
 * account is a throwaway RSA key generated in the test, which exercises the
 * real JWT signing path without any Google credentials.
 */

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Article } from '../types.js';
import {
  shouldPushTo,
  isValidMode,
  isLegacyExpoToken,
  registerPushToken,
  updatePushPrefs,
  getPushPrefs,
  unregisterPushToken,
  removeDeadToken,
  getAllPushRecords,
  loadServiceAccount,
  buildJwtAssertion,
  getAccessToken,
  buildFcmMessage,
  isDeadTokenResponse,
  sendFcmMessage,
  runWithConcurrency,
  sendPushNotifications,
  CHANNEL_BREAKING,
  CHANNEL_NEWS,
  FCM_API_BASE,
  GOOGLE_TOKEN_URL,
  _resetPushCache,
  _resetAccessToken,
  _resetPushedIds,
  type PushRecord,
} from '../push.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env['DATA_DIR']
  ? path.resolve(process.env['DATA_DIR'])
  : path.resolve(__dirname, '../../../data');
const PUSH_FILE = path.join(DATA_DIR, 'push-tokens.json');

function article(isBreaking: boolean, id = isBreaking ? 'breaking-1' : 'normal-1'): Article {
  return {
    id,
    title: isBreaking ? 'خبر عاجل مهم' : 'خبر عادي',
    summary: null,
    imageUrl: null,
    url: 'https://example.com/x',
    sourceId: 'test',
    sourceName: 'اليوم السابع',
    category: 'egypt',
    country: 'EG',
    publishedAt: Date.now(),
    isBreaking,
  };
}

function record(overrides: Partial<PushRecord> = {}): PushRecord {
  return {
    id: 'p1',
    userId: 'user-1',
    token: 'fcm-token-abc',
    platform: 'android',
    provider: 'fcm',
    enabled: true,
    mode: 'urgent',
    updatedAt: Date.now(),
    ...overrides,
  };
}

// --- a throwaway service account (real RSA key, fake project) ---
let privateKeyPem = '';
let accountDir = '';

beforeAll(() => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  privateKeyPem = privateKey;
  accountDir = fs.mkdtempSync(path.join(process.env['TMPDIR'] ?? '/tmp', 'fcm-acct-'));
});

function writeServiceAccount(): string {
  const file = path.join(accountDir, 'fcm-service-account.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      type: 'service_account',
      project_id: 'demo-project',
      client_email: 'pusher@demo-project.iam.gserviceaccount.com',
      private_key: privateKeyPem,
      token_uri: GOOGLE_TOKEN_URL,
    }),
  );
  return file;
}

/** Records every request and answers with the given scripted responses. */
function stubFetch(
  handlers: Array<{ status: number; body?: unknown }> ,
): { fetchImpl: typeof fetch; calls: Array<{ url: string; body: any; headers: any }> } {
  const calls: Array<{ url: string; body: any; headers: any }> = [];
  let index = 0;
  const fetchImpl = (async (url: string, init: any) => {
    // The OAuth2 token exchange posts a form; FCM posts JSON.
    const rawBody = init?.body ? String(init.body) : '';
    const isForm = rawBody.startsWith('grant_type=');
    calls.push({
      url: String(url),
      body: rawBody ? (isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : JSON.parse(rawBody)) : null,
      headers: init?.headers ?? {},
    });
    const scripted = handlers[Math.min(index++, handlers.length - 1)];
    return {
      ok: scripted.status >= 200 && scripted.status < 300,
      status: scripted.status,
      json: async () => scripted.body ?? {},
      text: async () =>
        typeof scripted.body === 'string' ? scripted.body : JSON.stringify(scripted.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('push: matching rule', () => {
  it('sends breaking news to urgent and all subscribers', () => {
    expect(shouldPushTo(record({ mode: 'urgent' }), article(true))).toBe(true);
    expect(shouldPushTo(record({ mode: 'all' }), article(true))).toBe(true);
  });

  it('sends non-breaking news only to all subscribers', () => {
    expect(shouldPushTo(record({ mode: 'urgent' }), article(false))).toBe(false);
    expect(shouldPushTo(record({ mode: 'all' }), article(false))).toBe(true);
  });

  it('never sends to a disabled device', () => {
    expect(shouldPushTo(record({ enabled: false, mode: 'all' }), article(true))).toBe(false);
    expect(shouldPushTo(record({ enabled: false, mode: 'all' }), article(false))).toBe(false);
  });

  it('validates the mode values', () => {
    expect(isValidMode('urgent')).toBe(true);
    expect(isValidMode('all')).toBe(true);
    expect(isValidMode('sometimes')).toBe(false);
    expect(isValidMode(undefined)).toBe(false);
    expect(isValidMode(1)).toBe(false);
  });
});

describe('push: token registry', () => {
  beforeEach(() => {
    try {
      fs.rmSync(PUSH_FILE, { force: true });
    } catch {
      /* ignore */
    }
    _resetPushCache();
  });

  it('registers a token with the documented defaults', () => {
    const r = registerPushToken('user-1', 'token-a', 'android');
    expect(r.enabled).toBe(true);
    expect(r.mode).toBe('urgent');
    expect(r.userId).toBe('user-1');
    expect(r.provider).toBe('fcm');
  });

  it('upserts by token instead of duplicating', () => {
    const first = registerPushToken('user-1', 'token-a', 'ios');
    const second = registerPushToken('user-1', 'token-a', 'android');
    expect(second.id).toBe(first.id);
    expect(second.platform).toBe('android');
  });

  it('updates preferences and reads them back', () => {
    registerPushToken('user-1', 'token-a', 'android');
    const updated = updatePushPrefs('user-1', 'token-a', { enabled: false, mode: 'all' });
    expect(updated?.enabled).toBe(false);
    expect(updated?.mode).toBe('all');

    const prefs = getPushPrefs('user-1', 'token-a');
    expect(prefs?.enabled).toBe(false);
    expect(prefs?.mode).toBe('all');
  });

  it('does not let another user touch the token', () => {
    registerPushToken('user-1', 'token-a', 'android');
    expect(updatePushPrefs('user-2', 'token-a', { enabled: false })).toBeNull();
    expect(getPushPrefs('user-2', 'token-a')).toBeNull();
    expect(unregisterPushToken('user-2', 'token-a')).toBe(false);
    expect(getPushPrefs('user-1', 'token-a')?.enabled).toBe(true);
  });

  it('unregisters the token', () => {
    registerPushToken('user-1', 'token-a', 'android');
    expect(unregisterPushToken('user-1', 'token-a')).toBe(true);
    expect(getPushPrefs('user-1', 'token-a')).toBeNull();
  });

  it('identifies legacy Expo push tokens', () => {
    expect(isLegacyExpoToken('ExponentPushToken[xyz]')).toBe(true);
    expect(isLegacyExpoToken('ExpoPushToken[xyz]')).toBe(true);
    expect(isLegacyExpoToken('fcm-token-abc')).toBe(false);
  });

  it('drops legacy Expo tokens when the file is loaded', () => {
    fs.writeFileSync(
      PUSH_FILE,
      JSON.stringify([
        { ...record(), id: 'old', token: 'ExponentPushToken[legacy]' },
        { ...record(), id: 'new', token: 'fcm-token-keep' },
      ]),
    );
    _resetPushCache();
    const tokens = getAllPushRecords().map((r) => r.token);
    expect(tokens).toEqual(['fcm-token-keep']);
  });

  it('removes a token FCM rejected', () => {
    registerPushToken('user-1', 'token-a', 'android');
    expect(removeDeadToken('token-a')).toBe(true);
    expect(getAllPushRecords()).toHaveLength(0);
    expect(removeDeadToken('token-a')).toBe(false);
  });
});

describe('push: FCM credentials', () => {
  it('returns null and warns when the key file is missing', () => {
    expect(loadServiceAccount(path.join(accountDir, 'nope.json'))).toBeNull();
  });

  it('returns null when the key file is not a service account', () => {
    const bad = path.join(accountDir, 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
    expect(loadServiceAccount(bad)).toBeNull();
  });

  it('reads a valid service account', () => {
    const account = loadServiceAccount(writeServiceAccount());
    expect(account?.project_id).toBe('demo-project');
    expect(account?.client_email).toContain('iam.gserviceaccount.com');
  });

  it('signs a JWT with the FCM scope and issuer', () => {
    const account = loadServiceAccount(writeServiceAccount())!;
    const jwt = buildJwtAssertion(account, 1_700_000_000);
    const [header, claims, signature] = jwt.split('.');
    expect(jwt.split('.')).toHaveLength(3);

    const decodedHeader = JSON.parse(Buffer.from(header!, 'base64').toString());
    const decodedClaims = JSON.parse(Buffer.from(claims!, 'base64').toString());
    expect(decodedHeader.alg).toBe('RS256');
    expect(decodedClaims.iss).toBe(account.client_email);
    expect(decodedClaims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(decodedClaims.exp - decodedClaims.iat).toBe(3600);

    // The signature must verify against the account's public key.
    const verify = crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`);
    const publicKey = crypto
      .createPublicKey(account.private_key)
      .export({ type: 'spki', format: 'pem' }) as string;
    expect(verify.verify(publicKey, Buffer.from(signature!, 'base64'))).toBe(true);
  });

  it('exchanges the JWT for an access token and caches it', async () => {
    _resetAccessToken();
    const account = loadServiceAccount(writeServiceAccount())!;
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
    ]);
    expect(await getAccessToken(account, fetchImpl)).toBe('ya29.test');
    expect(await getAccessToken(account, fetchImpl)).toBe('ya29.test');
    expect(calls).toHaveLength(1); // second call used the cache
    expect(calls[0]!.url).toBe(GOOGLE_TOKEN_URL);
    expect(String(calls[0]!.body.grant_type)).toBe(
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
    );
  });

  it('surfaces a token-exchange failure', async () => {
    _resetAccessToken();
    const account = loadServiceAccount(writeServiceAccount())!;
    const { fetchImpl } = stubFetch([{ status: 400, body: 'invalid_grant' }]);
    await expect(getAccessToken(account, fetchImpl)).rejects.toThrow(/token request failed/);
  });
});

describe('push: FCM payload', () => {
  it('builds a v1 message for breaking news', () => {
    const msg = buildFcmMessage(article(true, 'a1'), 'device-token');
    expect(msg.token).toBe('device-token');
    expect(msg.notification.title).toBe('خبر عاجل');
    expect(msg.data.articleId).toBe('a1');
    expect(msg.android.priority).toBe('high');
    expect(msg.android.notification.channel_id).toBe(CHANNEL_BREAKING);
  });

  it('uses the source name and the news channel for a normal article', () => {
    const msg = buildFcmMessage(article(false, 'a2'), 'device-token');
    expect(msg.notification.title).toBe('اليوم السابع');
    expect(msg.notification.body).toBe('خبر عادي');
    expect(msg.android.priority).toBe('normal');
    expect(msg.android.notification.channel_id).toBe(CHANNEL_NEWS);
  });

  it('treats UNREGISTERED and INVALID_ARGUMENT as dead tokens', () => {
    expect(isDeadTokenResponse(404, '{"error":{"status":"NOT_FOUND"}}')).toBe(true);
    expect(isDeadTokenResponse(400, '{"error":{"status":"INVALID_ARGUMENT"}}')).toBe(true);
    expect(isDeadTokenResponse(400, '{"error":{"status":"UNREGISTERED"}}')).toBe(true);
    expect(isDeadTokenResponse(500, 'boom')).toBe(false);
    expect(isDeadTokenResponse(429, '{"error":{"status":"QUOTA_EXCEEDED"}}')).toBe(false);
  });

  it('posts the message to the v1 endpoint of the right project', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { name: 'projects/demo/messages/1' } }]);
    const result = await sendFcmMessage('demo-project', 'ya29.test', buildFcmMessage(article(true), 'dev-1'), fetchImpl);
    expect(result).toBe('ok');
    expect(calls[0]!.url).toBe(`${FCM_API_BASE}/demo-project/messages:send`);
    expect(calls[0]!.headers.Authorization).toBe('Bearer ya29.test');
    expect(calls[0]!.body.message.token).toBe('dev-1');
  });

  it('reports a dead token instead of throwing', async () => {
    const { fetchImpl } = stubFetch([
      { status: 404, body: { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } } },
    ]);
    expect(await sendFcmMessage('demo', 'ya29', buildFcmMessage(article(true), 'dev-1'), fetchImpl)).toBe('dead');
  });

  it('reports a transient failure without deleting the token', async () => {
    const { fetchImpl } = stubFetch([{ status: 503, body: { error: { status: 'UNAVAILABLE' } } }]);
    expect(await sendFcmMessage('demo', 'ya29', buildFcmMessage(article(true), 'dev-1'), fetchImpl)).toBe('error');
  });
});

describe('push: concurrency helper', () => {
  it('never runs more than the limit at once', async () => {
    let inFlight = 0;
    let peak = 0;
    await runWithConcurrency(Array.from({ length: 25 }, (_, i) => i), 10, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(10);
    expect(peak).toBeGreaterThan(1);
  });

  it('visits every item once', async () => {
    const seen: number[] = [];
    await runWithConcurrency([1, 2, 3, 4, 5], 3, async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('push: end-to-end sending', () => {
  let accountFile = '';

  beforeEach(() => {
    try {
      fs.rmSync(PUSH_FILE, { force: true });
    } catch {
      /* ignore */
    }
    _resetPushCache();
    _resetPushedIds();
    _resetAccessToken();
    accountFile = writeServiceAccount();
    process.env['FCM_SERVICE_ACCOUNT_FILE'] = accountFile;
  });

  it('is a no-op without credentials', async () => {
    registerPushToken('user-1', 'dev-1', 'android');
    process.env['FCM_SERVICE_ACCOUNT_FILE'] = path.join(accountDir, 'missing.json');
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    expect(await sendPushNotifications([article(true)], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(0);
    delete process.env['FCM_SERVICE_ACCOUNT_FILE'];
  });

  it('is a no-op when nobody is subscribed', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    expect(await sendPushNotifications([article(true)], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('sends a breaking article to an urgent subscriber', async () => {
    registerPushToken('user-1', 'dev-urgent', 'android');
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { status: 200, body: { name: 'projects/demo/messages/1' } },
    ]);
    const delivered = await sendPushNotifications([article(true, 'a1')], fetchImpl);
    expect(delivered).toEqual(['a1']);
    expect(calls).toHaveLength(2); // token exchange + one message
    expect(calls[1]!.body.message.android.notification.channel_id).toBe(CHANNEL_BREAKING);
  });

  it('skips a normal article for an urgent-only subscriber', async () => {
    registerPushToken('user-1', 'dev-urgent', 'android');
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { status: 200, body: { name: 'ok' } },
    ]);
    expect(await sendPushNotifications([article(false, 'a2')], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('deletes a token FCM says is unregistered', async () => {
    registerPushToken('user-1', 'dev-dead', 'android');
    const { fetchImpl } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { status: 404, body: { error: { status: 'NOT_FOUND' } } },
    ]);
    await sendPushNotifications([article(true, 'a3')], fetchImpl);
    expect(getAllPushRecords()).toHaveLength(0);
  });

  it('ignores articles older than the 15-minute window', async () => {
    registerPushToken('user-1', 'dev-1', 'android');
    const old = { ...article(true, 'old'), publishedAt: Date.now() - 60 * 60 * 1000 };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    expect(await sendPushNotifications([old], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('never pushes a re-flagged OLD article (the 15-minute window guards backfills)', async () => {
    registerPushToken('user-1', 'dev-1', 'android');
    // An article that a backfill re-classified as breaking, published hours ago,
    // must not produce a notification: the rule is on publishedAt, not on when
    // the flag changed.
    const reflagged = {
      ...article(true, 'old-but-now-breaking'),
      publishedAt: Date.now() - 3 * 60 * 60 * 1000,
    };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: {} }]);
    expect(await sendPushNotifications([reflagged], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it('still pushes a genuinely fresh breaking article', async () => {
    registerPushToken('user-1', 'dev-urgent', 'android');
    const fresh = { ...article(true, 'fresh-breaking'), publishedAt: Date.now() - 60 * 1000 };
    const { fetchImpl } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { status: 200, body: { name: 'ok' } },
    ]);
    expect(await sendPushNotifications([fresh], fetchImpl)).toEqual(['fresh-breaking']);
  });

  it('never pushes the same article twice in one process', async () => {
    registerPushToken('user-1', 'dev-1', 'android');
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { access_token: 'ya29.test', expires_in: 3600 } },
      { status: 200, body: { name: 'ok' } },
    ]);
    await sendPushNotifications([article(true, 'dup')], fetchImpl);
    await sendPushNotifications([article(true, 'dup')], fetchImpl);
    expect(calls).toHaveLength(2); // one token exchange + one send, not two sends
  });

  it('does not attempt delivery when authentication fails', async () => {
    registerPushToken('user-1', 'dev-1', 'android');
    const { fetchImpl, calls } = stubFetch([{ status: 401, body: 'invalid_grant' }]);
    expect(await sendPushNotifications([article(true, 'a4')], fetchImpl)).toEqual([]);
    expect(calls).toHaveLength(1); // only the token exchange was attempted
  });
});
