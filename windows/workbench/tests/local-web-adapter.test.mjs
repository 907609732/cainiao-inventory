import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../desktop/renderer/web-adapter.js',import.meta.url),'utf8');
function fixture({hash='',existing,fail=false,events=[],taskStatuses}={}){
 const calls=[],timers=[],banners=[];let counter=0;
 const window={inventoryApp:existing,location:{hash,pathname:'/renderer/index.html',search:''},history:{replaceState(...args){calls.push(['history',...args]);}},crypto:{randomUUID:()=>`request-${++counter}`},addEventListener(){}};
 const document={readyState:'complete',getElementById:()=>null,createElement:()=>({setAttribute(){},textContent:'',hidden:false}),body:{prepend(el){banners.push(el);}},addEventListener(){}};
 const fetch=async(url,options={})=>{calls.push([url,options]);if(fail)throw Error('offline');if(taskStatuses && (url.endsWith('/sendDateException') || url.includes('/tasks/'))) return {ok:true,json:async()=>({ok:true,value:url.includes('/tasks/')?taskStatuses.shift():{taskId:'receipt-1',status:'running'}})};return {ok:true,json:async()=>url.includes('/session')?{csrf:'csrf-test'}:url.includes('/events')?{cursor:7,events}:{ok:true,value:{operation:url}}};};
 vm.runInNewContext(source,{window,document,location:window.location,history:window.history,crypto:window.crypto,URLSearchParams,fetch,setTimeout:fn=>timers.push(fn),clearTimeout(){},console});
 return {window,calls,timers,banners};
}
test('desktop preload remains untouched',()=>{const existing={desktop:true};const f=fixture({existing});assert.equal(f.window.inventoryApp,existing);assert.equal(f.calls.length,0);});
test('fragment exchanges immediately and methods synchronously await session',async()=>{const f=fixture({hash:'#token=once'});assert.ok(f.window.inventoryApp);await f.window.inventoryApp.runNow();assert.equal(f.calls[0][0],'history');assert.equal(f.calls[1][1].method,'POST');assert.deepEqual(JSON.parse(f.calls[1][1].body),{token:'once'});const c=f.calls.find(c=>c[0].endsWith?.('/runNow'));assert.equal(c[1].headers['x-csrf-token'],'csrf-test');assert.equal(JSON.parse(c[1].body).confirmed,true);assert.ok(c[1].headers['Idempotency-Key']);});
test('reload resumes cookie; secrets never requested and blanks preserve proxy',async()=>{const f=fixture();assert.deepEqual(Object.keys(await f.window.inventoryApp.getEditableSecrets()),[]);await f.window.inventoryApp.saveSettingsSection({section:'robot',secrets:{telegramProxyUrl:'',emailPassword:'new'}});assert.equal(f.calls.find(c=>c[0]==='/api/v1/session')[1].method,'GET');const c=f.calls.find(c=>c[0].endsWith?.('/saveSettingsSection'));assert.deepEqual(JSON.parse(c[1].body).secrets,{emailPassword:'new'});});
test('events deliver callbacks and schedule polling',async()=>{const f=fixture({events:[{type:'inventory:state',data:{running:true}}]});let value;f.window.inventoryApp.onState(v=>value=v);await f.window.inventoryApp.getState();await new Promise(r=>setImmediate(r));assert.equal(value.running,true);assert.ok(f.timers.length);});
test('offline startup rejects with visible recovery guidance and never retries writes',async()=>{const f=fixture({fail:true});await assert.rejects(f.window.inventoryApp.runNow(),/offline/);await new Promise(r=>setImmediate(r));assert.match(f.banners[0].textContent,/重新|打开/);assert.equal(f.calls.filter(c=>String(c[0]).includes('/runNow')).length,0);});

test('browser exposes every preload method and credential controls',async()=>{
 const f=fixture();
 const preload=await readFile(new URL('../desktop/preload.cjs',import.meta.url),'utf8');
 for(const match of preload.matchAll(/^  (\w+):/gm)) assert.equal(typeof f.window.inventoryApp[match[1]],'function',match[1]);
 for(const name of ['getLocalAccess','createAiCredential','revokeAiCredential','openWeb']) assert.equal(typeof f.window.inventoryApp[name],'function');
});
test('explicit secret clears are retained; each user action has a distinct idempotency key',async()=>{
 const f=fixture();
 await f.window.inventoryApp.saveSettingsSection({section:'robot',secrets:{telegramProxyUrl:''},clearSecrets:['telegramProxyUrl']});
 await f.window.inventoryApp.runNow();await f.window.inventoryApp.runNow();
 const saves=f.calls.find(c=>String(c[0]).endsWith('/saveSettingsSection'));
 assert.deepEqual(JSON.parse(saves[1].body).clearSecrets,['telegramProxyUrl']);
 const runs=f.calls.filter(c=>String(c[0]).endsWith('/runNow'));
 assert.notEqual(runs[0][1].headers['Idempotency-Key'],runs[1][1].headers['Idempotency-Key']);
});
test('the same renderer supplies all four browser views and loads adapter first',async()=>{
 const html=await readFile(new URL('../desktop/renderer/index.html',import.meta.url),'utf8');
 for(const view of ['dashboard','inventory','sales','settings']) assert.ok(html.includes(`data-view-panel="${view}"`));
 assert.ok(html.indexOf('src="web-adapter.js"')<html.indexOf('src="renderer.js"'));
 assert.ok(html.includes("connect-src 'self'"));
});

for (const outcome of ['succeeded','failed','unknown']) test(`task receipt ${outcome} is observed without repeating the write`,async()=>{
 const statuses=[{taskId:'receipt-1',status:'running'},{taskId:'receipt-1',status:outcome,value:{accepted:true},error:{code:'TASK_FAILED',message:'delivery rejected'}}];
 const f=fixture({taskStatuses:statuses});
 const pending=f.window.inventoryApp.sendDateException({token:'confirmation',confirmed:true});
 const result=pending.then(value=>({value}),error=>({error}));
 for(let i=0;i<6 && statuses.length;i++){await new Promise(r=>setImmediate(r));f.timers.splice(0).forEach(fn=>fn());}
 const resolved=await result;
 if(outcome==='succeeded') assert.equal(resolved.value.accepted,true);
 else assert.match(resolved.error.message,outcome==='failed'?/delivery rejected/:/receipt-1/);
 assert.equal(f.calls.filter(c=>String(c[0]).endsWith('/sendDateException')).length,1);
 assert.equal(f.calls.filter(c=>String(c[0]).includes('/tasks/')).length,2);
});
