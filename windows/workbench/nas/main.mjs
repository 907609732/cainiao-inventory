import fs from 'node:fs';
import path from 'node:path';
import {createNasRuntime} from './runtime.mjs';
import {createNasGateway} from './server/gateway.mjs';
const root=path.resolve(process.env.CAINIAO_DATA_DIR||'/data');
fs.mkdirSync(root,{recursive:true,mode:0o700});
const passwordFile=path.join(root,'admin-password');
const runtime=await createNasRuntime({dataDir:root});
const gateway=await createNasGateway({runtime,root,host:process.env.CAINIAO_GATEWAY_HOST||'127.0.0.1',port:Number(process.env.CAINIAO_GATEWAY_PORT||18761),apiHost:process.env.CAINIAO_API_HOST||'127.0.0.1',apiPort:Number(process.env.CAINIAO_API_PORT||18762),origin:process.env.CAINIAO_PUBLIC_ORIGIN||(fs.existsSync(path.join(root,'public-origin'))?fs.readFileSync(path.join(root,'public-origin'),'utf8').trim():undefined),additionalOrigins:fs.existsSync(path.join(root,'additional-origins'))?fs.readFileSync(path.join(root,'additional-origins'),'utf8').trim().split(/[,\s]+/).filter(Boolean):[],browserPasswordRequired:false,browserUrl:process.env.CAINIAO_BROWSER_URL});
await gateway.start();
if(fs.existsSync(passwordFile))fs.unlinkSync(passwordFile);
const cliFile=path.join(root,'cli-credential.json');
// A new boot rotates the private CLI capability; it never reaches logs or the UI.
let cli;if(fs.existsSync(cliFile)){try{const old=JSON.parse(fs.readFileSync(cliFile));cli=await gateway.credentials.rotate(old.id);}catch{}}
cli ||= await gateway.credentials.createLocalOwner();fs.writeFileSync(cliFile,JSON.stringify(cli),{mode:0o600});
fs.writeFileSync(path.join(root,'service.json'),JSON.stringify({apiAddress:gateway.apiAddress}),{mode:0o600});
await runtime.start();
let ending=false;async function stop(){if(ending)return;ending=true;await runtime.close();await gateway.stop();process.exit(0);}
process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
console.log('独立云仓服务已启动；可直接在浏览器打开。');




