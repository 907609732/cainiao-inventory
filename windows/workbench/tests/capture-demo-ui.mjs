import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';

const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(sourceRoot);
const output=path.resolve(sourceRoot,'../../docs/images/ui-demo');
const profile=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'cainiao-public-demo-')));
const workspace=path.join(profile,'workspace'),data=path.join(workspace,'data');
fs.mkdirSync(data,{recursive:true});fs.mkdirSync(output,{recursive:true});
process.env.CAINIAO_APP_DATA_DIR=workspace;process.env.ERP_DATA_DIR=data;
const {getDb,closeDb}=await import('../core/erp/db.js');
const db=getDb();
const products=['收纳盒','文件夹','标签纸','杯垫','笔记本','书立','收纳袋','便签'].map((name,index)=>({
  sku:`DEMO-${String(index+1).padStart(3,'0')}`,name:`演示商品 ${String.fromCharCode(65+index)} · ${name}`,
  quantity:[0,5,12,22,45,80,120,32][index],near30:[90,60,45,30,30,24,12,20][index]
}));
const sourceDate='2026-10-15',stamp='2026-10-15T09:30:00Z',fakeHash='0'.repeat(64);
for(const p of products){
  db.prepare('INSERT INTO skus(sku,name,barcode,low_stock_threshold) VALUES(?,?,?,10)').run(p.sku,p.name,'DEMO-BARCODE-'+p.sku);
  db.prepare('INSERT INTO inventory_snapshots(sku,warehouse_id,snapshot_date,quantity,imported_at) VALUES(?,?,?,?,?)').run(p.sku,'cainiao',sourceDate,p.quantity,stamp);
  db.prepare('INSERT INTO monthly_outbound(sku,warehouse_id,month,total_outbound,near_30_days_sales) VALUES(?,?,?,?,?)').run(p.sku,'cainiao','2026-10',p.near30,p.near30);
}
db.prepare('INSERT INTO inventory_data_validations(warehouse_id,source_file,source_date,status,row_count,total_quantity,checks_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
  .run('cainiao','DEMO-ONLY.xlsx',sourceDate,'valid',products.length,products.reduce((s,p)=>s+p.quantity,0),'{"synthetic":true}',stamp);
for(const year of [2025,2026])for(let month=1;month<=(year===2025?12:9);month++){
  if(year===2026&&month===6)continue; // A deliberate gap, never fabricated as zero sales.
  const period=`${year}-${String(month).padStart(2,'0')}`,start=period+'-01';
  const end=period+'-'+String(new Date(Date.UTC(year,month,0)).getUTCDate()).padStart(2,'0');
  let total=0;
  for(const [index,p] of products.entries()){
    let toc=35+index*9+month*6+(year===2026?18:0)+Math.round(Math.sin(month+index)*12);
    if(year===2026&&month===9&&index<2)toc=Math.round(toc*0.45);
    const tob=5+(month+index)%5*4;total+=toc+tob;
    db.prepare('INSERT INTO warehouse_monthly_sales(warehouse_id,sku,month,product_name,period_start,period_end,toc_sales,tob_sales,sales_quantity,source_file,source_file_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('cainiao',p.sku,period,p.name,start,end,toc,tob,toc+tob,'DEMO-ONLY.xlsx',fakeHash);
  }
  db.prepare('INSERT INTO warehouse_monthly_sales_validations(warehouse_id,month,status,row_count,sku_count,total_sales_quantity,source_file_hash,period_start,period_end) VALUES(?,?,?,?,?,?,?,?,?)')
    .run('cainiao',period,'valid',8,8,total,fakeHash,start,end);
}
closeDb();
fs.writeFileSync(path.join(profile,'settings.json'),JSON.stringify({runtimeMode:'standalone',remoteServerUrl:'https://example.invalid',
  firstRunPending:false,scheduleEnabled:false,monthlySalesEnabled:false,startAtLogin:false,
  cainiaoUsername:'demo@example.test',deliveryMode:'app',dingtalkRobotCode:'DEMO-ROBOT',
  dingtalkConversationId:'DEMO-GROUP-NOT-CONNECTED',dingtalkTargetName:'演示接收人（未连接）'}));
const env={...process.env};
for(const key of Object.keys(env))if(/^(?:CAINIAO_|DINGTALK_|LINGTU_|ERP_|GH_TOKEN$|GITHUB_TOKEN$)|SECRET|PASSWORD|API_KEY|ACCESS_TOKEN/.test(key))delete env[key];
Object.assign(env,{CAINIAO_APP_DATA_DIR:workspace,ERP_DATA_DIR:data,LINGTU_REGISTRY_PATH:path.join(profile,'registry.json'),
  LINGTU_TEST_LEDGER:'1',LINGTU_ISOLATED_TEST:'1',LINGTU_MANAGED_MODULE:'0',LINGTU_BUSINESS_ONLY:'1'});
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors=[],images=[];
try{
  app=await _electron.launch({executablePath:path.resolve('node_modules/electron/dist/electron.exe'),args:['.','--user-data-dir='+profile],env});
  await app.evaluate(({session})=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,done)=>done({cancel:true})));
  const page=await app.firstWindow();page.on('pageerror',error=>errors.push(error.message));
  await page.setViewportSize({width:1280,height:940});
  await page.waitForLoadState('domcontentloaded');await page.waitForFunction(()=>!!window.inventoryApp);
  assert.equal(await app.evaluate(({app})=>app.getPath('userData')),profile);
  assert.equal(await app.evaluate(()=>process.env.ERP_DATA_DIR),data);
  const inventory=await page.evaluate(()=>window.inventoryApp.getInventory());
  assert.equal(inventory.skuCount,8);assert.equal(inventory.totalQuantity,316);
  assert.ok(inventory.items.every(p=>p.sku.startsWith('DEMO-')&&p.name.startsWith('演示商品')));
  const sales=await page.evaluate(()=>window.inventoryApp.getMonthlySales({year:'2026',selectedMonth:'2026-09'}));
  assert.equal(sales.summary.validMonthCount,8);assert.ok(sales.skuOptions.every(p=>p.sku.startsWith('DEMO-')));
  const state=await page.evaluate(()=>window.inventoryApp.getState());
  assert.equal(state.running,false);assert.equal(Boolean(state.nextScheduledRun),false);
  await page.evaluate(()=>{
    const banner=document.createElement('aside');banner.id='public-demo-label';
    banner.textContent='演示数据 · DEMO ONLY  |  商品、SKU、库存与销量均为虚构测试数据，未连接真实账号或发送消息。';
    Object.assign(banner.style,{padding:'14px 32px',background:'#fff4d8',color:'#735212',font:'600 14px sans-serif',borderBottom:'1px solid #e7d5a5'});
    document.body.prepend(banner);
  });
  async function capture(name,clipTo){
    await page.evaluate(async()=>{await document.fonts.ready;for(const id of ['monthlySalesChart','annualSalesChart']){const chart=window.echarts?.getInstanceByDom(document.getElementById(id));if(chart){chart.setOption({animation:false});chart.getZr().flush();}}await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});
    assert.doesNotMatch(await page.locator('body').innerText(),/[A-Z]:\\Users\\/i);
    for(const input of await page.locator('input[type="password"]').all())assert.equal(await input.inputValue(),'');
    const bounds=clipTo?await page.locator(clipTo).boundingBox():null;
    const viewport=page.viewportSize();
    if(bounds)await page.setViewportSize({width:1280,height:Math.ceil(bounds.y+bounds.height+24)});
    await page.screenshot({path:path.join(output,name+'.png'),fullPage:!bounds});
    if(bounds)await page.setViewportSize(viewport);
    images.push(name+'.png');
  }
  await capture('overview');
  await page.locator('[data-view="inventory"]').click();await page.locator('#inventoryGrid').getByText('DEMO-001',{exact:true}).waitFor();
  await capture('inventory');
  await page.locator('[data-inventory-filter="critical"]').click();
  await page.waitForFunction(()=>document.querySelectorAll('#inventoryGrid tbody tr').length===2);
  await page.locator('[data-inventory-filter="all"]').click();
  await page.locator('[data-view="sales"]').click();
  await page.locator('#salesYear').selectOption('2026');await page.locator('#salesMonth').selectOption('2026-09');
  await page.locator('#salesRankingTitle').filter({hasText:'2026-09'}).waitFor();
  await capture('sales-overall');
  await page.locator('[data-sales-scope="multi"]').click();await page.locator('#salesSeriesModeField').waitFor({state:'visible'});
  await page.waitForFunction(()=>window.echarts.getInstanceByDom(document.getElementById('monthlySalesChart')).getOption().series.length===5);
  await capture('sales-multi');
  await page.locator('[data-sales-scope="sku"]').click();await page.locator('#salesSku').fill('DEMO-003');
  await page.locator('#refreshMonthlySales').click();
  await page.waitForFunction(()=>document.querySelector('#salesTotalLabel').textContent.includes('演示商品 C'));
  await capture('sales-single');
  await page.locator('[data-view="settings"]').click();await page.locator('#cainiaoUsername').waitFor({state:'visible'});
  assert.equal(await page.locator('#cainiaoUsername').inputValue(),'demo@example.test');
  await page.evaluate(()=>{
    document.getElementById('cliCommand').textContent='CainiaoWarehouse.exe --cli status';
    document.getElementById('debugCommand').textContent='CainiaoWarehouse.exe --cli doctor';
    document.getElementById('extensionDirectory').textContent='[演示目录]\\workspace\\extensions';
    document.getElementById('mcpCommand').textContent=JSON.stringify({command:'CainiaoWarehouse.exe',args:['--mcp-stdio']});
    window.scrollTo(0,0);
  });
  await capture('settings','#settingsLinks');
  assert.deepEqual(errors,[]);
  const version=await app.evaluate(({app})=>app.getVersion());
  fs.writeFileSync(path.join(output,'demo-manifest.json'),JSON.stringify({softwareVersion:version,synthetic:true,realDataRead:false,
    credentialsIncluded:false,electronHttpRequestsBlocked:true,scheduledTasksEnabled:false,environmentPathsReplacedWithDemoPlaceholders:true,settingsScreenshotIsExcerpt:true,sourceDate,skuCount:8,totalQuantity:316,
    validMonths2026:['01','02','03','04','05','07','08','09'],images,rendererErrors:errors,fixture:'windows/workbench/tests/capture-demo-ui.mjs'},null,2)+'\n');
  console.log(JSON.stringify({version,images,synthetic:true,realDataRead:false,output}));
}finally{
  await app?.close();assert.ok(path.basename(profile).startsWith('cainiao-public-demo-'));
  fs.rmSync(profile,{recursive:true,force:true});
}
