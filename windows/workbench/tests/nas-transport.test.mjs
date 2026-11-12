import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('NAS direct browser access needs no password while CSRF and API credentials remain required',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');
 const root=await mkdtemp(join(tmpdir(),'nas-direct-'));
 const gateway=createNasGateway({runtime:{identity:{datasetId:'direct',version:'test'},dispatch:async()=>({ready:true})},root,browserPasswordRequired:false});
 await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});
 const initial=await fetch(gateway.address+'/api/v1/session');assert.equal(initial.status,200);
 const cookie=initial.headers.get('set-cookie').split(';')[0],{csrf}=await initial.json();assert.ok(csrf);
 const call=(base,headers)=>fetch(base+'/api/v1/call/getInventory',{method:'POST',headers:{'content-type':'application/json',...headers},body:'{}'});
 assert.equal((await call(gateway.address,{cookie,'x-csrf-token':csrf})).status,200);
 assert.equal((await call(gateway.address,{cookie})).status,403);
 assert.equal((await call(gateway.address,{cookie,'x-csrf-token':csrf,origin:'https://evil.invalid'})).status,403);
 assert.equal((await call(gateway.apiAddress,{})).status,401);
 const reader=await gateway.credentials.create();assert.equal((await call(gateway.apiAddress,{authorization:'Bearer '+reader.token})).status,200);
 assert.equal((await fetch(gateway.address+'/login',{redirect:'manual'})).headers.get('location'),'/');
 assert.equal(JSON.parse(await readFile(join(root,'nas-auth.json'),'utf8')).password,undefined);
});

test('NAS gateway protects browser, scopes service tasks and persists credential revocation',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');
 const root=await mkdtemp(join(tmpdir(),'nas-http-'));let calls=0;
 const runtime={identity:{datasetId:'dataset-1',version:'test'},dispatch:async()=>({count:++calls})};
 let gateway=createNasGateway({runtime,root,adminPassword:'test-password-long',port:0,apiPort:0});await gateway.start();
 t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});
 const health=await (await fetch(gateway.apiAddress+'/api/v1/health')).json();assert.equal(health.datasetId,'dataset-1');assert.equal(health.protocol,1);
 assert.equal((await fetch(gateway.address+'/',{redirect:'manual'})).status,302);
 const login=await fetch(gateway.address+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json',origin:gateway.address},body:JSON.stringify({password:'test-password-long'})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();assert.ok(csrf);
 const call=(base,op,headers={},body={})=>fetch(base+'/api/v1/call/'+op,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await call(gateway.address,'runNow',{cookie,'idempotency-key':'a'})).status,403);
 assert.equal((await call(gateway.address,'getInventory',{cookie,origin:'https://evil.invalid'})).status,403);
 const reader=await gateway.credentials.create();
 assert.equal((await call(gateway.apiAddress,'runNow',{authorization:'Bearer '+reader.token,'idempotency-key':'r'},{confirmed:true})).status,403);
 assert.equal((await call(gateway.apiAddress,'previewDateException',{authorization:'Bearer '+reader.token})).status,403);
 const writer=await gateway.credentials.create({write:true}),other=await gateway.credentials.create({write:true});
 const headers={authorization:'Bearer '+writer.token,'idempotency-key':'one'};
 const receipt=await (await call(gateway.apiAddress,'runNow',headers,{confirmed:true})).json();assert.ok(receipt.value.taskId);
 assert.equal((await fetch(gateway.apiAddress+'/api/v1/tasks/'+receipt.value.taskId,{headers:{authorization:'Bearer '+other.token}})).status,404);
 await gateway.stop();gateway=createNasGateway({runtime,root,adminPassword:'test-password-long',port:0,apiPort:0});await gateway.start();
 assert.equal((await call(gateway.apiAddress,'runNow',headers,{confirmed:true})).status,200);assert.equal(calls,1);
 const rotated=await gateway.credentials.rotate(writer.id);assert.ok(rotated.token);
 assert.equal((await call(gateway.apiAddress,'getInventory',{authorization:'Bearer '+writer.token})).status,401);
 await gateway.credentials.revoke(rotated.id);assert.equal((await call(gateway.apiAddress,'getInventory',{authorization:'Bearer '+rotated.token})).status,401);
 assert.ok(!(await readFile(join(root,'nas-auth.json'),'utf8')).includes(reader.token));
});

test('NAS browser visual endpoint cannot bypass cookie or same-origin websocket checks',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-vnc-'));
 const gateway=createNasGateway({runtime:{identity:{datasetId:'d',version:'t'},dispatch:async()=>null},root,adminPassword:'long-test-password',browserUrl:'http://127.0.0.1:1'});await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});
 assert.equal((await fetch(gateway.address+'/browser/vnc.html',{redirect:'manual'})).status,302);
 const {WebSocket}=await import('ws');
 const rejected=await new Promise(resolve=>{const ws=new WebSocket(gateway.address.replace('http:','ws:')+'/browser/websockify',{origin:'https://evil.invalid'});ws.on('unexpected-response',(_,r)=>{resolve(r.statusCode);r.resume();ws.terminate();});ws.on('error',()=>{});});assert.equal(rejected,403);
});

test('NAS authenticated visual HTTP and websocket traffic reaches private browser only',async t=>{
 const http=await import('node:http');const {WebSocketServer,WebSocket}=await import('ws');const backend=http.createServer((req,res)=>res.end('visual:'+req.url));const wss=new WebSocketServer({server:backend});wss.on('connection',ws=>ws.on('message',data=>ws.send(data)));await new Promise(r=>backend.listen(0,'127.0.0.1',r));
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-vnc-ok-'));const gateway=createNasGateway({runtime:{identity:{datasetId:'d',version:'t'},dispatch:async()=>null},root,adminPassword:'long-test-password',browserUrl:'http://127.0.0.1:'+backend.address().port});await gateway.start();t.after(async()=>{await gateway.stop();wss.close();await new Promise(r=>backend.close(r));await rm(root,{recursive:true,force:true});});
 const login=await fetch(gateway.address+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'long-test-password'})});const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.equal(await (await fetch(gateway.address+'/browser/vnc.html',{headers:{cookie}})).text(),'visual:/vnc.html');
 const value=await new Promise((resolve,reject)=>{const ws=new WebSocket(gateway.address.replace('http:','ws:')+'/browser/websockify',{headers:{cookie},origin:gateway.address});ws.on('open',()=>ws.send('echo'));ws.on('message',data=>{resolve(data.toString());ws.close();});ws.on('error',reject);});assert.equal(value,'echo');
});

test('NAS public bind and browser upstream require explicit safe boundaries',async()=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const runtime={identity:{datasetId:'d'}};
 assert.throws(()=>createNasGateway({runtime,root:tmpdir(),host:'0.0.0.0'}),/origin/);
 assert.throws(()=>createNasGateway({runtime,root:tmpdir(),browserUrl:'http://example.com'}),/loopback/);
});

test('NAS API wildcard bind accepts only advertised loopback host',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-host-'));const gateway=createNasGateway({runtime:{identity:{datasetId:'d',version:'t'},dispatch:async()=>null},root,adminPassword:'long-test-password',apiHost:'0.0.0.0'});await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});assert.match(gateway.apiAddress,/127\.0\.0\.1/);assert.equal((await fetch(gateway.apiAddress+'/api/v1/health')).status,200);assert.equal(await new Promise(async resolve=>{const http=await import('node:http');http.get(gateway.apiAddress+'/api/v1/health',{headers:{host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);});}),403);
});


test('private CLI owner is not exposed or obtainable through browser credential creation',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-owner-'));const gateway=createNasGateway({runtime:{identity:{datasetId:'d',version:'t'},dispatch:async(name,payload,context)=>({name,context})},root,adminPassword:'long-test-password'});await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});
 const owner=await gateway.credentials.createLocalOwner();assert.deepEqual(await gateway.credentials.list(),[]);
 const call=(base,name,headers,payload)=>fetch(base+'/api/v1/call/'+name,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)});
 const result=await (await call(gateway.apiAddress,'executeCli',{authorization:'Bearer '+owner.token},{request:{command:'status'}})).json();assert.equal(result.value.context.kind,'owner');
 const reader=await gateway.credentials.create();assert.equal((await call(gateway.apiAddress,'executeCli',{authorization:'Bearer '+reader.token},{request:{command:'status'}})).status,403);
 const login=await fetch(gateway.address+'/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'long-test-password'})});const cookie=login.headers.get('set-cookie').split(';')[0],{csrf}=await login.json();assert.equal((await call(gateway.address,'createAiCredential',{cookie,'x-csrf-token':csrf,'idempotency-key':'owner-injection'},{write:true,owner:true})).status,400);
});

test('eye reveals only the selected field to CSRF-protected browser, never service credentials or disk receipts',async t=>{
 const {createNasRuntime}=await import('../nas/runtime.mjs');const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-eye-'));const runtime=await createNasRuntime({dataDir:root});await runtime.dispatch('saveSettingsSection',{section:'account',settings:{cainiaoUsername:'DEMO'},secrets:{cainiaoPassword:'eye-fixture-secret'}});const gateway=createNasGateway({runtime,root,browserPasswordRequired:false});await gateway.start();t.after(async()=>{await gateway.stop();await runtime.close();await rm(root,{recursive:true,force:true});});
 const initial=await fetch(gateway.address+'/api/v1/session');const cookie=initial.headers.get('set-cookie').split(';')[0],{csrf}=await initial.json();
 const reveal=(base,headers,field='cainiaoPassword')=>fetch(base+'/api/v1/call/revealSecret',{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify({field})});
 const shown=await reveal(gateway.address,{cookie,'x-csrf-token':csrf});assert.equal(shown.status,200);assert.deepEqual(await shown.json(),{ok:true,value:{value:'eye-fixture-secret'}});
 assert.equal((await reveal(gateway.address,{cookie})).status,403);
 assert.equal((await reveal(gateway.address,{cookie,'x-csrf-token':csrf},'../master.key')).status,400);
 const reader=await gateway.credentials.create({write:true});assert.equal((await reveal(gateway.apiAddress,{authorization:'Bearer '+reader.token})).status,403);
 const {readdir}=await import('node:fs/promises');for(const f of await readdir(join(root,'local-web-tasks')))assert.ok(!(await readFile(join(root,'local-web-tasks',f),'utf8')).includes('eye-fixture-secret'));
});

test('NAS configured fnOS origin works without accepting arbitrary hosts or cross-origin calls',async t=>{
 const {createNasGateway}=await import('../nas/server/gateway.mjs');const root=await mkdtemp(join(tmpdir(),'nas-alias-'));const alias='https://warehouse.example.test';const gateway=createNasGateway({runtime:{identity:{datasetId:'d',version:'t'},dispatch:async()=>({ready:true})},root,browserPasswordRequired:false,additionalOrigins:[alias]});await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});
 const http=await import('node:http');const request=(path,headers={},body)=>new Promise((resolve,reject)=>{const req=http.request(gateway.address+path,{method:body?'POST':'GET',headers:{host:'warehouse.example.test',...headers}},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,text}));});req.on('error',reject);req.end(body);});
 const session=await request('/api/v1/session');assert.equal(session.status,200);assert.match(session.headers['set-cookie'][0],/Secure/);const cookie=session.headers['set-cookie'][0].split(';')[0],csrf=JSON.parse(session.text).csrf;
 const result=await request('/api/v1/call/getLocalAccess',{'content-type':'application/json',cookie,'x-csrf-token':csrf,origin:alias},'{}');assert.equal(result.status,200);assert.equal(JSON.parse(result.text).value.origin,alias);
 assert.equal((await request('/api/v1/session',{host:'evil.invalid'})).status,403);
 assert.equal((await request('/api/v1/session',{origin:gateway.address})).status,403);
 assert.equal((await fetch(gateway.address+'/api/v1/health')).status,200);
});
