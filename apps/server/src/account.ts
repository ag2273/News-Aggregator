// Account deletion and the rate limit for the public deletion form.
//
// Google Play requires an account-deletion path that removes the user's data,
// both in-app and on the web for people who no longer have the app. Deleting the
// account has to remove EVERY record that points at the user, otherwise a later
// sign-up with the same address inherits their follows, saved articles or push
// tokens — and the push token would keep notifying a deleted account.
//
// Session invalidation is inherent: sessions are self-contained HMAC tokens, and
// every authenticated route looks the user up by id, so a token for a deleted
// user 401s immediately without any server-side session table.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteUser, findUserById, type StoredUser } from './users.js';
import { deleteFollowsForUser } from './follows.js';
import { deleteSavedForUser } from './saved.js';
import { deletePushTokensForUser } from './push.js';
import { deleteVerifyDataForUser } from './verify.js';
import { deleteReactionsForUser } from './reactions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const DELETIONS_FILE = path.join(DATA_DIR, 'deletions.json');

export interface DeletionReport {
  userId: string;
  email: string;
  follows: number;
  saved: number;
  pushTokens: number;
  verifyRecords: number;
  reactions: number;
}

/**
 * Delete a user and all of their data. Returns what was removed, or null when
 * the account does not exist.
 *
 * Order matters only for observability: the stores are independent JSON files and
 * the user row is removed last, so a crash mid-way leaves a user with fewer
 * records rather than orphaned data.
 */
export function deleteAccount(userId: string): DeletionReport | null {
  const user: StoredUser | null = findUserById(userId);
  if (!user) return null;

  const follows = deleteFollowsForUser(userId);
  const saved = deleteSavedForUser(userId);
  const pushTokens = deletePushTokensForUser(userId);
  const verifyRecords = deleteVerifyDataForUser(userId);
  const reactions = deleteReactionsForUser(userId);
  const removed = deleteUser(userId);

  // Explicit log line so a deletion is visible in the deploy log without PII.
  console.log(
    `[account] deleted account ${maskEmail(user.email)} — follows ${follows}, saved ${saved}, push ${pushTokens}, verify ${verifyRecords}, reactions ${reactions}, user row ${removed}`,
  );

  return {
    userId,
    email: user.email,
    follows,
    saved,
    pushTokens,
    verifyRecords,
    reactions,
  };
}

/** Never log a full address. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return '***';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

// --- rate limiting for the public web form ---

/** Attempts allowed per IP per window. */
export const DELETE_RATE_LIMIT = 5;
export const DELETE_RATE_WINDOW_MS = 60 * 60 * 1000;

interface Attempt {
  at: number;
  ok: boolean;
}

interface DeletionStore {
  /** key: "ip:<addr>" or "user:<id>", value: recent attempts */
  attempts: Record<string, Attempt[]>;
}

let cache: DeletionStore | null = null;

function load(): DeletionStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(DELETIONS_FILE, 'utf8')) as Partial<DeletionStore>;
    cache = { attempts: parsed.attempts ?? {} };
  } catch {
    cache = { attempts: {} };
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(DELETIONS_FILE), { recursive: true });
  fs.writeFileSync(DELETIONS_FILE, JSON.stringify(cache ?? { attempts: {} }, null, 2));
}

/**
 * Pure window check: how many attempts fall inside the window, and when the
 * oldest of them expires (i.e. when a slot frees up).
 */
export function rateLimitState(
  attempts: Attempt[],
  now: number,
  limit: number = DELETE_RATE_LIMIT,
  windowMs: number = DELETE_RATE_WINDOW_MS,
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const recent = attempts.filter((a) => a.at > now - windowMs).sort((a, b) => a.at - b.at);
  if (recent.length < limit) {
    return { allowed: true, remaining: limit - recent.length, retryAfterMs: 0 };
  }
  const oldest = recent[0] as Attempt;
  return { allowed: false, remaining: 0, retryAfterMs: oldest.at + windowMs - now };
}

/** Check one key without recording anything. */
export function checkDeleteRateLimit(
  key: string,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  return rateLimitState(load().attempts[key] ?? [], now);
}

/** Record an attempt for a key (successful or not) and prune expired entries. */
export function recordDeleteAttempt(key: string, ok: boolean, now: number = Date.now()): void {
  const store = load();
  const kept = (store.attempts[key] ?? []).filter((a) => a.at > now - DELETE_RATE_WINDOW_MS);
  kept.push({ at: now, ok });
  store.attempts[key] = kept;
  cache = store;
  save();
}

export function _resetDeletionStore(): void {
  cache = null;
}
