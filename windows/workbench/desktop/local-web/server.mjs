import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import staticPlugin from '@fastify/static';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {mkdir,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {dirname,basename,join,isAbsolute} from 'node:path';
import {operationPolicy,validOperationPayload} from './operations.mjs';

const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fail=(status,code)=>Object.assign(new Error(code),{statusCode:status,publicCode:code});
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);

export function createLocalWebServer({version,port=17891,instanceId=random(),ownerToken,dispatch,assets={},stateDir,verifyBearer=async()=>null,authenticateRequest,healthIdentity={}}) {
 const app=Fastify({logger:false,bodyLimit:256*1024});
 const sessions=new Map(),tokens=new Map(),receipts=new Map(),previews=new Map();
 const events=[]; let cursor=0,origin='',persistQueue=Promise.resolve();
 const receiptDir=stateDir&&join(stateDir,'local-web-tasks');
 const persist=receipt=>{if(!receiptDir)throw fail(503,'STATE_UNAVAILABLE');const safe={...receipt};if(receipt.sensitive){delete safe.value;delete safe.response;safe.status='unknown';}const text=JSON.stringify(safe);persistQueue=persistQueue.then(async()=>{const file=join(receiptDir,receipt.taskId+'.json');await writeFile(file+'.tmp',text,{mode:0o600});await rename(file+'.tmp',file);});return persistQueue;};
 const authenticate=async req=>{
  if(authenticateRequest){const context=await authenticateRequest(req);if(context)return context;}
  const bearer=/^Bearer (.+)$/.exec(req.headers.authorization||'')?.[1];
  if(bearer){if(ownerToken&&equal(bearer,ownerToken))return {kind:'owner',id:'owner',write:true};const credential=await verifyBearer(bearer);if(credential&&typeof credential.id==='string')return {kind:'ai',id:credential.id,write:credential.write===true};throw fail(401,'UNAUTHORIZED');}
  const session=sessions.get(req.cookies.warehouse_session);if(!session||session.expires<Date.now())throw fail(401,'UNAUTHORIZED');return {kind:'browser',id:session.id,write:true,csrf:session.csrf};
 };
 app.register(cookie);
 app.register(staticPlugin,{serve:false});
 app.setErrorHandler((error,req,reply)=>reply.code(error.statusCode>=400&&error.statusCode<600?error.statusCode:500).send({ok:false,error:{code:error.publicCode||'REQUEST_FAILED',message:error.publicCode||'Request failed'}}));
 app.addHook('onRequest',async(req,reply)=>{
  reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','no-referrer');
  if(req.headers.host!==new URL(origin).host)throw fail(403,'INVALID_HOST');
  if(req.headers.origin&&req.headers.origin!==origin)throw fail(403,'INVALID_ORIGIN');
  if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'INVALID_ORIGIN');
  if(!['GET','HEAD','POST'].includes(req.method))throw fail(405,'METHOD_NOT_ALLOWED');
  if(req.method==='POST'&&!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']||''))throw fail(415,'JSON_REQUIRED');
 });
 app.get('/api/v1/health',async()=>({brand:'cainiao-cloud-warehouse',version,protocol:1,instanceId,...healthIdentity}));
 app.post('/api/v1/session',async(req,reply)=>{
  const token=req.body?.token,expires=tokens.get(token);tokens.delete(token);if(!expires||expires<Date.now())throw fail(401,'UNAUTHORIZED');
  const previous=sessions.get(req.cookies.warehouse_session);
  const session=previous&&previous.expires>=Date.now()?previous:{id:random(),csrf:random()};
  session.expires=Date.now()+12*3600_000;sessions.set(session.id,session);
  reply.setCookie('warehouse_session',session.id,{path:'/',httpOnly:true,sameSite:'strict',maxAge:43200});return {csrf:session.csrf};
 });
 app.get('/api/v1/session',async req=>{const ctx=await authenticate(req);if(ctx.kind!=='browser')throw fail(403,'FORBIDDEN');return {csrf:ctx.csrf};});
 app.get('/api/v1/events',async req=>{await authenticate(req);const after=Number(req.query.after||0);if(!Number.isSafeInteger(after)||after<0)throw fail(400,'INVALID_CURSOR');return {cursor,events:events.filter(e=>e.cursor>after)};});
 app.get('/api/v1/tasks/:id',async req=>{const ctx=await authenticate(req);const receipt=receipts.get(req.params.id);if(!receipt||receipt.identity!==ctx.kind+':'+ctx.id)throw fail(404,'NOT_FOUND');return {ok:true,value:{taskId:receipt.taskId,status:receipt.status,...(receipt.status==='succeeded'?{value:receipt.value}:{}),...(['failed','unknown'].includes(receipt.status)?{error:{code:receipt.status==='unknown'?'TASK_UNKNOWN':'TASK_FAILED',message:receipt.status==='unknown'?'Task outcome unknown; check provider records':'Task failed'}}:{})}};});
 app.post('/api/v1/call/:operation',async(req,reply)=>{
  const ctx=await authenticate(req),name=req.params.operation,payload=req.body??{},op=operationPolicy(name,payload);
  if(!op)throw fail(404,'UNKNOWN_OPERATION');
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw fail(400,'INVALID_PAYLOAD');
  if(!validOperationPayload(name,payload))throw fail(400,'INVALID_PAYLOAD');
  if(op.ownerOnly&&ctx.kind!=='owner'||ctx.kind==='ai'&&!op.ai)throw fail(403,'FORBIDDEN');
  if((op.write||name==='previewDateException')&&!ctx.write)throw fail(403,'READ_ONLY');
  if(op.write){if(!ctx.write)throw fail(403,'READ_ONLY');if(ctx.kind==='browser'&&!equal(req.headers['x-csrf-token'],ctx.csrf))throw fail(403,'CSRF_REQUIRED');if(ctx.kind==='ai'&&payload.confirmed!==true&&payload.confirmSend!==true&&payload.confirmSideEffect!==true)throw fail(403,'CONFIRMATION_REQUIRED');}
  if(name==='revealSecret'&&(ctx.kind!=='browser'||!ctx.write))throw fail(403,'FORBIDDEN');
  if(name==='revealSecret'&&!equal(req.headers['x-csrf-token'],ctx.csrf))throw fail(403,'CSRF_REQUIRED');
  if(name==='getEditableSecrets')return {ok:true,value:{}};
  const context={kind:ctx.kind,id:ctx.id,write:ctx.write,...(ctx.origin?{origin:ctx.origin}:{})};
  const invoke=async()=>{const value=await dispatch(name,payload,context);if(name==='previewDateException'){const token=value?.token||value?.confirmationToken;if(token)previews.set(token,{identity:ctx.kind+':'+ctx.id,expires:Date.now()+120000});}return value;};
  if(!op.write)return {ok:true,value:await invoke()};
  const key=req.headers['idempotency-key'];if(typeof key!=='string'||!key.length||key.length>128)throw fail(400,'IDEMPOTENCY_REQUIRED');
  const identity=ctx.kind+':'+ctx.id,fingerprint=createHash('sha256').update(stable({name,payload})).digest('hex');
  const taskId=createHash('sha256').update(identity+'\0'+key).digest('hex');const prior=receipts.get(taskId);
  if(prior){if(prior.fingerprint!==fingerprint)throw fail(409,'IDEMPOTENCY_CONFLICT');return prior.response||{ok:true,value:{taskId,status:prior.status}};}
  if(name==='sendDateException'){
   const token=payload.token||payload.confirmationToken;const preview=previews.get(token);if(!preview||preview.identity!==identity||preview.expires<Date.now())throw fail(403,'INVALID_PREVIEW');
  }
  const receipt={taskId,identity,fingerprint,status:'running',sensitive:name==='createAiCredential'};receipts.set(taskId,receipt);await persist(receipt);
  const finish=async()=>{try{
   receipt.value=await invoke();
   const value=receipt.value,states=value?.accepted===false&&value.channels&&typeof value.channels==='object'?Object.values(value.channels).map(channel=>channel?.status):null;
   if(value?.unknown===true||(states&&(!states.length||!states.every(status=>status==='failed'))))receipt.status='unknown';
   else if(states||value?.success===false||value?.ok===false)receipt.status='failed';
   else receipt.status='succeeded';
   if(receipt.status==='unknown')receipt.response={ok:true,value:{taskId,status:'unknown'}};
   else if(!op.task)receipt.response=receipt.status==='succeeded'?{ok:true,value:receipt.value}:{ok:false,error:{code:'TASK_FAILED',message:'Task failed'}};
  }catch{receipt.status='failed';if(!op.task)receipt.response={ok:false,error:{code:'TASK_FAILED',message:'Task failed'}};}await persist(receipt);};
  if(op.task){receipt.response={ok:true,value:{taskId,status:'running'}};await persist(receipt);void finish().catch(()=>{receipt.status='unknown';});return receipt.response;}
  await finish();return receipt.response;
 });
 for(const [url,file] of Object.entries(assets)){if(!url.startsWith('/')||url.startsWith('/api/')||!isAbsolute(file))throw Error('Invalid asset mapping');app.get(url,(req,reply)=>reply.sendFile(basename(file),dirname(file)));}
 return {
  async start(){if(receiptDir){await mkdir(receiptDir,{recursive:true});for(const file of await readdir(receiptDir)){if(!/^[a-f0-9]{64}\.json$/.test(file))continue;try{const r=JSON.parse(await readFile(join(receiptDir,file),'utf8'));if(r.status==='running'){r.status='unknown';delete r.response;}receipts.set(r.taskId,r);}catch{throw Error('Invalid task receipt');}}}await app.listen({host:'127.0.0.1',port});origin='http://127.0.0.1:'+app.server.address().port;return origin;},
  async stop(){await persistQueue;await app.close();},
  openUrl(){if(!origin)throw Error('Server not started');const token=random();tokens.set(token,Date.now()+60000);return origin+'/#token='+token;},
  publish(type,data){events.push({cursor:++cursor,type,data});if(events.length>500)events.shift();},
  get address(){return origin;}
 };
}


