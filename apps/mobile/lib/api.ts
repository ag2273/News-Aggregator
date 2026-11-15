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
