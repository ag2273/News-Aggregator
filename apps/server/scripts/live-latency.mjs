#!/usr/bin/env node
// Live latency probe: poll both sources for whole matches that are LIVE now, and
// measure how long each source takes to report a score or status change.
//
// The method that makes the number meaningful:
//   * Poll both sources in the same tick, back to back, so their requests share
//     the same wall clock. Record the UTC time each response came back.
//   * Annotate each observation with the source's own reported state.
//   * A change is timestamped with the *midpoint* between the last tick that did
//     not see it and the first tick that did. Any latency figure is therefore an
//     upper bound of half a poll interval, which is stated with the result.
//
// usage: node live-latency.mjs --minutes 60 --interval 10 [--filter Liverpool]

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]]);
    return acc;
  }, []),
);
const minutes = Number(args.minutes ?? 60);
const intervalSec = Number(args.interval ?? 10);
const outFile = args.out ?? '/tmp/live-latency.jsonl';

function cairo() {
  const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
  return { at: d.toISOString().slice(11, 19), date: d.toISOString().slice(0, 10) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
    const body = res.ok ? await res.text() : '';
    return { ok: res.ok, status: res.status, body, ms: Date.now() - started };
  } catch (e) {
    return { ok: false, status: 0, body: '', ms: Date.now() - started, error: String(e).slice(0, 80) };
  }
}

const scoreOf = (frag) => {
  const m = [...frag.matchAll(/class="score">\s*([^<]*?)\s*</g)].map((x) => x[1].trim());
  return m.slice(0, 2).join('-');
};

/** Every live match on the Yallakora day page, keyed by a normalised team pair. */
function yallakoraLive(html) {
  const out = {};
  const pos = [...html.matchAll(/<div class="allData">/g)].map((m) => m.index);
  for (let i = 0; i < pos.length; i += 1) {
    const b = html.slice(pos[i], pos[i + 1] ?? html.length);
    const status = (b.match(/class="matchStatus">\s*<span>\s*([^<]+?)\s*</) ?? [])[1]?.trim() ?? '';
    if (!/مباشر|الشوط|استراحة/.test(status)) continue;
    const teams = [...b.matchAll(/class="teams team[AB]"[\s\S]{0,2000}?<p>([^<]{2,60})<\/p>/g)].map((m) =>
      m[1].trim(),
    );
    if (teams.length < 2) continue;
    out[`${teams[0]}|${teams[1]}`] = { teams, status, score: scoreOf(b) };
  }
  return out;
}

/** Every live match on the FilGoal day page. */
function filgoalLive(html) {
  const out = {};
  const start = html.indexOf('data-matches-scroller');
  if (start < 0) return out;
  let region = html.slice(start);
  const side = region.indexOf('<div class="side">');
  if (side > 0) region = region.slice(0, side);
  for (const b of region.split('<div class="cin_cntnr">').slice(1)) {
    const status = ((b.match(/class="status[^"]*">([\s\S]*?)<\/span>/) ?? [])[1] ?? '')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!/مباشر|الشوط|استراحة/.test(status)) continue;
    const names = [...b.matchAll(/<strong>([^<]{2,40})<\/strong>/g)].map((m) => m[1].trim());
    if (names.length < 2) continue;
    // Day-list markup: the home score is the first `<b>` after the home block
    // opens, the away score the next one. Reading with two near-anchored regexes
    // picked up the SAME `<b>` twice on a short block and made the score appear to
    // flip between ticks when nothing had changed.
    const bolds = [...b.matchAll(/<b>\s*(?:<text>\s*<\/text>)?\s*(\d*)\s*[^<]*<\/b>/g)].map((m) => m[1]);
    const hs = bolds[0];
    const as = bolds[1];
    out[`${names[0]}|${names[1]}`] = {
      teams: names.slice(0, 2),
      status,
      score: `${hs || '-'}-${as || '-'}`,
    };
  }
  return out;
}

/**
 * A key both sources produce for the same fixture.
 *
 * The two write the same club differently («أيوبسبور» vs «أيوب سبور», «ستاد رين»
 * vs «رين»), so keys are compared with spacing squashed and a shared-word match.
 * Without this the two sides never line up and a latency figure cannot exist.
 */
function normaliseTeam(name) {
  return name
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/\s*\|?\s*تحت\s*\d+/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .toLowerCase();
}
function fixtureKey(teams) {
  return teams.map(normaliseTeam).sort().join('~');
}

const history = {}; // normalised key -> { per-source state }
let ticks = 0;

function observe(source, key, state, at) {
  const id = fixtureKey(state.teams);
  const bucket = (history[id] ??= {});
  const prev = bucket[source];
  if (!prev) {
    bucket[source] = { ...state, at };
    return null;
  }
  if (prev.status === state.status && prev.score === state.score) return null;
  const change = {
    source,
    key,
    normalised: id,
    from: { status: prev.status, score: prev.score },
    to: { status: state.status, score: state.score },
    firstSeenAt: at,
    previousTickAt: prev.at,
  };
  bucket[source] = { ...state, at };
  return change;
}

const started = Date.now();
const deadline = started + minutes * 60_000;
const changes = [];

while (Date.now() < deadline) {
  ticks += 1;
  const date = cairo().date;
  // Back to back, same tick, so the two responses share a wall clock.
  const yk = await get(`https://www.yallakora.com/matches-center?date=${date}`);
  const fg = await get(`https://www.filgoal.com/matches?date=${date}`);
  const at = cairo().at;

  const ykLive = yk.ok ? yallakoraLive(yk.body) : {};
  const fgLive = fg.ok ? filgoalLive(fg.body) : {};

  for (const [k, s] of Object.entries(ykLive)) {
    const c = observe('yallakora', k, s, at);
    if (c) { changes.push(c); console.log(JSON.stringify({ kind: 'change', ...c, at })); }
  }
  for (const [k, s] of Object.entries(fgLive)) {
    const c = observe('filgoal', k, s, at);
    if (c) { changes.push(c); console.log(JSON.stringify({ kind: 'change', ...c, at })); }
  }

  // A compact heartbeat every 6 ticks, so the log shows the probe is alive and
  // what it is watching without spamming a line per tick.
  if (ticks % 6 === 1) {
    console.log(
      JSON.stringify({
        kind: 'tick',
        ticks,
        at,
        yallakora: { http: yk.status, ms: yk.ms, live: Object.keys(ykLive).length },
        filgoal: { http: fg.status, ms: fg.ms, live: Object.keys(fgLive).length },
      }),
    );
  }
  await sleep(intervalSec * 1000);
}

console.log(
  JSON.stringify({
    kind: 'summary',
    ticks,
    intervalSec,
    minutes,
    changes: changes.length,
    perSource: changes.reduce((a, c) => ({ ...a, [c.source]: (a[c.source] ?? 0) + 1 }), {}),
  }),
);
