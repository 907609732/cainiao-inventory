import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import {WebSocket,WebSocketServer} from 'ws';
import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalWebServer} from '../../desktop/local-web/server.mjs';
const random=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const error=(statusCode,code)=>Object.assign(Error(code),{statusCode,code});
const appRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export function browserAssets(){
 const assets={'/':join(appRoot,'desktop/renderer/index.html')};
 assets['/nas-ui-adapter.js']=join(appRoot,'nas/ui-adapter.js');
 for(const f of ['renderer.js','web-adapter.js','styles.css','daily-work.css'])assets['/'+f]=join(appRoot,'desktop/renderer',f);
 for(const f of ['loading-screen.css','loading-screen.mjs','loading-screen-auto.mjs','ui/tokens.css','ui/base.css','ui/components.css','ui/vendor/gridjs.css'])assets['/shared/'+f]=join(appRoot,'desktop/shared',f);
 assets['/assets/lingtu-icon.png']=join(appRoot,'desktop/assets/lingtu-icon.png');
 for(const f of ['gridjs/dist/theme/mermaid.min.css','gridjs/dist/gridjs.production.min.js','echarts/dist/echarts.min.js'])assets['/node_modules/'+f]=join(appRoot,'node_modules',f);
 return assets;
}
export function createNasGateway({runtime,root,host='127.0.0.1',port=0,origin,additionalOrigins=[],adminPassword,browserPasswordRequired=true,apiPort=0,apiHost='127.0.0.1',assets=browserAssets(),browserUrl}){
 if(!runtime?.identity?.datasetId||!root)throw Error('Runtime identity and root required');
 if(!['127.0.0.1','localhost','::1'].includes(host)&&!origin)throw Error('Public gateway requires explicit origin');
 if(origin){const u=new URL(origin);if(!['http:','https:'].includes(u.protocol)||u.origin!==origin)throw Error('Invalid gateway origin');}
 if(!Array.isArray(additionalOrigins))throw Error('Invalid additional origins');
 for(const value of additionalOrigins){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.origin!==value)throw Error('Invalid additional origin');}
 if(new Set([...(origin?[origin]:[]),...additionalOrigins].map(value=>new URL(value).host)).size!==(origin?1:0)+additionalOrigins.length)throw Error('Duplicate origin host');
 if(browserUrl){const u=new URL(browserUrl);if(!['127.0.0.1','[::1]','localhost'].includes(u.hostname)||u.protocol!=='http:'||u.username||u.password)throw Error('Browser upstream must be loopback HTTP');}
 const web=Fastify({logger:false,bodyLimit:262144}),api=Fastify({logger:false,bodyLimit:262144});
 const sessions=new Map(),bridges=new Map();let db,internal,address,apiAddress,unsubscribe,saveQueue=Promise.resolve();
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
 const createSession=(reply,requestOrigin)=>{const s={id:random(),csrf:random(),expires:Date.now()+43200000};sessions.set(s.id,s);reply.setCookie('nas_session',s.id,{httpOnly:true,sameSite:'strict',secure:(requestOrigin||origin||address).startsWith('https:'),path:'/',maxAge:43200});return s;};
 const session=req=>{const s=sessions.get(req.cookies?.nas_session);return s&&s.expires>Date.now()?s:null;};
 const configure=(app,isWeb)=>{
  app.register(cookie);
  app.setErrorHandler((e,req,reply)=>reply.code(e.statusCode>=400&&e.statusCode<600?e.statusCode:500).send({ok:false,error:{code:e.statusCode?e.code:'REQUEST_FAILED',message:e.statusCode?e.code:'Request failed'}}));
  app.addHook('onRequest',async(req,reply)=>{
   reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
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
 const sockets=new WebSocketServer({noServer:true});
 web.server.on('upgrade',(req,socket,head)=>{
  const expected=originForHost(req.headers.host);
  const cookies=Object.fromEntries((req.headers.cookie||'').split(';').map(s=>s.trim().split('=')));
  if(!expected||!browserUrl||req.url!=='/browser/websockify'||req.headers.host!==new URL(expected).host||req.headers.origin!==expected||!session({cookies})){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
  sockets.handleUpgrade(req,socket,head,client=>{
   const target=new URL('/websockify',browserUrl);target.protocol=target.protocol==='https:'?'wss:':'ws:';
   const upstream=new WebSocket(target);const pending=[];
   client.on('message',(data,isBinary)=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary:isBinary});else if(pending.length<16)pending.push([data,isBinary]);else client.close(1009);});
   upstream.on('open',()=>{for(const [data,isBinary]of pending)upstream.send(data,{binary:isBinary});pending.length=0;});
   upstream.on('message',(data,isBinary)=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary:isBinary});});
   upstream.on('error',()=>client.close(1011));client.on('error',()=>upstream.terminate());client.on('close',()=>upstream.terminate());upstream.on('close',()=>client.close());
  });
 });
 web.get('/browser/*',async(req,reply)=>{
  if(!session(req))return reply.redirect('/login');if(!browserUrl)throw error(503,'BROWSER_UNAVAILABLE');
  if(req.url==='/browser/')return reply.redirect('/browser/vnc.html?autoconnect=true&path=browser/websockify');
  const path=req.url.slice('/browser'.length);if(path.includes('..')||path.startsWith('//'))throw error(400,'INVALID_PATH');
  const response=await fetch(new URL(path,browserUrl),{redirect:'error'});reply.code(response.status).type(response.headers.get('content-type')||'application/octet-stream');return reply.send(Buffer.from(await response.arrayBuffer()));
 });
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
 return {credentials,get address(){return address;},get apiAddress(){return apiAddress;},publish(type,data){internal?.publish(type,data);},
 async start(){await mkdir(root,{recursive:true});try{db=JSON.parse(await readFile(authPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;if(browserPasswordRequired&&(typeof adminPassword!=='string'||adminPassword.length<12))throw Error('Initial administrator password must have 12 characters');const salt=random();db=browserPasswordRequired?{salt,password:scryptSync(adminPassword,salt,32).toString('hex'),credentials:[]}:{credentials:[]};await save();}
 internal=createLocalWebServer({version:runtime.identity.version,port:0,stateDir:root,assets,healthIdentity:{datasetId:runtime.identity.datasetId,platform:'fnos'},authenticateRequest:async req=>bridges.get(/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1])||null,dispatch:async(name,payload,context)=>{if(name==='getLocalAccess')return {origin:context.origin||address,credentials:await credentials.list()};if(name==='openWeb')return {url:context.origin||address};if(name==='createAiCredential')return credentials.create(payload);if(name==='revokeAiCredential'){if(db.credentials.find(c=>c.id===payload.id)?.owner)throw error(403,'FORBIDDEN');await credentials.revoke(payload.id);return {ok:true};}return runtime.dispatch(name,payload,context);}});await internal.start();
 await web.listen({host,port});address=origin||'http://'+(host==='::1'?'[::1]':host)+':'+web.server.address().port;
 await api.listen({host:apiHost,port:apiPort});apiAddress='http://'+(apiHost==='0.0.0.0'?'127.0.0.1':apiHost==='::1'?'[::1]':apiHost)+':'+api.server.address().port;
 if(runtime.subscribe)unsubscribe=runtime.subscribe((type,data)=>typeof type==='string'?internal.publish(type,data):internal.publish(type.type,type.data));return address;},
 async stop(){unsubscribe?.();for(const client of sockets.clients)client.terminate();sockets.close();await Promise.all([web.close(),api.close()]);await internal?.stop();await saveQueue;}
 };
}



