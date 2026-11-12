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

test('unknown request and mismatched upload cannot yield a signed URL',async()=>{
 const calls=[];
 const fake=async(url)=>{
  const s=String(url);calls.push(s);
  if(s.includes('/auth/v1/user'))return Response.json(user);
  if(s.includes('/requests?'))return Response.json([{request_id:'2026-10_C01',client_id:'C01'}]);
  if(s.includes('/clients?'))return Response.json([{client_id:'C01'}]);
  if(s.includes('/uploads?'))return Response.json([]);
  throw Error('must not sign');
 };
 const h=createOfficeHandler(env,fake);
 const r=await h(request({action:'openFile',requestId:'2026-10_C01',uploadId:'DIFFERENT'}));
 assert.equal(r.status,404);
 assert.equal(calls.some(s=>s.includes('/storage/v1/object/sign/')),false);
});
test('pending upload does not receive a signed URL',async()=>{
 const calls=[];
 const fake=async(url)=>{
  const s=String(url);calls.push(s);
  if(s.includes('/auth/v1/user'))return Response.json(user);
  if(s.includes('/requests?'))return Response.json([{request_id:'R1',client_id:'C01'}]);
  if(s.includes('/clients?'))return Response.json([{client_id:'C01'}]);
  if(s.includes('/uploads?'))return Response.json([{upload_id:'U_01',storage_provider:'supabase',storage_path:'file.pdf',ingest_status:'pending'}]);
  throw Error('unexpected');
 };
 const h=createOfficeHandler(env,fake);
 assert.equal((await h(request({action:'openFile',requestId:'R1',uploadId:'U_01'}))).status,404);
 assert.equal(calls.some(s=>s.includes('/storage/v1/object/sign/')),false);
});

// ---- Stage 6.3.1: office write actions ----
import {encryptToken,decryptToken,newToken,cleanText} from '../functions/nelio-office/core.ts';
const linkKey=Buffer.alloc(32,7).toString('base64');
function writeStub({authUser=user,tokenEnc='',rpcResult={ok:true,requestStatus:'partial'},calls=[]}={}){return async(url,init)=>{
 const s=String(url);calls.push({url:s,init});
 if(s.includes('/auth/v1/user'))return new Response(JSON.stringify(authUser),{status:authUser?200:401});
 if(s.includes('/requests?'))return Response.json([{request_id:'2026-10_C07',client_id:'C07'}]);
 if(s.includes('/clients?'))return Response.json([{token_enc:tokenEnc}]);
 if(s.includes('/rest/v1/rpc/nelio_office_action'))return Response.json(typeof rpcResult==='function'?rpcResult(JSON.parse(init.body).p):rpcResult);
 throw new Error('unexpected '+s);
};}
test('write actions accept exact fields only, a staff id and clean text',()=>{
 assert.deepEqual(parseAction({action:'approve',requestId:'2026-10_C07',actor:'S2'}),{action:'approve',requestId:'2026-10_C07',actor:'S2'});
 assert.deepEqual(parseAction({action:'reject',requestId:'R',actor:'S2',uploadId:'U_1',reason:' מטושטש\u202e  מאוד '}),
  {action:'reject',requestId:'R',actor:'S2',uploadId:'U_1',reason:'מטושטש מאוד',dryRun:false});
 for(const bad of [
  {action:'approve',requestId:'R'},{action:'approve',requestId:'R',actor:'admin'},{action:'approve',requestId:'R',actor:'S2',status:'complete'},
  {action:'reject',requestId:'R',actor:'S2',uploadId:'U',reason:'   '},{action:'reject',requestId:'R',actor:'S2',uploadId:'../x',reason:'a'},
  {action:'completeManual',requestId:'R',actor:'S2',note:''},{action:'whatsapp',requestId:'R',actor:'S2',dryRun:'yes'},
  {action:'rotateLink',requestId:'R',actor:'S2',newToken:'chosen-by-browser'},
 ])assert.equal(parseAction(bad),null);
 assert.equal(cleanText('א'.repeat(400),300).length,300);
});
test('foreign identity cannot run any write action',async()=>{
 for(const body of [{action:'approve',requestId:'R',actor:'S2'},{action:'rotateLink',requestId:'R',actor:'S2'},{action:'reject',requestId:'R',actor:'S2',uploadId:'U',reason:'x'}]){
  const calls=[],h=createOfficeHandler({...env,linkKey},writeStub({authUser:{...user,email:'other@gmail.com'},calls}));
  assert.equal((await h(request(body))).status,403);
  assert.equal(calls.some(c=>c.url.includes('/rpc/')),false);
 }
});
test('token encryption round-trips and is bound to the client',async()=>{
 const t=newToken();assert.match(t,/^[A-Za-z0-9_-]{43}$/);
 const enc=await encryptToken(t,'C07',linkKey);
 assert.match(enc,/^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{40,}$/);assert.equal(enc.includes(t),false);
 assert.equal(await decryptToken(enc,'C07',linkKey),t);
 assert.equal(await decryptToken(enc,'C08',linkKey),null);
 assert.equal(await decryptToken(enc,'C07',Buffer.alloc(32,9).toString('base64')),null);
 assert.equal(await decryptToken('garbage','C07',linkKey),null);
});
test('whatsapp passes the decrypted token to the database and never to the log of calls',async()=>{
 const t=newToken(),enc=await encryptToken(t,'C07',linkKey),calls=[];
 let seen;
 const h=createOfficeHandler({...env,linkKey},writeStub({tokenEnc:enc,calls,rpcResult:p=>{seen=p;return {ok:true,text:'x',linkMissing:false};}}));
 const r=await h(request({action:'whatsapp',requestId:'2026-10_C07',actor:'S2',dryRun:true}));
 assert.equal(r.status,200);assert.equal(seen.token,t);assert.equal(seen.dryRun,true);assert.equal(seen.actor,'S2');
 const rpcCall=calls.find(c=>c.url.includes('/rpc/'));
 assert.equal(rpcCall.init.method,'POST');assert.equal(rpcCall.init.headers.apikey,env.serviceKey);
});
test('without a link key the token is simply missing, and rotation is refused clearly',async()=>{
 let seen;const h=createOfficeHandler(env,writeStub({tokenEnc:'v1.x',rpcResult:p=>{seen=p;return {ok:true};}}));
 assert.equal((await h(request({action:'whatsapp',requestId:'R',actor:'S2'}))).status,200);
 assert.equal('token' in seen,false);
 const calls=[],h2=createOfficeHandler(env,writeStub({calls}));
 const r=await h2(request({action:'rotateLink',requestId:'R',actor:'S2'}));
 assert.equal(r.status,501);assert.equal((await r.json()).code,'LINK_KEY_MISSING');
 assert.equal(calls.some(c=>c.url.includes('/rpc/')),false);
});
test('rotation generates the token on the server and stores only ciphertext plus hash input',async()=>{
 let seen;
 const h=createOfficeHandler({...env,linkKey},writeStub({rpcResult:p=>{seen=p;return {ok:true,link:'https://shedmi-cpa.github.io/nelio/#t='+p.newToken};}}));
 const r=await h(request({action:'rotateLink',requestId:'R',actor:'S2'}));
 assert.equal(r.status,200);
 assert.match(seen.newToken,/^[A-Za-z0-9_-]{43}$/);
 assert.equal(await decryptToken(seen.newTokenEnc,'C07',linkKey),seen.newToken);
});
test('database refusals map to clear HTTP codes; unknown codes are not echoed',async()=>{
 for(const [code,status] of [['NOT_ALLOWED',409],['BAD_ACTOR',400],['TEMPLATE_MISSING',500],['NOT_FOUND',404]]){
  const h=createOfficeHandler(env,writeStub({rpcResult:{ok:false,code}}));
  const r=await h(request({action:'approve',requestId:'R',actor:'S2'}));
  assert.equal(r.status,status);assert.equal((await r.json()).code,code);
 }
 const h=createOfficeHandler(env,writeStub({rpcResult:{ok:false,code:'<script>'}}));
 const r=await h(request({action:'approve',requestId:'R',actor:'S2'}));
 assert.equal(r.status,503);assert.equal((await r.json()).code,'UNAVAILABLE');
});
test('client detail tells whether a link is stored without sending the ciphertext',async()=>{
 const f=async(url)=>{
  const s=String(url);
  if(s.includes('/auth/v1/user'))return Response.json(user);
  if(s.includes('/requests?'))return Response.json([{request_id:'R',client_id:'C07',status:'partial'}]);
  if(s.includes('/clients?'))return Response.json([{client_id:'C07',business_name:'דוגמה',token_enc:'v1.SECRETCIPHERTEXT'}]);
  if(s.includes('/items?')||s.includes('/uploads?')||s.includes('/doc_types?'))return Response.json([]);
  if(s.includes('/templates?'))return Response.json([{template_id:'WHATSAPP',body:'[מה שחסר]'}]);
  throw Error('unexpected '+s);
 };
 const r=await createOfficeHandler(env,f)(request({action:'clientDetail',requestId:'R'}));
 const text=await r.text();
 assert.equal(r.status,200);assert.equal(text.includes('SECRETCIPHERTEXT'),false);
 const d=JSON.parse(text);assert.equal(d.client.hasLink,true);assert.equal(d.linkKeyConfigured,false);assert.equal(d.templates.length,1);
});
