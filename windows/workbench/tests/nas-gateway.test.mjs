import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {mkdtemp,rm,writeFile,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket,WebSocketServer} from 'ws';
import {createNasGateway,gatewayOrigin,gatewayIdentity} from '../nas/server/gateway.mjs';

const prefix='/app/cainiao-warehouse';
const origin='https://nas.example.test';
const admin={'x-trim-userid':'1000','x-trim-isadmin':'true','x-trim-username':'admin'};
const socketPath=(dir,name='app.sock')=>process.platform==='win32'?`\\\\.\\pipe\\cainiao-gateway-${process.pid}-${Date.now()}-${name}`:join(dir,name);

function request(socket,path,{method='GET',headers={},body}={}){
 const payload=body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body);
 return new Promise((resolve,reject)=>{
  const req=http.request({socketPath:socket,path,method,headers:{host:'nas.example.test',...headers,...(payload!==undefined?{'content-length':Buffer.byteLength(payload)}:{})}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,text:Buffer.concat(chunks).toString('utf8')}));});
  req.on('error',reject);if(payload!==undefined)req.write(payload);req.end();
 });
}
const json=result=>JSON.parse(result.text);
test('all authenticated fnOS users can access the shared warehouse',()=>{
 for(const flag of ['true','false',undefined]){
  const identity=gatewayIdentity({'x-trim-userid':'2001','x-trim-username':'member',...(flag?{'x-trim-isadmin':flag}:{})});
  assert.equal(identity.uid,'2001');assert.equal(identity.isAdmin,flag==='true');
 }
 assert.throws(()=>gatewayIdentity({'x-trim-isadmin':'false'}));
});
test('configured FN Connect origin survives upstream Host rewriting',()=>{
 const headers={host:'localhost',origin:'https://nas.example.test'};
 assert.throws(()=>gatewayOrigin({headers}));
 assert.equal(gatewayOrigin({headers},['https://nas.example.test']).expected,'https://nas.example.test');
 assert.throws(()=>gatewayOrigin({headers:{...headers,origin:'https://evil.invalid'}},['https://nas.example.test']));
 assert.throws(()=>gatewayOrigin({headers:{...headers,origin:'null'}},['https://nas.example.test']));
});
test('fnOS strips Host port while preserving external Origin and forwarded protocol',()=>{
 for(const origin of ['http://192.168.1.100:5666','https://nas.example.test:7443']){
  const url=new URL(origin),headers={host:url.hostname,origin,'x-forwarded-proto':url.protocol.slice(0,-1)};
  assert.equal(gatewayOrigin({headers}).expected,origin);
  assert.throws(()=>gatewayOrigin({headers:{...headers,origin:'https://evil.invalid'}}));
  assert.throws(()=>gatewayOrigin({headers:{...headers,origin:'null'}}));
  assert.equal(gatewayOrigin({headers:{...headers,'x-forwarded-proto':'http'}}).expected,origin);
  assert.throws(()=>gatewayOrigin({headers:{...headers,host:url.hostname+':9999'}}));
 }
});
function websocketConnect(socket,path,{headers={},origin:requestOrigin,timeout=5000}={}){
 return new Promise((resolve,reject)=>{
  const websocket=new WebSocket('ws://nas.example.test'+path,{createConnection:()=>net.connect(socket),origin:requestOrigin,headers});let settled=false;
  const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);resolve(value);};
  const timer=setTimeout(()=>{if(settled)return;settled=true;websocket.terminate();reject(Error('websocket timeout'));},timeout);
  websocket.once('open',()=>finish({status:101,websocket}));
  websocket.once('unexpected-response',(req,response)=>{response.resume();websocket.terminate();finish({status:response.statusCode});});
  websocket.once('error',error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error);});
 });
}
function websocketMessage(websocket,timeout=5000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{websocket.terminate();reject(Error('websocket message timeout'));},timeout);websocket.once('message',data=>{clearTimeout(timer);resolve(data.toString());});websocket.once('error',error=>{clearTimeout(timer);reject(error);});});}

test('fnOS gateway serves the same UI/API under its prefix and rejects untrusted identity',{timeout:30000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'nas-gateway-prefix-')),socket=socketPath(root);
 const runtime={identity:{datasetId:'gateway-dataset',version:'test'},dispatch:async(name,payload,context)=>({name,context})};
 const gateway=createNasGateway({runtime,root,port:0,apiPort:0,browserPasswordRequired:false,gatewayPrefix:prefix,gatewaySocket:socket});
 await gateway.start();t.after(async()=>{await gateway.stop();await rm(root,{recursive:true,force:true});});

 const page=await request(socket,prefix,{headers:admin});
 assert.equal(page.status,200);
 assert.match(page.text,new RegExp(`<base href="${prefix}/">`));
 assert.match(page.text,/src="gateway-bootstrap.js"/);
 assert.match(page.text,/src="nas-ui-adapter.js"/);
 assert.ok(page.text.indexOf('gateway-bootstrap.js')<page.text.indexOf('nas-ui-adapter.js'));
 assert.ok(page.text.indexOf('nas-ui-adapter.js')<page.text.indexOf('src="web-adapter.js"'));
 assert.match(page.text,/href="assets\/lingtu-icon\.png"/);
 assert.match(page.text,/src="node_modules\/gridjs\/dist\/gridjs\.production\.min\.js"/);
 assert.match(page.text,/src="shared\/loading-screen-auto\.mjs"/);
 assert.doesNotMatch(page.text,/href="\.\.\/assets|href="\.\.\/\.\.\/node_modules|src="\.\.\/shared/);

 const bootstrap=await request(socket,prefix+'/gateway-bootstrap.js',{headers:admin});
 assert.equal(bootstrap.status,200);
 assert.equal(bootstrap.text.trim(),`window.__CAINIAO_GATEWAY_PREFIX__=${JSON.stringify(prefix)};`);
 const css=await request(socket,prefix+'/styles.css',{headers:admin});
 assert.equal(css.status,200);
 assert.match(css.headers['content-type'],/text\/css/);

 const session=await request(socket,prefix+'/api/v1/session',{headers:{...admin,origin}});
 assert.equal(session.status,200);
 const cookie=session.headers['set-cookie'][0].split(';')[0];
 assert.match(session.headers['set-cookie'][0],/HttpOnly/);
 assert.match(session.headers['set-cookie'][0],/Secure/);
 assert.match(session.headers['set-cookie'][0],new RegExp(`Path=${prefix}`));
 const {csrf}=json(session);assert.ok(csrf);

 const explicit443=await request(socket,prefix+'/api/v1/session',{headers:{...admin,host:'nas.example.test:443',origin}});
 assert.equal(explicit443.status,200);assert.match(explicit443.headers['set-cookie'][0],/Secure/);

 const events=await request(socket,prefix+'/api/v1/events?after=0',{headers:{...admin,cookie,origin}});
 assert.equal(events.status,200);assert.ok(Array.isArray(json(events).events));

 const call=await request(socket,prefix+'/api/v1/call/getInventory',{method:'POST',headers:{...admin,cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':'gateway-one'},body:{}});
 assert.equal(call.status,200);
 const value=json(call).value;
 assert.equal(value.context.kind,'browser');
 assert.equal(value.context.id,'gateway:1000');
 assert.equal(value.context.write,true);
 assert.equal(value.context.origin,origin+prefix);

 const access=await request(socket,prefix+'/api/v1/call/getLocalAccess',{method:'POST',headers:{...admin,cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':'gateway-access'},body:{}});
 assert.equal(access.status,200);assert.equal(json(access).value.origin,origin+prefix);
 const openWeb=await request(socket,prefix+'/api/v1/call/openWeb',{method:'POST',headers:{...admin,cookie,origin,'content-type':'application/json','x-csrf-token':csrf,'idempotency-key':'gateway-open'},body:{}});
 assert.equal(openWeb.status,200);assert.equal(json(openWeb).value.url,origin+prefix);

 const httpOrigin='http://192.168.1.100:5666';
 const httpSession=await request(socket,prefix+'/api/v1/session',{headers:{...admin,host:'192.168.1.100','x-forwarded-proto':'http',origin:httpOrigin}});
 assert.equal(httpSession.status,200);assert.doesNotMatch(httpSession.headers['set-cookie'][0],/Secure/);
 const httpCookie=httpSession.headers['set-cookie'][0].split(';')[0],httpCsrf=json(httpSession).csrf;
 const httpAccess=await request(socket,prefix+'/api/v1/call/getLocalAccess',{method:'POST',headers:{...admin,cookie:httpCookie,host:'192.168.1.100','x-forwarded-proto':'http',origin:httpOrigin,'content-type':'application/json','x-csrf-token':httpCsrf,'idempotency-key':'gateway-http'},body:{}});
 assert.equal(httpAccess.status,200);assert.equal(json(httpAccess).value.origin,httpOrigin+prefix);

 const plain=await request(socket,prefix+'/api/v1/session',{headers:{...admin,host:'192.168.1.100:5666'}});
 assert.equal(plain.status,200);assert.doesNotMatch(plain.headers['set-cookie'][0],/Secure/);
 const plainCookie=plain.headers['set-cookie'][0].split(';')[0],plainCsrf=json(plain).csrf;
 const plainAccess=await request(socket,prefix+'/api/v1/call/getLocalAccess',{method:'POST',headers:{...admin,cookie:plainCookie,host:'192.168.1.100:5666','content-type':'application/json','x-csrf-token':plainCsrf,'idempotency-key':'gateway-plain'},body:{}});
 assert.equal(plainAccess.status,200);assert.equal(json(plainAccess).value.origin,'http://192.168.1.100:5666'+prefix);

 const forwarded=await request(socket,prefix+'/api/v1/session',{headers:{...admin,host:'real-nas.local','x-forwarded-proto':'https'}});
 assert.equal(forwarded.status,200);assert.match(forwarded.headers['set-cookie'][0],/Secure/);
 const forwardedCookie=forwarded.headers['set-cookie'][0].split(';')[0],forwardedCsrf=json(forwarded).csrf;
 const forwardedAccess=await request(socket,prefix+'/api/v1/call/getLocalAccess',{method:'POST',headers:{...admin,cookie:forwardedCookie,host:'real-nas.local','content-type':'application/json','x-csrf-token':forwardedCsrf,'idempotency-key':'gateway-forwarded'},body:{}});
 assert.equal(forwardedAccess.status,200);assert.equal(json(forwardedAccess).value.origin,'https://real-nas.local'+prefix);

 assert.equal((await request(socket,prefix+'/api/v1/call/getInventory',{method:'POST',headers:{...admin,cookie,origin,'content-type':'application/json','idempotency-key':'gateway-two'},body:{}})).status,403);
 assert.equal((await request(socket,prefix+'/api/v1/session',{headers:{...admin,origin:'https://evil.invalid'}})).status,403);
 assert.equal((await request(socket,prefix+'/api/v1/session',{headers:{...admin,origin:'null'}})).status,403);
 assert.equal((await request(socket,prefix,{headers:{...admin,host:'evil.com@nas.example.test'}})).status,403);
 assert.equal((await request(socket,prefix,{headers:{...admin,'sec-fetch-site':'cross-site'}})).status,403);
 assert.equal((await request(socket,prefix,{headers:{'x-trim-isadmin':'true'}})).status,401);
 const memberHeaders={...admin,'x-trim-userid':'2001','x-trim-isadmin':'false'};
 const memberPage=await request(socket,prefix,{headers:memberHeaders});
 assert.equal(memberPage.status,200);
 const memberCookie=memberPage.headers['set-cookie'][0].split(';')[0];
 const memberSession=await request(socket,prefix+'/api/v1/session',{headers:{...memberHeaders,cookie:memberCookie,origin}});
 assert.equal(memberSession.status,200);
 const memberRead=await request(socket,prefix+'/api/v1/call/getInventory',{method:'POST',headers:{...memberHeaders,cookie:memberCookie,origin,'content-type':'application/json','x-csrf-token':json(memberSession).csrf},body:{}});
 assert.equal(memberRead.status,200);
 const memberSettings=await request(socket,prefix+'/api/v1/call/saveSettings',{method:'POST',headers:{...memberHeaders,cookie:memberCookie,origin,'content-type':'application/json','x-csrf-token':json(memberSession).csrf,'idempotency-key':'member-settings'},body:{confirmed:true}});
 assert.equal(memberSettings.status,200);

 const spoofed=await fetch(gateway.address+'/api/v1/health',{headers:{'x-trim-userid':'1000','x-trim-isadmin':'true'}});
 assert.equal(spoofed.status,403);assert.equal((await spoofed.json()).error.code,'GATEWAY_HEADERS_FORBIDDEN');
 const spoofedApi=await fetch(gateway.apiAddress+'/api/v1/health',{headers:{'x-trim-userid':'1000','x-trim-isadmin':'true'}});
 assert.equal(spoofedApi.status,403);assert.equal((await spoofedApi.json()).error.code,'GATEWAY_HEADERS_FORBIDDEN');

 const direct=await fetch(gateway.address+'/');assert.equal(direct.status,200);
 const directHtml=await direct.text();
 assert.doesNotMatch(directHtml,/<base href=/);
 assert.doesNotMatch(directHtml,/__CAINIAO_GATEWAY_PREFIX__/);
 assert.match(directHtml,/src="nas-ui-adapter\.js"><\/script><script src="renderer\.js">/);
});

test('fnOS gateway browser HTTP and WebSocket require authenticated identity',{timeout:30000},async t=>{
 const backend=http.createServer((req,res)=>res.end('visual:'+req.url));
 const sockets=new WebSocketServer({server:backend});sockets.on('connection',socket=>socket.on('message',data=>socket.send(data)));
 await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
 const root=await mkdtemp(join(tmpdir(),'nas-gateway-browser-')),socket=socketPath(root,'browser.sock');
 const gateway=createNasGateway({runtime:{identity:{datasetId:'browser-dataset',version:'test'},dispatch:async()=>null},root,port:0,apiPort:0,browserPasswordRequired:false,browserUrl:'http://127.0.0.1:'+backend.address().port,gatewayPrefix:prefix,gatewaySocket:socket,additionalOrigins:['https://mobile.example.test:33811']});
 await gateway.start();t.after(async()=>{await gateway.stop();sockets.close();await new Promise(resolve=>backend.close(resolve));await rm(root,{recursive:true,force:true});});

 const page=await request(socket,prefix+'/browser/vnc.html',{headers:{...admin,origin}});
 assert.equal(page.status,200);assert.equal(page.text,'visual:/vnc.html');
 const cookie=page.headers['set-cookie'][0].split(';')[0];
 const redirect=await request(socket,prefix+'/browser/',{headers:{...admin,origin}});
 assert.equal(redirect.status,302);
 const location=new URL(redirect.headers.location,'https://nas.example.test');
 assert.equal(location.pathname,prefix+'/browser/vnc.html');
 assert.equal('/'+location.searchParams.get('path'),prefix+'/browser/websockify');

 const connected=await websocketConnect(socket,prefix+'/browser/websockify',{origin,headers:{host:'nas.example.test',cookie,...admin}});
 assert.equal(connected.status,101);connected.websocket.send('echo');assert.equal(await websocketMessage(connected.websocket),'echo');connected.websocket.terminate();

 const memberSocket=await websocketConnect(socket,prefix+'/browser/websockify',{origin,headers:{host:'nas.example.test',cookie,'x-trim-userid':'1000','x-trim-isadmin':'false'}});
 assert.equal(memberSocket.status,101);memberSocket.websocket.terminate();
 const mobileSocket=await websocketConnect(socket,prefix+'/browser/websockify',{origin:'https://mobile.example.test:33811',headers:{host:'localhost',cookie,...admin}});
 assert.equal(mobileSocket.status,101);mobileSocket.websocket.terminate();
 const rejected=await websocketConnect(socket,prefix+'/browser/websockify',{origin,headers:{host:'nas.example.test',cookie}});
 assert.equal(rejected.status,403);
 const wrongOrigin=await websocketConnect(socket,prefix+'/browser/websockify',{origin:'https://evil.invalid',headers:{host:'nas.example.test',cookie,...admin}});
 assert.equal(wrongOrigin.status,403);
 const nullOrigin=await websocketConnect(socket,prefix+'/browser/websockify',{origin:'null',headers:{host:'nas.example.test',cookie,...admin}});
 assert.equal(nullOrigin.status,403);
});

test('fnOS gateway socket cleanup refuses live or foreign files and removes only its own socket',{skip:process.platform==='win32',timeout:30000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'nas-gateway-socket-')),socket=join(root,'app.sock');
 const options={runtime:{identity:{datasetId:'socket-dataset',version:'test'},dispatch:async()=>null},root,port:0,apiPort:0,browserPasswordRequired:false,gatewayPrefix:prefix,gatewaySocket:socket};
 const first=createNasGateway(options);await first.start();t.after(async()=>{await first.stop();await rm(root,{recursive:true,force:true});});
 assert.equal((await stat(socket)).isSocket(),true);
 assert.equal((await stat(socket)).mode&0o777,0o600);
 const second=createNasGateway({...options,runtime:{identity:{datasetId:'other-dataset',version:'test'},dispatch:async()=>null}});
 await assert.rejects(second.start(),/already in use/);
 assert.equal((await stat(socket)).isSocket(),true);
 await first.stop();await assert.rejects(stat(socket),/ENOENT/);

 await writeFile(socket,'do-not-remove');
 const third=createNasGateway({...options,runtime:{identity:{datasetId:'other-dataset',version:'test'},dispatch:async()=>null}});
 await assert.rejects(third.start(),/not a socket/);
 assert.equal(await readFile(socket,'utf8'),'do-not-remove');
});
