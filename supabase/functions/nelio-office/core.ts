// Office-only read API. This server never trusts browser-provided user details.
export const OFFICE_ORIGIN = 'https://shedmi-cpa.github.io';
export const OFFICE_EMAIL = 'shedmi.cpa@gmail.com';
export const VERSION = '0.6.2';
export type OfficeEnv = { url:string; anonKey:string; serviceKey:string };
type HttpFetch = (input:RequestInfo|URL, init?:RequestInit)=>Promise<Response>;
type Action = {action:'session'}|{action:'overview';cycleId?:string}|{action:'requestDetail';requestId:string}|{action:'fileLink';uploadId:string};
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
 if(x.action==='requestDetail'&&Object.keys(x).length===2&&typeof x.requestId==='string'
  &&/^[A-Za-z0-9_-]{1,100}$/.test(x.requestId))return {action:'requestDetail',requestId:x.requestId};
 if(x.action==='fileLink'&&Object.keys(x).length===2&&typeof x.uploadId==='string'
  &&/^[A-Za-z0-9_-]{1,120}$/.test(x.uploadId))return {action:'fileLink',uploadId:x.uploadId};
 return null;
}
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

type RequestRow={request_id:string;client_id:string;cycle_id:string;period:string;status:string};
type UploadRef={upload_id:string;client_id:string;storage_provider:string;storage_path:string|null;drive_file_id:string;ingest_status:string};

async function requestDetail(requestId:string,env:OfficeEnv,f:HttpFetch):Promise<unknown|null>{
 const requests=await table('requests','select=request_id,client_id,cycle_id,period,status,reminder_count,last_activity,last_activity_at,client_note,submitted_at,completed_at,completion_note&request_id=eq.'+encodeURIComponent(requestId)+'&limit=1',env,f);
 const request=requests[0] as RequestRow|undefined;
 if(!request)return null;
 const id=encodeURIComponent(request.client_id);
 const req=encodeURIComponent(requestId);
 const [clients,items,uploads,docTypes]=await Promise.all([
  table('clients','select=client_id,business_name,contact_name,profile_id,frequency,bookkeeper_id,legal_type,has_employees&client_id=eq.'+id+'&limit=1',env,f),
  table('items','select=item_id,doc_type_id,required,status,file_count,na_note,reject_reason,updated_at&request_id=eq.'+req+'&limit=100',env,f),
  table('uploads','select=upload_id,item_id,uploaded_at,original_name,stored_name,mime_type,size_bytes,status,storage_provider,ingest_status&request_id=eq.'+req+'&order=uploaded_at.desc&limit=200',env,f),
  table('doc_types','select=doc_type_id,name_he,description_he,sort_order&limit=100',env,f)
 ]);
 if(!clients.length)throw Error('client_missing');
 return {request,client:clients[0],items,uploads,docTypes};
}
async function fileLink(uploadId:string,env:OfficeEnv,f:HttpFetch):Promise<{url:string;provider:string;expiresIn?:number}|null|'pending'>{
 const rows=await table('uploads','select=upload_id,client_id,storage_provider,storage_path,drive_file_id,ingest_status&upload_id=eq.'+encodeURIComponent(uploadId)+'&limit=1',env,f);
 const upload=rows[0] as UploadRef|undefined;
 if(!upload)return null;
 if(upload.ingest_status!=='ready')return 'pending';
 if(upload.storage_provider==='drive'){
  // A Drive file ID is not an access credential. Google's existing file ACL
  // remains authoritative; this link does not change sharing or proxy bytes.
  if(!/^[A-Za-z0-9_-]{10,200}$/.test(upload.drive_file_id||''))throw Error('invalid_drive_reference');
  return {url:'https://drive.google.com/file/d/'+encodeURIComponent(upload.drive_file_id)+'/view',provider:'drive'};
 }
 if(upload.storage_provider!=='supabase')throw Error('unknown_provider');
 const path=upload.storage_path||'';
 if(!/^[A-Za-z0-9_-]{1,64}\/20[0-9]{2}-(0[1-9]|1[0-2])(?:_(0[1-9]|1[0-2]))?\/[0-9a-fA-F-]{36}$/.test(path)
  || !path.startsWith(upload.client_id+'/'))throw Error('invalid_storage_reference');
 const res=await f(env.url+'/storage/v1/object/sign/nelio-documents/'+path.split('/').map(encodeURIComponent).join('/'),
  {method:'POST',headers:{...adminHeaders(env.serviceKey),'Content-Type':'application/json'},body:JSON.stringify({expiresIn:60}),signal:AbortSignal.timeout(8000)});
 if(!res.ok)throw Error('storage_unavailable');
 const data=await res.json() as {signedURL?:unknown;signedUrl?:unknown};
 const signed=data.signedURL??data.signedUrl;
 if(typeof signed!=='string'||!signed.startsWith('/object/sign/nelio-documents/'))throw Error('invalid_signed_response');
 const url=new URL('/storage/v1'+signed,env.url);
 if(url.origin!==new URL(env.url).origin||!url.searchParams.has('token'))throw Error('invalid_signed_url');
 return {url:url.toString(),provider:'supabase',expiresIn:60};
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
   if(action.action==='requestDetail'){
    const detail=await requestDetail(action.requestId,env,f);
    return detail?output({ok:true,version:VERSION,...detail},200,origin):output({ok:false,code:'NOT_FOUND'},404,origin);
   }
   if(action.action==='fileLink'){
    const link=await fileLink(action.uploadId,env,f);
    if(link==='pending')return output({ok:false,code:'NOT_READY'},409,origin);
    return link?output({ok:true,...link},200,origin):output({ok:false,code:'NOT_FOUND'},404,origin);
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
