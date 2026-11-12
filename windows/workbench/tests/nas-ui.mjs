import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createNasRuntime} from '../nas/runtime.mjs';
import {createNasGateway} from '../nas/server/gateway.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'cainiao-nas-ui-'));
const runtime=await createNasRuntime({dataDir:root});
const password=randomBytes(24).toString('base64url');
const gateway=createNasGateway({runtime,root,adminPassword:password});
let browser;
try {
 await gateway.start();await runtime.start();
 browser=await chromium.launch({headless:true,...(process.platform==='win32'?{channel:'chrome'}:{})});
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(gateway.address);
 await page.locator('input[type="password"]').fill(password);
 await page.getByRole('button',{name:'登录',exact:true}).click();
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
 const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});
}
