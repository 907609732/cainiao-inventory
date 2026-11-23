import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import http from 'node:http';
import {chromium} from 'playwright';
import {createNasRuntime} from '../nas/runtime.mjs';
import {createNasGateway} from '../nas/server/gateway.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cainiao-nas-ui-'));
const runtime=await createNasRuntime({dataDir:root});
const gatewayMode=process.env.CAINIAO_TEST_UNIFIED_GATEWAY==='1';
const prefix='/app/cainiao-warehouse';
const socket=process.platform==='win32'?`\\\\.\\pipe\\cainiao-ui-${process.pid}`:path.join(root,'app.sock');
const gateway=createNasGateway({runtime,root,browserPasswordRequired:false,...(gatewayMode?{gatewayPrefix:prefix,gatewaySocket:socket}:{})});
let proxy;
let browser;
try {
 await gateway.start();await runtime.start();
 let entry=gateway.address;
 if(gatewayMode){
  // Isolated fake fnOS transport: inject identity only at this private test proxy.
  proxy=http.createServer((req,res)=>{
   const upstream=http.request({socketPath:socket,path:req.url,method:req.method,headers:{...req.headers,host:'127.0.0.1','x-forwarded-proto':'http','x-trim-userid':'1000','x-trim-isadmin':'true'}},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});
   upstream.on('error',error=>res.destroy(error));req.pipe(upstream);
  });
  await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  entry=`http://127.0.0.1:${proxy.address().port}${prefix}/`;
 }
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(entry);


 await page.locator('#warehouseLoading').waitFor({state:'hidden'});
 await page.locator('#nasBrowserEntry').waitFor();
 for(const view of ['dashboard','inventory','sales','settings']){
  await page.locator(`[data-view="${view}"]`).click();
  await page.locator(`[data-view-panel="${view}"]`).waitFor({state:'visible'});
 }
 assert.deepEqual(await page.evaluate(()=>window.inventoryApp.getEditableSecrets()),{});
 assert.equal((await page.evaluate(()=>window.inventoryApp.getInventory())).available,false);
 await page.locator('#cainiaoUsername').fill('DEMO-NAS-ACCOUNT');
 await page.locator('#cainiaoPassword').fill('DEMO-NAS-PASSWORD');
 await page.getByRole('button',{name:'保存账号设置',exact:true}).click();
 await page.waitForFunction(async()=> (await window.inventoryApp.getSettings()).cainiaoUsername==='DEMO-NAS-ACCOUNT');
 await page.reload();await page.locator('#warehouseLoading').waitFor({state:'hidden'});
 await page.locator('[data-view="settings"]').click();
 assert.equal(await page.locator('#cainiaoUsername').inputValue(),'DEMO-NAS-ACCOUNT');
 assert.equal(await page.locator('#cainiaoPassword').inputValue(),'');
 await page.locator('[data-secret-target="cainiaoPassword"]').click();
 await page.waitForFunction(()=>document.getElementById('cainiaoPassword').value==='DEMO-NAS-PASSWORD'&&document.getElementById('cainiaoPassword').type==='text');
 await page.locator('[data-secret-target="cainiaoPassword"]').click();
 assert.equal(await page.locator('#cainiaoPassword').getAttribute('type'),'password');
 assert.equal(await page.locator('#cainiaoPassword').inputValue(),'');

 const credential=await gateway.credentials.create();
 const query=await fetch(gateway.apiAddress+'/api/v1/call/getInventory',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+credential.token},body:'{}'});
 assert.equal(query.status,200);
 await gateway.credentials.revoke(credential.id);
 assert.deepEqual(errors,[]);
 const evidence=process.env.CAINIAO_NAS_UI_SCREENSHOT;
 if(evidence)await page.screenshot({path:path.resolve(evidence),fullPage:true});
 console.log(JSON.stringify({ok:true,fourViews:true,emptyDataset:true,settingsPersisted:true,passwordNotReturned:true,erpReadonlyQuery:true,rendererErrors:errors,realMessagesSent:false}));
} finally {
 await browser?.close();await runtime.close();await gateway.stop();
 await new Promise(resolve=>proxy?proxy.close(resolve):resolve());
 const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
}
