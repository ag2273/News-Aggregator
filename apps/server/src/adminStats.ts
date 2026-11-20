// Admin usage statistics: aggregate counts only.
//
// Same privacy contract as adminReactions.ts, and the same guard: this module
// receives numbers and labels, never an install id, email, user id or IP. The
// daily device hashes stay inside analytics.ts and are already reduced to a
// count before they get here — `aggregateStats` only reads `bucket.dau`.

import type { Period } from './adminReactions.js';
import type { AnalyticsStore } from './analytics.js';
import { dayKey, dayKeyBefore, KEEP_DAYS, TOP_ARTICLES, TOP_QUERIES } from './analytics.js';
import type { UserCounts } from './users.js';

export interface DailyRow {
  day: string;
  dau: number;
  opens: number;
  shares: number;
  reactions: number;
  signups: number;
}

export interface ArticleStat {
  articleId: string;
  title: string;
  url: string;
  sourceName: string;
  opens: number;
  shares: number;
  reactions: number;
}

export interface LabeledCount {
  id: string;
  name: string;
  count: number;
}

export interface StatsData {
  period: Period;
  /** First and last day keys covered by the period, oldest first. */
  fromDay: string;
  toDay: string;
  summary: {
    /** Distinct devices today. */
    dauToday: number;
    /** Mean DAU over the period's days that have data. */
    dauAvg: number;
    opens: number;
    shares: number;
    reactions: number;
    signupsInPeriod: number;
    totalUsers: number;
    verifiedUsers: number;
    newSignupsToday: number;
    saves: number;
    follows: number;
    keywordFollows: number;
    keywordMutes: number;
    sourceViews: number;
    searches: number;
  };
  daily: DailyRow[];
  topArticles: ArticleStat[];
  perSource: LabeledCount[];
  perCategory: LabeledCount[];
  topQueries: LabeledCount[];
  /** Day keys with any recorded data, newest first — for the "all" period. */
  daysWithData: number;
}

export interface ArticleLookup {
  id: string;
  title: string;
  url: string;
  sourceName: string;
  sourceId: string;
  category: string;
}

export interface ReactionRowLookup {
  articleId: string;
  total: number;
  /** When each reaction was set, for the daily table. Counts only. */
  at?: number[];
}

const PERIOD_DAYS: Record<Exclude<Period, 'all'>, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

/** Day keys covered by a period, oldest first. */
export function periodDays(period: Period, now: number = Date.now()): string[] {
  const count = period === 'all' ? KEEP_DAYS : PERIOD_DAYS[period];
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(dayKeyBefore(now, i));
  return out.reverse();
}

function sum(map: Record<string, number> | undefined): number {
  if (!map) return 0;
  let total = 0;
  for (const v of Object.values(map)) total += v;
  return total;
}

function sortCounts(map: Record<string, number> | undefined, limit?: number): Array<{ id: string; count: number }> {
  const rows = Object.entries(map ?? {})
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
  return limit === undefined ? rows : rows.slice(0, limit);
}

/**
 * Reduce the store to the page's numbers.
 *
 * `reactions` is passed in as already-aggregated per-article rows from the
 * reactions admin module, so this module never sees the reaction store itself.
 */
export function aggregateStats(
  store: AnalyticsStore,
  articles: ArticleLookup[],
  reactions: ReactionRowLookup[],
  users: UserCounts,
  options: { period?: Period; now?: number } = {},
): StatsData {
  const period = options.period ?? '7d';
  const now = options.now ?? Date.now();
  const days = periodDays(period, now);
  const inPeriod = new Set(days);
  const toDay = days[days.length - 1] ?? dayKey(now);
  const fromDay = days[0] ?? toDay;

  const byId = new Map(articles.map((a) => [a.id, a]));
  const sourceNames = new Map(articles.map((a) => [a.sourceId, a.sourceName]));
  const categoryNames = new Map<string, string>();
  for (const a of articles) categoryNames.set(a.category, a.category);

  const opens: Record<string, number> = {};
  const shares: Record<string, number> = {};
  const sourceViews: Record<string, number> = {};
  const queries: Record<string, number> = {};
  const events: Record<string, number> = {};
  let signupsInPeriod = 0;
  let searches = 0;

  const daily: DailyRow[] = [];
  let dauSum = 0;
  let dauDays = 0;

  for (const day of days) {
    const bucket = store.days[day];
    // A device list that still exists is an open day; after rollover `dau` holds
    // the final count. Either way only a number leaves this function.
    const dau = bucket ? (bucket.dau ?? bucket.devices?.length ?? 0) : 0;
    const dayOpens = sum(bucket?.opens);
    const dayShares = sum(bucket?.shares);
    const daySignups = bucket?.signups ?? (users.signupsByDay[day] ?? 0);

    if (dau > 0) {
      dauSum += dau;
      dauDays += 1;
    }
    for (const [id, n] of Object.entries(bucket?.opens ?? {})) opens[id] = (opens[id] ?? 0) + n;
    for (const [id, n] of Object.entries(bucket?.shares ?? {})) shares[id] = (shares[id] ?? 0) + n;
    for (const [id, n] of Object.entries(bucket?.sourceViews ?? {})) sourceViews[id] = (sourceViews[id] ?? 0) + n;
    for (const [q, n] of Object.entries(bucket?.queries ?? {})) {
      queries[q] = (queries[q] ?? 0) + n;
      searches += n;
    }
    for (const [k, n] of Object.entries(bucket?.events ?? {})) events[k] = (events[k] ?? 0) + n;
    signupsInPeriod += daySignups;

    daily.push({
      day,
      dau,
      opens: dayOpens,
      shares: dayShares,
      reactions: 0,
      signups: daySignups,
    });
  }

  // Reaction totals per day come from the reaction store's own timestamps, so the
  // page's daily table and its summary agree with /admin/reactions.
  const reactionByArticle = new Map(reactions.map((r) => [r.articleId, r]));
  let reactionTotal = 0;
  for (const r of reactions) reactionTotal += r.total;

  for (const r of reactions) {
    for (const at of r.at ?? []) {
      const day = dayKey(at);
      if (!inPeriod.has(day)) continue;
      const row = daily.find((d) => d.day === day);
      if (row) row.reactions += 1;
    }
  }

  const topArticles: ArticleStat[] = sortCounts(opens, TOP_ARTICLES).map(({ id, count }) => {
    const article = byId.get(id);
    return {
      articleId: id,
      title: article?.title ?? id,
      url: article?.url ?? '',
      sourceName: article?.sourceName ?? sourceNames.get(article?.sourceId ?? '') ?? '',
      opens: count,
      shares: shares[id] ?? 0,
      reactions: reactionByArticle.get(id)?.total ?? 0,
    };
  });

  const perSource: LabeledCount[] = sortCounts(sourceViews).map(({ id, count }) => ({
    id,
    name: sourceNames.get(id) ?? id,
    count,
  }));

  // Opens per category: fold article opens through each article's category.
  const perCategoryMap: Record<string, number> = {};
  for (const [id, n] of Object.entries(opens)) {
    const category = byId.get(id)?.category ?? 'misc';
    perCategoryMap[category] = (perCategoryMap[category] ?? 0) + n;
  }
  const perCategory: LabeledCount[] = sortCounts(perCategoryMap).map(({ id, count }) => ({
    id,
    name: categoryNames.get(id) ?? id,
    count,
  }));

  const topQueries: LabeledCount[] = sortCounts(queries, TOP_QUERIES).map(({ id, count }) => ({
    id,
    name: id,
    count,
  }));

  const today = dayKey(now);
  const dauToday = store.days[today] ? (store.days[today].dau ?? store.days[today].devices?.length ?? 0) : 0;
  const daysWithData = Object.keys(store.days).length;

  return {
    period,
    fromDay,
    toDay,
    summary: {
      dauToday,
      dauAvg: dauDays ? Math.round((dauSum / dauDays) * 10) / 10 : 0,
      opens: sum(opens),
      shares: sum(shares),
      reactions: reactionTotal,
      signupsInPeriod,
      totalUsers: users.total,
      verifiedUsers: users.verified,
      newSignupsToday: users.signupsByDay[today] ?? 0,
      saves: events['save'] ?? 0,
      follows: events['follow'] ?? 0,
      keywordFollows: events['keyword_follow'] ?? 0,
      keywordMutes: events['keyword_mute'] ?? 0,
      sourceViews: sum(sourceViews),
      searches,
    },
    daily,
    topArticles,
    perSource,
    perCategory,
    topQueries,
    daysWithData,
  };
}

// --- rendering ---

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function query(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return q ? `?${q}` : '';
}

function pill(label: string, href: string, active: boolean): string {
  return `<a class="pill${active ? ' active' : ''}" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}

/** Inline SVG bars. No JS, no network loads. */
function barChart(rows: DailyRow[]): string {
  const points = rows.slice(-30);
  const max = Math.max(1, ...points.map((r) => Math.max(r.dau, r.opens)));
  const width = 700;
  const height = 120;
  const step = points.length ? width / points.length : width;
  const bars = points
    .map((r, i) => {
      const h = Math.round((r.opens / max) * (height - 10));
      const x = i * step + 2;
      const w = Math.max(2, step - 4);
      const title = `${r.day}: ${r.opens} فتح`;
      return `<rect x="${x.toFixed(1)}" y="${height - h}" width="${w.toFixed(1)}" height="${h}" fill="#34D399" opacity="0.75"><title>${escapeHtml(title)}</title></rect>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="فتح المقالات يومياً">${bars}</svg>`;
}

/** The Arabic RTL page. Counts only; nothing user-identifying is interpolated. */
export function renderStatsPage(data: StatsData): string {
  const s = data.summary;
  const labels: Record<Period, string> = { '24h': '٢٤ ساعة', '7d': '٧ أيام', '30d': '٣٠ يوم', all: 'الكل' };
  const nav = (['24h', '7d', '30d'] as Period[])
    .map((p) => pill(labels[p], `/admin/stats${query({ period: p })}`, p === data.period))
    .join('');

  const cards: Array<[string, number | string]> = [
    ['DAU اليوم', s.dauToday],
    [`متوسط DAU (${data.daily.filter((d) => d.dau > 0).length} يوم)`, s.dauAvg],
    ['فتح مقالات', s.opens],
    ['مشاركات', s.shares],
    ['تفاعلات', s.reactions],
    ['مستخدمون مسجلون', s.totalUsers],
    ['موثّقون', s.verifiedUsers],
    ['تسجيلات جديدة (الفترة)', s.signupsInPeriod],
    ['تسجيلات اليوم', s.newSignupsToday],
  ];

  const dailyRows = data.daily
    .slice()
    .reverse()
    .map(
      (d) => `<tr>
        <td class="num">${escapeHtml(d.day)}</td>
        <td class="num">${d.dau || ''}</td>
        <td class="num">${d.opens || ''}</td>
        <td class="num">${d.shares || ''}</td>
        <td class="num">${d.signups || ''}</td>
      </tr>`,
    )
    .join('');

  const articleRows = data.topArticles
    .map(
      (a, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td class="title"><a href="${escapeHtml(a.url || '#')}" target="_blank" rel="noopener noreferrer">${escapeHtml(a.title)}</a></td>
        <td>${escapeHtml(a.sourceName)}</td>
        <td class="num">${a.opens}</td>
        <td class="num">${a.shares || ''}</td>
        <td class="num">${a.reactions || ''}</td>
      </tr>`,
    )
    .join('');

  const listRows = (rows: LabeledCount[], label: string) =>
    rows.length
      ? `<table><thead><tr><th>${escapeHtml(label)}</th><th class="num">العدد</th></tr></thead><tbody>${rows
          .map((r) => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${r.count}</td></tr>`)
          .join('')}</tbody></table>`
      : '<div class="empty">لا بيانات في هذه الفترة.</div>';

  const events: Array<[string, number]> = [
    ['حفظ المقالات', s.saves],
    ['متابعة مصادر', s.follows],
    ['متابعة كلمات', s.keywordFollows],
    ['كتم كلمات', s.keywordMutes],
    ['زيارات صفحات المصادر', s.sourceViews],
    ['عمليات بحث', s.searches],
  ];

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>إحصاءات الاستخدام — رئيس التحرير</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:16px; background:#0B1511; color:#F8FAFC;
         font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif; direction:rtl; }
  h1 { font-size:19px; margin:0 0 4px; }
  h2 { font-size:14px; margin:22px 0 8px; color:#CBD5E1; }
  .sub { color:#94A3B8; font-size:12px; margin-bottom:14px; }
  .nav { display:flex; flex-wrap:wrap; gap:6px; align-items:center; margin-bottom:14px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:8px; }
  .card { background:#182721; border-radius:14px; padding:12px 14px; min-width:96px; }
  .card .k { color:#94A3B8; font-size:11px; }
  .card .v { font-size:20px; font-weight:700; margin-top:2px; font-variant-numeric:tabular-nums; }
  .pill { display:inline-block; padding:6px 12px; border-radius:14px; background:rgba(255,255,255,.08);
          color:#CBD5E1; text-decoration:none; font-size:12px; }
  .pill.active { background:rgba(52,211,153,.18); color:#34D399; border:1px solid rgba(52,211,153,.35); }
  table { width:100%; border-collapse:collapse; font-size:12px; margin-bottom:8px; }
  th, td { padding:7px 6px; text-align:right; border-bottom:1px solid rgba(255,255,255,.08); vertical-align:top; }
  th { color:#94A3B8; font-weight:600; font-size:11px; }
  td.title { max-width:320px; }
  td.title a { color:#F8FAFC; text-decoration:none; }
  .num { text-align:center; font-variant-numeric:tabular-nums; white-space:nowrap; }
  .split { display:grid; grid-template-columns:1fr 1fr; gap:18px; }
  .empty { color:#94A3B8; padding:16px 0; text-align:center; font-size:13px; }
  .chart { background:#182721; border-radius:14px; padding:10px; margin-bottom:8px; }
  .csv { margin-inline-start:auto; background:rgba(52,211,153,.15); color:#34D399;
         padding:7px 14px; border-radius:14px; text-decoration:none; font-size:12px;
         border:1px solid rgba(52,211,153,.35); }
  @media (max-width:640px){ .split{grid-template-columns:1fr} td.title{max-width:150px} .card{min-width:74px} }
</style>
</head>
<body>
  <h1>إحصاءات الاستخدام</h1>
  <div class="sub">أعداد مجمّعة فقط — بدون بريد أو معرّف مستخدم أو معرّف جهاز خام. التوقيت بتوقيت القاهرة. من ${escapeHtml(data.fromDay)} إلى ${escapeHtml(data.toDay)}.</div>

  <div class="nav">
    ${nav}
    <a class="pill" href="/admin/reactions">التفاعلات</a>
    <a class="csv" href="/admin/stats.csv${query({ period: data.period })}">تنزيل CSV</a>
  </div>

  <div class="cards">
    ${cards.map(([k, v]) => `<div class="card"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`).join('')}
  </div>

  <h2>يومياً</h2>
  <div class="chart">${barChart(data.daily)}</div>
  <table>
    <thead><tr><th class="num">اليوم</th><th class="num">DAU</th><th class="num">فتح</th><th class="num">مشاركة</th><th class="num">تسجيل</th></tr></thead>
    <tbody>${dailyRows || '<tr><td colspan="5" class="empty">لا بيانات.</td></tr>'}</tbody>
  </table>

  <h2>أكثر ٢٠ خبراً بالفتح</h2>
  ${
    data.topArticles.length
      ? `<table><thead><tr><th class="num">#</th><th>الخبر</th><th>المصدر</th><th class="num">فتح</th><th class="num">مشاركة</th><th class="num">تفاعل</th></tr></thead><tbody>${articleRows}</tbody></table>`
      : '<div class="empty">لا فتحات في هذه الفترة.</div>'
  }

  <div class="split">
    <div><h2>فتح حسب المصدر</h2>${listRows(data.perSource, 'المصدر')}</div>
    <div><h2>فتح حسب التصنيف</h2>${listRows(data.perCategory, 'التصنيف')}</div>
  </div>

  <h2>أفعال أخرى</h2>
  <table><tbody>${events.map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table>

  <h2>أكثر ٥٠ كلمة بحثاً</h2>
  ${listRows(data.topQueries, 'كلمة البحث')}
</body>
</html>`;
}

/** CSV of the same data: UTF-8 with a BOM so Excel reads the Arabic correctly. */
export function renderStatsCsv(data: StatsData): string {
  const escapeCsv = (value: string): string => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const lines: string[] = [];
  lines.push(['القسم', 'البند', 'العدد'].map(escapeCsv).join(','));
  const s = data.summary;
  lines.push(['ملخص', 'DAU اليوم', String(s.dauToday)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'متوسط DAU', String(s.dauAvg)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'فتح مقالات', String(s.opens)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'مشاركات', String(s.shares)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'تفاعلات', String(s.reactions)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'مستخدمون', String(s.totalUsers)].map(escapeCsv).join(','));
  lines.push(['ملخص', 'موثّقون', String(s.verifiedUsers)].map(escapeCsv).join(','));

  lines.push(['يومي', 'اليوم,DAU,فتح,مشاركة,تفاعل,تسجيل', ''].map(escapeCsv).join(','));
  for (const d of data.daily) {
    lines.push(['يومي', d.day, `${d.dau},${d.opens},${d.shares},${d.reactions},${d.signups}`].map(escapeCsv).join(','));
  }
  for (const a of data.topArticles) {
    lines.push(['خبر', a.title, `${a.opens},${a.shares},${a.reactions}`].map(escapeCsv).join(','));
  }
  for (const r of data.perSource) lines.push(['مصدر', r.name, String(r.count)].map(escapeCsv).join(','));
  for (const r of data.perCategory) lines.push(['تصنيف', r.name, String(r.count)].map(escapeCsv).join(','));
  for (const q of data.topQueries) lines.push(['بحث', q.name, String(q.count)].map(escapeCsv).join(','));
  return `\uFEFF${lines.join('\n')}\n`;
}
