import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run = promisify(execFile);
const MAX_DISCOVERY = 8192;
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'instanceId,origin,ownerToken,pid' ||
      !Number.isSafeInteger(value.pid) || value.pid < 1 ||
      typeof value.origin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value.origin) || Number(value.origin.split(':').at(-1)) > 65535 ||
      typeof value.instanceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.instanceId) ||
      typeof value.ownerToken !== 'string' || !/^[a-zA-Z0-9_-]{43,256}$/.test(value.ownerToken)) throw new Error('Invalid local backend discovery');
  return value;
}
async function location(profile, create = false) {
  const base = path.resolve(profile);
  // Root is supplied by the profile coordinator. All descendants must be actual directories.
  let current = base;
  for (const part of ['', 'workspace', 'state']) {
    if (part) current = path.join(current, part);
    if (create) await fs.mkdir(current, {recursive:false,mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    let stat;
    try { stat = await fs.lstat(current); } catch(e) {if(e.code==='ENOENT')return null;throw e;}
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Unsafe local backend discovery directory');
  }
  return path.join(current,'local-web.json');
}
async function userOnly(directory) {
  if (process.platform !== 'win32') return fs.chmod(directory,0o700);
  // Replace the DACL, rather than adding a grant while retaining broader explicit access.
  const script = '$p=$env:CAINIAO_DISCOVERY_ACL_PATH; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetOwner($sid); $acl.SetAccessRuleProtection($true,$false); $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,"FullControl","ContainerInherit,ObjectInherit","None","Allow"); $acl.AddAccessRule($rule); [System.IO.Directory]::SetAccessControl($p,$acl)';
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,CAINIAO_DISCOVERY_ACL_PATH:directory},timeout:10000});
}
export async function writeDiscovery(profile, value) {
  validate(value);
  const file = await location(profile,true);
  await userOnly(path.dirname(file));
  try {const s=await fs.lstat(file);if(s.isSymbolicLink()||!s.isFile())throw new Error('Unsafe local backend discovery file');}catch(e){if(e.code!=='ENOENT')throw e;}
  const temp = path.join(path.dirname(file),`.local-web-${randomUUID()}.tmp`);
  try {await fs.writeFile(temp,JSON.stringify(value),{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
export async function readDiscovery(profile) {
  const file = await location(profile);
  if (!file) return null;
  let stat;
  try {stat=await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
  if(stat.isSymbolicLink()||!stat.isFile()||stat.size>MAX_DISCOVERY)throw new Error('Unsafe local backend discovery file');
  const handle=await fs.open(file,'r');
  try {
    const buffer=Buffer.alloc(MAX_DISCOVERY+1);const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    if(bytesRead>MAX_DISCOVERY)throw new Error('Invalid local backend discovery');
    try{return validate(JSON.parse(buffer.subarray(0,bytesRead).toString('utf8')));}catch{throw new Error('Invalid local backend discovery');}
  }finally{await handle.close();}
}
export async function removeDiscovery(profile,instanceId) {
  const value=await readDiscovery(profile);
  if(value?.instanceId===instanceId)await fs.unlink(await location(profile));
}
function running(pid) {try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
export async function connectLocalOwner({profile,fetchImpl=fetch,isAlive=running,timeoutMs=3000}) {
  const value=await readDiscovery(profile);
  if(!value||!await isAlive(value.pid))return null;
  async function request(route,options={},limit=timeoutMs) {
    const response=await fetchImpl(value.origin+route,{...options,redirect:'error',signal:AbortSignal.timeout(limit)});
    if(!response.ok)throw new Error(`Local backend request failed (${response.status})`);
    try{return await response.json();}catch{throw new Error('Invalid local backend response');}
  }
  let health;
  try{health=await request('/api/v1/health');}catch(e){if(e.cause?.code==='ECONNREFUSED')return null;throw new Error('Cannot verify local backend identity');}
  if(health?.brand!=='cainiao-cloud-warehouse'||health.protocol!==1||health.instanceId!==value.instanceId)throw new Error('Local backend identity mismatch');
  const headers={Authorization:`Bearer ${value.ownerToken}`};
  function unwrap(result){if(!result||result.ok!==true)throw new Error('Local backend operation failed');return result.value;}
  return {
    origin:value.origin,instanceId:value.instanceId,
    async call(operation,payload={},options={}) {
      if(typeof operation!=='string'||!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(operation))throw new Error('Invalid backend operation');
      const requestHeaders={...headers,'Content-Type':'application/json'};
      // Every call gets a key: read operations ignore it; a caller cannot accidentally omit write protection.
      requestHeaders['Idempotency-Key']=options.idempotencyKey||randomUUID();
      return unwrap(await request(`/api/v1/call/${operation}`,{method:'POST',headers:requestHeaders,body:JSON.stringify(payload)},options.timeoutMs||timeoutMs));
    },
    async pollTask(taskId,{timeoutMs:pollTimeout=30000}={}) {
      if(typeof taskId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(taskId))throw new Error('Invalid backend task');
      const end=Date.now()+pollTimeout;
      do {
        const task=unwrap(await request(`/api/v1/tasks/${taskId}`,{headers},Math.max(1,Math.min(timeoutMs,end-Date.now()))));
        if(['completed','succeeded','success'].includes(task?.status))return task.value;
        if(['failed','cancelled'].includes(task?.status))throw new Error('Local backend task failed');
        await new Promise(r=>setTimeout(r,Math.min(250,Math.max(1,end-Date.now()))));
      }while(Date.now()<end);
      throw new Error('Local backend task is still running; retain its task ID');
    }
  };
}
