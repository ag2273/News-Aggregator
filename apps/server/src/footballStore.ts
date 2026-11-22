// Football store: cached match data and per-user team follows.
//
// Two jobs in one file because they share a lifetime: fixtures are cached for a
// few minutes (the sources are scraped, so we are polite), follows are permanent.
//
// Nothing here talks to the app directly — `footballService.ts` owns that — so a
// source failure becomes "unavailable" for one day, never a broken screen.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MatchRow, StandingsTable } from './football.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const FOLLOWS_FILE = path.join(DATA_DIR, 'team-follows.json');

/** Fixtures go stale quickly; the sources are scraped, so keep it polite. */
export const MATCHES_TTL_MS = 5 * 60 * 1000;
/** Standings change at most once per round. */
export const STANDINGS_TTL_MS = 30 * 60 * 1000;

export interface DayCache {
  date: string;
  fetchedAt: number;
  /** True when the fetch failed: the app shows «غير متاح» for that day. */
  unavailable: boolean;
  matches: MatchRow[];
}

export interface StandingsCache {
  competitionId: string;
  fetchedAt: number;
  unavailable: boolean;
  tables: StandingsTable[];
}

export interface TeamFollow {
  /** The team name as the source gives it. */
  name: string;
  competitionId: string;
  /** Notification switches, all on by default. */
  notifyKickoff: boolean;
  notifyGoals: boolean;
  notifyFinal: boolean;
}

export interface FootballStore {
  days: Record<string, DayCache>;
  standings: Record<string, StandingsCache>;
  follows: Record<string, TeamFollow[]>;
}

let cache: FootballStore | null = null;

function load(): FootballStore {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(FOLLOWS_FILE, 'utf8')) as Partial<FootballStore>;
    cache = { days: parsed.days ?? {}, standings: parsed.standings ?? {}, follows: parsed.follows ?? {} };
  } catch {
    cache = { days: {}, standings: {}, follows: {} };
  }
  return cache;
}

function persist(): void {
  fs.mkdirSync(path.dirname(FOLLOWS_FILE), { recursive: true });
  const store = load();
  // Only follows are worth keeping across a restart: a cached fixture day is
  // cheap to refetch, and keeping it would serve stale scores after a deploy.
  fs.writeFileSync(
    FOLLOWS_FILE,
    JSON.stringify({ days: {}, standings: {}, follows: store.follows }),
  );
}

export function _resetFootballCache(): void {
  cache = null;
}

// --- fixtures ---

export function getCachedDay(date: string, now: number = Date.now()): DayCache | null {
  const day = load().days[date];
  if (!day) return null;
  // A failure is cached briefly too, so one outage does not hammer the source.
  const ttl = day.unavailable ? MATCHES_TTL_MS : MATCHES_TTL_MS;
  if (now - day.fetchedAt > ttl) return null;
  return day;
}

export function storeDay(date: string, matches: MatchRow[], unavailable = false): DayCache {
  const store = load();
  const day = { date, fetchedAt: Date.now(), unavailable, matches };
  store.days[date] = day;
  // Keep at most a week of days: the app only shows a 7-day ribbon.
  const keys = Object.keys(store.days).sort();
  for (const key of keys.slice(0, Math.max(0, keys.length - 7))) delete store.days[key];
  return day;
}

// --- standings ---

export function getCachedStandings(competitionId: string, now: number = Date.now()): StandingsCache | null {
  const entry = load().standings[competitionId];
  if (!entry) return null;
  if (now - entry.fetchedAt > STANDINGS_TTL_MS) return null;
  return entry;
}

export function storeStandings(
  competitionId: string,
  tables: StandingsTable[],
  unavailable = false,
): StandingsCache {
  const store = load();
  const entry = { competitionId, fetchedAt: Date.now(), unavailable, tables };
  store.standings[competitionId] = entry;
  return entry;
}

// --- follows ---

export function getTeamFollows(userId: string): TeamFollow[] {
  return load().follows[userId] ?? [];
}

/** Add a follow. Idempotent: following twice keeps one row and its settings. */
export function followTeam(userId: string, team: string, competitionId: string): TeamFollow[] {
  const store = load();
  const list = store.follows[userId] ?? [];
  if (!list.some((f) => f.name === team)) {
    list.push({
      name: team,
      competitionId,
      notifyKickoff: true,
      notifyGoals: true,
      notifyFinal: true,
    });
  }
  store.follows[userId] = list;
  persist();
  return list;
}

export function unfollowTeam(userId: string, team: string): TeamFollow[] {
  const store = load();
  store.follows[userId] = (store.follows[userId] ?? []).filter((f) => f.name !== team);
  persist();
  return store.follows[userId];
}

/** Change one team's notification switches. Returns null when not followed. */
export function setTeamNotify(
  userId: string,
  team: string,
  prefs: { notifyKickoff?: boolean; notifyGoals?: boolean; notifyFinal?: boolean },
): TeamFollow | null {
  const store = load();
  const list = store.follows[userId] ?? [];
  const found = list.find((f) => f.name === team);
  if (!found) return null;
  if (typeof prefs.notifyKickoff === 'boolean') found.notifyKickoff = prefs.notifyKickoff;
  if (typeof prefs.notifyGoals === 'boolean') found.notifyGoals = prefs.notifyGoals;
  if (typeof prefs.notifyFinal === 'boolean') found.notifyFinal = prefs.notifyFinal;
  persist();
  return found;
}

/** Everyone following a given team, for the push fan-out. */
export function followersOf(team: string): Array<{ userId: string; follow: TeamFollow }> {
  const store = load();
  const out: Array<{ userId: string; follow: TeamFollow }> = [];
  for (const [userId, list] of Object.entries(store.follows)) {
    const follow = list.find((f) => f.name === team);
    if (follow) out.push({ userId, follow });
  }
  return out;
}
