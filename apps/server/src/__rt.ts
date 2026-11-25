import { readerArticle } from './readerService.js';
const urls = [
  'https://www.youm7.com/story/2026/11/24/الأهلي-يفوز/',
  'https://www.masrawy.com/sports',
];
for (const u of urls) {
  const r = await readerArticle(u);
  console.log(u, '=>', r.readable, r.reason ?? '', 'blocks', r.blocks.length, 'title', (r.title ?? '').slice(0,40));
  for (const b of r.blocks.slice(0,3)) console.log('   ', b.type, (b as any).text?.slice(0,60) ?? (b as any).url?.slice(0,60));
}
