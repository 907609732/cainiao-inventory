import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {_electron} from 'playwright';
process.chdir(path.resolve(import.meta.dirname,'..'));
const expectedVersion=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'cainiao-web-ui-'));
const env={...process.env};
for(const key of Object.keys(env))if(/^(LINGTU_|ERP_|CAINIAO_|DINGTALK_)/.test(key)||key==='ELECTRON_RUN_AS_NODE')delete env[key];
Object.assign(env,{LINGTU_ISOLATED_TEST:'1',LINGTU_TEST_LEDGER:'1',CAINIAO_APP_DATA_DIR:path.join(profile,'workspace'),ERP_DATA_DIR:path.join(profile,'workspace','data')});
fs.mkdirSync(env.ERP_DATA_DIR,{recursive:true});
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({runtimeMode:'standalone',scheduleEnabled:false,monthlySalesEnabled:false,startAtLogin:false,dingtalkEnabled:false,firstRunPending:false}));
const fixture=`import {getDb,closeDb} from './core/erp/db.js';
const db=getDb();db.prepare('INSERT INTO skus(sku,name,low_stock_threshold) VALUES(?,?,?)').run('DEMO-WEB-001','网页演示商品',10);
db.prepare('INSERT INTO inventory_snapshots(sku,warehouse_id,snapshot_date,quantity) VALUES(?,?,?,?)').run('DEMO-WEB-001','cainiao','2026-11-10',123);
db.prepare('INSERT INTO warehouse_monthly_sales(warehouse_id,sku,month,product_name,period_start,period_end,toc_sales,tob_sales,sales_quantity,source_file,source_file_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('cainiao','DEMO-WEB-001','2026-10','网页演示商品','2026-10-01','2026-10-31',30,5,35,'DEMO.xlsx','demo-hash');
closeDb();`;
const init=spawnSync(process.execPath,['--input-type=module','-e',fixture],{env,encoding:'utf8',windowsHide:true});
assert.equal(init.status,0,init.stderr);
let app;
try{
 const exe=process.env.WAREHOUSE_TEST_EXE||path.resolve('node_modules/electron/dist/electron.exe');
 app=await _electron.launch({executablePath:exe,args:[...(process.env.WAREHOUSE_TEST_EXE?[]:['.']),'--user-data-dir='+profile,'--web-port=0'],env});
 const page=await app.firstWindow();await page.waitForFunction(()=>window.inventoryApp);
 const access=await page.evaluate(()=>window.inventoryApp.getLocalAccess());
 assert.match(access.origin,/^http:\/\/127\.0\.0\.1:\d+$/);
 assert.deepEqual(access.credentials,[]);
 const desktopInventory=await page.evaluate(()=>window.inventoryApp.getInventory());
 assert.equal(desktopInventory.totalQuantity,123);
 const discovery=JSON.parse(fs.readFileSync(path.join(profile,'workspace/state/local-web.json'),'utf8'));
 const pid=discovery.pid;
 // Create an actual HTTP renderer without any preload/Node privileges.
 await app.evaluate(({shell})=>{shell.openExternal=async url=>{globalThis.__warehouseOpenedUrl=url;};});
 await page.evaluate(()=>window.inventoryApp.openWeb());
 const url=await app.evaluate(()=>globalThis.__warehouseOpenedUrl);
 const webWindow=app.waitForEvent('window');
 await app.evaluate(({BrowserWindow},url)=>{globalThis.webTestWindow=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});globalThis.webTestWindow.loadURL(url);},url);
 const web=await webWindow;
 await web.waitForFunction(version=>document.querySelector('#aboutVersion')?.textContent.trim() === 'v'+version,expectedVersion);
 for(const view of ['dashboard','inventory','sales','settings']){
  await web.locator(`.view-tab[data-view="${view}"]`).click();
  await web.locator(`[data-view-panel="${view}"]`).waitFor({state:'visible'});
 }
 assert.deepEqual(await web.evaluate(()=>window.inventoryApp.getEditableSecrets()),{});
 assert.deepEqual(await web.evaluate(()=>window.inventoryApp.getInventory()),desktopInventory);
 assert.deepEqual(await web.evaluate(()=>window.inventoryApp.getMonthlySales({year:'2026'})),await page.evaluate(()=>window.inventoryApp.getMonthlySales({year:'2026'})));
 await web.evaluate(()=>window.inventoryApp.saveSettingsSection({section:'account',settings:{cainiaoUsername:'DEMO-WEB-ACCOUNT'},secrets:{cainiaoPassword:'DEMO-PASSWORD-ONLY'}}));
 assert.equal((await page.evaluate(()=>window.inventoryApp.getSettings())).cainiaoUsername,'DEMO-WEB-ACCOUNT');
 assert.equal((await web.evaluate(()=>window.inventoryApp.getSettings())).cainiaoUsername,'DEMO-WEB-ACCOUNT');
 assert.deepEqual(await web.evaluate(()=>window.inventoryApp.getEditableSecrets()),{});
 const runCli=(command)=>new Promise((resolve,reject)=>{
  const child=spawn(exe,[...(process.env.WAREHOUSE_TEST_EXE?[]:['.']),'--cli',command,'--user-data-dir='+profile],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.once('error',reject);child.once('close',code=>{try{assert.equal(code,0,err);resolve(JSON.parse(out));}catch(error){reject(error);}});
 });
 assert.deepEqual((await runCli('inventory')).inventory,desktopInventory);
 const token=await web.evaluate(()=>window.inventoryApp.createAiCredential({write:false,confirmed:true}));
 assert.equal(typeof token.token,'string');
 const api=await fetch(access.origin+'/api/v1/call/getInventory',{method:'POST',headers:{authorization:'Bearer '+token.token,'content-type':'application/json'},body:'{}'});
 assert.equal(api.status,200);
 const denied=await fetch(access.origin+'/api/v1/call/runNow',{method:'POST',headers:{authorization:'Bearer '+token.token,'content-type':'application/json','idempotency-key':'readonly-attempt'},body:JSON.stringify({confirmed:true})});
 assert.equal(denied.status,403);
 await web.reload();await web.waitForFunction(version=>document.querySelector('#aboutVersion')?.textContent.trim() === 'v'+version,expectedVersion);
 assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'workspace/state/local-web.json'),'utf8')).pid,pid);
 await web.evaluate(id=>window.inventoryApp.revokeAiCredential({id,confirmed:true}),token.id);
 assert.equal((await fetch(access.origin+'/api/v1/call/getInventory',{method:'POST',headers:{authorization:'Bearer '+token.token,'content-type':'application/json'},body:'{}'})).status,401);
 // In this isolated owner only, replace child spawning with a failing local
 // EventEmitter; no login/browser/platform process can run during this check.
 await app.evaluate(async()=>{
  const cp=process.getBuiltinModule('child_process'),{syncBuiltinESMExports}=process.getBuiltinModule('module');
  const {EventEmitter}=process.getBuiltinModule('events'),{PassThrough}=process.getBuiltinModule('stream');
  globalThis.restoreSpawn=()=>{cp.spawn=globalThis.originalSpawn;syncBuiltinESMExports();};
  globalThis.originalSpawn=cp.spawn;
  cp.spawn=()=>{const child=new EventEmitter();child.pid=999999;child.stdout=new PassThrough();child.stderr=new PassThrough();setTimeout(()=>{child.stdout.write('DEMO-PASSWORD-ONLY\n');child.emit('close',globalThis.syntheticChildExit??1);},150);return child;};
  syncBuiltinESMExports();
 });
 await assert.rejects(web.evaluate(()=>window.inventoryApp.refreshLogin()),/failed|失败/i);
 assert.equal((await web.evaluate(()=>window.inventoryApp.getState())).running,false);
 await app.evaluate(()=>{globalThis.syntheticChildExit=0;});
 const successTask=await web.evaluate(()=>window.inventoryApp.refreshLogin());
 assert.doesNotMatch(JSON.stringify(successTask),/DEMO-PASSWORD-ONLY/);
 for(const file of fs.readdirSync(path.join(profile,'workspace/state/local-web-tasks'))){assert.doesNotMatch(fs.readFileSync(path.join(profile,'workspace/state/local-web-tasks',file),'utf8'),/DEMO-PASSWORD-ONLY/);}
 await app.evaluate(()=>globalThis.restoreSpawn());
 // A repeated --background launch must not open another window or scheduler.
 await new Promise((resolve,reject)=>{const child=spawn(exe,[...(process.env.WAREHOUSE_TEST_EXE?[]:['.']),'--background','--user-data-dir='+profile,'--web-port=0'],{env,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('close',()=>resolve());});
 assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'workspace/state/local-web.json'),'utf8')).pid,pid);
 await app.evaluate(()=>globalThis.webTestWindow.destroy());
 assert.equal((await fetch(access.origin+'/api/v1/health')).status,200);
 console.log(JSON.stringify({ok:true,packaged:Boolean(process.env.WAREHOUSE_TEST_EXE),fourViews:true,sessionReload:true,sameOwner:true,readonlyAi:true,aiRevocation:true,cliSharedOwner:true,syntheticDataAndSettingsShared:true,plaintextSecretsExposed:false,realMessagesSent:false}));
}finally{
 if(app){await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{});}
 fs.rmSync(profile,{recursive:true,force:true});
}
