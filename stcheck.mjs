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
const failed=[];
ws.on('message',raw=>{const m=JSON.parse(raw.toString());
  if(m.method==='Network.responseReceived'&&m.params.response.status>=400) failed.push(m.params.response.url.slice(0,90)+' -> '+m.params.response.status);
  if(m.method==='Network.loadingFailed') failed.push('FAILED '+m.params.errorText);
});
await send('Emulation.setDeviceMetricsOverride',{width:360,height:740,deviceScaleFactor:2,mobile:true});
await send('Page.navigate',{url:'http://127.0.0.1:8081/matches/standings?t='+Date.now()});
for(let i=0;i<12;i++){
  await new Promise(r=>setTimeout(r,2000));
  const b=await js('document.body.innerText');
  const hasRows=/بيراميدز|الأهلي|أرسنال|برشلونة/.test(b||'');
  console.log(`t=${(i+1)*2}s rows=${hasRows} text=${JSON.stringify((b||'').slice(0,120))}`);
  if(hasRows) break;
}
console.log('FAILED_REQUESTS', JSON.stringify(failed.slice(0,5)));
const {data}=await send('Page.captureScreenshot',{format:'png'});
fs.writeFileSync('/tmp/st-live.png',Buffer.from(data,'base64'));
