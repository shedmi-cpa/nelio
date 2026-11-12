-- Stage 6.3.4: the ZIP file list. Always rolled back.
begin;
insert into public.clients(client_id,business_name,contact_name,email,profile_id,frequency,bookkeeper_id,token_hash,active) values
 ('QA_Z1','ב עסק שני','א','shedmi.cpa+z1@gmail.com','SERVICE','monthly','S2',encode(extensions.digest(repeat('x',43),'sha256'),'hex'),true),
 ('QA_Z2','א עסק ראשון','א','shedmi.cpa+z2@gmail.com','SERVICE','monthly','S2',encode(extensions.digest(repeat('y',43),'sha256'),'hex'),true);
insert into public.cycles(cycle_id,due_date,status) values('2026-09','2026-10-12','closed');
insert into public.requests(request_id,cycle_id,client_id,period,status) values
 ('QA_Z1_10','2026-10','QA_Z1','2026-10','partial'),('QA_Z1_09','2026-09','QA_Z1','2026-09','complete'),('QA_Z2_10','2026-10','QA_Z2','2026-10','partial');
insert into public.items(item_id,request_id,doc_type_id,required,status) values
 ('Z1_10_BANK','QA_Z1_10','BANK_STATEMENT',true,'rejected'),('Z1_10_CREDIT','QA_Z1_10','CREDIT_CARD',true,'received'),
 ('Z1_09_BANK','QA_Z1_09','BANK_STATEMENT',true,'received'),('Z2_10_BANK','QA_Z2_10','BANK_STATEMENT',true,'received');
insert into public.uploads(upload_id,uploaded_at,item_id,request_id,client_id,stored_name,seq,mime_type,size_bytes,status,storage_provider,storage_path,drive_file_id,ingest_status) values
 ('ZU1',now(),'Z1_10_BANK','QA_Z1_10','QA_Z1','b_2026-10_דף-בנק_01.jpg',1,'image/jpeg',100,'rejected','supabase','QA_Z1/2026-10/1','','ready'),
 ('ZU2',now(),'Z1_10_CREDIT','QA_Z1_10','QA_Z1','b_2026-10_פירוט-אשראי_01.pdf',1,'application/pdf',200,'active','supabase','QA_Z1/2026-10/2','','ready'),
 ('ZU3',now(),'Z1_10_CREDIT','QA_Z1_10','QA_Z1','b_2026-10_פירוט-אשראי_02.pdf',2,'application/pdf',300,'active','supabase','QA_Z1/2026-10/3','','pending'),
 ('ZU4',now(),'Z1_09_BANK','QA_Z1_09','QA_Z1','b_2026-09_דף-בנק_01.jpg',1,'image/jpeg',400,'active','drive',null,'DRIVEID123456','ready'),
 ('ZU5',now(),'Z2_10_BANK','QA_Z2_10','QA_Z2','a_2026-10_דף-בנק_01.jpg',1,'image/jpeg',500,'active','supabase','QA_Z2/2026-10/5','','ready');
set local role service_role;
do $$
declare a jsonb;
begin
 a:=public.nelio_office_files('{"scope":"request","requestId":"QA_Z1_10","actor":"S9"}');
 assert a->>'code'='BAD_ACTOR','actor required';
 a:=public.nelio_office_files('{"scope":"request","requestId":"QA_Z1_10","actor":"S2","dryRun":true}');
 assert (a->>'count')::int=2 and (a->>'totalBytes')::bigint=300,'request: ready files only, rejected included';
 assert (a->'files'->0->>'docName')='דף בנק' and (a->'files'->0->>'rejected')::boolean,'ordered by document, rejected flagged';
 assert not exists(select 1 from jsonb_array_elements(a->'files') f where f ? 'storagePath' or f ? 'driveFileId'),'no storage ids';
 assert not exists(select 1 from public.activity_log where event='office_export'),'dry run not logged';
 a:=public.nelio_office_files('{"scope":"request","requestId":"QA_Z1_10","actor":"S2","includeRejected":false,"dryRun":true}');
 assert (a->>'count')::int=1,'without rejected';
 a:=public.nelio_office_files('{"scope":"docType","requestId":"QA_Z1_10","docTypeId":"CREDIT_CARD","actor":"S2","dryRun":true}');
 assert (a->>'count')::int=1 and a->'files'->0->>'uploadId'='ZU2','one document type';
 a:=public.nelio_office_files('{"scope":"docType","requestId":"QA_Z1_10","docTypeId":"Z_REPORTS","actor":"S2"}');
 assert a->>'code'='NOT_FOUND','type not in request';
 a:=public.nelio_office_files('{"scope":"client","clientId":"QA_Z1","actor":"S2","dryRun":true}');
 assert (a->>'count')::int=3 and a->'files'->0->>'period'='2026-09','all cycles of one client, Drive included';
 a:=public.nelio_office_files('{"scope":"cycle","cycleId":"2026-10","actor":"S2"}');
 assert exists(select 1 from jsonb_array_elements(a->'files') f where f->>'uploadId'='ZU5') and not exists(select 1 from jsonb_array_elements(a->'files') f where f->>'uploadId'='ZU4'),'one cycle, all clients';
 assert (select position('כל הלקוחות, אוקטובר 2026' in details)=1 from public.activity_log where event='office_export' and actor='office:S2'),'export logged';
 a:=public.nelio_office_files('{"scope":"everything","actor":"S2"}');
 assert a->>'code'='BAD_REQUEST','unknown scope';
 assert not has_function_privilege('anon','public.nelio_office_files(jsonb)','EXECUTE'),'anon denied';
end $$;
rollback;
