import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USERS_FILE = path.resolve(__dirname, '../../data/users.json');

export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  name?: string;
  createdAt: number;
}

export interface SafeUser {
  id: string;
  email: string;
  name?: string;
}

let cache: StoredUser[] | null = null;

function load(): StoredUser[] {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = Array.isArray(parsed) ? parsed : [];
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
  const norm = email.trim().toLowerCase();
  return load().find((u) => u.email.toLowerCase() === norm) ?? null;
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

export function toSafeUser(user: StoredUser): SafeUser {
  const safe: SafeUser = {
    id: user.id,
    email: user.email,
  };
  if (user.name) safe.name = user.name;
  return safe;
}

/** Reset cache (for test suites) */
export function _resetUsersCache(): void {
  cache = null;
}
