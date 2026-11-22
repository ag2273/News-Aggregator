#!/usr/bin/env node
// Live latency probe for the El Gouna × Zamalek match (23 Nov, 17:00 Cairo).
//
// What it measures, and why this way:
//   * It polls BOTH sources for that one fixture, on a fixed interval, and logs
//     every state change it sees with the wall-clock time it saw it.
//   * It never writes to /data and never talks to the app. It is a probe.
//
// `node live-probe.mjs --minutes 100 --interval 20`

import fs from 'node:fs';

const BASE_YK = 'https://www.yallakora.com';
const FILGOAL = 'https://www.filgoal.com/matches';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const minutes = Number(args.minutes ?? 100);
const intervalSec = Number(args.interval ?? 20);
const outFile = args.out ?? '/tmp/live-probe.jsonl';
/** The day the fixture belongs to; defaults to Cairo today. */
const targetDate = args.date ?? null;

/** Cairo-local YYYY-MM-DD and HH:MM. */
function cairoNow() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 19) };
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return { ok: false, status: res.status, body: null };
  return { ok: true, status: res.status, body: await res.text() };
}

function text(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Yallakora: the Egyptian match inside the day page. */
function yallakoraState(html) {
  const positions = [];
  for (const m of html.matchAll(/<div class="allData">/g)) positions.push(m.index);
  const heads = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => ({ at: m.index, name: text(m[1]) }));
  for (let i = 0; i < positions.length; i += 1) {
    const start = positions[i];
    const block = html.slice(start, positions[i + 1] ?? html.length);
    const teams = [...block.matchAll(/class="teams team[AB]"[\s\S]{0,2000}?<p>([^<]{2,60})<\/p>/g)].map((m) => m[1].trim());
    if (teams.length < 2) continue;
    const joined = `${teams[0]}${teams[1]}`;
    if (!/الجونة/.test(joined) || !/الزمالك/.test(joined)) continue;
    const scores = [...block.matchAll(/class="score">\s*([^<]*?)\s*</g)].map((m) => m[1].trim());
    const status = (block.match(/class="matchStatus">\s*<span>\s*([^<]+?)\s*</) ?? [])[1] ?? '';
    const league = heads.filter((h) => h.at < start).pop()?.name ?? '';
    return { teams, score: scores.slice(0, 2).join('-'), status: status.trim(), league };
  }
  return null;
}

/** FilGoal: the same fixture from its day list. */
function filgoalState(html) {
  const start = html.indexOf('data-matches-scroller');
  if (start < 0) return null;
  let region = html.slice(start);
  const side = region.indexOf('<div class="side">');
  if (side > 0) region = region.slice(0, side);
  for (const block of region.split('<div class="cin_cntnr">').slice(1)) {
    const names = [...block.matchAll(/<strong>([^<]{2,40})<\/strong>/g)].map((m) => m[1].trim());
    const joined = names.join('');
    if (!/الجونة/.test(joined) || !/الزمالك/.test(joined)) continue;
    const status = text((block.match(/class="status[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? '');
    const score = block.match(/class="f"[\s\S]{0,600}?<b>\s*(?:<text>\s*<\/text>)?\s*(\d*)\s*<\/b>[\s\S]{0,600}?class="s"[\s\S]{0,600}?<b>\s*(?:<text>\s*<\/text>)?\s*(\d*)\s*<\/b>/);
    const stamp = block.match(/(\d{2})-(\d{2})-(\d{4})\s*-\s*(\d{1,2}):(\d{2})/);
    return {
      names,
      score: score ? `${score[1] || '-'}-${score[2] || '-'}` : null,
      status,
      kickoff: stamp ? `${stamp[4].padStart(2, '0')}:${stamp[5]}` : null,
    };
  }
  return null;
}

const started = Date.now();
const deadline = started + minutes * 60_000;
let last = { yk: null, fg: null };
let changes = 0;

function log(entry) {
  fs.appendFileSync(outFile, `${JSON.stringify(entry)}\n`);
  console.log(JSON.stringify(entry));
}

log({ kind: 'start', cairo: cairoNow(), date: targetDate ?? cairoNow().date, minutes, intervalSec });

while (Date.now() < deadline) {
  const cairo = cairoNow();
  const date = targetDate ?? cairo.date;
  const [yk, fg] = await Promise.all([
    get(`${BASE_YK}/matches-center?date=${date}`),
    get(`${FILGOAL}?date=${date}`),
  ]);
  const ykState = yk.ok ? yallakoraState(yk.body) : { error: yk.status };
  const fgState = fg.ok ? filgoalState(fg.body) : { error: fg.status };

  const ykKey = JSON.stringify(ykState);
  const fgKey = JSON.stringify(fgState);
  if (ykKey !== last.yk) {
    last.yk = ykKey;
    changes += 1;
    log({ kind: 'yallakora', at: cairo, http: yk.status, ...(ykState ?? {}) });
  }
  if (fgKey !== last.fg) {
    last.fg = fgKey;
    changes += 1;
    log({ kind: 'filgoal', at: cairo, http: fg.status, ...(fgState ?? {}) });
  }
  await new Promise((r) => setTimeout(r, intervalSec * 1000));
}

log({ kind: 'end', cairo: cairoNow(), changes, outFile });
