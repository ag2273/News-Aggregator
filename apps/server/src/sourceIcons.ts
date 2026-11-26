// The outlet's own icon and colour, for a card that has no picture (#57).
//
// When a story's page gives no image, the card's image slot shows the outlet
// instead: its colour as the background and its site icon on a white tile (design
// option A, approved by Ayman 2026-11-26). The app never calls the outlet for the
// icon: it asks `/api/sources/:id/icon`, and we serve bytes fetched once and kept on
// disk, the same rule as the team crests (crests.ts).
//
// Where the icon comes from, best first:
//   1. the homepage's `apple-touch-icon` (or a `rel=icon` declared 96px or larger):
//      the outlet's own square app icon, usually 180px;
//   2. Google's favicon service at 128px, which knows every one of our hosts.
// An image under 48px is not kept: blown up on a 64px tile it would look broken,
// and the app's letter tile looks better than that.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOURCES } from './types.js';
import { fetchPageWithTimeout } from './articleText.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rawDataDir = process.env['DATA_DIR'] || process.env['RAILWAY_VOLUME_MOUNT_PATH'];
const DATA_DIR = rawDataDir ? path.resolve(rawDataDir) : path.resolve(__dirname, '../../data');
const ICON_DIR = path.join(DATA_DIR, 'source-icons');

/**
 * Each outlet's brand colour, picked by hand from its masthead. Approximate on
 * purpose: it is a background behind the outlet's real icon, not a logo. A source
 * missing here gets the app's neutral ink. All are dark enough for white text.
 */
export const SOURCE_COLORS: Record<string, string> = {
  youm7: '#C4161C',
  aljazeera: '#B8862B',
  'bbc-arabic': '#B80000',
  'cnn-arabic': '#CC0000',
  'skynews-arabia': '#0B3F7A',
  'rt-arabic': '#4E8F27',
  alarabiya: '#1C5DA8',
  ahram: '#1B3E74',
  almasry: '#B5121B',
  masrawy: '#D9541E',
  asharqalawsat: '#1F7A4D',
  alkhaleej: '#8B1E2D',
  alnahar: '#B71C1C',
  okaz: '#0D4F8B',
  alshorouk: '#C1272D',
  aldostor: '#1D4E89',
  elwatannews: '#D7191F',
  'tech-wd': '#2B6FA8',
  hashtagarabi: '#5B2C83',
  arabhardware: '#C8102E',
  arabgamerz: '#6A2BB0',
  aitnews: '#0069A8',
  alghad: '#B8292F',
  elbalad: '#C41E2B',
  'al-madina': '#0E6E46',
  aleqt: '#00594C',
  asharqbusiness: '#C85A17',
  'euronews-ar': '#003399',
  cnbcarabia: '#1B3A6B',
};

export function sourceColor(sourceId: string): string | null {
  return SOURCE_COLORS[sourceId] ?? null;
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MIN_SIDE = 48;
const MAX_BYTES = 256 * 1024;
const RETRY_MS = 6 * 60 * 60 * 1000;

export function detectImageType(buf: Buffer): string | null {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** A PNG's width and height from its header, or null for other formats. */
export function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (detectImageType(buf) !== 'image/png') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

/** Icon candidates declared on a homepage, best first, absolute. */
export function iconLinks(html: string, pageUrl: string): string[] {
  const end = html.search(/<\/head>/i);
  const head = html.slice(0, end >= 0 ? end : 200_000);
  const scored: Array<{ url: string; score: number }> = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = (tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? '').toLowerCase();
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const size = Number(tag.match(/\bsizes\s*=\s*["'](\d+)x\d+["']/i)?.[1] ?? 0);
    let score = 0;
    if (rel.includes('apple-touch-icon')) score = 1000 + (size || 180);
    else if (/\bicon\b/.test(rel) && size >= 96) score = size;
    else continue;
    if (/\.svg(\?|$)/i.test(href)) continue;
    try {
      scored.push({ url: new URL(href.replace(/&amp;/g, '&'), pageUrl).toString(), score });
    } catch {
      /* skip */
    }
  }
  return scored.sort((a, b) => b.score - a.score).map((s) => s.url);
}

export interface IconDeps {
  fetchHtml: (url: string) => Promise<{ ok: boolean; text: string }>;
  fetchBytes: (url: string) => Promise<Buffer | null>;
}

const defaultDeps: IconDeps = {
  fetchHtml: (url) => fetchPageWithTimeout(url, undefined, 8000),
  fetchBytes: async (url) => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'image/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      return buf.length && buf.length <= MAX_BYTES ? buf : null;
    } catch {
      return null;
    }
  },
};

/** Usable as a tile icon: a known image type, and not a tiny favicon. */
function usable(buf: Buffer | null): buf is Buffer {
  if (!buf || !detectImageType(buf)) return false;
  const size = pngSize(buf);
  return !size || (size.w >= MIN_SIDE && size.h >= MIN_SIDE);
}

/** Find and fetch an outlet's icon. Null when nothing usable exists. */
export async function findSourceIcon(siteUrl: string, deps: IconDeps = defaultDeps): Promise<Buffer | null> {
  try {
    const page = await deps.fetchHtml(siteUrl);
    if (page.ok) {
      for (const url of iconLinks(page.text, siteUrl).slice(0, 3)) {
        const buf = await deps.fetchBytes(url);
        if (usable(buf)) return buf;
      }
    }
  } catch {
    /* fall through to the favicon service */
  }
  const host = new URL(siteUrl).hostname;
  const buf = await deps.fetchBytes(`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`);
  return usable(buf) ? buf : null;
}

const memory = new Map<string, Buffer>();
const failedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<Buffer | null>>();

/** Test seam. */
export function _resetSourceIcons(): void {
  memory.clear();
  failedAt.clear();
  inFlight.clear();
}

/**
 * The icon for one of our sources, from memory, then disk, then fetched once.
 * There are 29 sources, so the whole cache is a few hundred KB.
 */
export async function getSourceIcon(
  sourceId: string,
  deps: IconDeps = defaultDeps,
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const source = SOURCES.find((s) => s.id === sourceId);
  if (!source) return null;
  const hit = memory.get(sourceId);
  if (hit) return { buffer: hit, contentType: detectImageType(hit)! };
  const file = path.join(ICON_DIR, sourceId);
  try {
    const buf = fs.readFileSync(file);
    if (detectImageType(buf)) {
      memory.set(sourceId, buf);
      return { buffer: buf, contentType: detectImageType(buf)! };
    }
  } catch {
    /* not cached yet */
  }
  const failed = failedAt.get(sourceId);
  if (failed && Date.now() - failed < RETRY_MS) return null;
  let job = inFlight.get(sourceId);
  if (!job) {
    job = findSourceIcon(source.url, deps).finally(() => inFlight.delete(sourceId));
    inFlight.set(sourceId, job);
  }
  const buf = await job;
  if (!buf) {
    failedAt.set(sourceId, Date.now());
    return null;
  }
  memory.set(sourceId, buf);
  try {
    fs.mkdirSync(ICON_DIR, { recursive: true });
    fs.writeFileSync(file, buf);
  } catch {
    /* serving from memory is enough */
  }
  return { buffer: buf, contentType: detectImageType(buf)! };
}
