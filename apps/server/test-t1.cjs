/**
 * Standalone T1 acceptance test runner.
 * No TypeScript required — pure Node.js CJS.
 * Run: node test-t1.cjs
 */

'use strict';

const path = require('path');
const crypto = require('crypto');
const http = require('http');

// Try to load server deps
let Database, XMLParser;
try {
  Database = require(path.resolve(__dirname, 'node_modules/better-sqlite3'));
  ({ XMLParser } = require(path.resolve(__dirname, 'node_modules/fast-xml-parser')));
} catch (e) {
  console.error('Missing deps:', e.message);
  process.exit(1);
}

const DB_PATH = path.resolve(__dirname, 'data/news.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    image_url TEXT,
    url TEXT NOT NULL UNIQUE,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    country TEXT DEFAULT 'EG',
    published_at INTEGER NOT NULL,
    is_breaking INTEGER DEFAULT 0,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_articles_published ON articles(published_at DESC);
`);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  cdataPropName: '__cdata',
  parseTagValue: false,
  trimValues: true,
});

const SOURCES = [
  { id: 'youm7',          name: 'اليوم السابع',       country: 'EG', url: 'https://www.youm7.com/rss/SectionRss?SectionID=1' },
  { id: 'aljazeera',      name: 'الجزيرة',            country: 'QA', url: 'https://www.aljazeera.net/aljazeerarss' },
  { id: 'bbc-arabic',     name: 'بي بي سي عربي',     country: 'GB', url: 'https://feeds.bbci.co.uk/arabic/rss.xml' },
  { id: 'cnn-arabic',     name: 'سي إن إن عربي',      country: 'AE', url: 'https://arabic.cnn.com/rss' },
  { id: 'skynews-arabia', name: 'سكاي نيوز عربية',   country: 'AE', url: 'https://www.skynewsarabia.com/rss' },
  { id: 'rt-arabic',      name: 'آر تي عربي',        country: 'RU', url: 'https://www.rtarabic.com/rss' },
  { id: 'alarabiya',      name: 'العربية',            country: 'AE', url: 'https://news.google.com/rss/search?q=site:alarabiya.net&hl=ar&gl=EG&ceid=EG:ar' },
  { id: 'ahram',          name: 'الأهرام',            country: 'EG', url: 'https://news.google.com/rss/search?q=site:ahram.org.eg&hl=ar&gl=EG&ceid=EG:ar' },
  { id: 'almasry',        name: 'المصري اليوم',       country: 'EG', url: 'https://news.google.com/rss/search?q=site:almasryalyoum.com&hl=ar&gl=EG&ceid=EG:ar' },
  { id: 'masrawy',        name: 'مصراوي',             country: 'EG', url: 'https://news.google.com/rss/search?q=site:masrawy.com&hl=ar&gl=EG&ceid=EG:ar' },
];

function hashUrl(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? require('https') : require('http');
    const req = mod.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NewsBot/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      timeout: 15000,
    }, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractText(val) {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val.__cdata) return String(val.__cdata);
  if (val['#text']) return String(val['#text']);
  return String(val);
}

function extractImage(item) {
  const mc = item['media:content'];
  if (mc?.['@_url']) return mc['@_url'];
  const mt = item['media:thumbnail'];
  if (mt?.['@_url']) return mt['@_url'];
  const enc = item['enclosure'];
  if (enc?.['@_url'] && String(enc['@_type'] || '').startsWith('image')) return enc['@_url'];
  return null;
}

function parseDate(val) {
  if (!val) return Date.now();
  const d = new Date(typeof val === 'string' ? val : String(val));
  return isNaN(d.getTime()) ? Date.now() : d.getTime();
}

async function fetchSource(src) {
  const articles = [];
  let raw;
  try {
    raw = await fetchUrl(src.url);
  } catch (e) {
    console.warn(`  [${src.id}] SKIP: ${e.message}`);
    return [];
  }

  let parsed;
  try { parsed = parser.parse(raw); } catch (e) {
    console.warn(`  [${src.id}] XML error: ${e.message}`);
    return [];
  }

  const rss = parsed['rss'] || parsed['feed'];
  if (!rss) { console.warn(`  [${src.id}] no rss root`); return []; }
  const channel = rss['channel'] || rss;
  const rawItems = channel['item'] || channel['entry'];
  const items = Array.isArray(rawItems) ? rawItems : rawItems ? [rawItems] : [];

  for (const item of items.slice(0, 50)) {
    const url = extractText(item['link'] || item['guid']);
    if (!url || !url.startsWith('http')) continue;
    const title = extractText(item['title']);
    if (!title) continue;
    const summary = extractText(item['description'] || item['summary'] || '')
      .replace(/<[^>]+>/g, '').trim().slice(0, 500) || null;
    articles.push({
      id: hashUrl(url),
      title: title.trim(),
      summary,
      imageUrl: extractImage(item),
      url,
      sourceId: src.id,
      sourceName: src.name,
      category: 'general',
      country: src.country,
      publishedAt: parseDate(item['pubDate'] || item['published'] || item['updated']),
      isBreaking: 0,
    });
  }
  return articles;
}

const insert = db.prepare(`
  INSERT OR IGNORE INTO articles
    (id, title, summary, image_url, url, source_id, source_name, category, country, published_at, is_breaking, fetched_at)
  VALUES
    (@id, @title, @summary, @imageUrl, @url, @sourceId, @sourceName, @category, @country, @publishedAt, @isBreaking, @fetchedAt)
`);

async function main() {
  const now = Date.now();
  console.log('Fetching', SOURCES.length, 'sources in parallel…');
  const results = await Promise.allSettled(SOURCES.map(s => fetchSource(s)));
  const sourcesWithArticles = new Set();
  let total = 0;

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const src = SOURCES[i];
    if (r.status !== 'fulfilled') { console.error(`[${src.id}] error:`, r.reason?.message); continue; }
    let inserted = 0;
    for (const a of r.value) {
      const info = insert.run({ ...a, fetchedAt: now });
      if (info.changes) { inserted++; sourcesWithArticles.add(src.id); }
    }
    console.log(`[${src.id}] fetched=${r.value.length} new=${inserted}`);
    if (r.value.length > 0) sourcesWithArticles.add(src.id);
    total += r.value.length;
  }

  const rows = db.prepare('SELECT COUNT(*) as c FROM articles').get();
  const distinctSources = db.prepare('SELECT COUNT(DISTINCT source_id) as c FROM articles').get();
  console.log('\n=== T1 ACCEPTANCE CHECK ===');
  console.log('Total articles in DB:', rows.c);
  console.log('Sources with articles:', distinctSources.c, '(need ≥5)');
  console.log('T1 PASS:', rows.c >= 10 && distinctSources.c >= 5);

  // Start minimal HTTP server to serve /api/feed
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/feed' || req.url?.startsWith('/api/feed?')) {
      const articles = db.prepare('SELECT id,title,summary,image_url,url,source_id,source_name,category,country,published_at,is_breaking FROM articles ORDER BY published_at DESC LIMIT 50').all()
        .map(a => ({ id: a.id, title: a.title, summary: a.summary, imageUrl: a.image_url, url: a.url, sourceId: a.source_id, sourceName: a.source_name, category: a.category, country: a.country, publishedAt: a.published_at, isBreaking: !!a.is_breaking }));
      res.end(JSON.stringify({ data: articles, total: articles.length }));
    } else if (req.url === '/api/sources') {
      const srcs = db.prepare('SELECT DISTINCT source_id as id, source_name as name, country FROM articles').all();
      res.end(JSON.stringify({ data: srcs }));
    } else if (req.url?.startsWith('/api/articles/')) {
      const id = req.url.split('/')[3];
      const a = db.prepare('SELECT * FROM articles WHERE id=?').get(id);
      if (!a) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); }
      else res.end(JSON.stringify({ data: a }));
    } else if (req.url === '/health') {
      res.end(JSON.stringify({ ok: true }));
    } else {
      res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' }));
    }
  });
  server.listen(3001, () => console.log('\nServer on http://localhost:3001 (Ctrl+C to stop)'));
}

main().catch(err => { console.error(err); process.exit(1); });
