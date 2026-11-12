-- Stage 6.3.2: reminder now, call list, upload on behalf. Always rolled back.
begin;
insert into public.clients(client_id,business_name,contact_name,email,phone,profile_id,frequency,bookkeeper_id,token_hash,active)
values('QA_M','עסק "בדיקה"/שני','איש קשר','shedmi.cpa+qam@gmail.com','050-XXX-0001','SERVICE','monthly','S2',encode(extensions.digest(repeat('m',43),'sha256'),'hex'),true),
      ('QA_N','עסק שהשלים','איש קשר','shedmi.cpa+qan@gmail.com','050-XXX-0002','SERVICE','monthly','S2',encode(extensions.digest(repeat('o',43),'sha256'),'hex'),true);
insert into public.requests(request_id,cycle_id,client_id,period,status)
select 'QA_M_REQ',cycle_id,'QA_M',cycle_id,'not_started' from public.cycles where status='open';
insert into public.requests(request_id,cycle_id,client_id,period,status)
select 'QA_N_REQ',cycle_id,'QA_N',cycle_id,'submitted' from public.cycles where status='open';
insert into public.items(item_id,request_id,doc_type_id,required,status) values
 ('QA_M_BANK','QA_M_REQ','BANK_STATEMENT',true,'missing'),('QA_M_CREDIT','QA_M_REQ','CREDIT_CARD',true,'not_applicable'),('QA_M_OTHER','QA_M_REQ','OTHER',false,'missing'),
 ('QA_N_BANK','QA_N_REQ','BANK_STATEMENT',true,'received');
set local role service_role;
do $$
declare a jsonb; base jsonb:=jsonb_build_object('actor','S2','requestId','QA_M_REQ'); id text; path text;
begin
 -- Reminder now.
 a:=public.nelio_office_remind(base||'{"actor":"S9"}');
 assert a->>'code'='BAD_ACTOR','inactive actor';
 a:=public.nelio_office_remind(base||jsonb_build_object('dryRun',true,'token',repeat('m',43)));
 assert a->>'ok'='true' and position('דף בנק' in a->>'text')>0 and position('פירוט אשראי' in a->>'text')=0,'only missing documents';
 assert position('#t='||repeat('m',43) in a->>'text')>0 and a->>'toEmail'='shedmi.cpa+qam@gmail.com','link and recipient';
 assert (select reminder_count from public.requests where request_id='QA_M_REQ')=0,'preview writes nothing';
 a:=public.nelio_office_remind(base);
 assert a->>'messageStatus'='simulated' and a->>'linkMissing'='true','recorded in demo mode';
 assert (select reminder_count from public.requests where request_id='QA_M_REQ')=1,'counted';
 assert (select count(*) from public.messages where request_id='QA_M_REQ' and template_id='REMINDER_1' and status='simulated')=1,'message recorded';
 assert (select count(*) from public.activity_log where request_id='QA_M_REQ' and event='office_remind' and actor='office:S2')=1,'logged';
 a:=public.nelio_office_remind(jsonb_build_object('actor','S2','requestId','QA_N_REQ'));
 assert a->>'code'='NOT_ALLOWED','no reminder after the client finished';

 -- Call list.
 a:=public.nelio_office_calls('{"action":"callList"}');
 assert a->>'ok'='true','list';
 assert exists(select 1 from jsonb_array_elements(a->'rows') x where x->>'requestId'='QA_M_REQ' and x->>'missing'='דף בנק' and x->>'phone'='050-XXX-0001' and x->'calledAt'='null'::jsonb),'client with missing document listed';
 assert not exists(select 1 from jsonb_array_elements(a->'rows') x where x->>'requestId'='QA_N_REQ'),'finished client not listed';
 a:=public.nelio_office_calls('{"action":"callDone","actor":"S2","requestId":"QA_M_REQ","note":"אמר שישלח מחר"}');
 assert a->>'ok'='true','call recorded';
 a:=public.nelio_office_calls('{"action":"callList"}');
 assert exists(select 1 from jsonb_array_elements(a->'rows') x where x->>'requestId'='QA_M_REQ' and x->>'calledBy'='office:S2' and x->'calledAt'<>'null'::jsonb),'called today';
 a:=public.nelio_office_calls('{"action":"callDone","actor":"S77","requestId":"QA_M_REQ"}');
 assert a->>'code'='BAD_ACTOR','call needs actor';
 a:=public.nelio_office_calls('{"action":"callList","cycleId":"1999-01"}');
 assert a->>'code'='NOT_FOUND','unknown cycle';

 -- Upload on behalf.
 a:=public.nelio_office_upload(base||jsonb_build_object('action','reserve','itemId','QA_M_BANK','fileName','scan.exe','mimeType','application/x-msdownload','sizeBytes',10,'fileHash',repeat('a',64),'uploadKey','office-key-1'));
 assert a->>'code'='BAD_TYPE','type allowlist';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','reserve','itemId','QA_M_BANK','fileName','big.pdf','mimeType','application/pdf','sizeBytes',20000000,'fileHash',repeat('a',64),'uploadKey','office-key-1'));
 assert a->>'code'='TOO_BIG','size limit';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','reserve','itemId','QA_N_BANK','fileName','x.pdf','mimeType','application/pdf','sizeBytes',10,'fileHash',repeat('a',64),'uploadKey','office-key-1'));
 assert a->>'code'='NOT_FOUND','item of another request refused';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','reserve','itemId','QA_M_BANK','fileName','bank.pdf','mimeType','application/pdf','sizeBytes',10,'fileHash',repeat('a',64),'uploadKey','office-key-1'));
 assert a->>'ok'='true' and a->>'storedName'='עסק-״בדיקה״-שני_2026-10_דף-בנק_01.pdf','reserved with a safe Hebrew name: '||(a->>'storedName');
 id:=a->>'uploadId';path:=a->>'storagePath';
 assert path like 'QA_M/2026-10/%','storage path by ids';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','reserve','itemId','QA_M_BANK','fileName','bank.pdf','mimeType','application/pdf','sizeBytes',10,'fileHash',repeat('a',64),'uploadKey','office-key-1'));
 assert a->>'uploadId'=id,'retry reuses the reservation';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','finish','itemId','QA_M_BANK','uploadId',id));
 assert a->>'code'='UPLOAD_PENDING','no bytes, no receipt';
 reset role;
 insert into storage.objects(bucket_id,name,metadata) values('nelio-documents',path,'{"size":10}');
 set local role service_role;
 a:=public.nelio_office_upload(base||jsonb_build_object('action','finish','itemId','QA_M_BANK','uploadId',id));
 assert a->>'ok'='true' and a->>'requestStatus'='submitted','received, request complete for the client';
 assert (select status||file_count||updated_by from public.items where item_id='QA_M_BANK')='received1office:S2','item received by the office';
 assert (select uploaded_by from public.uploads where upload_id=id)='office:S2','upload attributed';
 assert (select count(*) from public.activity_log where request_id='QA_M_REQ' and event='office_upload')=1,'logged once';
 a:=public.nelio_office_upload(base||jsonb_build_object('action','finish','itemId','QA_M_BANK','uploadId',id));
 assert a->>'ok'='true' and (select count(*) from public.activity_log where request_id='QA_M_REQ' and event='office_upload')=1,'finish is idempotent';

 assert not has_function_privilege('anon','public.nelio_office_upload(jsonb)','EXECUTE'),'anon denied upload';
 assert not has_function_privilege('authenticated','public.nelio_office_calls(jsonb)','EXECUTE'),'authenticated denied calls';
 assert not has_function_privilege('anon','public.nelio_office_remind(jsonb)','EXECUTE'),'anon denied remind';
end $$;
rollback;
