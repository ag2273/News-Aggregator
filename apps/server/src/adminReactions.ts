// Admin reaction statistics: aggregate counts only.
//
// Privacy is the hard rule: this module never receives or emits a user id, email
// or name. It reads the reaction store and reduces it to numbers per article
// before any formatting happens, so identity data cannot leak into the HTML or
// CSV even by accident. A test asserts that.
//
// Auth: HTTP Basic, username "admin", password verified against a scrypt hash
// stored in a file (never in the repo or env). Failed logins are rate-limited per
// IP. A missing hash file makes /admin answer 503 rather than fall open.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { REACTION_TYPES, REACTION_EMOJI, entryOf, type ReactionType } from './reactions.js';

export const DEFAULT_ADMIN_HASH_FILE = '/data/secrets/admin-password.hash';
export const ADMIN_USERNAME = 'admin';

/** Failed-login budget per IP. */
export const ADMIN_FAIL_LIMIT = 10;
export const ADMIN_FAIL_WINDOW_MS = 15 * 60 * 1000;

/** Rows per page. */
export const ADMIN_PAGE_SIZE = 50;

// --- password hashing / checking ---

/** Hash a password in the same format as the user store: "salt:scryptHex". */
export function hashAdminPassword(password: string, salt?: string): string {
  const useSalt = salt ?? crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, useSalt, 64);
  return `${useSalt}:${derived.toString('hex')}`;
}

/** Constant-time verify against a "salt:hash" string. */
export function verifyAdminPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.trim().split(':');
  if (!salt || !key) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(key, 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const derived = crypto.scryptSync(password, salt, expected.length || 64);
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Read the admin password hash. A missing or unreadable file logs one warning and
 * returns null, which makes the routes answer 503 — never open access.
 */
export function loadAdminHash(
  filePath: string = process.env['ADMIN_PASSWORD_HASH_FILE'] || DEFAULT_ADMIN_HASH_FILE,
): string | null {
  try {
    const hash = fs.readFileSync(filePath, 'utf8').trim();
    if (!hash) {
      console.warn(`[admin] ${filePath} is empty — admin pages disabled`);
      return null;
    }
    return hash;
  } catch {
    console.warn(
      `[admin] no admin password hash at ${filePath} — admin pages return 503. ` +
        'Set ADMIN_PASSWORD_HASH_FILE or mount the hash there.',
    );
    return null;
  }
}

// --- failed-login rate limit ---

const failures = new Map<string, number[]>();

export function adminRateState(
  ip: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const times = (failures.get(ip) ?? []).filter((t) => t > now - ADMIN_FAIL_WINDOW_MS);
  failures.set(ip, times);
  if (times.length < ADMIN_FAIL_LIMIT) return { allowed: true, retryAfterMs: 0 };
  const oldest = Math.min(...times);
  return { allowed: false, retryAfterMs: oldest + ADMIN_FAIL_WINDOW_MS - now };
}

export function recordAdminFailure(ip: string, now: number = Date.now()): void {
  const times = (failures.get(ip) ?? []).filter((t) => t > now - ADMIN_FAIL_WINDOW_MS);
  times.push(now);
  failures.set(ip, times);
}

export function _resetAdminRateLimit(): void {
  failures.clear();
}

// --- auth header parsing ---

export interface Credentials {
  username: string;
  password: string;
}

/** Parse an `Authorization: Basic ...` header. Null when absent or malformed. */
export function parseBasicAuth(header: string | undefined): Credentials | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'basic' || !encoded) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }
  const at = decoded.indexOf(':');
  if (at === -1) return null;
  return { username: decoded.slice(0, at), password: decoded.slice(at + 1) };
}

// --- aggregation (privacy boundary) ---

export type Period = '24h' | '7d' | '30d' | 'all';
export const PERIODS: Period[] = ['24h', '7d', '30d', 'all'];
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === 'string' && (PERIODS as string[]).includes(value);
}

/** Aggregate row: counts only. No identity fields exist on this type at all. */
export interface AdminReactionRow {
  articleId: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: number;
  counts: Record<ReactionType, number>;
  total: number;
}

export interface AdminSummary {
  totalReactions: number;
  perType: Record<ReactionType, number>;
  articlesWithReactions: number;
}

export interface AdminData {
  summary: AdminSummary;
  rows: AdminReactionRow[];
  period: Period;
  sort: ReactionType | 'total';
  page: number;
  pageCount: number;
}

/** Unix ms threshold for a period, or 0 for "all". */
export function periodCutoff(period: Period, now: number = Date.now()): number {
  return period === 'all' ? 0 : now - PERIOD_MS[period];
}

/**
 * Reduce the raw reaction store to aggregate rows.
 *
 * Takes ONLY the reactions map and the article lookup. It deliberately does not
 * receive the user list, so it cannot emit an identifier.
 */
export function aggregateReactions(
  reactions: Record<string, Record<string, { type: ReactionType; updatedAt: number } | ReactionType>>,
  articles: Array<{ id: string; title: string; url: string; sourceName: string; publishedAt: number }>,
  options: { period?: Period; sort?: ReactionType | 'total'; page?: number; now?: number } = {},
): AdminData {
  const period = options.period ?? '7d';
  const sort = options.sort ?? 'total';
  const page = Math.max(1, options.page ?? 1);
  const now = options.now ?? Date.now();
  const cutoff = periodCutoff(period, now);
  const byId = new Map(articles.map((a) => [a.id, a]));

  const summary: AdminSummary = {
    totalReactions: 0,
    perType: { like: 0, love: 0, wow: 0, sad: 0, angry: 0 },
    articlesWithReactions: 0,
  };

  const rows: AdminReactionRow[] = [];

  for (const [articleId, entry] of Object.entries(reactions)) {
    const article = byId.get(articleId);
    // A reaction on an article that is no longer stored cannot be shown honestly.
    if (!article) continue;

    const counts: Record<ReactionType, number> = { like: 0, love: 0, wow: 0, sad: 0, angry: 0 };
    for (const stored of Object.values(entry)) {
      const reaction = entryOf(stored);
      // Period is by reaction time when known, else the article's publish time —
      // the documented fallback for records written before timestamps existed.
      const at = reaction.updatedAt > 0 ? reaction.updatedAt : article.publishedAt;
      if (at < cutoff) continue;
      counts[reaction.type] += 1;
    }

    const total = REACTION_TYPES.reduce((sum, t) => sum + counts[t], 0);
    if (total === 0) continue;

    summary.articlesWithReactions += 1;
    summary.totalReactions += total;
    for (const t of REACTION_TYPES) summary.perType[t] += counts[t];

    rows.push({
      articleId,
      title: article.title,
      url: article.url,
      sourceName: article.sourceName,
      publishedAt: article.publishedAt,
      counts,
      total,
    });
  }

  rows.sort((a, b) => {
    const av = sort === 'total' ? a.total : a.counts[sort];
    const bv = sort === 'total' ? b.total : b.counts[sort];
    if (bv !== av) return bv - av;
    return b.publishedAt - a.publishedAt;
  });

  const pageCount = Math.max(1, Math.ceil(rows.length / ADMIN_PAGE_SIZE));
  const start = (page - 1) * ADMIN_PAGE_SIZE;

  return {
    summary,
    rows: rows.slice(start, start + ADMIN_PAGE_SIZE),
    period,
    sort,
    page,
    pageCount,
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

/** Cairo time, as the brief asks. Africa/Cairo is UTC+2 (no DST since 2015). */
export function formatCairo(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  // ASCII digits on purpose: the table is scanned column-wise and the CSV is read
  // in Excel, where Arabic-Indic numerals are hard to sort or filter.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`;
}

function query(params: Record<string, string>): string {
  const q = new URLSearchParams(params).toString();
  return q ? `?${q}` : '';
}

function sortLink(label: string, key: ReactionType | 'total', data: AdminData): string {
  const active = data.sort === key;
  return `<a href="/admin/reactions${query({ period: data.period, sort: key, page: '1' })}" class="sort${active ? ' active' : ''}">${label}</a>`;
}

/** The Arabic RTL page. Counts only; nothing user-identifying is interpolated. */
export function renderAdminPage(data: AdminData): string {
  const { summary, period, page, pageCount } = data;
  const emoji = REACTION_EMOJI;

  const periodLinks = (['24h', '7d', '30d', 'all'] as Period[])
    .map((p) => {
      const labels: Record<Period, string> = { '24h': '٢٤ ساعة', '7d': '٧ أيام', '30d': '٣٠ يوم', all: 'الكل' };
      const active = p === period ? ' active' : '';
      return `<a class="pill${active}" href="/admin/reactions${query({ period: p, sort: data.sort, page: '1' })}">${labels[p]}</a>`;
    })
    .join('');

  const rows = data.rows
    .map(
      (r) => `<tr>
        <td class="title"><a href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a></td>
        <td>${escapeHtml(r.sourceName)}</td>
        <td class="num">${formatCairo(r.publishedAt)}</td>
        ${REACTION_TYPES.map((t) => `<td class="num">${r.counts[t] || ''}</td>`).join('')}
        <td class="num total">${r.total}</td>
      </tr>`,
    )
    .join('');

  const pager = Array.from({ length: pageCount }, (_, i) => i + 1)
    .slice(Math.max(0, page - 3), Math.max(6, page + 2))
    .map((p) => `<a class="pill${p === page ? ' active' : ''}" href="/admin/reactions${query({ period, sort: data.sort, page: String(p) })}">${p}</a>`)
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow, noarchive" />
<title>إحصاءات التفاعلات — رئيس التحرير</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; padding:16px; background:#0B1511; color:#F8FAFC;
         font-family:system-ui,-apple-system,'Segoe UI',Tahoma,sans-serif; direction:rtl; }
  h1 { font-size:19px; margin:0 0 4px; }
  .sub { color:#94A3B8; font-size:12px; margin-bottom:16px; }
  .cards { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:16px; }
  .card { background:#182721; border-radius:14px; padding:12px 14px; min-width:96px; }
  .card .k { color:#94A3B8; font-size:11px; }
  .card .v { font-size:20px; font-weight:700; margin-top:2px; }
  .pill { display:inline-block; padding:6px 12px; border-radius:14px; background:rgba(255,255,255,.08);
          color:#CBD5E1; text-decoration:none; font-size:12px; margin:0 0 6px 6px; }
  .pill.active { background:rgba(52,211,153,.18); color:#34D399; border:1px solid rgba(52,211,153,.35); }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { padding:8px 6px; text-align:right; border-bottom:1px solid rgba(255,255,255,.08); vertical-align:top; }
  th { color:#94A3B8; font-weight:600; font-size:11px; position:sticky; top:0; background:#0B1511; }
  td.title { max-width:320px; }
  td.title a { color:#F8FAFC; text-decoration:none; }
  td.title a:hover { color:#34D399; }
  .num { text-align:center; font-variant-numeric:tabular-nums; white-space:nowrap; }
  td.total { color:#34D399; font-weight:700; }
  .sort { color:inherit; text-decoration:none; }
  .sort.active { color:#34D399; }
  .toolbar { display:flex; flex-wrap:wrap; gap:8px; align-items:center; margin-bottom:10px; }
  .csv { margin-inline-start:auto; background:rgba(52,211,153,.15); color:#34D399;
         padding:7px 14px; border-radius:14px; text-decoration:none; font-size:12px;
         border:1px solid rgba(52,211,153,.35); }
  .empty { color:#94A3B8; padding:24px 0; text-align:center; font-size:13px; }
  @media (max-width:640px){ td.title{max-width:150px} .card{min-width:74px} }
</style>
</head>
<body>
  <h1>إحصاءات التفاعلات</h1>
  <div class="sub">أعداد مجمّعة فقط — بدون أي بيانات شخصية. التوقيت بتوقيت القاهرة.</div>

  <div class="cards">
    <div class="card"><div class="k">إجمالي التفاعلات</div><div class="v">${summary.totalReactions}</div></div>
    ${REACTION_TYPES.map((t) => `<div class="card"><div class="k">${emoji[t]}</div><div class="v">${summary.perType[t]}</div></div>`).join('')}
    <div class="card"><div class="k">أخبار فيها تفاعل</div><div class="v">${summary.articlesWithReactions}</div></div>
  </div>

  <div class="toolbar">
    ${periodLinks}
    <a class="pill" href="/admin/stats?period=${period}">الاستخدام</a>
    <a class="csv" href="/admin/reactions.csv${query({ period, sort: data.sort })}">تنزيل CSV</a>
  </div>

  ${
    data.rows.length
      ? `<table>
    <thead>
      <tr>
        <th>الخبر</th>
        <th>المصدر</th>
        <th>النشر (القاهرة)</th>
        ${REACTION_TYPES.map((t) => `<th class="num">${sortLink(emoji[t], t, data)}</th>`).join('')}
        <th class="num">${sortLink('الإجمالي', 'total', data)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <div style="margin-top:14px">${pager}</div>`
      : '<div class="empty">لا توجد تفاعلات في هذه الفترة.</div>'
  }
</body>
</html>`;
}

/** CSV of the same data: UTF-8 with a BOM so Excel reads the Arabic correctly. */
export function renderAdminCsv(data: AdminData): string {
  const header = ['الخبر', 'المصدر', 'النشر (القاهرة)', ...REACTION_TYPES.map((t) => REACTION_EMOJI[t]), 'الإجمالي'];
  const escapeCsv = (value: string): string => {
    if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  const lines = [header.map(escapeCsv).join(',')];
  for (const r of data.rows) {
    lines.push(
      [
        escapeCsv(r.title),
        escapeCsv(r.sourceName),
        formatCairo(r.publishedAt),
        ...REACTION_TYPES.map((t) => String(r.counts[t])),
        String(r.total),
      ].join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}
