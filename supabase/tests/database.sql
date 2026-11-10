-- Run against nelio-dev after importing the demo. Entire test is rolled back.
begin;
insert into public.clients(client_id,business_name,contact_name,email,profile_id,frequency,bookkeeper_id,token_hash,active)
values('QA_SQL','בדיקה זמנית','בדיקה','shedmi.cpa+qa@gmail.com','SERVICE','monthly','S2',encode(extensions.digest(repeat('q',32),'sha256'),'hex'),true);
insert into public.requests(request_id,cycle_id,client_id,period,status)
select 'QA_SQL_REQUEST',cycle_id,'QA_SQL',cycle_id,'not_started' from public.cycles where status='open';
insert into public.items(item_id,request_id,doc_type_id,required,status)
values('QA_SQL_BANK','QA_SQL_REQUEST','BANK_STATEMENT',true,'missing'),('QA_SQL_OTHER','QA_SQL_REQUEST','OTHER',false,'missing');
set local role service_role;
do $$
declare answer jsonb; p jsonb:=jsonb_build_object('token',repeat('q',32)); id text;
begin
 answer:=public.nelio_api(p||'{"action":"hello"}'::jsonb);
 assert answer->>'requestStatus'='not_started','initial state';
 answer:=public.nelio_api(p||'{"action":"markNa","docTypeId":"BANK_STATEMENT"}'::jsonb);
 assert answer->>'requestStatus'='submitted','all required closed';
 perform public.nelio_api(p||'{"action":"unmarkNa","docTypeId":"BANK_STATEMENT"}'::jsonb);
 perform public.nelio_api(p||'{"action":"markNa","docTypeId":"BANK_STATEMENT"}'::jsonb);
 assert (select count(*) from public.messages where request_id='QA_SQL_REQUEST' and template_id='CONFIRMATION')=1,'confirmation once';
 update public.requests set status='complete' where request_id='QA_SQL_REQUEST';
 answer:=public.nelio_api(p||'{"action":"unmarkNa","docTypeId":"BANK_STATEMENT"}'::jsonb);
 assert answer->>'requestStatus'='complete','client cannot undo office approval';
 answer:=public.nelio_api(p||'{"action":"markNa","docTypeId":"Z_REPORTS"}'::jsonb);
 assert answer->>'code'='BAD_ITEM','unassigned item denied';
 answer:=public.nelio_api(p||jsonb_build_object('action','reserveUpload','docTypeId','BANK_STATEMENT','uploadKey','qa-pending-key','fileName','demo.png','mimeType','image/png','fileHash',repeat('a',64),'sizeBytes',100));
 assert answer->>'ok'='true','reservation';id:=answer->>'uploadId';
 answer:=public.nelio_api(p||jsonb_build_object('action','finishUpload','docTypeId','BANK_STATEMENT','uploadId',id));
 assert answer->>'code'='UPLOAD_PENDING','missing object cannot be marked received';
 assert (select file_count from public.items where item_id='QA_SQL_BANK')=0,'pending upload not counted';
 update public.clients set active=false where client_id='QA_SQL';
 answer:=public.nelio_api(p||'{"action":"hello"}'::jsonb);
 assert answer->>'code'='BAD_TOKEN','revocation immediate';
 update public.clients set active=true,token_hash=encode(extensions.digest(repeat('r',32),'sha256'),'hex') where client_id='QA_SQL';
 answer:=public.nelio_api(p||'{"action":"hello"}'::jsonb);
 assert answer->>'code'='BAD_TOKEN','rotated token denied';
 assert not has_function_privilege('anon','public.nelio_api(jsonb)','EXECUTE'),'anonymous RPC denied';
 assert not has_function_privilege('authenticated','public.nelio_api(jsonb)','EXECUTE'),'authenticated RPC denied';
 assert not has_table_privilege('anon','public.clients','SELECT'),'anonymous tables denied';
end $$;
rollback;
