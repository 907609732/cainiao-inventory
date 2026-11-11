import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
const moduleUrl = new URL('../desktop/local-web/client.mjs', import.meta.url);
const record = {pid:process.pid,origin:'http://127.0.0.1:17891',instanceId:'test-instance',ownerToken:randomBytes(32).toString('hex')};
async function fixture(t){const p=await mkdtemp(path.join(tmpdir(),'warehouse-client-'));t.after(()=>rm(p,{recursive:true,force:true}));return p;}
test('profile discovery round trips and only matching owner removes it',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);await c.writeDiscovery(p,record);assert.deepEqual(await c.readDiscovery(p),record);
 await c.removeDiscovery(p,'different');assert.deepEqual(await c.readDiscovery(p),record);await c.removeDiscovery(p,record.instanceId);assert.equal(await c.readDiscovery(p),null);
});
test('discovery rejects hostile origins weak credentials and oversized input',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);
 for(const origin of ['http://localhost:17891','http://127.0.0.1:17891/','https://127.0.0.1:17891','http://u:p@127.0.0.1:17891','http://127.0.0.1:0'])await assert.rejects(c.writeDiscovery(p,{...record,origin}));
 await assert.rejects(c.writeDiscovery(p,{...record,ownerToken:'weak'}));
 await mkdir(path.join(p,'workspace/state'),{recursive:true});await writeFile(path.join(p,'workspace/state/local-web.json'),' '.repeat(17000));await assert.rejects(c.readDiscovery(p));
});
test('discovery refuses symbolic link directories',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);const target=await fixture(t);await symlink(target,path.join(p,'workspace'),'junction');await assert.rejects(c.writeDiscovery(p,record));await assert.rejects(c.readDiscovery(p));
});
test('absent and dead owners return null without network requests',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);assert.equal(await c.connectLocalOwner({profile:p}),null);await c.writeDiscovery(p,record);
 assert.equal(await c.connectLocalOwner({profile:p,isAlive:()=>false,fetchImpl:()=>{throw Error('must not fetch');}}),null);
});
async function serve(t,handler){const s=http.createServer(handler);await new Promise(r=>s.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>s.close(r)));return `http://127.0.0.1:${s.address().port}`;}
test('foreign health never receives owner credentials',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);let count=0;const origin=await serve(t,(req,res)=>{count++;assert.equal(req.headers.authorization,undefined);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({brand:'foreign',protocol:1,instanceId:record.instanceId}));});await c.writeDiscovery(p,{...record,origin});await assert.rejects(c.connectLocalOwner({profile:p}));assert.equal(count,1);
});
test('health redirects cannot forward discovery credentials to another service',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);let forwarded=0;const target=await serve(t,(_req,res)=>{forwarded++;res.end('{}');});const origin=await serve(t,(req,res)=>{assert.equal(req.headers.authorization,undefined);res.writeHead(302,{Location:target+'/api/v1/health'});res.end();});await c.writeDiscovery(p,{...record,origin});await assert.rejects(c.connectLocalOwner({profile:p}));assert.equal(forwarded,0);
});
test('verified owner calls carry authentication and write idempotency then poll receipts',async t=>{
 const c=await import(moduleUrl);const p=await fixture(t);const seen=[];const origin=await serve(t,(req,res)=>{seen.push(req);res.setHeader('Content-Type','application/json');if(req.url==='/api/v1/health'){assert.equal(req.headers.authorization,undefined);res.end(JSON.stringify({brand:'cainiao-cloud-warehouse',protocol:1,instanceId:record.instanceId}));}else {assert.equal(req.headers.authorization,`Bearer ${record.ownerToken}`);res.end(JSON.stringify({ok:true,value:req.url.includes('/tasks/')?{status:'completed',value:42}:{taskId:'task-1'}}));}});await c.writeDiscovery(p,{...record,origin});const owner=await c.connectLocalOwner({profile:p});assert.deepEqual(await owner.call('sync',{confirm:true},{write:true}),{taskId:'task-1'});assert.match(seen[1].headers['idempotency-key'],/^[a-f0-9-]{36}$/);assert.equal(await owner.pollTask('task-1'),42);
});
