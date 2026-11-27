// Follow one match: a notification for every event in it (goals, cards,
// substitutions, kick-off, half-time, second half, full time).
//
// LOAD. The server is a 1 GB e2-micro, so the watch is built to cost nothing when
// nobody uses it and very little when someone does:
//   * It runs inside the existing one-minute football poll — no new timer.
//   * It reads the day list the poll already holds (no extra request for scores).
//   * It fetches a match page ONLY for a match that someone follows AND that is
//     being played: one Yallakora page and one FilGoal page a minute, shared by
//     every follower of that match. ESPN's summary is read only for a match neither
//     of those two has published a single event for.
//   * Once a source has given a match its first event row, the match keeps that
//     source, so two spellings of one card are never announced twice.
//
// HONESTY. Every notification comes from something a source published:
//   * A goal is announced when the SCORE moves on the day list. The scorer and the
//     minute are added when a timeline row for that side arrives within two polls;
//     otherwise the goal goes out with the club and the new score, and no minute.
//   * A card or a substitution is announced from a timeline row, with its minute.
//   * Phases come from the source's own phase rows («استراحة», «الشوط الثاني») or
//     from the status moving (upcoming → live, live → finished).
//   * The first look at a match (a new follow, or a restart) records what is already
//     there without announcing it, so nobody gets ten old events at once. A source
//     that back-fills many rows in one go (some publish the timeline after the
//     whistle) is recorded the same way.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS, ESPN_BASE, getPage, type MatchRow } from './football.js';
import { FILGOAL_BASE } from './filgoal.js';
import { loadDay, todayCairo } from './footballService.js';
import { fetchEspnLiveDay, clockFor } from './espnLive.js';
import { sendWatchNotifications, type WatchPush } from './push.js';
import {
  eventKey,
  parseEspnKeyEvents,
  parseFilGoalTimeline,
  parseYallakoraEvents,
  type LiveEvent,
  type LivePhase,
  type LiveTimeline,
} from './liveTimeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const WATCH_FILE = path.join(DATA_DIR, 'match-watches.json');

/** A reader can follow this many matches at once. */
export const MAX_WATCHES_PER_USER = 10;
/** Matches read per poll, across all readers. Keeps a busy evening bounded. */
export const MAX_LIVE_MATCHES_PER_POLL = 40;
/** Polls a score change waits for its timeline row before going out without one. */
const GOAL_WAIT_POLLS = 2;
/** A goal row with no score change behind it is dropped after this many polls. */
const ROW_WAIT_POLLS = 3;
/** More new rows than this in one poll is a back-fill, recorded, not announced. */
const BACKFILL_ROWS = 5;

/** One match a reader follows. */
export interface MatchWatch {
  matchId: string;
  /** The Cairo day the match is listed on, so the poll knows which day to read. */
  date: string;
  home: string;
  away: string;
  competitionId: string;
  addedAt: number;
}

type WatchStore = Record<string, MatchWatch[]>;

let store: WatchStore | null = null;

function load(): WatchStore {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(WATCH_FILE, 'utf8')) as WatchStore;
  } catch {
    store = {};
  }
  return store;
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(WATCH_FILE), { recursive: true });
    fs.writeFileSync(WATCH_FILE, JSON.stringify(load()));
  } catch (err) {
    console.error('[watch] could not save match follows:', err);
  }
}

/** Test seam. */
export function _resetMatchWatches(): void {
  store = {};
  states.clear();
}

export function getMatchWatches(userId: string): MatchWatch[] {
  return load()[userId] ?? [];
}

export type WatchResult =
  | { ok: true; watches: MatchWatch[] }
  | { ok: false; reason: 'finished' | 'limit' };

/** Follow a match. Following it twice is a no-op. */
export function watchMatch(userId: string, match: MatchRow, date: string, now = Date.now()): WatchResult {
  const all = load();
  const mine = all[userId] ?? [];
  if (mine.some((w) => w.matchId === match.id)) return { ok: true, watches: mine };
  if (match.status === 'finished') return { ok: false, reason: 'finished' };
  if (mine.length >= MAX_WATCHES_PER_USER) return { ok: false, reason: 'limit' };
  const next = [
    ...mine,
    { matchId: match.id, date, home: match.home, away: match.away, competitionId: match.competitionId, addedAt: now },
  ];
  all[userId] = next;
  persist();
  return { ok: true, watches: next };
}

export function unwatchMatch(userId: string, matchId: string): MatchWatch[] {
  const all = load();
  const next = (all[userId] ?? []).filter((w) => w.matchId !== matchId);
  if (next.length) all[userId] = next;
  else delete all[userId];
  persist();
  return next;
}

/** Every follower of every followed match, by match id. */
function watchersByMatch(): Map<string, { date: string; home: string; away: string; users: string[] }> {
  const out = new Map<string, { date: string; home: string; away: string; users: string[] }>();
  for (const [userId, list] of Object.entries(load())) {
    for (const w of list) {
      const entry = out.get(w.matchId) ?? { date: w.date, home: w.home, away: w.away, users: [] };
      entry.users.push(userId);
      out.set(w.matchId, entry);
    }
  }
  return out;
}

/** The users following one match — the team poll leaves them to the watch. */
export function watchersOf(matchId: string): Set<string> {
  return new Set(watchersByMatch().get(matchId)?.users ?? []);
}

/** Drop the follows of matches that are over, or listed before yesterday. */
function prune(finished: Set<string>, now: number): void {
  const all = load();
  const oldest = todayCairo(now - 86_400_000);
  let changed = false;
  for (const [userId, list] of Object.entries(all)) {
    const next = list.filter((w) => !finished.has(w.matchId) && w.date >= oldest);
    if (next.length !== list.length) {
      changed = true;
      if (next.length) all[userId] = next;
      else delete all[userId];
    }
  }
  if (changed) persist();
}

// --- per-match state (memory only; a restart re-records, see the header) ---

interface PendingGoal {
  side: 'home' | 'away';
  polls: number;
}

interface WatchState {
  status: MatchRow['status'];
  /** The score last announced (or recorded on the first look). */
  home: number;
  away: number;
  /** Polls the score has been lower than announced (a goal taken back). */
  lowerPolls: number;
  timelineSource: LiveTimeline['source'] | null;
  seen: Set<string>;
  phases: Set<LivePhase>;
  pendingGoals: PendingGoal[];
  /** Goal rows not yet matched to a score change, with their age in polls. */
  spareGoals: Array<{ event: LiveEvent; polls: number }>;
  /** Goals announced without a scorer; the late row is then dropped, not re-sent. */
  goalsWithoutRow: { home: number; away: number };
  finalSent: boolean;
}

const states = new Map<string, WatchState>();

export function _watchState(matchId: string): WatchState | undefined {
  return states.get(matchId);
}

// --- reading the sources ---

export interface TimelineReaders {
  yallakora: (url: string) => Promise<string | null>;
  filgoal: (url: string) => Promise<string | null>;
  espn: (match: MatchRow, date: string) => Promise<unknown | null>;
}

function defaultReaders(fetchImpl?: typeof fetch): TimelineReaders {
  return {
    yallakora: (url) => getPage(url, fetchImpl),
    filgoal: (url) => getPage(url, fetchImpl),
    espn: async (match, date) => {
      const comp = COMPETITIONS.find((c) => c.id === match.competitionId);
      if (!comp?.espnSlug) return null;
      const live = await fetchEspnLiveDay(date, fetchImpl).catch(() => []);
      const event = clockFor(live, match.home, match.away);
      if (!event?.id) return null;
      const body = await getPage(`${ESPN_BASE}/${comp.espnSlug}/summary?event=${event.id}`, fetchImpl);
      if (!body) return null;
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    },
  };
}

function yallakoraUrlOf(match: MatchRow): string | null {
  if (match.dataSource === 'yallakora') return match.url ?? null;
  return match.yallakoraUrl ?? null;
}

function filGoalUrlOf(match: MatchRow): string | null {
  if (match.dataSource === 'filgoal' && match.providerMatchId) {
    return `${FILGOAL_BASE}/matches/${match.providerMatchId}`;
  }
  return null;
}

/**
 * Read the timeline for one match: its events from the source it is locked to (or
 * the first one with rows), its phases from any source that states them.
 */
async function readTimeline(
  match: MatchRow,
  date: string,
  locked: LiveTimeline['source'] | null,
  readers: TimelineReaders,
): Promise<LiveTimeline | null> {
  const phases = new Set<LivePhase>();
  const candidates: LiveTimeline[] = [];

  const yk = yallakoraUrlOf(match);
  if (yk && (!locked || locked === 'yallakora')) {
    const html = await readers.yallakora(yk).catch(() => null);
    if (html) candidates.push({ source: 'yallakora', events: parseYallakoraEvents(html), phases: [] });
  }
  const fg = filGoalUrlOf(match);
  if (fg) {
    // FilGoal's page is read even when another source holds the events: it is the
    // one that states the phases live.
    const html = await readers.filgoal(fg).catch(() => null);
    if (html) {
      const parsed = parseFilGoalTimeline(html);
      parsed.phases.forEach((p) => phases.add(p));
      if (!locked || locked === 'filgoal') candidates.push({ source: 'filgoal', ...parsed });
    }
  }
  const haveRows = candidates.some((c) => c.events.length > 0);
  if ((!locked && !haveRows) || locked === 'espn') {
    const json = await readers.espn(match, date).catch(() => null);
    if (json) {
      const parsed = parseEspnKeyEvents(json);
      parsed.phases.forEach((p) => phases.add(p));
      candidates.push({ source: 'espn', ...parsed });
    }
  }
  if (!candidates.length && !phases.size) return null;
  const chosen =
    candidates.find((c) => c.source === locked) ??
    candidates.find((c) => c.events.length > 0) ??
    null;
  return {
    source: chosen?.source ?? locked ?? 'filgoal',
    events: chosen?.events ?? [],
    phases: [...phases],
  };
}

// --- the words ---

function scoreLine(match: MatchRow, home: number, away: number): string {
  return `${match.home} ${home} - ${away} ${match.away}`;
}

function minuteTag(minute: string | null): string {
  return minute ? `د ${minute}' ` : '';
}

/** «للأهلي», «لبيراميدز»: the Arabic «for» joined to a club name. */
export function forClub(name: string): string {
  if (!name) return '';
  if (name.startsWith('ال')) return `لل${name.slice(2)}`;
  return `ل${name}`;
}

function sideName(match: MatchRow, side: 'home' | 'away' | null): string {
  return side === 'home' ? match.home : side === 'away' ? match.away : '';
}

function withPlayer(prefix: string, player: string | null, latin: boolean): string {
  // An ESPN name is Latin; it is shown as sent, never transliterated by us.
  if (!player) return prefix.trim();
  return `${prefix}${latin ? `(${player})` : player}`.trim();
}

export function eventPush(
  match: MatchRow,
  date: string,
  event: LiveEvent,
  score: { home: number; away: number },
  source: LiveTimeline['source'],
): WatchPush {
  const latin = source === 'espn';
  const team = sideName(match, event.side);
  const base = { matchId: match.id, date, kind: event.kind };
  const line = scoreLine(match, score.home, score.away);
  switch (event.kind) {
    case 'goal':
    case 'penaltyGoal':
    case 'ownGoal': {
      const label = event.kind === 'ownGoal' ? 'هدف عكسي' : event.kind === 'penaltyGoal' ? 'هدف من ركلة جزاء' : 'جوووول';
      const assist = event.other && event.kind === 'goal' ? ` • صناعة ${latin ? `(${event.other})` : event.other}` : '';
      return {
        ...base,
        title: `⚽ ${label}${team && event.kind !== 'ownGoal' ? ` ${forClub(team)}` : ''}! ${line}`,
        body: `${withPlayer(minuteTag(event.minute), event.player, latin)}${assist}`.trim() || line,
        urgent: true,
      };
    }
    case 'missedPenalty':
      return {
        ...base,
        title: `❌ ركلة جزاء ضائعة${team ? ` — ${team}` : ''}`,
        body: `${withPlayer(minuteTag(event.minute), event.player, latin)} • ${line}`,
        urgent: false,
      };
    case 'yellow':
      return {
        ...base,
        title: `🟨 إنذار${team ? ` — ${team}` : ''}`,
        body: `${withPlayer(minuteTag(event.minute), event.player, latin)} • ${line}`,
        urgent: false,
      };
    case 'secondYellow':
    case 'red':
      return {
        ...base,
        title: `🟥 طرد${event.kind === 'secondYellow' ? ' (إنذار ثانٍ)' : ''}${team ? ` — ${team}` : ''}`,
        body: `${withPlayer(minuteTag(event.minute), event.player, latin)} • ${line}`,
        urgent: true,
      };
    case 'sub': {
      const on = event.player ? `دخول ${latin ? `(${event.player})` : event.player}` : '';
      const off = event.other ? `خروج ${latin ? `(${event.other})` : event.other}` : '';
      return {
        ...base,
        title: `🔄 تبديل${team ? ` — ${team}` : ''}`,
        body: `${minuteTag(event.minute)}${[on, off].filter(Boolean).join(' • ')}`.trim(),
        urgent: false,
      };
    }
  }
}

/** A goal the score shows but no timeline row names: the club and the score only. */
export function bareGoalPush(match: MatchRow, date: string, side: 'home' | 'away', score: { home: number; away: number }): WatchPush {
  return {
    matchId: match.id,
    date,
    kind: 'goal',
    title: `⚽ جوووول ${forClub(sideName(match, side))}!`,
    body: `النتيجة الآن ${scoreLine(match, score.home, score.away)}`,
    urgent: true,
  };
}

export function phasePush(
  match: MatchRow,
  date: string,
  phase: LivePhase | 'kickoff' | 'correction',
  score: { home: number; away: number },
): WatchPush {
  const line = scoreLine(match, score.home, score.away);
  const base = { matchId: match.id, date, kind: phase };
  switch (phase) {
    case 'kickoff':
    case 'firstHalf':
      return { ...base, kind: 'kickoff', title: `🟢 بدأت المباراة`, body: `${match.home} × ${match.away}`, urgent: true };
    case 'halftime':
      return { ...base, title: `⏸️ نهاية الشوط الأول`, body: line, urgent: false };
    case 'secondHalf':
      return { ...base, title: `▶️ بداية الشوط الثاني`, body: line, urgent: false };
    case 'extraTime':
      return { ...base, title: `⏱️ وقت إضافي`, body: line, urgent: false };
    case 'penalties':
      return { ...base, title: `🎯 ركلات الترجيح`, body: line, urgent: true };
    case 'final':
      return { ...base, title: `🏁 انتهت المباراة`, body: `النتيجة النهائية: ${line}`, urgent: true };
    case 'correction':
      return { ...base, title: `↩️ تعديل في النتيجة`, body: `النتيجة الآن ${line}`, urgent: false };
  }
}

// --- one poll ---

function newState(match: MatchRow): WatchState {
  return {
    status: match.status,
    home: match.homeScore ?? 0,
    away: match.awayScore ?? 0,
    lowerPolls: 0,
    timelineSource: null,
    seen: new Set(),
    phases: new Set(),
    pendingGoals: [],
    spareGoals: [],
    goalsWithoutRow: { home: 0, away: 0 },
    finalSent: match.status === 'finished',
  };
}

const isGoal = (e: LiveEvent): boolean => e.kind === 'goal' || e.kind === 'penaltyGoal' || e.kind === 'ownGoal';

/**
 * Advance one match by one poll and return what to announce.
 *
 * Pure apart from `state`, so the rules above are testable without a network.
 */
export function stepMatch(
  state: WatchState | undefined,
  match: MatchRow,
  date: string,
  timeline: LiveTimeline | null,
): { state: WatchState; pushes: WatchPush[] } {
  const pushes: WatchPush[] = [];
  const homeNow = match.homeScore ?? 0;
  const awayNow = match.awayScore ?? 0;

  // First look: record, announce nothing.
  if (!state) {
    const s = newState(match);
    if (timeline) {
      if (timeline.events.length) s.timelineSource = timeline.source;
      timeline.events.forEach((e) => s.seen.add(eventKey(e)));
      timeline.phases.forEach((p) => s.phases.add(p));
    }
    if (match.status !== 'upcoming') s.phases.add('firstHalf');
    return { state: s, pushes };
  }
  const s = state;

  // Kick-off: the match is LIVE now (FilGoal's «بعد قليل» is «unknown», which is
  // not a kick-off: measured, it went out ~45 minutes early), or the source's own
  // «الشوط الأول» row appeared. A match first seen live at 1-1 did not just start.
  const kickedOff =
    (match.status === 'live' && s.status !== 'live' && (s.status === 'upcoming' || homeNow + awayNow === 0)) ||
    (timeline?.phases.includes('firstHalf') ?? false);
  if (kickedOff && !s.phases.has('firstHalf')) {
    s.phases.add('firstHalf');
    pushes.push(phasePush(match, date, 'kickoff', { home: homeNow, away: awayNow }));
  }

  // Timeline rows.
  if (timeline) {
    if (!s.timelineSource && timeline.events.length) s.timelineSource = timeline.source;
    const fresh =
      timeline.source === s.timelineSource ? timeline.events.filter((e) => !s.seen.has(eventKey(e))) : [];
    fresh.forEach((e) => s.seen.add(eventKey(e)));
    // A back-fill, or rows that arrive after the whistle, are history, not news.
    const announceRows = fresh.length <= BACKFILL_ROWS && (match.status === 'live' || s.status === 'live');
    if (announceRows) {
      for (const e of fresh) {
        if (isGoal(e)) {
          s.spareGoals.push({ event: e, polls: 0 });
          continue;
        }
        pushes.push(eventPush(match, date, e, { home: homeNow, away: awayNow }, s.timelineSource ?? timeline.source));
      }
    }
  }

  // A score first seen after an «unknown» state is where the match already is, not
  // goals scored now (measured: a Bahraini fixture went unknown → live at 1-1).
  if (s.status === 'unknown' && match.status !== 'unknown') {
    s.home = homeNow;
    s.away = awayNow;
  }

  // Full time, known before the goals so a late goal goes out BEFORE the whistle.
  const over = match.status === 'finished' || (timeline?.phases.includes('final') ?? false);

  // A goal not yet announced that the score takes back is dropped quietly
  // (measured: لوسيل 1→3→2 sent two goals and a correction in one minute).
  for (const side of ['home', 'away'] as const) {
    const now = side === 'home' ? homeNow : awayNow;
    while (now < s[side] && s.pendingGoals.some((g) => g.side === side)) {
      const i = s.pendingGoals.map((g) => g.side).lastIndexOf(side);
      s.pendingGoals.splice(i, 1);
      s[side] -= 1;
    }
  }

  // Goals: the score is the trigger. After the final whistle has been sent, the
  // final notification already carried the score.
  for (const side of ['home', 'away'] as const) {
    const now = side === 'home' ? homeNow : awayNow;
    const before = s[side];
    if (s.finalSent) {
      if (now > before) s[side] = now;
      continue;
    }
    for (let i = before; i < now; i += 1) s.pendingGoals.push({ side, polls: 0 });
    if (now > before) s[side] = now;
  }
  // Rows that arrive for a goal already announced without one are dropped.
  s.spareGoals = s.spareGoals.filter(({ event }) => {
    const side = event.side;
    if (!side || !s.goalsWithoutRow[side]) return true;
    s.goalsWithoutRow[side] -= 1;
    return false;
  });
  const stillPending: PendingGoal[] = [];
  for (const goal of s.pendingGoals) {
    // An own goal may sit in either column, so it can serve either side.
    const idx = s.spareGoals.findIndex(
      ({ event }) => event.side === goal.side || event.kind === 'ownGoal' || event.side === null,
    );
    if (idx >= 0) {
      const [{ event }] = s.spareGoals.splice(idx, 1) as [{ event: LiveEvent; polls: number }];
      pushes.push(eventPush(match, date, { ...event, side: event.kind === 'ownGoal' ? goal.side : event.side }, { home: s.home, away: s.away }, s.timelineSource ?? 'filgoal'));
      continue;
    }
    if (goal.polls >= GOAL_WAIT_POLLS || match.status !== 'live' || over) {
      s.goalsWithoutRow[goal.side] += 1;
      pushes.push(bareGoalPush(match, date, goal.side, { home: s.home, away: s.away }));
      continue;
    }
    stillPending.push({ ...goal, polls: goal.polls + 1 });
  }
  s.pendingGoals = stillPending;
  s.spareGoals = s.spareGoals.map((g) => ({ ...g, polls: g.polls + 1 })).filter((g) => g.polls <= ROW_WAIT_POLLS);

  // A goal taken back: announced only once the lower score holds for two polls.
  if (homeNow < s.home || awayNow < s.away) {
    s.lowerPolls += 1;
    if (s.lowerPolls >= 2) {
      s.home = homeNow;
      s.away = awayNow;
      s.lowerPolls = 0;
      pushes.push(phasePush(match, date, 'correction', { home: homeNow, away: awayNow }));
    }
  } else {
    s.lowerPolls = 0;
  }

  // Phases the source stated.
  for (const phase of ['halftime', 'secondHalf', 'extraTime', 'penalties'] as const) {
    if (timeline?.phases.includes(phase) && !s.phases.has(phase)) {
      s.phases.add(phase);
      // A phase that shows up after the whistle is history.
      if (match.status === 'live') pushes.push(phasePush(match, date, phase, { home: homeNow, away: awayNow }));
    }
  }

  // Full time: the status, or FilGoal's «انتهت».
  if (over && !s.finalSent && s.status !== 'upcoming') {
    s.finalSent = true;
    pushes.push(phasePush(match, date, 'final', { home: homeNow, away: awayNow }));
  }
  s.status = match.status;
  return { state: s, pushes };
}

/**
 * One poll of every followed match. Called from the football poll, after the day
 * list is loaded, so the day read here is a cache hit.
 */
export async function pollMatchWatches(options: {
  now?: number;
  fetchImpl?: typeof fetch;
  readers?: TimelineReaders;
  send?: typeof sendWatchNotifications;
} = {}): Promise<{ matches: number; pushes: number }> {
  const now = options.now ?? Date.now();
  const watched = watchersByMatch();
  if (!watched.size) return { matches: 0, pushes: 0 };
  const readers = options.readers ?? defaultReaders(options.fetchImpl);
  const send = options.send ?? sendWatchNotifications;

  // Only today's list, and yesterday's in the small hours (a late kick-off that
  // runs past midnight). A follow for a later day waits without costing a request.
  const today = todayCairo(now);
  const yesterday = todayCairo(now - 86_400_000);
  const cairoHour = new Date(now + 2 * 3_600_000).getUTCHours();
  const dates = [...new Set([...watched.values()].map((w) => w.date))].filter(
    (d) => d === today || (d === yesterday && cairoHour < 4),
  );
  const days = new Map<string, MatchRow[]>();
  for (const date of dates) {
    const day = await loadDay(date, options.fetchImpl ? { fetchImpl: options.fetchImpl, now } : { now }).catch(() => null);
    if (day && !day.unavailable) days.set(date, day.matches);
  }

  const finished = new Set<string>();
  let read = 0;
  let pushes = 0;
  for (const [matchId, { date, home, away, users }] of watched) {
    // A Yallakora-only row's id is its place on the day page, so the names are
    // checked too: a row that moved is found by its clubs, never swapped for another.
    const rows = days.get(date) ?? [];
    const stableId = !matchId.startsWith('yk-');
    const match = stableId
      ? rows.find((m) => m.id === matchId)
      : (rows.find((m) => m.id === matchId && m.home === home && m.away === away) ??
        rows.find((m) => m.home === home && m.away === away));
    if (!match) continue;
    const state = states.get(matchId);
    // Pages are read only while the ball is in play, or on the poll the whistle
    // goes (so the last minute's rows are not lost).
    const wantsPage = match.status === 'live' || (match.status === 'finished' && state && state.status === 'live');
    let timeline: LiveTimeline | null = null;
    if (wantsPage && read < MAX_LIVE_MATCHES_PER_POLL) {
      read += 1;
      timeline = await readTimeline(match, date, state?.timelineSource ?? null, readers).catch(() => null);
    }
    const step = stepMatch(state, match, date, timeline);
    states.set(matchId, step.state);
    if (step.pushes.length) {
      try {
        pushes += await send(users, step.pushes, options.fetchImpl);
      } catch (err) {
        console.error('[watch] notification failed:', err);
      }
    }
    if (step.state.finalSent && match.status === 'finished') finished.add(matchId);
  }
  // A finished match's follows have done their job.
  for (const id of finished) states.delete(id);
  prune(finished, now);
  return { matches: watched.size, pushes };
}
