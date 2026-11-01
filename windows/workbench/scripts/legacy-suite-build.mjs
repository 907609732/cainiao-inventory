import fs from 'node:fs';import path from 'node:path';
export function buildLegacyWarehouse({root,work,output,host,sources,npmCli,builder,copy,run}){
const source=path.resolve(import.meta.dirname,'..');
const cloudStage=path.join(work,'warehouse-source');fs.mkdirSync(cloudStage);
for(const name of ['desktop','core','config.json','package.json','package-lock.json'])copy(path.join(source,name),path.join(cloudStage,name));
run(process.execPath,[npmCli,'ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{cwd:cloudStage});
const cloudOutput=path.join(work,'warehouse-output'),cloudConfig=path.join(work,'warehouse-builder.cjs');
const cloudBuildInfo=path.join(work,'cloud-build-info.json');fs.writeFileSync(cloudBuildInfo,JSON.stringify({channel:'release',productVersion:host.version,builtAt:new Date().toISOString(),sourceDigest:sources.warehouse}));
fs.writeFileSync(cloudConfig,'module.exports='+JSON.stringify({appId:'com.wucheng.ecommerce.erp.v2',productName:'菜鸟云仓同步',executableName:'LingtuWarehouseModule',electronVersion:JSON.parse(fs.readFileSync('node_modules/electron/package.json','utf8')).version,electronDist:path.join(root,'node_modules/electron/dist'),directories:{output:cloudOutput},files:['desktop/**/*','!desktop/launcher/**/*','!desktop/workbench-client/**/*','!desktop/workbench-migration/**/*','!desktop/invoice-module/**/*','!desktop/shared/cli-child-result.mjs','!desktop/workbench/{gateway,server,store,manifest,policy}.mjs','!desktop/modules/{module-manager,package-format,service-lifecycle,electron-lifecycle,bundled-suite}.mjs','core/**/*','config.json','package.json','!node_modules/**/{test,tests,__tests__,examples,benchmark,benchmarks}/**'],extraResources:[{from:cloudBuildInfo,to:'build-info.json'}],asar:true,npmRebuild:false,win:{icon:path.join(root,'desktop/assets/lingtu-icon.png'),target:[{target:'dir',arch:['x64']}]}}));
run(process.execPath,[builder,'--projectDir',cloudStage,'--config',cloudConfig,'--win','--dir','--publish','never']);
const cloudVersion=JSON.parse(fs.readFileSync(path.join(cloudStage,'package.json'),'utf8')).version;
run(process.execPath,['scripts/build-module-pack.mjs','--id','warehouse','--source',path.join(cloudOutput,'win-unpacked'),'--output',output,'--tag','v'+host.version,'--version',cloudVersion,'--entry','LingtuWarehouseModule.exe']);

}
