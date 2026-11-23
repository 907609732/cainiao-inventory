import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {WebSocket,WebSocketServer} from 'ws';
import net from 'node:net';
import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,lstat,unlink,chmod} from 'node:fs/promises';
import {join,resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalWebServer} from '../../desktop/local-web/server.mjs';
const random=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const error=(statusCode,code)=>Object.assign(Error(code),{statusCode,code});
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const gatewayPrefixPattern=/^\/app\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const isWindowsPipe=value=>process.platform==='win32'&&/^\\\\\.\\pipe\\/.test(value);
const hasTrimHeaders=req=>Object.keys(req.headers).some(name=>name.toLowerCase().startsWith('x-trim-'));
const cookiesOf=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(value=>value.trim()).filter(Boolean).map(value=>{const index=value.indexOf('=');return [value.slice(0,index),value.slice(index+1)];}));

// Private Unix/pipe socket only: the host may be any real fnOS access host.
// This deliberately does not reuse the public TCP origin whitelist, which stays strict.
export function gatewayOrigin(req){
 const host=req.headers.host;
 if(typeof host!=='string'||!host||host.length>255||/[\s,;\\/@]/.test(host))throw error(403,'INVALID_HOST');
 const normalizedHost=host.toLowerCase();
 let parsed;try{parsed=new URL('http://'+host);}catch{throw error(403,'INVALID_HOST');}
 const defaultPort=parsed.host===normalizedHost||(parsed.port===''&&normalizedHost===parsed.host+':80');
 if(!defaultPort||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw error(403,'INVALID_HOST');
 const origin=req.headers.origin;
 if(origin!==undefined){
  if(typeof origin!=='string'||origin==='null')throw error(403,'INVALID_ORIGIN');
  let parsedOrigin;try{parsedOrigin=new URL(origin);}catch{throw error(403,'INVALID_ORIGIN');}
  const originPort=parsedOrigin.port||(parsedOrigin.protocol==='https:'?'443':'80');
  // fnOS 1.2 strips the external port from Host on its authenticated Unix hop.
  // Keep exact hostname/protocol checks; compare ports only when Host retains one.
  const explicitHostPort=/\]:\d+$/.test(host)||(!host.startsWith('[')&&/:\d+$/.test(host));
  const hostPort=parsed.port||(normalizedHost.endsWith(':80')?'80':null);
  const forwardedProto=req.headers['x-forwarded-proto'];
  if(!['http:','https:'].includes(parsedOrigin.protocol)||parsedOrigin.origin!==origin||parsedOrigin.hostname.toLowerCase()!==parsed.hostname.toLowerCase()||(explicitHostPort&&originPort!==hostPort)||(typeof forwardedProto==='string'&&/^https?$/i.test(forwardedProto)&&parsedOrigin.protocol!==forwardedProto.toLowerCase()+':'))throw error(403,'INVALID_ORIGIN');
  return {expected:parsedOrigin.origin,scheme:parsedOrigin.protocol.slice(0,-1)};
 }
 const forwarded=req.headers['x-forwarded-proto'],loopback=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname),plainPort=(parsed.port&&parsed.port!=='443')||normalizedHost.endsWith(':80');
 const scheme=typeof forwarded==='string'&&/^https?$/i.test(forwarded)?forwarded.toLowerCase():(loopback||plainPort?'http':'https');
 return {expected:scheme+'://'+parsed.host,scheme};
}
function validateGatewayPrefix(value){
 if(typeof value!=='string'||value.length>200||!gatewayPrefixPattern.test(value))throw Error('Invalid gateway prefix');
 return value;
}
export function gatewayPath(prefix,url){
 const query=url.indexOf('?'),pathname=query<0?url:url.slice(0,query),search=query<0?'':url.slice(query);
 if(pathname!==prefix&&!pathname.startsWith(prefix+'/'))throw error(404,'NOT_FOUND');
 const rest=pathname.slice(prefix.length)||'/';
 if(!rest.startsWith('/')||rest.startsWith('//')||rest.includes('\\')||search.includes('\0')||search.includes('\\'))throw error(400,'INVALID_PATH');
 let decoded;try{decoded=decodeURIComponent(rest);}catch{throw error(400,'INVALID_PATH');}
 if(decoded.includes('\0')||decoded.includes('\\')||decoded.split('/').some(segment=>segment==='.'||segment==='..'))throw error(400,'INVALID_PATH');
 return rest+search;
}
export function gatewayIdentity(headers){
 const uid=headers['x-trim-userid'];
 if(typeof uid!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(uid))throw error(401,'GATEWAY_IDENTITY_REQUIRED');
 if(String(headers['x-trim-isadmin']||'').toLowerCase()!=='true')throw error(403,'ADMIN_REQUIRED');
 const username=typeof headers['x-trim-username']==='string'?headers['x-trim-username'].replace(/[\u0000-\u001f\u007f]/g,'').slice(0,128):'';
 return {uid,isAdmin:true,username};
}
export function rewriteGatewayHtml(html,prefix){
 const rewritten=String(html)
   .replace(/href="\.\.\/assets\//g,'href="assets/')
   .replace(/src="\.\.\/assets\//g,'src="assets/')
   .replace(/data-loading-logo="\.\.\/assets\//g,'data-loading-logo="assets/')
   .replace(/href="\.\.\/\.\.\/node_modules\//g,'href="node_modules/')
   .replace(/src="\.\.\/\.\.\/node_modules\//g,'src="node_modules/')
   .replace(/href="\.\.\/shared\//g,'href="shared/')
   .replace(/src="\.\.\/shared\//g,'src="shared/');
 return rewritten
   .replace('<head>',`<head><base href="${prefix}/">`)
   .replace('<script src="web-adapter.js"></script>',`<script src="gateway-bootstrap.js"></script>\n  <script src="nas-ui-adapter.js"></script>\n  <script src="web-adapter.js"></script>`);
}
function rewriteGatewayLocation(location,prefix){
 if(typeof location!=='string'||!location.startsWith('/')||location.startsWith('//'))return location;
 return location===prefix||location.startsWith(prefix+'/')?location:prefix+location;
}
async function prepareGatewaySocket(socketPath){
 if(isWindowsPipe(socketPath))return;
 await mkdir(dirname(socketPath),{recursive:true,mode:0o700});
 let stats;try{stats=await lstat(socketPath);}catch(error){if(error.code==='ENOENT')return;throw error;}
 if(!stats.isSocket())throw Error('Gateway socket path exists and is not a socket');
 const live=await new Promise(resolve=>{const socket=net.connect(socketPath);const timer=setTimeout(()=>{socket.destroy();resolve(false);},300);timer.unref?.();socket.once('connect',()=>{clearTimeout(timer);socket.destroy();resolve(true);});socket.once('error',()=>{clearTimeout(timer);socket.destroy();resolve(false);});});
 if(live)throw Error('Gateway socket is already in use');
 await unlink(socketPath);
}
async function removeOwnedGatewaySocket(socketPath,ownership){
 if(!socketPath||isWindowsPipe(socketPath)||!ownership)return;
 try{const stats=await lstat(socketPath);if(stats.dev===ownership.dev&&stats.ino===ownership.ino)await unlink(socketPath);}catch(error){if(error.code!=='ENOENT')throw error;}
}
export function browserAssets(){
 const assets={'/':join(appRoot,'desktop/renderer/index.html')};
 assets['/nas-ui-adapter.js']=join(appRoot,'nas/ui-adapter.js');
 for(const f of ['renderer.js','web-adapter.js','styles.css','daily-work.css'])assets['/'+f]=join(appRoot,'desktop/renderer',f);
 for(const f of ['loading-screen.css','loading-screen.mjs','loading-screen-auto.mjs','ui/tokens.css','ui/base.css','ui/components.css','ui/vendor/gridjs.css'])assets['/shared/'+f]=join(appRoot,'desktop/shared',f);
 assets['/assets/lingtu-icon.png']=join(appRoot,'desktop/assets/lingtu-icon.png');
 for(const f of ['gridjs/dist/theme/mermaid.min.css','gridjs/dist/gridjs.production.min.js','echarts/dist/echarts.min.js'])assets['/node_modules/'+f]=join(appRoot,'node_modules',f);
 return assets;
}
export function createNasGateway({runtime,root,host='127.0.0.1',port=0,origin,additionalOrigins=[],adminPassword,browserPasswordRequired=true,apiPort=0,apiHost='127.0.0.1',assets=browserAssets(),browserUrl,gatewayPrefix,gatewaySocket}){
 if(!runtime?.identity?.datasetId||!root)throw Error('Runtime identity and root required');
 if(!['127.0.0.1','localhost','::1'].includes(host)&&!origin)throw Error('Public gateway requires explicit origin');
 if(origin){const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.origin!==origin)throw Error('Invalid gateway origin');}
 if(!Array.isArray(additionalOrigins))throw Error('Invalid additional origins');
 for(const value of additionalOrigins){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.origin!==value)throw Error('Invalid additional origin');}
 if(new Set([...(origin?[origin]:[]),...additionalOrigins].map(value=>new URL(value).host)).size!==(origin?1:0)+additionalOrigins.length)throw Error('Duplicate origin host');
 if(browserUrl){const u=new URL(browserUrl);if(!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.protocol!=='http:'||u.username||u.password)throw Error('Browser upstream must be loopback HTTP');}
 const fnosPrefix=gatewayPrefix===undefined?null:validateGatewayPrefix(gatewayPrefix);
 if(Boolean(fnosPrefix)!==Boolean(gatewaySocket))throw Error('Gateway prefix and socket must be configured together');
 if(gatewaySocket&&typeof gatewaySocket!=='string')throw Error('Invalid gateway socket');
 if(gatewaySocket&&!isWindowsPipe(gatewaySocket)&&!isAbsolute(gatewaySocket))throw Error('Gateway socket must be an absolute path');
 const web=Fastify({logger:false,bodyLimit:262144}),api=Fastify({logger:false,bodyLimit:262144}),fnos=fnosPrefix?Fastify({logger:false,bodyLimit:262144}):null;
 const sessions=new Map(),bridges=new Map();let db,internal,address,apiAddress,unsubscribe,saveQueue=Promise.resolve(),gatewayOwnership=null;
 const authPath=join(root,'nas-auth.json');
 const save=()=>{const content=JSON.stringify(db);saveQueue=saveQueue.then(async()=>{await writeFile(authPath+'.tmp',content,{mode:0o600});await rename(authPath+'.tmp',authPath);});return saveQueue;};
 const credentials={
  async create({write=false}={}){const id=randomUUID(),token=random();db.credentials.push({id,digest:hash(token),write:write===true});await save();return {id,token,write:write===true};},
  async createLocalOwner(){const id=randomUUID(),token=random();db.credentials.push({id,digest:hash(token),write:true,owner:true});await save();return {id,token,write:true};},
  async rotate(id){const item=db.credentials.find(c=>c.id===id);if(!item)throw Error('Credential not found');const token=random();item.digest=hash(token);await save();return {id,token,write:item.write};},
  async revoke(id){db.credentials=db.credentials.filter(c=>c.id!==id);await save();},
  async list(){return db.credentials.filter(c=>!c.owner).map(({id,write})=>({id,write}));}
 };
 const originForHost=host=>[origin||address,...additionalOrigins].find(value=>value&&new URL(value).host===host);
 const createSession=(reply,requestOrigin,options={})=>{const s={id:random(),csrf:random(),expires:Date.now()+43200000};if(options.uid)s.uid=options.uid;sessions.set(s.id,s);reply.setCookie(options.name||'nas_session',s.id,{httpOnly:true,sameSite:'strict',secure:(requestOrigin||origin||address).startsWith('https:'),path:options.path||'/',maxAge:43200});return s;};
 const sessionFor=(req,name='nas_session')=>{const s=sessions.get(req.cookies?.[name]);return s&&s.expires>Date.now()?s:null;};
 const session=req=>sessionFor(req);
 const configure=(app,isWeb)=>{
  app.register(cookie);
  app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode>=400&&e.statusCode<600?e.statusCode:500).send({ok:false,error:{code:e.statusCode?e.code:'REQUEST_FAILED',message:e.statusCode?e.code:'Request failed'}}));
  app.addHook('onRequest',async(req,reply)=>{
   reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
   if(hasTrimHeaders(req))throw error(403,'GATEWAY_HEADERS_FORBIDDEN');
   const expected=isWeb?originForHost(req.headers.host):apiAddress;
   if(!expected||req.headers.host!==new URL(expected).host)throw error(403,'INVALID_HOST');
   if(req.headers.origin&&req.headers.origin!==expected||req.headers['sec-fetch-site']==='cross-site')throw error(403,'INVALID_ORIGIN');
   if(isWeb)req.nasOrigin=expected;
   if(!['GET','POST','HEAD'].includes(req.method))throw error(405,'METHOD_NOT_ALLOWED');
   if(isWeb&&!browserPasswordRequired&&req.method==='GET'&&['/','/api/v1/session'].includes(req.url)&&!session(req)){const s=createSession(reply,req.nasOrigin);req.cookies.nas_session=s.id;}
   if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw error(415,'JSON_REQUIRED');
  });
  app.get('/api/v1/health',async()=>({brand:'cainiao-cloud-warehouse',protocol:1,instanceId:boot,platform:'fnos',...runtime.identity}));
 };
 const boot=randomUUID();configure(web,true);configure(api,false);
 if(fnos){
  fnos.register(cookie);
  fnos.setErrorHandler((e,req,reply)=>reply.code(e.statusCode>=400&&e.statusCode<600?e.statusCode:500).send({ok:false,error:{code:e.statusCode?e.code:'REQUEST_FAILED',message:e.statusCode?e.code:'Request failed'}}));
  fnos.addHook('onRequest',async(req,reply)=>{
   reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
   if(req.headers['sec-fetch-site']==='cross-site')throw error(403,'INVALID_ORIGIN');
   if(!['GET','POST','HEAD'].includes(req.method))throw error(405,'METHOD_NOT_ALLOWED');
   if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw error(415,'JSON_REQUIRED');
   const {expected}=gatewayOrigin(req),identity=gatewayIdentity(req.headers),internalPath=gatewayPath(fnosPrefix,req.url);
   req.gateway={expected,identity,internalPath};
  });
  fnos.get(fnosPrefix+'/gateway-bootstrap.js',async(req,reply)=>reply.type('application/javascript; charset=utf-8').send(`window.__CAINIAO_GATEWAY_PREFIX__=${JSON.stringify(fnosPrefix)};\n`));
 }
 const sockets=new WebSocketServer({noServer:true});
 const attachBrowserSocket=(client,upstreamTarget)=>{
  const target=new URL('/websockify',upstreamTarget);target.protocol=target.protocol==='https:'?'wss:':'ws:';
  const upstream=new WebSocket(target);const pending=[];
  client.on('message',(data,isBinary)=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary:isBinary});else if(pending.length<16)pending.push([data,isBinary]);else client.close(1009);});
  upstream.on('open',()=>{for(const [data,isBinary]of pending)upstream.send(data,{binary:isBinary});pending.length=0;});
  upstream.on('message',(data,isBinary)=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary:isBinary});});
  upstream.on('error',()=>client.close(1011));client.on('error',()=>upstream.terminate());client.on('close',()=>upstream.terminate());upstream.on('close',()=>client.close());
 };
 web.server.on('upgrade',(req,socket,head)=>{
  if(hasTrimHeaders(req)){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  const expected=originForHost(req.headers.host);
  const cookies=cookiesOf(req);
  if(!expected||!browserUrl||req.url!=='/browser/websockify'||req.headers.host!==new URL(expected).host||req.headers.origin!==expected||!session({cookies})){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,client=>attachBrowserSocket(client,browserUrl));
 });
 if(fnos)fnos.server.on('upgrade',(req,socket,head)=>{
  const wsPath=req.url.split('?')[0],cookies=cookiesOf(req);
  let identity,sessionValue;
  try{
   if(!req.headers.origin||!browserUrl||wsPath!==fnosPrefix+'/browser/websockify')throw error(403,'FORBIDDEN');
   const {expected}=gatewayOrigin(req);
   if(req.headers.origin!==expected)throw error(403,'FORBIDDEN');
   identity=gatewayIdentity(req.headers);
   sessionValue=sessionFor({cookies},'nas_gateway_session');
   if(!sessionValue||sessionValue.uid!==identity.uid)throw error(403,'FORBIDDEN');
  }catch{socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,client=>{client.trimUserId=identity.uid;attachBrowserSocket(client,browserUrl);});
 });
 async function proxyBrowser(req,reply,path,redirectPrefix=''){
  if(!browserUrl)throw error(503,'BROWSER_UNAVAILABLE');
  if(path==='/browser/'){const websockify=redirectPrefix?`${redirectPrefix}/browser/websockify`:'browser/websockify';return reply.redirect(redirectPrefix+'/browser/vnc.html?autoconnect=true&path='+(redirectPrefix?encodeURIComponent(websockify):websockify));}
  const suffix=path.slice('/browser'.length);if(suffix.includes('..')||suffix.includes('\\')||suffix.startsWith('//'))throw error(400,'INVALID_PATH');
  const response=await fetch(new URL(suffix,browserUrl),{redirect:'error'});reply.code(response.status).type(response.headers.get('content-type')||'application/octet-stream');return reply.send(Buffer.from(await response.arrayBuffer()));
 }
 web.get('/browser/*',async(req,reply)=>{if(!session(req))return reply.redirect('/login');return proxyBrowser(req,reply,req.url);});
 web.get('/login',async(req,reply)=>!browserPasswordRequired?reply.redirect('/'):reply.type('text/html').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>菜鸟云仓登录</title><h1>菜鸟云仓</h1><form><label>管理员密码 <input type="password" autocomplete="current-password" required></label><button>登录</button><p role="status"></p></form><script>document.querySelector("form").onsubmit=async e=>{e.preventDefault();const r=await fetch("/api/v1/session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.querySelector("input").value})});if(r.ok)location.replace("/");else document.querySelector("p").textContent="登录失败";};</script></html>'));
 const attempts=new Map();
 web.post('/api/v1/session',async(req,reply)=>{
  const key=req.ip,record=attempts.get(key)||{count:0,until:Date.now()+60000};if(record.until<Date.now()){record.count=0;record.until=Date.now()+60000;}attempts.set(key,record);if(++record.count>10)throw error(429,'TOO_MANY_ATTEMPTS');
  if(browserPasswordRequired&&(typeof req.body?.password!=='string'||req.body.password.length>1024||!equal(scryptSync(req.body.password,db.salt,32).toString('hex'),db.password)))throw error(401,'UNAUTHORIZED');
  attempts.delete(key);const s=createSession(reply,req.nasOrigin);return {csrf:s.csrf};
 });
 web.get('/api/v1/session',async req=>{const s=session(req);if(!s)throw error(401,'UNAUTHORIZED');return {csrf:s.csrf};});
 async function proxy(req,reply,isWeb){
  let ctx;
  if(isWeb){const s=session(req);if(!s){if(!req.url.startsWith('/api/'))return reply.redirect('/login');throw error(401,'UNAUTHORIZED');}if(req.method==='POST'&&!equal(req.headers['x-csrf-token'],s.csrf))throw error(403,'CSRF_REQUIRED');ctx={kind:'browser',id:'nas-admin',write:true,csrf:s.csrf,origin:req.nasOrigin};}
  else {if(!req.url.startsWith('/api/v1/call/')&&!req.url.startsWith('/api/v1/tasks/'))throw error(404,'NOT_FOUND');const token=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1],c=token&&db.credentials.find(c=>equal(c.digest,hash(token)));if(!c)throw error(401,'UNAUTHORIZED');ctx={kind:c.owner?'owner':'ai',id:c.id,write:c.write};}
  const bridge=random();bridges.set(bridge,ctx);
  try{const response=await fetch(internal.address+req.url,{method:req.method,headers:{authorization:'Bearer '+bridge,...(req.method==='POST'?{'content-type':'application/json','x-csrf-token':ctx.csrf||'','idempotency-key':req.headers['idempotency-key']||''}:{})},...(req.method==='POST'?{body:JSON.stringify(req.body)}:{}),redirect:'manual'});reply.code(response.status);reply.type(response.headers.get('content-type')||'application/octet-stream');const bytes=Buffer.from(await response.arrayBuffer());return reply.send(isWeb&&req.url==='/'?bytes.toString().replace('<script src="renderer.js">','<script src="nas-ui-adapter.js"></script><script src="renderer.js">'):bytes);}finally{bridges.delete(bridge);}
 }
 web.setNotFoundHandler((req,reply)=>proxy(req,reply,true));api.setNotFoundHandler((req,reply)=>proxy(req,reply,false));
 const gatewaySessionFor=(req,reply,{create=false}={})=>{const current=sessionFor(req,'nas_gateway_session'),uid=req.gateway.identity.uid;if(current&&current.uid===uid)return current;if(!create)return null;const created=createSession(reply,req.gateway.expected,{uid,path:fnosPrefix,name:'nas_gateway_session'});req.cookies.nas_gateway_session=created.id;return created;};
 async function proxyGateway(req,reply){
  const {expected,identity,internalPath}=req.gateway,isApi=internalPath.startsWith('/api/'),publicHealth=internalPath==='/api/v1/health';
  const needsSession=!publicHealth&&(internalPath==='/'||isApi||internalPath.startsWith('/browser/'));
  const mayCreateSession=['GET','HEAD'].includes(req.method)&&(internalPath==='/'||internalPath==='/api/v1/session'||internalPath.startsWith('/browser/'));
  const current=gatewaySessionFor(req,reply,{create:mayCreateSession});
  if(needsSession&&!current)throw error(401,'UNAUTHORIZED');
  if(req.method==='POST'&&isApi&&!equal(req.headers['x-csrf-token'],current?.csrf))throw error(403,'CSRF_REQUIRED');
  if(internalPath.startsWith('/browser/'))return proxyBrowser(req,reply,internalPath,fnosPrefix);
  const context={kind:'browser',id:'gateway:'+identity.uid,write:true,...(current?.csrf?{csrf:current.csrf}:{}),origin:expected+fnosPrefix},bridge=random();bridges.set(bridge,context);
  try{
   const response=await fetch(internal.address+internalPath,{method:req.method,headers:{authorization:'Bearer '+bridge,...(req.method==='POST'?{'content-type':'application/json','x-csrf-token':context.csrf||'','idempotency-key':req.headers['idempotency-key']||''}:{})},...(req.method==='POST'?{body:JSON.stringify(req.body??{})}:{}),redirect:'manual'});
   const type=response.headers.get('content-type')||'application/octet-stream';
   reply.code(response.status).type(type);
   if(response.status>=300&&response.status<400){const location=response.headers.get('location');if(location)reply.header('location',rewriteGatewayLocation(location,fnosPrefix));}
   let bytes=Buffer.from(await response.arrayBuffer());
   if(internalPath==='/'&&response.status===200&&/text\/html/i.test(type))bytes=Buffer.from(rewriteGatewayHtml(bytes.toString('utf8'),fnosPrefix));
   return reply.send(bytes);
  }finally{bridges.delete(bridge);}
 }
 if(fnos)fnos.setNotFoundHandler((req,reply)=>proxyGateway(req,reply));
 return {credentials,get address(){return address;},get apiAddress(){return apiAddress;},publish(type,data){internal?.publish(type,data);},
 async start(){
  await mkdir(root,{recursive:true});
  if(fnos)await prepareGatewaySocket(gatewaySocket);
  try{
   try{db=JSON.parse(await readFile(authPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;if(browserPasswordRequired&&(typeof adminPassword!=='string'||adminPassword.length<12))throw Error('Initial administrator password must have 12 characters');const salt=random();db=browserPasswordRequired?{salt,password:scryptSync(adminPassword,salt,32).toString('hex'),credentials:[]}:{credentials:[]};await save();}
   internal=createLocalWebServer({version:runtime.identity.version,port:0,stateDir:root,assets,healthIdentity:{datasetId:runtime.identity.datasetId,platform:'fnos'},authenticateRequest:async req=>bridges.get(/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1])||null,dispatch:async(name,payload,context)=>{if(name==='getLocalAccess')return {origin:context.origin||address,credentials:await credentials.list()};if(name==='openWeb')return {url:context.origin||address};if(name==='createAiCredential')return credentials.create(payload);if(name==='revokeAiCredential'){if(db.credentials.find(c=>c.id===payload.id)?.owner)throw error(403,'FORBIDDEN');await credentials.revoke(payload.id);return {ok:true};}return runtime.dispatch(name,payload,context);}});await internal.start();
   await web.listen({host,port});address=origin||'http://'+(host==='::1'?'[::1]':host)+':'+web.server.address().port;
   await api.listen({host:apiHost,port:apiPort});apiAddress='http://'+(apiHost==='0.0.0.0'?'127.0.0.1':apiHost==='::1'?'[::1]':apiHost)+':'+api.server.address().port;
   if(fnos){await fnos.listen({path:gatewaySocket});if(!isWindowsPipe(gatewaySocket)){gatewayOwnership=await lstat(gatewaySocket);await chmod(gatewaySocket,0o600);}}
   if(runtime.subscribe)unsubscribe=runtime.subscribe((type,data)=>typeof type==='string'?internal.publish(type,data):internal.publish(type.type,type.data));
   return address;
  }catch(e){await stop().catch(()=>{});throw e;}
 },
 async stop(){
  unsubscribe?.();unsubscribe=null;
  for(const client of sockets.clients)client.terminate();
  try{sockets.close();}catch{}
  const servers=[web.close(),api.close()];if(fnos)servers.push(fnos.close());
  await Promise.allSettled(servers);
  try{await internal?.stop();}catch{}
  await saveQueue;
  await removeOwnedGatewaySocket(gatewaySocket,gatewayOwnership);gatewayOwnership=null;
 }
 };
}



