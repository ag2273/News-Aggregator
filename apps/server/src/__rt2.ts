import { readerArticle } from './readerService.js';
const urls = [
  'https://www.skynewsarabia.com/middle-east/1906906-%D8%A7%D9%84%D8%A5%D8%B9%D9%84%D8%A7%D9%86-%D8%A3%D9%88%D9%84-%D8%A7%D8%AA%D9%81%D8%A7%D9%82-%D8%A7%D8%A6%D8%AA%D9%84%D8%A7%D9%81%D9%8A-%D9%84%D8%AA%D8%B4%D9%83%D9%8A%D9%84-%D8%AD%D9%83%D9%88%D9%85%D8%A9-%D8%A5%D8%B3%D8%B1%D8%A7%D8%A6%D9%8A%D9%84%D9%8A%D8%A9-%D8%AC%D8%AF%D9%8A%D8%AF%D8%A9',
  'https://rtarabic.com/features/1857165-rt-%D8%AA%D8%AF%D8%AE%D9%80%D9%84-%D9%85%D9%8A%D9%86%D9%80%D8%A7%D8%A1-%D8%A8%D9%86%D8%BA%D9%80%D8%A7%D8%B2%D9%8A/',
  'https://news.google.com/rss/articles/CBMiX0FVX3lxTE9ybWVuX3dWUlJqT3Zjbi1PTVVYY3I0SDVNQTRMaldIWDMxR1Nzbk13aXlXMzBWSXFxRU5ESDh5QXE4bGRRaXg5WTV1Smg4aU5zMExmTmZvS2V4ZWxsRDNN?oc=5',
];
for (const u of urls) {
  const r = await readerArticle(u);
  const types = r.blocks.reduce((m:any,b)=>(m[b.type]=(m[b.type]??0)+1,m),{});
  console.log(u.slice(0,50), '=> readable', r.readable, r.reason??'', JSON.stringify(types), '| title:', (r.title??'').slice(0,50));
  for (const b of r.blocks.filter(b=>b.type==='paragraph').slice(0,2)) console.log('    P:', (b as any).text.slice(0,90));
  for (const b of r.blocks.filter(b=>b.type==='video')) console.log('    V:', (b as any).url.slice(0,70));
}
