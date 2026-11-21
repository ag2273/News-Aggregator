import { describe, it } from 'vitest';
import { fetchArticleText } from '../articleText.js';


const SITES: Record<string, string> = {
  'الشرق الأوسط': 'aawsat.com', 'الشروق': 'shorouknews.com', 'الدستور': 'dostor.org',
  'الخليج': 'alkhaleej.ae', 'الوطن نيوز': 'elwatannews.com', 'فيتو': 'vetogate.com',
  'النهار': 'alnaharegypt.com', 'القدس العربي': 'alquds.co.uk', 'عكاظ': 'okaz.com.sa',
  'العربي الجديد': 'alaraby.co.uk', 'الوقت': 'alwaqt.com', 'عرب ٤٨': 'arab48.com',
  'الوطن': 'alwatan.com.sa', 'الأخبار': 'al-akhbar.com',
};
const UA = { 'User-Agent': 'news-aggregator/1.0 (+https://news.nileorbit.com)' };

async function feed(site: string, when: string): Promise<Array<{ title: string; url: string; date: number }>> {
  const u = `https://news.google.com/rss/search?q=site:${site}+${when}&hl=ar&gl=EG&ceid=EG:ar`;
  const res = await fetch(u, { headers: UA });
  const xml = await res.text();
  return xml.split('<item>').slice(1).map((item) => {
    const title = (item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:<!\[CDATA\[)?<\/title>/) ?? [])[1] ?? '';
    const link = (item.match(/<link>([^<]+)<\/link>/) ?? [])[1] ?? '';
    const pub = (item.match(/<pubDate>([^<]+)<\/pubDate>/) ?? [])[1] ?? '';
    return { title: title.replace(/<[^>]+>/g, '').trim(), url: link, date: pub ? Date.parse(pub) : 0 };
  });
}

describe('survey: real volume + full-text fetchability', () => {
  it('samples each candidate', async () => {
    console.log('name | items/24h(floor) | oldestHours | fullText');
    for (const [name, site] of Object.entries(SITES)) {
      const items = await feed(site, 'when:1d');
      const ages = items.map((i) => (Date.now() - i.date) / 3600000).filter((h) => h > 0);
      const span = ages.length ? Math.max(...ages) : 0;
      // fetch full text for up to 3
      let ok = 0;
      const sample = items.slice(0, 3);
      for (const s of sample) {
        try {
          let url = s.url;
          if (url.includes('news.google.com')) {
            const r = await fetch(url, { headers: UA });
            const html = await r.text();
            const sig = html.match(/data-n-a-sg="([^"]+)"/)?.[1];
            if (sig) {
              const id = html.match(/data-n-a-id="([^"]+)"/)?.[1] ?? '';
              const ts = html.match(/data-n-a-ts="([^"]+)"/)?.[1] ?? '';
              const inner = JSON.stringify(['garturlreq', [['X','X',['X','X'],null,null,1,1,'EG:ar',null,1,null,null,null,null,null,0,1],'X','X',1,[1,1,1],1,1,null,0,0,null,0], id, ts, sig]);
              const body = `f.req=${encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]]))}`;
              const rr = await fetch('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body,
              });
              const txt = await rr.text();
              const m = txt.match(/"garturlres","(.*?)"/) ?? txt.match(/\\"garturlres\\",\\"(.*?)\\"/);
              if (m) url = m[1].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/\\\//g, '/');
            }
          }
          const t = await fetchArticleText({ url, summary: s.title });
          if (t.source === 'full') ok += 1;
        } catch { /* count as failure */ }
      }
      console.log(`${name} | ${items.length} | ${span.toFixed(1)}h | ${ok}/${sample.length}`);
    }
  }, 900_000);
});
