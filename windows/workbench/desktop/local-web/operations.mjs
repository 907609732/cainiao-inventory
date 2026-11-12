const queries = ['revealSecret','getSettings','getInventory','getMonthlySales','getState','getLogs','getBranding','getAbout','getIntegration','getUpdateState','getLocalAccess','getCapabilities'];
const writes = ['checkForUpdates','saveSettings','saveSettingsSection','runNow','refreshLogin','stopTask','syncMonthlySales','backfillMonthlySales','sendDateException','openLogs','openData','openRepository','openWebsite','openReleaseNotes','createAiCredential','revokeAiCredential','openWeb'];
const ai = new Set(['getCapabilities','getInventory','getMonthlySales','getState','getLogs','getBranding','getAbout','runNow','refreshLogin','stopTask','syncMonthlySales','backfillMonthlySales','previewDateException','sendDateException']);
const tasks = new Set(['runNow','refreshLogin','syncMonthlySales','backfillMonthlySales','sendDateException','executeCli']);
const cliQueries = new Set(['inventory','sales','status','capabilities','doctor','logs','debug-logs','extensions']);
export const OPERATIONS = Object.freeze(Object.fromEntries([...queries,...writes,'previewDateException','getEditableSecrets','installUpdate','executeCli'].map(name=>[name,Object.freeze({write:writes.includes(name)||name==='executeCli'||name==='installUpdate',ai:ai.has(name),ownerOnly:name==='executeCli',task:tasks.has(name)})])));
export function operationPolicy(name,payload){
 const policy=OPERATIONS[name];
 return name==='executeCli'&&cliQueries.has(payload?.request?.command)?{...policy,write:false,task:false}:policy;
}

const confirmation={confirmed:'boolean',confirmSend:'boolean',confirmSideEffect:'boolean'};
const fields={
 revealSecret:{field:'string'},
 getMonthlySales:{year:['string','number'],selectedMonth:'string',scope:'string',seriesMode:'string',sku:'string'},
 saveSettings:{settings:'object',secrets:'object',clearSecrets:'array'},
 saveSettingsSection:{section:'string',settings:'object',secrets:'object',clearSecrets:'array'},
 syncMonthlySales:{month:'string'},backfillMonthlySales:{from:'string',to:'string'},
 sendDateException:{token:'string',confirmationToken:'string'},
 createAiCredential:{write:'boolean'},revokeAiCredential:{id:'string'},
 executeCli:{request:'object',command:'string',options:'object',args:'array'}
};
export function validOperationPayload(name,payload){
 const allowed={...(fields[name]||{}),...confirmation};
 if(Object.keys(payload).some(key=>!Object.hasOwn(allowed,key)))return false;
 for(const [key,value] of Object.entries(payload)){
  const type=Array.isArray(value)?'array':value===null?'null':typeof value;
  if(!(Array.isArray(allowed[key])?allowed[key]:[allowed[key]]).includes(type))return false;
  if(typeof value==='string'&&value.length>4096)return false;
 }
 if(name==='sendDateException'&&!payload.token&&!payload.confirmationToken)return false;
 if(name==='revokeAiCredential'&&!payload.id)return false;
 return true;
}
