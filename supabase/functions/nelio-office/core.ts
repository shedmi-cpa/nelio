// Office API. This server never trusts browser-provided user details.
// Reads since 6.1; write actions since 6.3.1, all through the nelio_office_action database routine.
export const OFFICE_ORIGIN = 'https://shedmi-cpa.github.io';
export const OFFICE_EMAIL = 'shedmi.cpa@gmail.com';
export const VERSION = '0.7.3';
export type OfficeEnv = { url:string; anonKey:string; serviceKey:string; driveCredentials?:string; linkKey?:string };
type HttpFetch = (input:RequestInfo|URL, init?:RequestInit)=>Promise<Response>;
export type WriteAction =
 {action:'reject';requestId:string;actor:string;uploadId:string;reason:string;dryRun:boolean}|
 {action:'approve';requestId:string;actor:string}|
 {action:'completeManual';requestId:string;actor:string;note:string}|
 {action:'whatsapp';requestId:string;actor:string;dryRun:boolean}|
 {action:'rotateLink';requestId:string;actor:string}|
 {action:'remindNow';requestId:string;actor:string;dryRun:boolean}|
 {action:'callDone';requestId:string;actor:string;note:string}|
 {action:'uploadStart';requestId:string;actor:string;itemId:string;fileName:string;mimeType:string;sizeBytes:number;fileHash:string;uploadKey:string}|
 {action:'uploadFinish';requestId:string;actor:string;itemId:string;uploadId:string};
export type SettingsAction={action:'logList';cycleId?:string}|{action:'settingsGet'}|
 {action:'settingsSave';actor:string;values:Record<string,string>}|
 {action:'templateSave';actor:string;templateId:string;subject:string;body:string}|
 {action:'zipFiles';actor:string;scope:'request'|'docType'|'client'|'cycle';requestId?:string;docTypeId?:string;clientId?:string;cycleId?:string;includeRejected:boolean;dryRun:boolean};
const SETTING_KEYS=['due_day','reminder1_days_before','reminder2_days_before','last_day_days_before','summary_days_after','send_time','quiet_start','quiet_end','friday_cutoff'];
type Action = {action:'session'}|{action:'overview';cycleId?:string}|{action:'callList';cycleId?:string}|SettingsAction|{action:'clientDetail';requestId:string}|{action:'openFile';requestId:string;uploadId:string}|WriteAction;
const WRITE_KEYS:Record<WriteAction['action'],string[]>={
 reject:['action','requestId','actor','uploadId','reason','dryRun'],
 approve:['action','requestId','actor'],
 completeManual:['action','requestId','actor','note'],
 whatsapp:['action','requestId','actor','dryRun'],
 rotateLink:['action','requestId','actor'],
 remindNow:['action','requestId','actor','dryRun'],
 callDone:['action','requestId','actor','note'],
 uploadStart:['action','requestId','actor','itemId','fileName','mimeType','sizeBytes','fileHash','uploadKey'],
 uploadFinish:['action','requestId','actor','itemId','uploadId'],
};
// Each write goes to one database routine; the routine checks the actor and every state change.
const ROUTINE:Record<WriteAction['action'],string>={reject:'nelio_office_action',approve:'nelio_office_action',completeManual:'nelio_office_action',
 whatsapp:'nelio_office_action',rotateLink:'nelio_office_action',remindNow:'nelio_office_remind',callDone:'nelio_office_calls',
 uploadStart:'nelio_office_upload',uploadFinish:'nelio_office_upload'};
const UPLOAD_TYPES=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
const FAILURE_STATUS:Record<string,number>={BAD_VALUE:400,BAD_ORDER:400,BAD_QUIET:400,LINK_REQUIRED:400,BAD_TYPE:400,TOO_BIG:413,UPLOAD_CONFLICT:409,UPLOAD_PENDING:409,QUOTA_EXCEEDED:409,BAD_ACTOR:400,BAD_REASON:400,BAD_NOTE:400,BAD_REQUEST:400,NOT_FOUND:404,NOT_ALLOWED:409,NOTHING_MISSING:409,TEMPLATE_MISSING:500};
type User = {id?:string;email?:string;email_confirmed_at?:string|null;app_metadata?:{providers?:string[]};identities?:{provider?:string}[]};

function output(data:unknown,code:number,origin:string|null):Response {
 const headers:Record<string,string> = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'};
 if(origin===OFFICE_ORIGIN)headers['Access-Control-Allow-Origin']=OFFICE_ORIGIN;
 return new Response(JSON.stringify(data),{status:code,headers});
}
export function isAuthorizedOfficeUser(u:User|null|undefined):boolean{
 return Boolean(u && /^[0-9a-f-]{36}$/i.test(u.id||'') && u.email?.toLowerCase()===OFFICE_EMAIL
  && u.email_confirmed_at && u.app_metadata?.providers?.includes('google')
  && u.identities?.some(i=>i.provider==='google'));
}
export function parseAction(v:unknown):Action|null{
 if(!v||typeof v!=='object'||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(x.action==='session'&&Object.keys(x).length===1)return {action:'session'};
 if(x.action==='overview'&&Object.keys(x).every(k=>k==='action'||k==='cycleId')){
  if(x.cycleId===undefined)return {action:'overview'};
  if(typeof x.cycleId==='string'&&/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(x.cycleId))return {action:'overview',cycleId:x.cycleId};
 }
 if(x.action==='clientDetail'&&Object.keys(x).every(k=>k==='action'||k==='requestId')&&validId(x.requestId))return {action:'clientDetail',requestId:x.requestId as string};
 if(x.action==='openFile'&&Object.keys(x).every(k=>['action','requestId','uploadId'].includes(k))&&validId(x.requestId)&&validId(x.uploadId))return {action:'openFile',requestId:x.requestId as string,uploadId:x.uploadId as string};
 if(x.action==='callList'&&Object.keys(x).every(k=>k==='action'||k==='cycleId')){
  if(x.cycleId===undefined)return {action:'callList'};
  if(typeof x.cycleId==='string'&&/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(x.cycleId))return {action:'callList',cycleId:x.cycleId};
 }
 const settings=parseSettings(x);if(settings)return settings;
 if(typeof x.action==='string'&&Object.hasOwn(WRITE_KEYS,x.action))return parseWrite(x);
 return null;
}
function parseWrite(x:Record<string,unknown>):WriteAction|null{
 const name=x.action as WriteAction['action'];
 if(!Object.keys(x).every(k=>WRITE_KEYS[name].includes(k)))return null;
 if(!validId(x.requestId)||typeof x.actor!=='string'||!/^S[0-9]{1,3}$/.test(x.actor))return null;
 if(x.dryRun!==undefined&&typeof x.dryRun!=='boolean')return null;
 const base={requestId:x.requestId,actor:x.actor};
 if(name==='reject'){
  if(!validId(x.uploadId))return null;
  const reason=cleanText(x.reason,300);if(!reason)return null;
  return {action:'reject',...base,uploadId:x.uploadId,reason,dryRun:x.dryRun===true};
 }
 if(name==='completeManual'){const note=cleanText(x.note,300);return note?{action:'completeManual',...base,note}:null;}
 if(name==='rotateLink'||name==='approve')return {action:name,...base};
 if(name==='whatsapp')return {action:'whatsapp',...base,dryRun:x.dryRun===true};
 if(name==='remindNow')return {action:'remindNow',...base,dryRun:x.dryRun===true};
 if(name==='callDone'){
  if(x.note!==undefined&&typeof x.note!=='string')return null;
  return {action:'callDone',...base,note:cleanText(x.note??'',300)};
 }
 if(name==='uploadStart'){
  if(!validId(x.itemId)||typeof x.mimeType!=='string'||!UPLOAD_TYPES.includes(x.mimeType))return null;
  if(!Number.isSafeInteger(x.sizeBytes)||(x.sizeBytes as number)<1||(x.sizeBytes as number)>10*1048576)return null;
  if(typeof x.fileHash!=='string'||!/^[a-f0-9]{64}$/.test(x.fileHash))return null;
  if(typeof x.uploadKey!=='string'||!/^[A-Za-z0-9_-]{8,64}$/.test(x.uploadKey))return null;
  return {action:'uploadStart',...base,itemId:x.itemId,fileName:cleanText(x.fileName,120),mimeType:x.mimeType,sizeBytes:x.sizeBytes as number,fileHash:x.fileHash,uploadKey:x.uploadKey};
 }
 if(name==='uploadFinish')return validId(x.itemId)&&validId(x.uploadId)?{action:'uploadFinish',...base,itemId:x.itemId,uploadId:x.uploadId}:null;
 return null;
}
// Removes control characters and direction marks that could disguise text, and collapses spaces.
function parseSettings(x:Record<string,unknown>):SettingsAction|null{
 const keys=Object.keys(x),only=(...k:string[])=>keys.every(n=>k.includes(n));
 if(x.action==='settingsGet'&&only('action'))return {action:'settingsGet'};
 if(x.action==='logList'&&only('action','cycleId')){
  if(x.cycleId===undefined)return {action:'logList'};
  return typeof x.cycleId==='string'&&/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(x.cycleId)?{action:'logList',cycleId:x.cycleId}:null;
 }
 if(typeof x.actor!=='string'||!/^S[0-9]{1,3}$/.test(x.actor))return null;
 if(x.action==='settingsSave'&&only('action','actor','values')){
  const v=x.values;
  if(!v||typeof v!=='object'||Array.isArray(v))return null;
  const entries=Object.entries(v as Record<string,unknown>);
  if(!entries.length||!entries.every(([k,val])=>SETTING_KEYS.includes(k)&&typeof val==='string'&&val.length<=5))return null;
  return {action:'settingsSave',actor:x.actor,values:Object.fromEntries(entries) as Record<string,string>};
 }
 if(x.action==='zipFiles'&&only('action','actor','scope','requestId','docTypeId','clientId','cycleId','includeRejected','dryRun')){
  if(typeof x.includeRejected!=='boolean'||typeof x.dryRun!=='boolean')return null;
  const base={action:'zipFiles' as const,actor:x.actor,includeRejected:x.includeRejected,dryRun:x.dryRun};
  // Each scope takes exactly the identifiers it needs, and nothing else.
  if(x.scope==='request'&&only('action','actor','scope','requestId','includeRejected','dryRun')&&validId(x.requestId))return {...base,scope:'request',requestId:x.requestId};
  if(x.scope==='docType'&&only('action','actor','scope','requestId','docTypeId','includeRejected','dryRun')&&validId(x.requestId)&&typeof x.docTypeId==='string'&&/^[A-Z0-9_]{2,40}$/.test(x.docTypeId))
   return {...base,scope:'docType',requestId:x.requestId,docTypeId:x.docTypeId};
  if(x.scope==='client'&&only('action','actor','scope','clientId','includeRejected','dryRun')&&validId(x.clientId))return {...base,scope:'client',clientId:x.clientId};
  if(x.scope==='cycle'&&only('action','actor','scope','cycleId','includeRejected','dryRun')&&typeof x.cycleId==='string'&&/^20[0-9]{2}-(0[1-9]|1[0-2])$/.test(x.cycleId))
   return {...base,scope:'cycle',cycleId:x.cycleId};
  return null;
 }
 if(x.action==='templateSave'&&only('action','actor','templateId','subject','body')){
  if(typeof x.templateId!=='string'||!/^[A-Z0-9_]{2,40}$/.test(x.templateId))return null;
  const body=cleanMultiline(x.body,1500);
  if(!body||typeof x.subject!=='string')return null;
  return {action:'templateSave',actor:x.actor,templateId:x.templateId,subject:cleanText(x.subject,200),body};
 }
 return null;
}
// Like cleanText, but a message body keeps its line breaks.
export function cleanMultiline(v:unknown,max:number):string{
 if(typeof v!=='string')return '';
 return v.replace(/\r\n?/g,'\n').split('\n').map(line=>line.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,' ').replace(/[ \t]+/g,' ').trim())
  .join('\n').replace(/\n{3,}/g,'\n\n').trim().slice(0,max);
}
export function cleanText(v:unknown,max:number):string{
 if(typeof v!=='string')return '';
 return v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function validId(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=100&&/^[A-Za-z0-9_-]+$/.test(v);}
async function smallJson(r:Request):Promise<unknown>{
 const reader=r.body?.getReader();if(!reader)throw Error('bad body');
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192)throw Error('too large');chunks.push(value);}}
 finally{reader.releaseLock();}
 const b=new Uint8Array(size);let off=0;for(const c of chunks){b.set(c,off);off+=c.length;}
 return JSON.parse(new TextDecoder().decode(b));
}
function adminHeaders(key:string):Record<string,string>{
 const h:Record<string,string>={apikey:key,Accept:'application/json'};
 if(key.startsWith('eyJ'))h.Authorization='Bearer '+key;
 return h;
}
async function verifiedUser(jwt:string,env:OfficeEnv,f:HttpFetch):Promise<User|null>{
 const r=await f(env.url+'/auth/v1/user',{method:'GET',headers:{Authorization:'Bearer '+jwt,apikey:env.anonKey},signal:AbortSignal.timeout(8000)});
 return r.ok ? await r.json() as User : null;
}
async function table(name:string,query:string,env:OfficeEnv,f:HttpFetch):Promise<unknown[]>{
 const r=await f(env.url+'/rest/v1/'+name+'?'+query,{method:'GET',headers:adminHeaders(env.serviceKey),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('database_unavailable');
 const value:unknown=await r.json();if(!Array.isArray(value))throw Error('bad data');return value;
}

function b64url(bytes:Uint8Array):string{
 let raw='';for(const b of bytes)raw+=String.fromCharCode(b);
 return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function fromB64url(v:string):Uint8Array<ArrayBuffer>{
 const raw=atob(v.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-v.length%4)%4));
 const out=new Uint8Array(new ArrayBuffer(raw.length));
 for(let n=0;n<raw.length;n++)out[n]=raw.charCodeAt(n);
 return out;
}
// D47: the personal link token is kept encrypted (AES-256-GCM). The client id is bound in as
// additional data, so a ciphertext copied to another client does not decrypt.
async function linkCryptoKey(raw:string):Promise<CryptoKey>{
 const bytes=fromB64url(raw.trim().replace(/=+$/,''));
 if(bytes.length!==32)throw Error('NELIO_LINK_KEY must be 32 bytes, base64');
 return crypto.subtle.importKey('raw',bytes,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
export async function encryptToken(token:string,clientId:string,rawKey:string):Promise<string>{
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(clientId)},await linkCryptoKey(rawKey),new TextEncoder().encode(token));
 return 'v1.'+b64url(iv)+'.'+b64url(new Uint8Array(sealed));
}
export async function decryptToken(value:string,clientId:string,rawKey:string):Promise<string|null>{
 const m=/^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{40,})$/.exec(value||'');
 if(!m)return null;
 try{
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromB64url(m[1]),additionalData:new TextEncoder().encode(clientId)},await linkCryptoKey(rawKey),fromB64url(m[2]));
  return new TextDecoder().decode(plain);
 }catch{return null;}
}
export function newToken():string{return b64url(crypto.getRandomValues(new Uint8Array(32)));}
async function rpc(name:string,p:Record<string,unknown>,env:OfficeEnv,f:HttpFetch):Promise<Record<string,unknown>>{
 const r=await f(env.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{...adminHeaders(env.serviceKey),'Content-Type':'application/json'},body:JSON.stringify({p}),signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('database_unavailable');
 const value:unknown=await r.json();
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('bad data');
 return value as Record<string,unknown>;
}
async function driveToken(raw:string,f:HttpFetch):Promise<string>{
 const account=JSON.parse(raw) as {client_email?:string;private_key?:string;type?:string};
 if(account.type!=='service_account'||!account.client_email||!account.private_key?.includes('BEGIN PRIVATE KEY'))throw Error('invalid service account');
 const der=Uint8Array.from(atob(account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const now=Math.floor(Date.now()/1000);
 const head=b64url(new TextEncoder().encode(JSON.stringify({alg:'RS256',typ:'JWT'})));
 const claim=b64url(new TextEncoder().encode(JSON.stringify({iss:account.client_email,scope:'https://www.googleapis.com/auth/drive.readonly',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})));
 const payload=head+'.'+claim;
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(payload));
 const assertion=payload+'.'+b64url(new Uint8Array(sig));
 const r=await f('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString(),signal:AbortSignal.timeout(8000)});
 if(!r.ok)throw Error('drive token failed');
 const data=await r.json() as {access_token?:string};
 if(!data.access_token)throw Error('missing drive token');return data.access_token;
}

function isWrite(a:Action):a is WriteAction{return Object.hasOwn(WRITE_KEYS,a.action);}
async function officeWrite(action:WriteAction,env:OfficeEnv,f:HttpFetch,origin:string|null):Promise<Response>{
 const reqRows=await table('requests','select=request_id,client_id&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=1',env,f);
 const req=reqRows[0] as {client_id?:string}|undefined;
 if(!req||typeof req.client_id!=='string')return output({ok:false,code:'NOT_FOUND'},404,origin);
 const clientId=req.client_id;
 const p:Record<string,unknown>={...action};
 if(action.action==='rotateLink'){
  if(!env.linkKey)return output({ok:false,code:'LINK_KEY_MISSING'},501,origin);
  const token=newToken();
  try{p.newTokenEnc=await encryptToken(token,clientId,env.linkKey);}catch{return output({ok:false,code:'LINK_KEY_INVALID'},500,origin);}
  p.newToken=token;
 } else if(env.linkKey&&(action.action==='reject'||action.action==='whatsapp'||action.action==='remindNow')){
  const rows=await table('clients','select=token_enc&client_id=eq.'+encodeURIComponent(clientId)+'&limit=1',env,f);
  const enc=(rows[0] as {token_enc?:string}|undefined)?.token_enc;
  // The database uses the token only if it still matches the stored hash.
  if(enc){try{const token=await decryptToken(enc,clientId,env.linkKey);if(token)p.token=token;}catch{/* treated as no stored link */}}
 }
 if(action.action==='callDone')p.action='callDone';
 if(action.action==='uploadStart')p.action='reserve';
 if(action.action==='uploadFinish')p.action='finish';
 const result=await rpc(ROUTINE[action.action],p,env,f);
 if(result.ok!==true){
  const code=typeof result.code==='string'&&Object.hasOwn(FAILURE_STATUS,result.code)?result.code:'UNAVAILABLE';
  return output({ok:false,code},FAILURE_STATUS[code]??503,origin);
 }
 if(action.action==='uploadStart'&&result.ready!==true){
  // The browser sends the bytes straight to private Storage with a signed upload URL for this exact path.
  const path=String(result.storagePath||'');
  if(!/^[A-Za-z0-9_-]+\/[0-9]{4}-[0-9]{2}(_[0-9]{2})?\/[0-9a-f-]{36}$/.test(path))throw Error('bad storage path');
  const signed=await f(env.url+'/storage/v1/object/upload/sign/nelio-documents/'+path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{...adminHeaders(env.serviceKey),'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(8000)});
  if(!signed.ok)throw Error('storage_unavailable');
  const body=await signed.json() as {url?:string};
  if(typeof body.url!=='string'||!body.url.startsWith('/object/upload/sign/nelio-documents/'+path+'?'))throw Error('invalid_signed_url');
  return output({ok:true,uploadId:result.uploadId,storedName:result.storedName,duplicateOf:result.duplicateOf,uploadUrl:env.url+'/storage/v1'+body.url},200,origin);
 }
 return output(result,200,origin);
}

export function createOfficeHandler(env:OfficeEnv,f:HttpFetch=fetch){
 return async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('Origin');
  if(origin&&origin!==OFFICE_ORIGIN)return output({ok:false,code:'FORBIDDEN'},403,origin);
  if(request.method==='OPTIONS'){
   if(origin!==OFFICE_ORIGIN)return output({ok:false,code:'FORBIDDEN'},403,origin);
   return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':OFFICE_ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, apikey, content-type','Access-Control-Max-Age':'600',Vary:'Origin','Cache-Control':'no-store'}});
  }
  if(request.method!=='POST')return output({ok:false,code:'METHOD_NOT_ALLOWED'},405,origin);
  const bearer=request.headers.get('Authorization')||'';
  const m=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(bearer);
  if(!m||m[1].length>4096)return output({ok:false,code:'UNAUTHORIZED'},401,origin);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))return output({ok:false,code:'BAD_REQUEST'},400,origin);
  let action:Action|null;
  try{action=parseAction(await smallJson(request));}catch{return output({ok:false,code:'BAD_REQUEST'},400,origin);}
  if(!action)return output({ok:false,code:'BAD_REQUEST'},400,origin);
  if(!env.url.startsWith('https://')||!env.anonKey||!env.serviceKey)return output({ok:false,code:'UNAVAILABLE'},503,origin);
  try{
   const user=await verifiedUser(m[1],env,f);
   if(!user)return output({ok:false,code:'UNAUTHORIZED'},401,origin);
   if(!isAuthorizedOfficeUser(user))return output({ok:false,code:'FORBIDDEN'},403,origin);
   if(action.action==='session')return output({ok:true,office:true,email:OFFICE_EMAIL,version:VERSION},200,origin);
   if(isWrite(action))return await officeWrite(action,env,f,origin);
   if(action.action==='zipFiles'){
    const {action:_name,...p}=action;
    const result=await rpc('nelio_office_files',p,env,f);
    if(result.ok!==true){
     const code=typeof result.code==='string'&&Object.hasOwn(FAILURE_STATUS,result.code)?result.code:'UNAVAILABLE';
     return output({ok:false,code},FAILURE_STATUS[code]??503,origin);
    }
    return output(result,200,origin);
   }
   if(action.action==='logList'||action.action==='settingsGet'||action.action==='settingsSave'||action.action==='templateSave'){
    const routine=action.action==='logList'?'nelio_office_log':'nelio_office_settings';
    const p:Record<string,unknown>=action.action==='logList'?(action.cycleId?{cycleId:action.cycleId}:{}):
     action.action==='settingsGet'?{action:'get'}:action.action==='settingsSave'?{action:'save',actor:action.actor,values:action.values}:
     {action:'saveTemplate',actor:action.actor,templateId:action.templateId,subject:action.subject,body:action.body};
    const result=await rpc(routine,p,env,f);
    if(result.ok!==true){
     const code=typeof result.code==='string'&&Object.hasOwn(FAILURE_STATUS,result.code)?result.code:'UNAVAILABLE';
     const key=typeof result.key==='string'&&SETTING_KEYS.includes(result.key)?{key:result.key}:{};
     return output({ok:false,code,...key},FAILURE_STATUS[code]??503,origin);
    }
    return output(result,200,origin);
   }
   if(action.action==='callList'){
    const result=await rpc('nelio_office_calls',action.cycleId?{action:'callList',cycleId:action.cycleId}:{action:'callList'},env,f);
    if(result.ok!==true)return output({ok:false,code:result.code==='NOT_FOUND'?'NOT_FOUND':'UNAVAILABLE'},result.code==='NOT_FOUND'?404:503,origin);
    return output(result,200,origin);
   }
   if(action.action==='clientDetail'||action.action==='openFile'){
    const reqRows=await table('requests','select=request_id,client_id,cycle_id,status,period,client_note,reminder_count,last_reminder_at,completed_at,completed_by,completion_note&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=1',env,f);
    const req=reqRows[0] as Record<string,unknown>|undefined;
    if(!req)return output({ok:false,code:'NOT_FOUND'},404,origin);
    const clientRows=await table('clients','select=client_id,business_name,contact_name,phone,frequency,profile_id,bookkeeper_id,token_enc&client_id=eq.'+encodeURIComponent(String(req.client_id))+'&limit=1',env,f);
    if(clientRows.length!==1)return output({ok:false,code:'NOT_FOUND'},404,origin);
    if(action.action==='clientDetail'){
     const items=await table('items','select=item_id,request_id,doc_type_id,required,status,file_count,na_note,reject_reason,updated_at&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=100',env,f);
     const uploads=await table('uploads','select=upload_id,item_id,request_id,stored_name,original_name,mime_type,size_bytes,uploaded_at,status,storage_provider,ingest_status&request_id=eq.'+encodeURIComponent(action.requestId)+'&order=uploaded_at.desc&limit=250',env,f);
     const docTypes=await table('doc_types','select=doc_type_id,name_he,sort_order&limit=100',env,f);
     const templates=await table('templates','select=template_id,body&template_id=in.(REJECTED,WHATSAPP)',env,f);
     // The ciphertext never leaves the server; the office only learns whether a link is stored.
     const {token_enc,...client}=clientRows[0] as Record<string,unknown>;
     return output({ok:true,request:req,client:{...client,hasLink:typeof token_enc==='string'&&token_enc!==''},items,uploads,docTypes,templates,linkKeyConfigured:Boolean(env.linkKey)},200,origin);
    }
    const uploadRows=await table('uploads','select=upload_id,request_id,storage_provider,storage_path,drive_file_id,ingest_status,stored_name,mime_type&upload_id=eq.'+encodeURIComponent(action.uploadId)+'&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=1',env,f);
    const upload=uploadRows[0] as Record<string,unknown>|undefined;
    if(!upload||upload.ingest_status!=='ready')return output({ok:false,code:'NOT_FOUND'},404,origin);
    if(upload.storage_provider==='drive'){
     if(!env.driveCredentials)return output({ok:false,code:'DRIVE_NOT_CONFIGURED'},501,origin);
     if(typeof upload.drive_file_id!=='string'||!(/^[A-Za-z0-9_-]{10,150}$/.test(upload.drive_file_id)))return output({ok:false,code:'NOT_FOUND'},404,origin);
     let token:string;
     try{token=await driveToken(env.driveCredentials,f);}catch{return output({ok:false,code:'DRIVE_UNAVAILABLE'},503,origin);}
     const file=await f('https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(upload.drive_file_id)+'?alt=media&supportsAllDrives=true',{method:'GET',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
     if(!file.ok||!file.body)return output({ok:false,code:'DRIVE_UNAVAILABLE'},503,origin);
     const mime=typeof upload.mime_type==='string'&&/^(application\/pdf|image\/(jpeg|png|webp|heic|heif))$/.test(upload.mime_type)?upload.mime_type:'application/octet-stream';
     const headers:Record<string,string>={'Content-Type':mime,'Content-Disposition':'attachment; filename="nelio-document"','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
     if(origin===OFFICE_ORIGIN)headers['Access-Control-Allow-Origin']=OFFICE_ORIGIN;
     return new Response(file.body,{status:200,headers});
    }
    if(upload.storage_provider!=='supabase'||typeof upload.storage_path!=='string'||!upload.storage_path||upload.storage_path.startsWith('/')||upload.storage_path.split('/').some(s=>s==='..'||s==='.')||upload.storage_path.length>500)return output({ok:false,code:'NOT_FOUND'},404,origin);
    const signed=await f(env.url+'/storage/v1/object/sign/nelio-documents/'+upload.storage_path.split('/').map(encodeURIComponent).join('/'),{method:'POST',headers:{...adminHeaders(env.serviceKey),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60}),signal:AbortSignal.timeout(8000)});
    if(!signed.ok)throw Error('storage_unavailable');
    const signedBody=await signed.json() as {signedURL?:string;signedUrl?:string};
    const relative=signedBody.signedURL||signedBody.signedUrl;
    if(typeof relative!=='string'||!relative.startsWith('/object/sign/nelio-documents/')||relative.startsWith('//'))throw Error('invalid_signed_url');
    return output({ok:true,url:env.url+'/storage/v1'+relative,expiresIn:60},200,origin);
   }
   const cycles=await table('cycles','select=cycle_id,due_date,status&order=cycle_id.desc&limit=24',env,f);
   const rows=cycles as Array<{cycle_id:string;status:string}>;
   const selected=action.cycleId??rows.find(c=>c.status==='open')?.cycle_id??rows[0]?.cycle_id;
   if(!selected||!rows.some(c=>c.cycle_id===selected))return output({ok:false,code:'UNKNOWN_CYCLE'},404,origin);
   const [requests,clients,staff]=await Promise.all([
    table('requests','select=request_id,cycle_id,client_id,status,reminder_count,last_activity,last_activity_at&cycle_id=eq.'+selected+'&limit=200',env,f),
    table('clients','select=client_id,business_name,profile_id,frequency,bookkeeper_id&limit=200',env,f),
    table('staff','select=staff_id,name&active=eq.true&limit=20',env,f)
   ]);
   return output({ok:true,version:VERSION,cycleId:selected,cycles,requests,clients,staff},200,origin);
  }catch{return output({ok:false,code:'UNAVAILABLE'},503,origin);}
 };
}
