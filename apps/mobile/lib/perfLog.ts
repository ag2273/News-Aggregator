// A small, permanent performance log for the app (#60).
//
// WHY THIS EXISTS
// ---------------
// The user asked for it directly, and it is the honest way to find a slowdown that
// reproduces on their phone but not on the box that builds it: every boot, every
// match-centre open, every cache read and write, and every network call is recorded
// with a duration, and they send it back.
//
// THE RULES IT KEEPS
// ------------------
//   * Local only. Nothing is ever uploaded — no fetch, no beacon, no analytics.
//   * No content. A line carries timestamps, a route or screen name, a duration, and a
//     size. It never carries an article title, a score, a token or anything a reader
//     typed. That is what makes it safe to paste.
//   * Never blocks the main thread. Lines go into an in-memory ring and are flushed to
//     disk in batches; a caller cannot await the disk.
//   * Bounded. A fixed number of lines, so the file cannot grow without limit.

import { Directory, File, Paths } from 'expo-file-system';

/** How many lines the ring keeps. Oldest are dropped first. */
export const PERF_LOG_LIMIT = 200;

/** How often pending lines are written to disk (ms). */
export const PERF_FLUSH_INTERVAL_MS = 4000;

const DIR = 'perf';
const FILE = 'perf.log';

/** One recorded event, already formatted. */
type Line = string;

let ring: Line[] = [];
let pending: Line[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let loaded = false;

function dir(): Directory {
  return new Directory(Paths.cache, DIR);
}

function file(): File {
  return new File(Paths.cache, DIR, FILE);
}

/** Milliseconds with one decimal: enough for UI work, short to read. */
function ms(value: number): string {
  return `${Math.round(value * 10) / 10}ms`;
}

/**
 * One log line.
 *
 * The format is `HH:MM:SS.mmm | kind | name | detail`, chosen so a human can scan it
 * and a machine can still split it on `|`. `detail` is key=value pairs only.
 */
export function formatLine(kind: string, name: string, detail?: Record<string, string | number | boolean | null | undefined>): Line {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const mss = String(now.getMilliseconds()).padStart(3, '0');
  const pairs = detail
    ? Object.entries(detail)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${String(v)}`)
        .join(' ')
    : '';
  return `${hh}:${mm}:${ss}.${mss} | ${kind} | ${name}${pairs ? ` | ${pairs}` : ''}`;
}

/**
 * Add a line.
 *
 * Synchronous and allocation-light: this is called from render paths, so it must never
 * await, and must never throw into a screen.
 */
export function logEvent(kind: string, name: string, detail?: Record<string, string | number | boolean | null | undefined>): void {
  try {
    const line = formatLine(kind, name, detail);
    ring.push(line);
    if (ring.length > PERF_LOG_LIMIT) ring.splice(0, ring.length - PERF_LOG_LIMIT);
    pending.push(line);
    scheduleFlush();
  } catch {
    /* a diagnostic must never break a screen */
  }
}

/** Time a promise and log how long it took, whatever the outcome. */
export async function timeAsync<T>(
  kind: string,
  name: string,
  work: () => Promise<T>,
  detail?: Record<string, string | number | boolean | null | undefined>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    logEvent(kind, name, { ...detail, ms: ms(Date.now() - started), ok: true });
    return result;
  } catch (err) {
    logEvent(kind, name, {
      ...detail,
      ms: ms(Date.now() - started),
      ok: false,
      err: err instanceof Error ? err.name : 'unknown',
    });
    throw err;
  }
}

function scheduleFlush(): void {
  // One timer for the whole app, started lazily, and never one per line.
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flush();
  }, PERF_FLUSH_INTERVAL_MS);
}

/** Write the pending lines. Batched, fire-and-forget. */
export async function flush(): Promise<void> {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  try {
    const folder = dir();
    if (!folder.exists) folder.create({ idempotent: true });
    const target = file();
    const previous = target.exists ? await target.text() : '';
    // Keep the file bounded too: the ring above is the source of truth for the tail.
    const merged = `${previous}${batch.join('\n')}\n`.split('\n').filter(Boolean);
    const tail = merged.slice(-PERF_LOG_LIMIT);
    await target.write(`${tail.join('\n')}\n`);
    loaded = true;
  } catch {
    // A full disk must not lose the in-memory copy: put the batch back.
    pending = batch.concat(pending);
  }
}

/** The whole log as text, for the copy button. */
export async function readLog(): Promise<string> {
  try {
    const target = file();
    const onDisk = target.exists ? await target.text() : '';
    const inMemory = pending.join('\n');
    const all = `${onDisk}${inMemory ? `${inMemory}\n` : ''}`.trim();
    return all || '(السجل فاضي لحد دلوقتي)';
  } catch {
    return pending.join('\n') || '(السجل فاضي لحد دلوقتي)';
  }
}

/** Test seam: reset the in-memory state. */
export function _resetPerfLog(): void {
  ring = [];
  pending = [];
  loaded = false;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
