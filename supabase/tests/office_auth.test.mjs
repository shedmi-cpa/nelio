import test from 'node:test';
import assert from 'node:assert/strict';
import {createOfficeHandler,isAuthorizedOfficeUser,parseAction,OFFICE_ORIGIN} from '../functions/nelio-office/core.ts';
const user={id:'12345678-1234-1234-1234-123456789abc',email:'shedmi.cpa@gmail.com',email_confirmed_at:'2026-11-10T00:00:00Z',app_metadata:{providers:['google']},identities:[{provider:'google'}]};
const env={url:'https://example.supabase.co',anonKey:'sb_publishable_test',serviceKey:'sb_secret_test'};
function request(body={action:'session'},token='abc.def.ghi',origin=OFFICE_ORIGIN){
 return new Request('https://example.supabase.co/functions/v1/nelio-office',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});
}
function stub(authUser=user,calls=[]){return async(url,init)=>{
 calls.push({url:String(url),init});
 if(String(url).includes('/auth/v1/user'))return new Response(JSON.stringify(authUser),{status:authUser?200:401});
 if(String(url).includes('/cycles?'))return Response.json([{cycle_id:'2026-10',status:'open',due_date:'2026-11-12'}]);
 if(String(url).includes('/requests?'))return Response.json([{request_id:'2026-10_C01',client_id:'C01',status:'partial'}]);
 if(String(url).includes('/clients?'))return Response.json([{client_id:'C01',business_name:'עסק לדוגמה'}]);
 if(String(url).includes('/staff?'))return Response.json([{staff_id:'S2',name:'עובד לדוגמה'}]);
 throw new Error('unexpected remote request');
};}
test('only verified Google identity with office email is authorized',()=>{
 assert.equal(isAuthorizedOfficeUser(user),true);
 for(const other of [{...user,email:'other@gmail.com'},{...user,email_confirmed_at:null},{...user,identities:[]},{...user,app_metadata:{providers:['email']}},{...user,id:'bad'}])
  assert.equal(isAuthorizedOfficeUser(other),false);
});
test('office endpoint permits only allowlisted actions and cycle values',()=>{
 assert.deepEqual(parseAction({action:'session'}),{action:'session'});
 for(const x of [{action:'session',access:true},{action:'deleteAll'},{action:'overview',cycleId:'2026-10&client_id=eq.C01'}])assert.equal(parseAction(x),null);
});
test('rejects absent token, foreign origin, bad action before network call',async()=>{
 const calls=[],handler=createOfficeHandler(env,stub(user,calls));
 assert.equal((await handler(request({action:'session'},'invalid'))).status,401);
 assert.equal((await handler(request({action:'session'},'abc.def.ghi','https://evil.test'))).status,403);
 assert.equal((await handler(request({action:'reserveUpload'}))).status,400);
 assert.equal(calls.length,0);
});
test('non-allowed Google user cannot read private table data',async()=>{
 const calls=[],handler=createOfficeHandler(env,stub({...user,email:'other@gmail.com'},calls));
 assert.equal((await handler(request({action:'overview'}))).status,403);
 assert.equal(calls.length,1);assert.match(calls[0].url,/\/auth\/v1\/user/);
});
test('bad Supabase session gets 401',async()=>{
 const handler=createOfficeHandler(env,stub(null));
 assert.equal((await handler(request({action:'overview'}))).status,401);
});
test('authorized overview queries only the server and returns read-only data',async()=>{
 const calls=[],handler=createOfficeHandler(env,stub(user,calls));
 const result=await handler(request({action:'overview',cycleId:'2026-10'}));
 assert.equal(result.status,200);const data=await result.json();
 assert.equal(data.cycleId,'2026-10');assert.equal(data.requests[0].status,'partial');
 assert.equal(calls.length,5);
 assert.ok(calls.slice(1).every(x=>x.init.method==='GET'&&x.init.headers.apikey===env.serviceKey));
 assert.ok(calls.slice(1).every(x=>!Object.hasOwn(x.init.headers,'Authorization')));
});
test('preflight permits only trusted origin',async()=>{
 const handler=createOfficeHandler(env,stub());
 const valid=await handler(new Request('https://example.supabase.co',{method:'OPTIONS',headers:{Origin:OFFICE_ORIGIN}}));
 assert.equal(valid.status,204);assert.equal(valid.headers.get('Access-Control-Allow-Origin'),OFFICE_ORIGIN);
 const invalid=await handler(new Request('https://example.supabase.co',{method:'OPTIONS',headers:{Origin:'https://evil.test'}}));
 assert.equal(invalid.status,403);assert.equal(invalid.headers.get('Access-Control-Allow-Origin'),null);
});

test('client detail and file actions require safe identifiers and exact allowlist',()=>{
 assert.deepEqual(parseAction({action:'clientDetail',requestId:'2026-10_C01'}),{action:'clientDetail',requestId:'2026-10_C01'});
 assert.deepEqual(parseAction({action:'openFile',requestId:'2026-10_C01',uploadId:'U_17'}),{action:'openFile',requestId:'2026-10_C01',uploadId:'U_17'});
 for(const input of [{action:'openFile',requestId:'x',uploadId:'../secret'},{action:'clientDetail',requestId:'x&client_id=eq.C02'},{action:'openFile',requestId:'x',uploadId:'x',override:'yes'}])assert.equal(parseAction(input),null);
});
test('foreign identity cannot fetch client detail or file URL',async()=>{
 const calls=[],handler=createOfficeHandler(env,stub({...user,email:'not-office@gmail.com'},calls));
 assert.equal((await handler(request({action:'clientDetail',requestId:'2026-10_C01'}))).status,403);
 assert.equal((await handler(request({action:'openFile',requestId:'2026-10_C01',uploadId:'U_01'}))).status,403);
 assert.equal(calls.length,2);
});
test('file access requires matching request, refuses pending and never exposes historical Drive IDs',async()=>{
 const calls=[];
 const f=async(url,init)=>{
  calls.push(String(url));
  if(String(url).includes('/auth/v1/user'))return Response.json(user);
  if(String(url).includes('/requests?'))return Response.json([{request_id:'2026-10_C01',client_id:'C01',cycle_id:'2026-10'}]);
  if(String(url).includes('/clients?'))return Response.json([{client_id:'C01',business_name:'דוגמה'}]);
  if(String(url).includes('/uploads?'))return Response.json([{upload_id:'U_01',request_id:'2026-10_C01',storage_provider:'drive',drive_file_id:'SECRET_DRIVE_FILE',ingest_status:'ready'}]);
  throw Error('unexpected');
 };
 const handler=createOfficeHandler(env,f),response=await handler(request({action:'openFile',requestId:'2026-10_C01',uploadId:'U_01'}));
 assert.equal(response.status,501);assert.equal((await response.text()).includes('SECRET_DRIVE_FILE'),false);
 assert.equal(calls.filter(u=>u.includes('/uploads?')).length,1);
});
test('Supabase file access signs only a ready object after office authorization and matching request',async()=>{
 let signed=false;
 const f=async(url,init)=>{
  const s=String(url);
  if(s.includes('/auth/v1/user'))return Response.json(user);
  if(s.includes('/requests?'))return Response.json([{request_id:'2026-10_C01',client_id:'C01'}]);
  if(s.includes('/clients?'))return Response.json([{client_id:'C01'}]);
  if(s.includes('/uploads?'))return Response.json([{upload_id:'U_01',request_id:'2026-10_C01',storage_provider:'supabase',storage_path:'2026-10/C01/file.pdf',ingest_status:'ready'}]);
  if(s.includes('/storage/v1/object/sign/')){signed=true;assert.equal(init.method,'POST');assert.equal(JSON.parse(init.body).expiresIn,60);return Response.json({signedURL:'/object/sign/nelio-documents/2026-10/C01/file.pdf?token=SIGNED'});}
  throw Error('unexpected '+s);
 };
 const handler=createOfficeHandler(env,f),response=await handler(request({action:'openFile',requestId:'2026-10_C01',uploadId:'U_01'}));
 assert.equal(response.status,200);assert.equal(signed,true);
 const body=await response.json();assert.equal(body.expiresIn,60);assert.ok(body.url.includes('token=SIGNED'));assert.equal(body.url.includes('sb_secret_test'),false);
});
