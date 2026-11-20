import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir
  ? path.resolve(rawDataDir)
  : path.resolve(__dirname, '../../data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  createdAt: number;
  /** True once the address is proven with the emailed link. */
  emailVerified: boolean;
  /** When it was proven. Absent for accounts that never verified. */
  verifiedAt?: number;
}

export interface SafeUser {
  id: string;
  email: string;
  name?: string;
  emailVerified: boolean;
}

/** Trim + lowercase; the single definition used for uniqueness and lookup. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

let cache: StoredUser[] | null = null;

/**
 * Accounts created before email verification existed are treated as verified:
 * they were never asked to prove the address, and locking them out now would be
 * a regression. The migration is applied once, on load, and written back.
 */
function migrate(users: StoredUser[]): { users: StoredUser[]; migrated: number } {
  let migrated = 0;
  const next = users.map((u) => {
    if (typeof u.emailVerified === 'boolean') return u;
    migrated++;
    const upgraded: StoredUser = { ...u, emailVerified: true, verifiedAt: u.createdAt };
    return upgraded;
  });
  return { users: next, migrated };
}

function load(): StoredUser[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    const users = Array.isArray(parsed) ? (parsed as StoredUser[]) : [];
    const { users: upgraded, migrated } = migrate(users);
    cache = upgraded;
    if (migrated > 0) {
      console.log(`[users] migrated ${migrated} existing account(s) to emailVerified=true`);
      save();
    }
  } catch {
    cache = [];
  }
  return cache;
}

function save(): void {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(cache, null, 2));
}

export function findUserByEmail(email: string): StoredUser | null {
  const norm = normalizeEmail(email);
  return load().find((u) => normalizeEmail(u.email) === norm) ?? null;
}

export function findUserById(id: string): StoredUser | null {
  return load().find((u) => u.id === id) ?? null;
}

export function createUser(user: StoredUser): StoredUser {
  const users = load();
  users.push(user);
  cache = users;
  save();
  return user;
}

/** Mark an account verified. Returns the updated user, or null if unknown. */
export function markUserVerified(userId: string, now: number = Date.now()): StoredUser | null {
  const users = load();
  const user = users.find((u) => u.id === userId);
  if (!user) return null;
  if (user.emailVerified) return user;
  user.emailVerified = true;
  user.verifiedAt = now;
  cache = users;
  save();
  return user;
}

/** Delete one account by id (used by the throwaway-account cleanup). */
export function deleteUser(userId: string): boolean {
  const users = load();
  const next = users.filter((u) => u.id !== userId);
  const removed = next.length !== users.length;
  if (removed) {
    cache = next;
    save();
  }
  return removed;
}

/**
 * Accounts as counts only. The admin stats page must never receive the user
 * list, so this is the only user accessor it is given.
 */
export interface UserCounts {
  total: number;
  verified: number;
  /** day key -> accounts created that day. */
  signupsByDay: Record<string, number>;
}

export function userCounts(): UserCounts {
  const users = load();
  const signupsByDay: Record<string, number> = {};
  let verified = 0;
  for (const u of users) {
    if (u.emailVerified) verified += 1;
    if (!Number.isFinite(u.createdAt)) continue;
    const day = new Date(u.createdAt + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    signupsByDay[day] = (signupsByDay[day] ?? 0) + 1;
  }
  return { total: users.length, verified, signupsByDay };
}

export function toSafeUser(user: StoredUser): SafeUser {
  const safe: SafeUser = {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified === true,
  };
  if (user.name) safe.name = user.name;
  return safe;
}

/** Reset cache (for test suites) */
export function _resetUsersCache(): void {
  cache = null;
}
