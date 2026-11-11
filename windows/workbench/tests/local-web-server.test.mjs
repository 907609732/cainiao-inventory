import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readdir,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createLocalWebServer} from '../desktop/local-web/server.mjs';

test('local transport confines assets, authenticates sessions, blocks cross-site and deduplicates writes', async t=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-http-')); let count=0;
 await writeFile(join(dir,'index.html'),'<h1>fixture</h1>');
 const server=createLocalWebServer({version:'test',port:0,instanceId:'test',ownerToken:'owner',stateDir:dir,assets:{'/':join(dir,'index.html')},verifyBearer:async token=>token==='read'?{id:'reader',write:false}:token==='write'?{id:'writer',write:true}:null,dispatch:async (op,p,ctx)=>{if(op==='getLogs')throw Error('SECRET');if(op==='runNow'){count++;return {count};}return {op,ctx};}});
 const origin=await server.start(); t.after(async()=>{await server.stop();await rm(dir,{recursive:true,force:true});});
 const call=(path,options={})=>fetch(origin+path,options);
 assert.equal((await call('/')).status,200); assert.equal((await call('/index.html')).status,404);
 assert.equal(await new Promise(resolve=>http.get(origin+'/api/v1/health',{headers:{host:'evil.invalid'}},r=>{r.resume();resolve(r.statusCode);})),403);
 assert.equal((await call('/api/v1/call/getState',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,401);
 const token=new URL(server.openUrl()).hash.slice(1).replace(/^token=/,'');
 const session=await call('/api/v1/session',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify({token})});
 const cookie=session.headers.get('set-cookie').split(';')[0];const {csrf}=await session.json();
 assert.match(session.headers.get('set-cookie'),/HttpOnly/); assert.equal((await call('/api/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})})).status,401);
 assert.equal((await call('/api/v1/session',{headers:{cookie}})).status,200);
 const req=(op,body={},headers={})=>call('/api/v1/call/'+op,{method:'POST',headers:{'content-type':'application/json',cookie,...headers},body:JSON.stringify(body)});
 assert.equal((await req('runNow',{}, {'idempotency-key':'one'})).status,403);
 assert.equal((await req('getState',{}, {origin:'https://evil.invalid'})).status,403);
 assert.equal((await req('runNow',{confirmed:true},{authorization:'Bearer read','idempotency-key':'read'})).status,403);
 assert.equal((await req('runNow',{}, {authorization:'Bearer write','idempotency-key':'write'})).status,403);
 const headers={'x-csrf-token':csrf,'idempotency-key':'one'};
 const first=await (await req('runNow',{},headers)).json(); const second=await (await req('runNow',{},headers)).json();
 assert.deepEqual(second,first);assert.equal(count,1);
 assert.equal((await req('runNow',{confirmed:false},headers)).status,409);
 assert.equal((await req('runNow',{unexpected:true},headers)).status,400);
 assert.deepEqual((await (await req('getEditableSecrets')).json()).value,{});
 assert.equal((await req('getEditableSecrets',{}, {authorization:'Bearer read'})).status,403);
 assert.doesNotMatch(await (await req('getLogs')).text(),/SECRET/);
 server.publish('state',{running:true}); assert.equal((await (await call('/api/v1/events?after=0',{headers:{cookie}})).json()).events.length,1);
});

test('durable receipts survive restart and date previews belong to one identity',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-receipts-'));let calls=0;
 const options={version:'test',port:0,stateDir:dir,ownerToken:'owner',verifyBearer:async id=>({id,write:true}),dispatch:async op=>op==='previewDateException'?{token:'preview'}:(calls++,{sent:true})};
 let server=createLocalWebServer(options);let origin=await server.start();
 t.after(async()=>{await server.stop();await rm(dir,{recursive:true,force:true});});
 const call=async(op,payload,key,identity='one')=>fetch(origin+'/api/v1/call/'+op,{method:'POST',headers:{authorization:'Bearer '+identity,'content-type':'application/json',...(key?{'idempotency-key':key}:{})},body:JSON.stringify(payload)});
 assert.equal((await call('previewDateException',{})).status,200);
 assert.equal((await call('sendDateException',{token:'preview',confirmed:true},'date','two')).status,403);
 const started=await (await call('sendDateException',{token:'preview',confirmed:true},'durable')).json();
 await new Promise(resolve=>setTimeout(resolve,50));await server.stop();
 server=createLocalWebServer(options);origin=await server.start();
 assert.deepEqual(await (await call('sendDateException',{token:'preview',confirmed:true},'durable')).json(),started);assert.equal(calls,1);
 assert.equal((await call('sendDateException',{token:'preview',confirmed:true},'new-request')).status,403);
 const task=await (await fetch(origin+'/api/v1/tasks/'+started.value.taskId,{headers:{authorization:'Bearer one'}})).json();
 assert.equal(task.value.status,'succeeded');
 assert.equal((await fetch(origin+'/api/v1/tasks/'+started.value.taskId,{headers:{authorization:'Bearer two'}})).status,404);
});

test('owner CLI queries return directly without storing result snapshots',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-query-'));
 const server=createLocalWebServer({version:'test',port:0,stateDir:dir,ownerToken:'owner',dispatch:async()=>({inventory:'PRIVATE_QUERY_RESULT'})});
 const origin=await server.start();t.after(async()=>{await server.stop();await rm(dir,{recursive:true,force:true});});
 for(const command of ['inventory','sales','status','capabilities','doctor','logs','debug-logs','extensions']){
  const result=await fetch(origin+'/api/v1/call/executeCli',{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json'},body:JSON.stringify({request:{command}})});
  assert.equal(result.status,200);assert.equal((await result.json()).value.inventory,'PRIVATE_QUERY_RESULT');
 }
 assert.deepEqual(await readdir(join(dir,'local-web-tasks')),[]);
});

test('business failure DTOs produce failed task receipts',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-failure-'));
 const server=createLocalWebServer({version:'test',port:0,stateDir:dir,ownerToken:'owner',dispatch:async(op,payload)=>payload.request.result});
 const origin=await server.start();t.after(async()=>{await server.stop();await rm(dir,{recursive:true,force:true});});
 for(const [index,result] of [{success:false},{ok:false}].entries()){
  const start=await (await fetch(origin+'/api/v1/call/executeCli',{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json','idempotency-key':'failure-'+index},body:JSON.stringify({request:{command:'sync',result}})})).json();
  let task;for(let attempt=0;attempt<50;attempt++){task=await (await fetch(origin+'/api/v1/tasks/'+start.value.taskId,{headers:{authorization:'Bearer owner'}})).json();if(task.value.status!=='running')break;await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(task.value.status,'failed');assert.equal(task.value.error.code,'TASK_FAILED');
 }
});

test('one-time AI credentials never enter durable receipt files',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'warehouse-secret-'));
 const options={version:'test',port:0,stateDir:dir,ownerToken:'owner',dispatch:async()=>({token:'CREDENTIAL_SECRET',id:'credential'})};
 let server=createLocalWebServer(options);let origin=await server.start();
 t.after(async()=>{await server.stop();await rm(dir,{recursive:true,force:true});});
 const call=()=>fetch(origin+'/api/v1/call/createAiCredential',{method:'POST',headers:{authorization:'Bearer owner','content-type':'application/json','idempotency-key':'create'},body:'{"write":false,"confirmed":true}'});
 assert.equal((await (await call()).json()).value.token,'CREDENTIAL_SECRET');
 await server.stop();
 for(const file of await readdir(join(dir,'local-web-tasks')))assert.doesNotMatch(await readFile(join(dir,'local-web-tasks',file),'utf8'),/CREDENTIAL_SECRET/);
 server=createLocalWebServer(options);origin=await server.start();
 assert.equal((await (await call()).json()).value.status,'unknown');
});
