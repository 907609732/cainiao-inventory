import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const argument=name=>process.argv.find(value=>value.startsWith(name+'='))?.slice(name.length+1);
const erp=path.resolve(argument('--erp')||path.join(root,'../五成电子商务集团ERP-V2'));
function run(args){const result=spawnSync(process.execPath,args,{cwd:erp,stdio:'inherit',windowsHide:true,env:{...process.env,LINGTU_WAREHOUSE_SOURCE:path.join(root,'windows/workbench')}});if(result.status!==0)throw Error('Windows workbench build failed');}
if(!process.argv.includes('--from-receipt')){run(['scripts/engineering/erp.mjs','build']);run(['scripts/engineering/erp.mjs','installer']);}
const receipt=JSON.parse(fs.readFileSync(path.join(erp,'.codex-artifacts/engineering/installer-current.json'),'utf8'));
const {suiteSourceDigest}=await import(pathToFileURL(path.join(erp,'scripts/suite-source-digests.mjs')).href);
if(receipt.source?.warehouseExtension!==suiteSourceDigest(path.join(root,'windows/workbench')))throw Error('Windows source changed since artifact build');
if(receipt.extensionRepository!=='907609732/cainiao-inventory'||!receipt.extensionAssets?.length)throw Error('Receipt does not contain Windows warehouse extension artifacts');
const output=path.join(root,'release/windows',receipt.extensionTag);fs.mkdirSync(output,{recursive:true});
const files=[];
for(const name of [...receipt.extensionAssets,'component-catalog.json']){
 const record=receipt.files.find(item=>item.name===name);if(!record)throw Error('Missing artifact record: '+name);
 const source=path.join(receipt.assets,name),bytes=fs.readFileSync(source),sha256=createHash('sha256').update(bytes).digest('hex');
 if(bytes.length!==record.bytes||sha256!==record.sha256)throw Error('Artifact changed: '+name);
 fs.copyFileSync(source,path.join(output,name));files.push({name,bytes:bytes.length,sha256});
}
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),files.map(file=>file.sha256+'  '+file.name).join('\n')+'\n');
fs.writeFileSync(path.join(output,'extension-release.json'),JSON.stringify({id:'warehouse',repository:receipt.extensionRepository,tag:receipt.extensionTag,hostVersion:receipt.version,hostManifestSha256:receipt.manifestSha256,platform:'win32',arch:'x64',entry:'runtime/resources/app.asar',surface:'window',files,installed:false,integrationVerified:receipt.integrationVerified===true},null,2));
console.log(JSON.stringify({output,files}));
