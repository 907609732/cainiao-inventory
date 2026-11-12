import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
export function atomicJson(file,value){const temp=file+'.tmp-'+randomUUID();fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});fs.renameSync(temp,file);}
function processStart(pid){
 if(process.platform!=='linux')return null;
 try{const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);return {bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),startTime:fields[19]};}catch{return null;}
}
export function createNasStorage(root){
 root=path.resolve(root);fs.mkdirSync(root,{recursive:true,mode:0o700});
 const file=name=>path.join(root,name);
 const read=(name,fallback)=>fs.existsSync(file(name))?JSON.parse(fs.readFileSync(file(name),'utf8')):fallback;
 function lock(kind,name='task.lock'){const target=file(name),record={pid:process.pid,id:randomUUID(),kind,processStart:processStart(process.pid)};try{fs.writeFileSync(target,JSON.stringify(record),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;const old=read(name,{});let alive=false;try{process.kill(Number(old.pid),0);alive=true;}catch{}if(alive&&old.processStart){const actual=processStart(Number(old.pid));if(actual&&JSON.stringify(actual)!==JSON.stringify(old.processStart))alive=false;}if(alive)throw Error('已有任务正在运行');fs.renameSync(target,target+'.stale-'+Date.now());fs.writeFileSync(target,JSON.stringify(record),{flag:'wx',mode:0o600});}return ()=>{if(read(name,{}).id===record.id)fs.unlinkSync(target);};}
 const releaseOwner=lock('runtime','runtime.lock');
 try{
 let identity=read('dataset.json',null);if(!identity){identity={datasetId:randomUUID()};atomicJson(file('dataset.json'),identity);}
 if(!/^[a-f0-9-]{36}$/i.test(identity.datasetId||''))throw Error('数据集身份文件无效');
 const keyFile=file('master.key');if(!fs.existsSync(keyFile)){if(fs.existsSync(file('secrets.bin')))throw Error('恢复密钥缺失，禁止覆盖已有加密配置');fs.writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});}
 const key=fs.readFileSync(keyFile);if(key.length!==32)throw Error('恢复密钥无效');
 function secrets(){if(!fs.existsSync(file('secrets.bin')))return {};try{const b=fs.readFileSync(file('secrets.bin'));const d=createDecipheriv('aes-256-gcm',key,b.subarray(0,12));d.setAuthTag(b.subarray(12,28));return JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString());}catch{throw Error('加密配置无法读取，请恢复匹配的密钥和数据');}}
 function saveSecrets(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);const temp=file('secrets.bin.tmp');fs.writeFileSync(temp,Buffer.concat([iv,c.getAuthTag(),data]),{mode:0o600});fs.renameSync(temp,file('secrets.bin'));}
 const receipts=read('run-receipts.json',{});for(const row of Object.values(receipts))if(row.status==='running'){row.status='unknown';row.finishedAt=new Date().toISOString();}atomicJson(file('run-receipts.json'),receipts);
 return {releaseOwner,root,file,read,write:(name,value)=>atomicJson(file(name),value),identity,secrets,saveSecrets,receipts,saveReceipts:()=>atomicJson(file('run-receipts.json'),receipts),lock};
 }catch(error){releaseOwner();throw error;}
}



