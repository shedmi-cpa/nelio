import { ApiError, ERRORS, VERSION, preparePayload, decodeFile, sha256, readJson } from './core.ts';

// Native REST avoids runtime package downloads and keeps server credentials on the server.
const base = Deno.env.get('SUPABASE_URL')!;
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default;
const headers: Record<string,string> = {apikey:key};
if (key?.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
const cors = {'Access-Control-Allow-Origin':'https://shedmi-cpa.github.io','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Allow-Headers':'content-type','Vary':'Origin','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json = (value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
async function rpc(payload:Record<string,unknown>):Promise<Record<string,any>> {
  const response=await fetch(`${base}/rest/v1/rpc/nelio_api`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({p:payload})});
  if(!response.ok){console.error('Database request failed',response.status);throw new ApiError('SERVER_ERROR');}
  return await response.json();
}
Deno.serve(async(request:Request)=>{
 const started=performance.now();
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(request.method==='GET') return json({ok:true,system:'Nelio',version:VERSION,backend:'supabase'});
 if(request.method!=='POST') return json({ok:false,code:'BAD_REQUEST',message:ERRORS.BAD_REQUEST},405);
 try {
  const raw=await readJson(request) as Record<string,unknown>;
  const payload=preparePayload(raw);
  let answer:Record<string,any>;
  if(payload.action==='upload') {
   // Authenticate before decoding large files. Reservations authenticate again inside a transaction.
   const authenticated=await rpc({action:'hello',token:payload.token});
   if(!authenticated.ok) answer=authenticated;
   else {
    const file=decodeFile(raw);
    const hash=await sha256(file.bytes);
    const reserved=await rpc({...payload,action:'reserveUpload',fileName:file.name,mimeType:file.mime,sizeBytes:file.bytes.length,fileHash:hash,uploadKey:file.uploadKey});
    if(!reserved.ok) answer=reserved;
    else if(reserved.ready) {const {storagePath:_path,ready:_ready,...publicResult}=reserved; answer=publicResult;}
    else {
     const response=await fetch(`${base}/storage/v1/object/nelio-documents/${reserved.storagePath}`,{method:'POST',headers:{...headers,'Content-Type':file.mime,'x-upsert':'false'},body:file.bytes});
     if(!response.ok){
      const error=await response.json().catch(()=>({}));
      // A lost response can leave the object saved but the DB pending. Retry safely.
      if(Number(error.statusCode)!==409 && error.error!=='Duplicate') throw new ApiError('SERVER_ERROR');
      const existing=await fetch(`${base}/storage/v1/object/authenticated/nelio-documents/${reserved.storagePath}`,{headers});
      if(!existing.ok || await sha256(new Uint8Array(await existing.arrayBuffer()))!==hash) throw new ApiError('UPLOAD_CONFLICT');
     }
     answer=await rpc({...payload,action:'finishUpload',uploadId:reserved.uploadId});
    }
   }
  } else answer=await rpc(payload);
  if(!answer.ok) answer.message=ERRORS[String(answer.code)]||ERRORS.SERVER_ERROR;
  return json({...answer,version:VERSION,serverMs:Math.round(performance.now()-started)});
 } catch(error) {
  const code=error instanceof ApiError?error.code:'SERVER_ERROR';
  if(code==='SERVER_ERROR') console.error('Nelio request failed'); // Never log bodies or tokens.
  return json({ok:false,code,message:ERRORS[code],serverMs:Math.round(performance.now()-started)});
 }
});
