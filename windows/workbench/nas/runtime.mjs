import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {discoverExtensions,invokeTrustedExtension} from '../desktop/shared/extensions.mjs';
import {buildInventoryMarkdown} from '../core/erp/reports.js';
import {createNasStorage} from './storage.mjs';
import {normalizeSettings,SECRET_FIELDS,EDITABLE_SECRET_FIELDS,validateSettings,validateCainiaoSettings,validateAutomationSettings,nextRunAt,nextMonthlyRunAt} from '../desktop/shared/settings.mjs';
import {validateNotifications,normalizeNotificationSettings} from '../desktop/shared/notification-settings.mjs';
import {readCainiaoInventory} from '../desktop/shared/inventory-store.mjs';
import {readMonthlySalesDashboard} from '../desktop/shared/monthly-sales-store.mjs';
import {sanitizeDiagnosticText} from '../desktop/shared/diagnostics.mjs';
import {terminateProcessTree} from '../desktop/shared/task-process.mjs';
import {latestCompleteMonth,defaultBackfillRange,shiftMonth} from '../core/erp/monthly-sales-dashboard.js';
import {createDateExceptionService} from '../core/date-exception-send.mjs';
import {createWarehouseDaily,expectedInventoryDate} from '../core/erp/warehouse-daily.js';
import {sendNotificationReport} from '../core/notifications.js';
import branding from '../desktop/shared/branding.cjs';
import {STANDALONE_CHANGELOG} from '../desktop/shared/changelog.mjs';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const clean=value=>JSON.parse(JSON.stringify(value));
export async function createNasRuntime({dataDir,version='0.10.1',spawnProcess=spawn,sendReport=sendNotificationReport}={}){
 if(!dataDir)throw Error('必须指定独立数据目录');const store=createNasStorage(dataDir),workspace=store.file('workspace'),db=path.join(workspace,'data','erp.sqlite');
 let daily;try{
 for(const name of ['data','downloads','reports','state','tests/.auth','logs'])fs.mkdirSync(path.join(workspace,name),{recursive:true,mode:0o700});
 if(!fs.existsSync(path.join(workspace,'config.json')))fs.copyFileSync(path.join(sourceRoot,'config.json'),path.join(workspace,'config.json'));
 if(!fs.existsSync(db))execFileSync(process.execPath,['--input-type=module','-e',"import {getDb,closeDb} from './core/erp/db.js';getDb();closeDb();"],{cwd:sourceRoot,env:{...process.env,CAINIAO_APP_DATA_DIR:workspace,ERP_DATA_DIR:path.dirname(db)},stdio:'pipe'});
 daily=createWarehouseDaily({databasePath:db});
 const tokenActors=new Map();const actor=context=>String(context.credentialId||context.id||context.kind||'local');
 const defaults=()=>normalizeSettings({dingtalkEnabled:false,scheduleEnabled:false,monthlySalesEnabled:false,remoteServerUrl:'',runtimeMode:'standalone'});
 let settings=normalizeSettings({...defaults(),...store.read('settings.json',{})}),secrets=store.secrets(),child=null,completion=null,runningKind='',timer=null,nextDaily=null,nextMonthly=null,closing=false,closed=false,sending=false,queue=[],publisher=null,sendCompletion=null;
 const listeners=new Set(),logs=[];
 const sensitive=()=>[...Object.values(secrets).filter(v=>typeof v==='string'&&v),settings.cainiaoUsername];
 const safe=text=>sanitizeDiagnosticText(String(text),sensitive());
 function publish(type,data){for(const fn of listeners)fn(type,data);publisher?.(type,data);}
 function log(text,level='info'){const row={line:safe(`[${new Date().toISOString()}] ${text}`),level};logs.push(row);if(logs.length>300)logs.shift();fs.appendFileSync(path.join(workspace,'logs','nas.log'),row.line+'\n',{mode:0o600});publish('inventory:log',row);}
 const existingLog=path.join(workspace,'logs','nas.log');if(fs.existsSync(existingLog))for(const line of fs.readFileSync(existingLog,'utf8').split(/\r?\n/).filter(Boolean).slice(-300))logs.push({line:safe(line),level:'info'});
 const flags=()=>Object.fromEntries(SECRET_FIELDS.map(k=>[k,Boolean(secrets[k])]));
 const publicSettings=()=>({...settings,firstRun:false,runtimeMode:'standalone',secretFlags:flags()});
 const exceptions=createDateExceptionService({databasePath:db,downloadDir:path.join(workspace,'downloads'),auditPath:path.join(workspace,'state','date-exception-sends.jsonl'),expectedDate:()=>expectedInventoryDate(),getTargets:async()=>({settings,secrets}),getTargetRevision:()=>createHash('sha256').update(JSON.stringify([settings,secrets])).digest('hex'),send:sendReport});
 function state(){return {schedulingOwner:'nas',running:Boolean(child)||sending,runningKind:runningKind|| (sending?'date-exception':''),dateExceptionSending:sending,dateExceptionAvailable:!child&&!sending&&exceptions.available(),nextScheduledRun:nextDaily?.toISOString()||'',nextMonthlyScheduledRun:nextMonthly?.toISOString()||'',monthlySalesDueMonth:latestCompleteMonth(),queuedTasks:queue.map(t=>t.kind),loginUrl:'/browser/',logPath:path.join(workspace,'logs','nas.log')};}
 function emit(){publish('inventory:state',state());}
 function schedule(){clearTimeout(timer);timer=null;nextDaily=settings.scheduleEnabled?nextRunAt(settings.scheduleTime):null;nextMonthly=settings.monthlySalesEnabled?nextMonthlyRunAt(settings.monthlySalesTime):null;const dates=[nextDaily,nextMonthly].filter(Boolean).sort((a,b)=>a-b);if(dates.length&&!closing){timer=setTimeout(()=>{const cutoff=Date.now()+1500;if(nextDaily&&nextDaily.getTime()<=cutoff)queue.push({kind:'sync',options:{}});if(nextMonthly&&nextMonthly.getTime()<=cutoff)queue.push({kind:'monthly-sales',options:{month:latestCompleteMonth()}});schedule();void drain();},Math.min(2147000000,Math.max(1000,dates[0]-Date.now())));timer.unref?.();}emit();}
 const month=value=>{const m=String(value||latestCompleteMonth());if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)||m>latestCompleteMonth())throw Error('只能同步 YYYY-MM 格式的完整自然月');return m;};
 function definition(kind,options){if(kind==='sync')return ['sync-cainiao-inventory.js',[]];if(kind==='login')return ['playwright-login.js',[]];if(kind==='monthly-sales')return ['sync-cainiao-monthly-sales.js',['--month',month(options.month)]];const range={...defaultBackfillRange(),...options};range.from=month(range.from);range.to=month(range.to);let count=1;for(let m=range.from;m<range.to;m=shiftMonth(m,1))if(++count>24)throw Error('一次最多补抓24个月');if(range.from>range.to)throw Error('起始月份不能晚于结束月份');return ['backfill-cainiao-monthly-sales.js',['--from',range.from,'--to',range.to]];}
 async function stopChild(current){if(process.platform==='win32')return terminateProcessTree(current);try{process.kill(-current.pid,'SIGTERM');}catch(error){if(error.code!=='ESRCH')throw error;}const force=setTimeout(()=>{try{process.kill(-current.pid,'SIGKILL');}catch{}},5000);try{await completion;}finally{clearTimeout(force);}}
 async function drain(){if(child||sending||closing||!queue.length)return;const task=queue.shift();try{await run(task.kind,task.options);}catch(e){queue=[];log(e.message,'error');}}
 async function run(kind,options={},context={}){if(child||completion||sending)throw Error('已有任务正在运行');const [script,args]=definition(kind,options);const validation=kind==='login'?{ok:true,errors:[]}:kind==='sync'&&options.collectOnly!==true?validateSettings(settings,flags()):validateCainiaoSettings(settings,flags());if(!validation.ok)throw Error(validation.errors.join('；'));if(kind==='sync'&&options.collectOnly!==true){const notifications=validateNotifications(settings,flags(),{requireEnabled:true});if(!notifications.ok)throw Error(notifications.errors.join('；'));}
 const release=store.lock(kind),taskId=randomUUID(),startedAt=new Date().toISOString();store.receipts[taskId]={taskId,kind,status:'running',startedAt,actor:context.credentialId||context.id||context.kind||'local'};store.saveReceipts();runningKind=kind;
 const inventory=kind==='sync';const syncRunId=inventory?daily.beginRun({id:taskId,expectedSourceDate:expectedInventoryDate()}):'';const env={...process.env,CAINIAO_APP_DATA_DIR:workspace,ERP_DATA_DIR:path.dirname(db),CAINIAO_AUTO_LOGIN_RECOVERY:'1',CAINIAO_USERNAME:settings.cainiaoUsername,CAINIAO_PASSWORD:secrets.cainiaoPassword||'',BUSINESS_TIME_ZONE:'Asia/Shanghai',LOW_STOCK_THRESHOLD:String(settings.lowStockThreshold),WAREHOUSE_NOTIFICATION_CONFIG:JSON.stringify(normalizeNotificationSettings(settings)),WAREHOUSE_NOTIFICATION_SECRETS:JSON.stringify(secrets),DINGTALK_SKIP_SEND:inventory?'0':'1',DINGTALK_INVENTORY_REPORT_ENABLED:inventory?'true':'false',DINGTALK_REMINDER_ENABLED:'false',DINGTALK_DELIVERY_MODE:settings.deliveryMode,DINGTALK_CLIENT_ID:secrets.dingtalkClientId||'',DINGTALK_CLIENT_SECRET:secrets.dingtalkClientSecret||'',DINGTALK_REMINDER_ROBOT_CODE:settings.dingtalkRobotCode,DINGTALK_REMINDER_CONVERSATION_ID:settings.dingtalkConversationId,DINGTALK_WEBHOOK:secrets.dingtalkWebhook||'',DINGTALK_SECRET:secrets.dingtalkWebhookSecret||''};env.CAINIAO_COLLECT_ONLY=options.collectOnly===true?'1':'0';if(syncRunId)env.WAREHOUSE_SYNC_RUN_ID=syncRunId;delete env.ELECTRON_RUN_AS_NODE;
 try{child=spawnProcess(process.execPath,[path.join(sourceRoot,'core',script),...args],{cwd:workspace,env,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});}catch(e){release();runningKind='';store.receipts[taskId].status='failed';store.saveReceipts();throw Error(safe(e.message));}
 log('启动任务 '+kind);const current=child;let stopped=false;current.nasStop=()=>{stopped=true;};completion=new Promise(resolve=>{current.stdout?.on('data',b=>log(b));current.stderr?.on('data',b=>log(b,'error'));current.on('error',e=>log(e.message,'error'));current.once('close',code=>{let deliveryStatus='';if(syncRunId){let ledger;try{ledger=new DatabaseSync(db,{readOnly:true});deliveryStatus=JSON.parse(ledger.prepare('SELECT payload FROM warehouse_sync_runs WHERE id=?').get(syncRunId)?.payload||'{}').deliveryStatus||'';}finally{ledger?.close();}}const value={deliveryStatus,...(deliveryStatus==='unknown'?{unknown:true}:{}),success:code===0&&!stopped,cancelled:stopped,exitCode:code,kind,startedAt,finishedAt:new Date().toISOString()};Object.assign(store.receipts[taskId],{status:value.success?'succeeded':value.unknown?'unknown':'failed',value,finishedAt:value.finishedAt});store.saveReceipts();if(syncRunId)daily.updateRun(syncRunId,{finishedAt:value.finishedAt,...(!value.success?{error:stopped?'任务已中止':'同步未完成'}:{})});release();child=null;completion=null;runningKind='';emit();publish(kind==='sync'?'inventory:updated':'monthly-sales:updated');resolve({...value,taskId});if(value.success)void drain();else queue=[];});});emit();return completion;}
 async function save(payload,section){if(sending)throw Error('特殊发送期间不能修改配置');const nextSecrets={...secrets};for(const k of EDITABLE_SECRET_FIELDS){if(payload.secrets?.[k])nextSecrets[k]=String(payload.secrets[k]).trim();}for(const k of payload.clearSecrets||[]){if(!EDITABLE_SECRET_FIELDS.includes(k))throw Error('清除密钥字段无效');delete nextSecrets[k];}const next=normalizeSettings({...settings,...payload.settings,runtimeMode:'standalone'});const validators={account:validateCainiaoSettings,robot:validateNotifications,automation:validateAutomationSettings,updates:()=>({ok:true})};if(section&&!validators[section])throw Error('不支持的飞牛设置分区');const validation=(validators[section]||validateSettings)(next,Object.fromEntries(SECRET_FIELDS.map(k=>[k,Boolean(nextSecrets[k])])));if(!validation.ok)throw Error(validation.errors.join('；'));store.saveSecrets(nextSecrets);store.write('settings.json',next);settings=next;secrets=nextSecrets;schedule();publish('settings:refresh');return publicSettings();}
  async function executeCli(request={}){
 if(request.command==='collect-only'){if(request.confirmed!==true)throw Error('需要明确确认仅采集操作');const value=await run('sync',{collectOnly:true},{kind:'owner'});return {ok:value.success!==false,...(value.unknown?{unknown:true}:{}),task:value};}
 const mapping={status:'getState',inventory:'getInventory',sales:'getMonthlySales',capabilities:'getCapabilities',logs:'getLogs',sync:'runNow',login:'refreshLogin'};
 if(mapping[request.command]){if(['sync','login'].includes(request.command)&&request.confirmed!==true)throw Error('需要明确确认操作');const key={status:'status',inventory:'inventory',sales:'sales',capabilities:'capabilities',logs:'lines'}[request.command]||'task';const value=await dispatch(mapping[request.command],request.filters||{}, {kind:'owner'});return {ok:value?.success!==false,...(value?.unknown?{unknown:true}:{}),[key]:value};}
 const directory=path.join(workspace,'extensions'),extensions=()=>discoverExtensions(directory,settings.trustedExtensionIds);
 if(request.command==='extensions')return {ok:true,directory,extensions:extensions()};
 if(request.command==='extension-trust'){if(request.confirmed!==true)throw Error('需要明确确认信任扩展代码');settings.trustedExtensionIds=[...new Set([...settings.trustedExtensionIds,request.id])];store.write('settings.json',settings);return {ok:true,extensions:extensions()};}
 if(request.command==='extension-call')return {ok:true,response:await invokeTrustedExtension(extensions().find(e=>e.id===request.id),request.action,request.params,{confirmSideEffect:request.confirmSideEffect,appVersion:version,workspace})};
 if(request.command==='doctor')return {ok:true,diagnostics:{datasetId:store.identity.datasetId,platform:'fnos',state:state(),databaseExists:fs.existsSync(db)}};
 if(request.command==='debug-logs')return {ok:true,lines:logs.filter(row=>(!request.query||row.line.includes(request.query))&&(!request.level||request.level==='any'||row.level===request.level)).slice(-(request.limit||50))};
 if(request.command==='debug-bundle'){const bundle={schema:'cainiao-debug-bundle/v1',identity:{...store.identity,version},settings:publicSettings(),state:state(),logs:logs.slice()};const bytes=safe(JSON.stringify(bundle,null,2)),target=path.join(workspace,'reports','debug-'+Date.now()+'.json');fs.writeFileSync(target,bytes,{mode:0o600});return {ok:true,path:target,sha256:createHash('sha256').update(bytes).digest('hex'),size:Buffer.byteLength(bytes),bundle};}
 if(request.command==='send-latest-valid'){
 if(request.confirmed!==true||child||sending)throw Error('需要明确确认且没有其他运行任务');const checked=validateNotifications(settings,flags(),{requireEnabled:true});if(!checked.ok)throw Error(checked.errors.join('；'));const database=new DatabaseSync(db,{readOnly:true});let validated;try{validated=database.prepare("SELECT source_date AS sourceDate,row_count AS rowCount,total_quantity AS totalQuantity FROM inventory_data_validations WHERE warehouse_id='cainiao' AND status='valid' ORDER BY id DESC LIMIT 1").get();}finally{database.close();}const snapshot=readCainiaoInventory(db);if(!validated||snapshot.sourceDate!==validated.sourceDate||snapshot.skuCount!==validated.rowCount||Math.abs(snapshot.totalQuantity-validated.totalQuantity)>0.001)throw Error('最近有效库存快照与校验记录不一致');const release=store.lock('send-latest-valid');sending=true;try{const report={...snapshot,snapshotDate:snapshot.sourceDate,items:snapshot.items.map(i=>({...i,totalQuantity:i.quantity})),lowStockItems:snapshot.items.filter(i=>i.stockAlert.level!=='ok').map(i=>({...i,totalQuantity:i.quantity})).sort((a,b)=>a.sellableDays-b.sellableDays)};const markdown=buildInventoryMarkdown('table',report);sendCompletion=sendReport({title:markdown.title,text:`> 本次沿用最近已校验库存快照 ${validated.sourceDate}。\n\n`+markdown.text,settings,secrets});const delivery=await sendCompletion;if(!delivery.accepted)throw Error('部分渠道结果未确认，请人工核对服务商回执');return {ok:true,sent:true,sourceDate:validated.sourceDate,delivery};}finally{sending=false;sendCompletion=null;release();void drain();}}
 throw Error('不支持的命令');
 }
 async function dispatch(name,payload={},context={}){try{if(context.kind==='ai'&&context.write!==true&&!['getInventory','getMonthlySales','getState','getLogs','getCapabilities','getTask'].includes(name))throw Object.assign(Error('只读凭据无权执行此操作'),{code:'READ_ONLY'});switch(name){
 case 'executeCli':return executeCli(payload.request);case 'getSettings':return publicSettings();case 'getEditableSecrets':return {};case 'saveSettings':return save(payload);case 'saveSettingsSection':return save(payload,payload.section);
 case 'getBranding':return {...branding.buildBranding('fnos'),subtitle:'独立飞牛云仓'};case 'getAbout':return {version,build:{channel:'fnos'},changelog:STANDALONE_CHANGELOG};
 case 'getCapabilities':return {schemaVersion:'1.0.0',application:{name:'cainiao-cloud-warehouse',version,platform:'fnos'},datasetId:store.identity.datasetId,modes:[{id:'nas',entry:'node nas/main.mjs'}],cliCommands:['status','inventory','sales','logs','capabilities','doctor','debug-logs','debug-bundle','extensions','extension-trust','extension-call','sync','login','send-latest-valid','collect-only'],operations:['getInventory','getMonthlySales','getSettings','getState','getLogs','runNow','refreshLogin','syncMonthlySales','backfillMonthlySales','previewDateException','sendDateException']};
 case 'getInventory':return clean(readCainiaoInventory(db));case 'getMonthlySales':return clean(readMonthlySalesDashboard(db,payload));case 'getState':return state();case 'getLogs':return logs.slice();case 'getTask':return store.receipts[payload.taskId]||null;
 case 'runNow':return run('sync',{},context);case 'refreshLogin':return run('login',{},context);case 'syncMonthlySales':return run('monthly-sales',payload,context);case 'backfillMonthlySales':return run('monthly-backfill',payload,context);
 case 'stopTask':{queue=[];if(!child)return {stopped:false};child.nasStop();await stopChild(child);await completion;return {stopped:true};}
 case 'previewDateException':{if(child||sending)throw Error('已有任务正在运行');const preview=await exceptions.preview();tokenActors.set(preview.token,actor(context));return {...preview,confirmationToken:preview.token};}
 case 'sendDateException':{if(child||sending)throw Error('已有任务正在运行');const release=store.lock('date-exception-send');sending=true;emit();try{const token=payload.token||payload.confirmationToken;if(tokenActors.get(token)!==actor(context))throw Error('确认令牌不属于当前调用身份');tokenActors.delete(token);sendCompletion=exceptions.send({...payload,token});return await sendCompletion;}finally{sendCompletion=null;sending=false;release();emit();void drain();}}
 case 'getIntegration':return {cli:{command:'node',args:['nas/cli.mjs'],examples:['status','inventory','sales']},mcp:{command:'node',args:['nas/cli.mjs','--mcp-stdio']},runtime:{apiVersion:'1.0.0',modes:['nas']}};
 case 'getUpdateState':case 'checkForUpdates':return {currentVersion:version,status:'idle',message:'请在飞牛应用中心或部署管理中更新独立应用'};
 case 'installUpdate':return {opened:false,message:'请在飞牛应用中心更新应用'};
 case 'openLogs':return {path:path.join(workspace,'logs'),message:'可通过飞牛文件管理查看日志目录'};case 'openData':return {path:workspace,message:'可通过飞牛文件管理查看独立数据目录'};
 case 'openWeb':return {url:'/'};case 'openRepository':case 'openWebsite':case 'openReleaseNotes':return {url:'https://github.com/907609732/cainiao-inventory'};
 default:throw Object.assign(Error('不支持的操作'),{code:'UNKNOWN_OPERATION'});
 }}catch(e){e.message=safe(e.message);throw e;}}
 return {identity:{...store.identity,version},dispatch,start:async()=>{closing=false;schedule();},close:async()=>{if(closed)return;closed=true;closing=true;clearTimeout(timer);queue=[];if(sendCompletion)await sendCompletion.catch(()=>{});if(child){child.nasStop();await stopChild(child);await completion;}daily.close();store.releaseOwner();},subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},setPublisher(fn){publisher=fn;},executeCli,storage:store};
 }catch(error){daily?.close();store.releaseOwner();throw error;}
}














