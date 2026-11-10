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


test('detail and file actions validate strict IDs without accepting query fragments',()=>{
 assert.deepEqual(parseAction({action:'requestDetail',requestId:'2026-10_C01'}),{action:'requestDetail',requestId:'2026-10_C01'});
 assert.deepEqual(parseAction({action:'fileLink',uploadId:'U-test-1'}),{action:'fileLink',uploadId:'U-test-1'});
 for(const action of [{action:'requestDetail',requestId:'C01&select=*'}, {action:'requestDetail',requestId:''},
  {action:'fileLink',uploadId:'../other'}, {action:'fileLink',uploadId:'file',serviceKey:'stolen'},
  {action:'requestDetail',requestId:'A',cycleId:'other'}])assert.equal(parseAction(action),null);
});
const fileId='12345678-1234-1234-1234-123456789abc';
function detailStub(calls,provider='supabase',ready='ready',authUser=user){
 return async (url,init)=>{
  const u=String(url);calls.push({url:u,init});
  if(u.includes('/auth/v1/user'))return Response.json(authUser);
  if(u.includes('/requests?'))return Response.json([{
   request_id:'2026-10_C01',client_id:'C01',cycle_id:'2026-10',period:'2026-10',status:'partial',client_note:'הערה לדוגמה'
  }]);
  if(u.includes('/clients?'))return Response.json([{client_id:'C01',business_name:'חברה לדוגמה',frequency:'monthly'}]);
  if(u.includes('/items?'))return Response.json([{item_id:'I1',doc_type_id:'BANK',status:'received',file_count:1}]);
  if(u.includes('/uploads?')){
   if(u.includes('upload_id=eq.'))return Response.json([{upload_id:'U1',client_id:'C01',storage_provider:provider,storage_path:'C01/2026-10/'+fileId,drive_file_id:'exampleDriveFileId123456789',ingest_status:ready}]);
   return Response.json([{upload_id:'U1',item_id:'I1',stored_name:'לדוגמה.pdf',storage_provider:provider,ingest_status:ready}]);
  }
  if(u.includes('/doc_types?'))return Response.json([{doc_type_id:'BANK',name_he:'דף בנק',sort_order:1}]);
  if(u.includes('/storage/v1/object/sign/'))return Response.json({signedURL:'/object/sign/nelio-documents/C01/2026-10/'+fileId+'?token=short-lived'});
  throw Error('Unexpected request '+u);
 };
}
test('request detail uses authenticated read-only queries and redacts storage references',async()=>{
 const calls=[],handler=createOfficeHandler(env,detailStub(calls));
 const result=await handler(request({action:'requestDetail',requestId:'2026-10_C01'}));
 assert.equal(result.status,200);
 const data=await result.json();
 assert.equal(data.client.business_name,'חברה לדוגמה');
 assert.equal(data.items[0].status,'received');
 assert.equal(data.uploads[0].storage_provider,'supabase');
 assert.doesNotMatch(JSON.stringify(data),/storage_path|drive_file_id|token_hash|sb_secret_test/);
 assert.equal(calls.length,6);
 assert.ok(calls.slice(1).every(x=>x.init.method==='GET'));
 assert.ok(calls.slice(1).every(x=>x.init.headers.apikey===env.serviceKey));
});
test('files are never looked up before Google office authorization',async()=>{
 const calls=[],handler=createOfficeHandler(env,detailStub(calls,'drive','ready',{...user,email:'outside@gmail.com'}));
 const result=await handler(request({action:'fileLink',uploadId:'U1'}));
 assert.equal(result.status,403);
 assert.equal(calls.length,1);
});
test('Supabase links are short-lived, authorized, and bound to the private bucket',async()=>{
 const calls=[],handler=createOfficeHandler(env,detailStub(calls));
 const result=await handler(request({action:'fileLink',uploadId:'U1'}));
 const data=await result.json();
 assert.equal(result.status,200);
 assert.equal(data.provider,'supabase');assert.equal(data.expiresIn,60);
 assert.match(data.url,/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/sign\/nelio-documents\//);
 assert.match(data.url,/token=short-lived/);
 assert.doesNotMatch(JSON.stringify(data),/sb_secret_test|drive_file_id/);
 const sign=calls.find(x=>x.url.includes('/storage/v1/object/sign/'));
 assert.equal(sign.init.method,'POST');
 assert.deepEqual(JSON.parse(sign.init.body),{expiresIn:60});
 assert.equal(sign.init.headers.apikey,env.serviceKey);
});
test('Drive archives use Google access controls, never public sharing or a storage signature',async()=>{
 const calls=[],handler=createOfficeHandler(env,detailStub(calls,'drive'));
 const response=await handler(request({action:'fileLink',uploadId:'U1'}));
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.url,'https://drive.google.com/file/d/exampleDriveFileId123456789/view');
 assert.equal(data.provider,'drive');
 assert.ok(calls.every(x=>!x.url.includes('/storage/v1/')&&!x.url.includes('googleapis')));
});
test('pending uploads cannot be viewed',async()=>{
 const calls=[],handler=createOfficeHandler(env,detailStub(calls,'supabase','pending'));
 const response=await handler(request({action:'fileLink',uploadId:'U1'}));
 assert.equal(response.status,409);
 assert.equal((await response.json()).code,'NOT_READY');
 assert.ok(calls.every(x=>!x.url.includes('/storage/v1/object/sign/')));
});
