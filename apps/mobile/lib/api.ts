export const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'https://newsserver-production.up.railway.app';

export interface Article {
  id: string;
  title: string;
  summary: string | null;
  imageUrl: string | null;
  url: string;
  sourceId: string;
  sourceName: string;
  category: string;
  country: string;
  publishedAt: number;
  isBreaking: boolean;
}

export async function fetchFeed(limit = 50, offset = 0): Promise<Article[]> {
  const url = `${API_BASE}/api/feed?limit=${limit}&offset=${offset}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchArticle(id: string): Promise<Article> {
  const res = await fetch(`${API_BASE}/api/articles/${encodeURIComponent(id)}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Article };
  return json.data;
}

export interface Category {
  id: string;
  name: string;
}

export interface SourceMeta {
  id: string;
  name: string;
}

export async function fetchCategories(): Promise<Category[]> {
  const res = await fetch(`${API_BASE}/api/categories`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Category[] };
  return json.data;
}

export async function fetchTrending(limit = 20): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/trending?limit=${limit}`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchSourceArticles(
  sourceId: string,
  limit = 50,
  offset = 0,
): Promise<{ source: SourceMeta; articles: Article[] }> {
  const res = await fetch(
    `${API_BASE}/api/sources/${encodeURIComponent(sourceId)}/articles?limit=${limit}&offset=${offset}`,
  );
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { source: SourceMeta; data: Article[] };
  return { source: json.source, articles: json.data };
}

export interface Source {
  id: string;
  name: string;
  country?: string;
}

export async function fetchSources(): Promise<Source[]> {
  const res = await fetch(`${API_BASE}/api/sources`);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Source[] };
  return json.data;
}

export async function fetchFollows(token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function followSource(sourceId: string, token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows/${encodeURIComponent(sourceId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function unfollowSource(sourceId: string, token: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/api/follows/${encodeURIComponent(sourceId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: { sourceIds: string[] } };
  return json.data.sourceIds;
}

export async function fetchFollowingFeed(token: string, limit = 50, offset = 0): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/feed/following?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchSavedArticles(token: string, limit = 50, offset = 0): Promise<Article[]> {
  const res = await fetch(`${API_BASE}/api/saved?limit=${limit}&offset=${offset}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: Article[] };
  return json.data;
}

export async function fetchIsArticleSaved(articleId: string, token: string): Promise<boolean> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const json = (await res.json()) as { data: { saved: boolean } };
  return json.data.saved;
}

export async function saveArticle(articleId: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

export async function unsaveArticle(articleId: string, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/saved/${encodeURIComponent(articleId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'أمس';
  if (days < 30) return `منذ ${days} يوم`;
  const months = Math.floor(days / 30);
  return `منذ ${months} شهر`;
}

const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
];

/** Absolute publish date, e.g. "16 نوفمبر 2026، 03:41 ص". */
export function fullDate(ts: number): string {
  const d = new Date(ts);
  const hours = d.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mins = String(d.getMinutes()).padStart(2, '0');
  const period = hours < 12 ? 'ص' : 'م';
  return `${d.getDate()} ${AR_MONTHS[d.getMonth()]} ${d.getFullYear()}، ${h12}:${mins} ${period}`;
}
