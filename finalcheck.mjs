import wsPkg from 'ws';
import fs from 'node:fs';
const WebSocket = wsPkg.WebSocket ?? wsPkg.default ?? wsPkg;
const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
const page = list.find(t=>t.type==='page');
const ws = await new Promise((r,j)=>{const w=new WebSocket(page.webSocketDebuggerUrl,{maxPayload:1<<26});w.on('open',()=>r(w));w.on('error',j);});
let id=0;
const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;const h=raw=>{const x=JSON.parse(raw.toString());if(x.id!==i)return;ws.off('message',h);x.error?rej(new Error(x.error.message)):res(x.result);};ws.on('message',h);ws.send(JSON.stringify({id:i,method:m,params:p}));});
const js=async e=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true});return r.result?.value;};
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
await send('Network.setCacheDisabled',{cacheDisabled:true});
await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:2,mobile:true});

// matches list
await send('Page.navigate',{url:'http://127.0.0.1:8081/matches?t='+Date.now()});
await new Promise(r=>setTimeout(r,12000));
const listBody=await js('document.body.innerText');
const strips=await js(`
(()=>{const o={};for(const n of document.querySelectorAll('div')){if(n.children.length)continue;const t=n.textContent.trim();
if(t.startsWith('اليوم ٢٢')||t==='الكل'||t.includes('مباشر (')){const r=n.getBoundingClientRect();o[t.slice(0,10)]={h:Math.round(r.height)}}}return o})()`);
console.log('STRIP_HEIGHTS',JSON.stringify(strips));
console.log('CHANNEL_LABEL_ON_CARD', /تُنقل على/.test(listBody));
console.log('ROUND_DOT_CHANNEL_LEAK', /الجولة[^\\n]*·[^\\n]*الكأس/.test(listBody));
const s1=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('/tmp/f-list.png',Buffer.from(s1.data,'base64'));

// empty favourites filter
await js(`(()=>{const el=[...document.querySelectorAll('div,span')].find(n=>n.textContent.trim()==='الفرق المتابعة'&&n.children.length===0);if(el)el.click()})()`);
await new Promise(r=>setTimeout(r,1800));
const empty=await js('document.body.innerText');
console.log('FAV_EMPTY_MSG', JSON.stringify((empty.split('\n').find(l=>l.includes('فرقك المفضلة'))||'MISSING')));
const s2=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('/tmp/f-empty.png',Buffer.from(s2.data,'base64'));
