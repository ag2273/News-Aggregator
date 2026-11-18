// Email verification: tokens, resend limits, and the Resend client.
//
// A token is generated once, sent to the user, and never stored. Only its
// SHA-256 hash is kept, so a leaked data file cannot be used to verify an
// account. Tokens are single-use and expire after 24 hours.
//
// Mail goes through Resend (https://api.resend.com/emails). The key is read from
// a file, the same pattern as the FCM service account, so no secret ever lives in
// the repo or in the environment of a shell.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { StoredUser } from './users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const TOKENS_FILE = path.join(DATA_DIR, 'verify-tokens.json');

export const DEFAULT_RESEND_KEY_FILE =
  '/data/secrets/resend-api-key';
export const RESEND_ENDPOINT = 'https://api.resend.com/emails';
export const MAIL_FROM = 'رئيس التحرير <no-reply@nileorbit.com>';
export const MAIL_SUBJECT = 'وثّق بريدك في رئيس التحرير';

/** How long a verification link stays valid. */
export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
/** Minimum gap between resends for one account. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Hard cap per account per rolling day. */
export const RESEND_DAILY_LIMIT = 5;
export const RESEND_DAY_MS = 24 * 60 * 60 * 1000;

/** SHA-256 of the raw token, hex. This is all we store. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, url-safe. */
export function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export interface VerifyTokenRecord {
  /** Hash of the token; the raw value is never persisted. */
  tokenHash: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  /** Set when consumed, so a second click is distinguishable from invalid. */
  usedAt?: number;
}

export interface ResendLogRecord {
  userId: string;
  /** Timestamps of every send attempt that produced an email. */
  sentAt: number[];
}

interface VerifyStore {
  tokens: VerifyTokenRecord[];
  resends: ResendLogRecord[];
}

let cache: VerifyStore | null = null;

function load(): VerifyStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')) as unknown;
    const store = parsed as Partial<VerifyStore>;
    cache = {
      tokens: Array.isArray(store.tokens) ? store.tokens : [],
      resends: Array.isArray(store.resends) ? store.resends : [],
    };
  } catch {
    cache = { tokens: [], resends: [] };
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true });
  const store = cache ?? { tokens: [], resends: [] };
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(store, null, 2));
}

/**
 * Issue a token for a user, invalidating any previous one for that account.
 * Returns the RAW token — the only moment it exists in memory.
 */
export function issueToken(
  userId: string,
  now: number = Date.now(),
): { token: string; expiresAt: number } {
  const store = load();
  const token = generateToken();
  const record: VerifyTokenRecord = {
    tokenHash: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: now + TOKEN_TTL_MS,
  };
  // One live token per account: the newest link is the only valid one.
  store.tokens = store.tokens.filter((t) => t.userId !== userId);
  store.tokens.push(record);
  cache = store;
  save();
  return { token, expiresAt: record.expiresAt };
}

export type VerifyOutcome =
  | { status: 'verified'; userId: string }
  | { status: 'used' }
  | { status: 'expired' }
  | { status: 'invalid' };

/**
 * Consume a token. Single-use: a successful verify marks it used.
 * Reads the raw token, hashes it, and compares against stored hashes only.
 */
export function consumeToken(rawToken: string, now: number = Date.now()): VerifyOutcome {
  if (!rawToken) return { status: 'invalid' };
  const store = load();
  const hash = hashToken(rawToken);
  const record = store.tokens.find((t) => t.tokenHash === hash);
  if (!record) return { status: 'invalid' };
  if (record.usedAt !== undefined) return { status: 'used' };
  if (now > record.expiresAt) return { status: 'expired' };

  record.usedAt = now;
  cache = store;
  save();
  return { status: 'verified', userId: record.userId };
}

/** True when the raw token maps to a live (unused, unexpired) record. */
export function peekToken(rawToken: string, now: number = Date.now()): VerifyOutcome {
  if (!rawToken) return { status: 'invalid' };
  const record = load().tokens.find((t) => t.tokenHash === hashToken(rawToken));
  if (!record) return { status: 'invalid' };
  if (record.usedAt !== undefined) return { status: 'used' };
  if (now > record.expiresAt) return { status: 'expired' };
  return { status: 'verified', userId: record.userId };
}

export interface ResendAllowance {
  allowed: boolean;
  /** Milliseconds until the next attempt is allowed (0 when allowed). */
  retryAfterMs: number;
  /** Sends left in the rolling day, for messaging. */
  remainingToday: number;
}

/**
 * Pure resend policy: 60s between sends, at most 5 in a rolling 24h.
 * `sentAt` is the account's send history, oldest first or not — order is irrelevant.
 */
export function resendAllowance(
  sentAt: number[],
  now: number = Date.now(),
): ResendAllowance {
  const dayAgo = now - RESEND_DAY_MS;
  const recent = sentAt.filter((t) => t > dayAgo).sort((a, b) => a - b);
  const remainingToday = Math.max(0, RESEND_DAILY_LIMIT - recent.length);

  const last = recent.length ? (recent[recent.length - 1] as number) : 0;
  const cooldownLeft = last ? Math.max(0, last + RESEND_COOLDOWN_MS - now) : 0;

  if (remainingToday === 0) {
    // Free again when the oldest send inside the window falls out of it.
    const oldest = recent[0] as number;
    return { allowed: false, retryAfterMs: Math.max(cooldownLeft, oldest + RESEND_DAY_MS - now), remainingToday };
  }
  if (cooldownLeft > 0) return { allowed: false, retryAfterMs: cooldownLeft, remainingToday };
  return { allowed: true, retryAfterMs: 0, remainingToday };
}

/** Record a successful send for the policy above. */
export function recordResend(userId: string, now: number = Date.now()): void {
  const store = load();
  const entry = store.resends.find((r) => r.userId === userId) ?? { userId, sentAt: [] as number[] };
  entry.sentAt = entry.sentAt.filter((t) => t > now - RESEND_DAY_MS);
  entry.sentAt.push(now);
  if (!store.resends.includes(entry)) store.resends.push(entry);
  cache = store;
  save();
}

/** Current send history for an account. */
export function sentTimes(userId: string): number[] {
  return load().resends.find((r) => r.userId === userId)?.sentAt ?? [];
}

/** Delete a user's verification tokens and resend history (account deletion). */
export function deleteVerifyDataForUser(userId: string): number {
  const store = load();
  const before = store.tokens.length + store.resends.length;
  store.tokens = store.tokens.filter((t) => t.userId !== userId);
  store.resends = store.resends.filter((r) => r.userId !== userId);
  const removed = before - (store.tokens.length + store.resends.length);
  if (removed > 0) {
    cache = store;
    save();
  }
  return removed;
}

export function _resetVerifyCache(): void {
  cache = null;
}

// --- email ---

/** Read the Resend key from its file, or null with one warning. */
export function loadResendKey(
  filePath: string = process.env['RESEND_API_KEY_FILE'] || DEFAULT_RESEND_KEY_FILE,
): string | null {
  try {
    const key = fs.readFileSync(filePath, 'utf8').trim();
    if (!key) {
      console.warn(`[email] ${filePath} is empty — verification emails will not be sent`);
      return null;
    }
    return key;
  } catch {
    console.warn(
      `[email] no Resend API key at ${filePath} — verification emails disabled. ` +
        'Sign-up still works; users just cannot receive the link.',
    );
    return null;
  }
}

export function verifyUrl(token: string, baseUrl = 'https://news.nileorbit.com'): string {
  return `${baseUrl.replace(/\/$/, '')}/verify?token=${encodeURIComponent(token)}`;
}

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** The verification email: Arabic, RTL, one button, no JS. */
export function buildVerificationEmail(link: string): EmailContent {
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${MAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;background:#EEF6F1;font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif;direction:rtl;text-align:right;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF6F1;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:20px;padding:32px;">
            <tr>
              <td style="direction:rtl;text-align:right;">
                <h1 style="margin:0 0 8px;font-size:22px;color:#0F172A;">رئيس التحرير</h1>
                <p style="margin:0 0 24px;font-size:15px;line-height:26px;color:#475569;">
                  أهلًا بك. اضغط الزر بالأسفل لتوثيق بريدك وتفعيل كل مميزات الحساب.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 24px;">
                  <tr>
                    <td align="center" style="border-radius:14px;background:#10B981;">
                      <a href="${link}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:14px;">
                        توثيق البريد
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="margin:0 0 12px;font-size:13px;line-height:22px;color:#64748B;">
                  الرابط صالح لمدة 24 ساعة فقط.
                </p>
                <p style="margin:0 0 12px;font-size:13px;line-height:22px;color:#64748B;">
                  إن لم تكن أنت من أنشأ الحساب، تجاهل هذه الرسالة ولا حاجة لفعل أي شيء.
                </p>
                <p style="margin:0;font-size:12px;line-height:20px;color:#94A3B8;word-break:break-all;">
                  إن لم يعمل الزر، انسخ هذا الرابط في المتصفح:<br />
                  ${link}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = `رئيس التحرير

أهلًا بك. لتوثيق بريدك وتفعيل كل مميزات الحساب، افتح هذا الرابط:

${link}

الرابط صالح لمدة 24 ساعة فقط.
إن لم تكن أنت من أنشأ الحساب، تجاهل هذه الرسالة.

— رئيس التحرير`;

  return { subject: MAIL_SUBJECT, html, text };
}

export interface SendResult {
  ok: boolean;
  id?: string;
  status?: number;
  error?: string;
}

/** POST the email to Resend. Never throws. */
export async function sendVerificationEmail(
  to: string,
  link: string,
  apiKey: string | null,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!apiKey) {
    console.log(`[email] verification email for ${maskEmail(to)} skipped: no API key`);
    return { ok: false, error: 'no-api-key' };
  }
  const content = buildVerificationEmail(link);
  try {
    const res = await fetcher(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [to],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] Resend rejected ${maskEmail(to)} (${res.status}): ${body.slice(0, 200)}`);
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    const json = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`[email] verification email accepted by Resend for ${maskEmail(to)} (id ${json.id ?? 'unknown'})`);
    return { ok: true, id: json.id, status: res.status };
  } catch (err) {
    console.error('[email] Resend request failed:', err);
    return { ok: false, error: String(err) };
  }
}

/** Never log a full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

/** Convenience: issue a token, send the mail, and log the resend attempt. */
export async function sendVerificationForUser(
  user: StoredUser,
  opts: { baseUrl?: string; apiKey?: string | null; fetcher?: typeof fetch; now?: number } = {},
): Promise<SendResult & { token?: string }> {
  const now = opts.now ?? Date.now();
  const { token } = issueToken(user.id, now);
  const link = verifyUrl(token, opts.baseUrl);
  const apiKey = opts.apiKey === undefined ? loadResendKey() : opts.apiKey;
  const result = await sendVerificationEmail(user.email, link, apiKey, opts.fetcher);
  if (result.ok) recordResend(user.id, now);
  return { ...result, token };
}

export const VERIFY_ERRORS = {
  expired: 'انتهت صلاحية رابط التوثيق',
  used: 'تم استخدام هذا الرابط من قبل',
  invalid: 'رابط التوثيق غير صالح',
} as const;
