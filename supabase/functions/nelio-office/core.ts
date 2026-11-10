// Office-only read API. This server never trusts browser-provided user details.
export const OFFICE_ORIGIN = 'https://shedmi-cpa.github.io';
export const OFFICE_EMAIL = 'shedmi.cpa@gmail.com';
export const VERSION = '0.6.2';
export type OfficeEnv = { url:string; anonKey:string; serviceKey:string };
type HttpFetch = (input:RequestInfo|URL, init?:RequestInit)=>Promise<Response>;
type Action = {action:'session'}|{action:'overview';cycleId?:string}|{action:'clientDetail';requestId:string}|{action:'openFile';requestId:string;uploadId:string};
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
 return null;
}
function validId(v:unknown):v is string{return typeof v==='string'&&v.length>0&&v.length<=100&&/^[A-Za-z0-9_-]+$/.test(v);}
async function smallJson(r:Request):Promise<unknown>{
 const reader=r.body?.getReader();if(!reader)throw Error('bad body');
 let size=0;const chunks:Uint8Array[]=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048)throw Error('too large');chunks.push(value);}}
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
   if(action.action==='clientDetail'||action.action==='openFile'){
    const reqRows=await table('requests','select=request_id,client_id,cycle_id,status,period,client_note&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=1',env,f);
    const req=reqRows[0] as Record<string,unknown>|undefined;
    if(!req)return output({ok:false,code:'NOT_FOUND'},404,origin);
    const clientRows=await table('clients','select=client_id,business_name,frequency,profile_id,bookkeeper_id&client_id=eq.'+encodeURIComponent(String(req.client_id))+'&limit=1',env,f);
    if(clientRows.length!==1)return output({ok:false,code:'NOT_FOUND'},404,origin);
    if(action.action==='clientDetail'){
     const items=await table('items','select=item_id,request_id,doc_type_id,required,status,file_count,na_note,reject_reason,updated_at&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=100',env,f);
     const uploads=await table('uploads','select=upload_id,item_id,request_id,stored_name,original_name,mime_type,size_bytes,uploaded_at,status,storage_provider,ingest_status&request_id=eq.'+encodeURIComponent(action.requestId)+'&order=uploaded_at.desc&limit=250',env,f);
     const docTypes=await table('doc_types','select=doc_type_id,name_he,sort_order&limit=100',env,f);
     return output({ok:true,request:req,client:clientRows[0],items,uploads,docTypes},200,origin);
    }
    const uploadRows=await table('uploads','select=upload_id,request_id,storage_provider,storage_path,drive_file_id,ingest_status,stored_name,mime_type&upload_id=eq.'+encodeURIComponent(action.uploadId)+'&request_id=eq.'+encodeURIComponent(action.requestId)+'&limit=1',env,f);
    const upload=uploadRows[0] as Record<string,unknown>|undefined;
    if(!upload||upload.ingest_status!=='ready')return output({ok:false,code:'NOT_FOUND'},404,origin);
    if(upload.storage_provider==='drive')return output({ok:false,code:'DRIVE_NOT_CONFIGURED'},501,origin);
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
