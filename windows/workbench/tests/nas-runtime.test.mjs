import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createNasRuntime} from '../nas/runtime.mjs';
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'nas-runtime-'));
test('new dataset stays empty and identity survives restart with notifications disabled',async()=>{
 const dataDir=temporary();let runtime=await createNasRuntime({dataDir,version:'0.10.0'});
 const id=runtime.identity.datasetId; assert.match(id,/^[a-f0-9-]{36}$/);
 assert.equal((await runtime.dispatch('getInventory')).available,false);
 const settings=await runtime.dispatch('getSettings');assert.equal(settings.scheduleEnabled,false);assert.equal(settings.monthlySalesEnabled,false);assert.equal(settings.dingtalkEnabled,false);
 await runtime.close();runtime=await createNasRuntime({dataDir});assert.equal(runtime.identity.datasetId,id);await runtime.close();fs.rmSync(dataDir,{recursive:true});
});
test('account secrets encrypt at rest, survive restart and never reach settings or logs',async()=>{
 const dataDir=temporary();let runtime=await createNasRuntime({dataDir});
 await runtime.dispatch('saveSettingsSection',{section:'account',settings:{cainiaoUsername:'test'},secrets:{cainiaoPassword:'needle-secret-123'}});
 assert.equal(JSON.stringify(await runtime.dispatch('getSettings')).includes('needle-secret'),false);
 assert.equal(fs.readFileSync(path.join(dataDir,'secrets.bin')).includes('needle-secret'),false);
 await runtime.close();runtime=await createNasRuntime({dataDir});assert.equal((await runtime.dispatch('getSettings')).secretFlags.cainiaoPassword,true);await runtime.close();fs.rmSync(dataDir,{recursive:true});
});
test('unfinished receipts become unknown after restart without replay',async()=>{
 const dataDir=temporary();let runtime=await createNasRuntime({dataDir});await runtime.close();
 fs.writeFileSync(path.join(dataDir,'run-receipts.json'),JSON.stringify({test:{taskId:'test',status:'running'}}));
 runtime=await createNasRuntime({dataDir});assert.equal((await runtime.dispatch('getTask',{taskId:'test'})).status,'unknown');await runtime.close();fs.rmSync(dataDir,{recursive:true});
});
test('injected child task records completion and masks captured output',async()=>{
 const dataDir=temporary();const {EventEmitter}=await import('node:events');const {PassThrough}=await import('node:stream');let launched;
 const runtime=await createNasRuntime({dataDir,spawnProcess:(exe,args,options)=>{launched={exe,args,options};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.pid=999999;setImmediate(()=>{child.stdout.write('needle-child-secret');child.emit('close',0);});return child;}});
 await runtime.dispatch('saveSettingsSection',{section:'account',settings:{cainiaoUsername:'test'},secrets:{cainiaoPassword:'needle-child-secret'}});
 const result=await runtime.dispatch('refreshLogin');assert.equal(result.success,true);assert.equal(launched.options.env.CAINIAO_APP_DATA_DIR,path.join(dataDir,'workspace'));assert.match(launched.args[0],/playwright-login.js$/);assert.equal(JSON.stringify(await runtime.dispatch('getLogs')).includes('needle-child-secret'),false);assert.equal((await runtime.dispatch('getTask',{taskId:result.taskId})).status,'succeeded');await runtime.close();fs.rmSync(dataDir,{recursive:true});
});
test('invalid month cannot start collection',async()=>{const dataDir=temporary();const runtime=await createNasRuntime({dataDir});await assert.rejects(runtime.dispatch('syncMonthlySales',{month:'2026-13'}),/完整自然月/);await runtime.close();fs.rmSync(dataDir,{recursive:true});});
test('a second runtime cannot change live receipts',async()=>{const dataDir=temporary();const first=await createNasRuntime({dataDir});await assert.rejects(createNasRuntime({dataDir}),/已有任务/);await first.close();fs.rmSync(dataDir,{recursive:true});});

