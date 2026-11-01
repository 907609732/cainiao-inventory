import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {randomUUID} from 'node:crypto';
import {getWarehouseLocation,workbenchLocationFile} from '../desktop/shared/workbench-location.mjs';
import {requestedUserDataPath} from '../desktop/shared/user-data-path.mjs';

const source=fs.readFileSync(new URL('../desktop/main.mjs',import.meta.url),'utf8');
const start=source.indexOf('let startupLocation;'),end=source.indexOf('const desktopDir =');
assert(start>=0&&end>start,'Standalone desktop location bootstrap must precede app initialization');
// Execute only the actual pre-initialization location block with a fake Electron
// app. This cannot initialize the application, ledger, scheduler, CLI or MCP.
const bootstrap=new vm.Script('(async()=>{'+source.slice(start,end)+';return {profile:stableUserDataPath,registry:process.env.LINGTU_REGISTRY_PATH};})()');
function fixture(t){
  const created=fs.mkdtempSync(path.join(os.tmpdir(),'desktop-location-bootstrap-')),root=fs.realpathSync.native(created);t.after(()=>{assert(path.basename(root).startsWith('desktop-location-bootstrap-'));assert.equal(fs.realpathSync.native(root),root);fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:100});});
  const home=path.join(root,'home'),appData=path.join(root,'classic-appdata'),profile=path.join(root,'physical-profile'),registry=path.join(home,'Documents','LingtuWorkbench','registry.json'),identity={schemaVersion:1,serverId:randomUUID(),dataSetId:randomUUID()};
  fs.mkdirSync(path.join(profile,'workbench-server'),{recursive:true});fs.mkdirSync(path.dirname(registry),{recursive:true});fs.writeFileSync(registry,'{}');fs.writeFileSync(path.join(profile,'workbench-server','identity.json'),JSON.stringify(identity));fs.writeFileSync(workbenchLocationFile(home),JSON.stringify({schemaVersion:1,profile,registryFile:registry,serverId:identity.serverId,dataSetId:identity.dataSetId}));
  return {root,home,appData,profile,registry,identity};
}
async function run(f,{args=[],env={}}={}){
  const calls={mkdir:[],setPath:[],dialogs:[],errors:[]},context={
    workbenchManaged:env.LINGTU_MANAGED_MODULE==='1'||args.includes('--managed-module=warehouse'),
    path,fs:{mkdirSync:(file,options)=>{calls.mkdir.push(file);return fs.mkdirSync(file,options);}},
    app:{getPath:name=>{assert.equal(name,'appData');return f.appData;},whenReady:async()=>{},setPath:(name,file)=>calls.setPath.push({name,file})},
    dialog:{showErrorBox:(...args)=>calls.dialogs.push(args)},
    process:{argv:['fixture.exe',...args],env:{...env},stderr:{write:text=>calls.errors.push(text)},exit:code=>{throw Object.assign(Error('fixture app exited'),{code:'APP_EXIT',exitCode:code,calls});}},
    requestedUserDataPath,getWarehouseLocation:(appData,options)=>getWarehouseLocation(appData,{...options,home:f.home})
  };
  const result=await bootstrap.runInNewContext(context);return {result,calls,env:context.process.env};
}

test('standalone GUI uses its own profile even with an adopted workbench',async t=>{
 const f=fixture(t),r=await run(f),profile=path.join(f.appData,'cainiao-cloud-warehouse');assert.equal(r.result.profile,profile);assert.equal(r.result.registry,path.join(profile,'integrations','registry.json'));assert.deepEqual(r.calls.setPath,[{name:'userData',file:profile}]);
});
test('standalone CLI and MCP cannot inherit the workbench registry',async t=>{
 const f=fixture(t);for(const mode of ['--cli','--mcp-stdio']){const r=await run(f,{args:[mode],env:{LINGTU_REGISTRY_PATH:f.registry}});assert.equal(r.result.profile,path.join(f.appData,'cainiao-cloud-warehouse'));assert.notEqual(r.result.registry,f.registry);assert.equal(r.calls.errors.length,0);}
});
test('managed warehouse explicit profile and registry take precedence over an invalid marker',async t=>{
 const f=fixture(t),profile=path.join(f.root,'managed'),registry=path.join(f.root,'explicit-registry.json');fs.mkdirSync(profile);fs.writeFileSync(workbenchLocationFile(f.home),'{bad');const r=await run(f,{args:['--managed-module=warehouse','--user-data-dir='+profile],env:{LINGTU_REGISTRY_PATH:registry}});assert.equal(r.result.profile,profile);assert.equal(r.result.registry,registry);
});
test('standalone ignores invalid host binding while managed warehouse still fails closed',async t=>{
 const f=fixture(t);fs.unlinkSync(path.join(f.profile,'workbench-server','identity.json'));
 for(const args of [[],['--cli','status'],['--mcp-stdio']]){const r=await run(f,{args});assert.equal(r.result.profile,path.join(f.appData,'cainiao-cloud-warehouse'));}
 for(const args of [['--managed-module=warehouse'],['--managed-module=warehouse','--cli','status'],['--managed-module=warehouse','--mcp-stdio']])await assert.rejects(run(f,{args}),e=>{assert.equal(e.code,'APP_EXIT');assert.deepEqual(e.calls.mkdir,[]);assert.deepEqual(e.calls.setPath,[]);return true;});
});
test('explicit managed component resolves the original workbench binding',async t=>{const f=fixture(t),r=await run(f,{args:['--managed-module=warehouse']});assert.equal(r.result.profile,f.profile);assert.equal(r.result.registry,f.registry);});
