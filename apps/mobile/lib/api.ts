const API_BASE = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3001';

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

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `منذ ${days} يوم`;
}
