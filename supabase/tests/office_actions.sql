-- Office write actions (stage 6.3.1). Runs locally (run_sql_tests.sh) or against nelio-dev; always rolled back.
begin;
insert into public.clients(client_id,business_name,contact_name,email,profile_id,frequency,bookkeeper_id,token_hash,active)
values('QA_OFF','עסק בדיקה','איש קשר לדוגמה','shedmi.cpa+qaoff@gmail.com','SERVICE','monthly','S2',encode(extensions.digest(repeat('k',43),'sha256'),'hex'),true);
insert into public.requests(request_id,cycle_id,client_id,period,status)
select 'QA_OFF_REQ',cycle_id,'QA_OFF',cycle_id,'partial' from public.cycles where status='open';
insert into public.items(item_id,request_id,doc_type_id,required,status,file_count,last_seq) values
 ('QA_OFF_BANK','QA_OFF_REQ','BANK_STATEMENT',true,'received',2,3),
 ('QA_OFF_CREDIT','QA_OFF_REQ','CREDIT_CARD',true,'missing',0,0),
 ('QA_OFF_OTHER','QA_OFF_REQ','OTHER',false,'missing',0,0);
insert into public.uploads(upload_id,uploaded_at,item_id,request_id,client_id,uploaded_by,stored_name,seq,mime_type,size_bytes,status,storage_provider,storage_path,ingest_status) values
 ('QA_U1',now(),'QA_OFF_BANK','QA_OFF_REQ','QA_OFF','client','עסק-בדיקה_2026-10_דף-בנק_01.jpg',1,'image/jpeg',100,'active','supabase','QA_OFF/2026-10/u1','ready'),
 ('QA_U2',now(),'QA_OFF_BANK','QA_OFF_REQ','QA_OFF','client','עסק-בדיקה_2026-10_דף-בנק_02.jpg',2,'image/jpeg',100,'active','supabase','QA_OFF/2026-10/u2','ready'),
 ('QA_U3',now(),'QA_OFF_BANK','QA_OFF_REQ','QA_OFF','client','עסק-בדיקה_2026-10_דף-בנק_03.jpg',3,'image/jpeg',100,'active','supabase','QA_OFF/2026-10/u3','pending');
set local role service_role;
do $$
declare
 answer jsonb; tok text:=repeat('k',43);
 base jsonb:=jsonb_build_object('actor','S2','requestId','QA_OFF_REQ');
 new_tok text:=repeat('n',43); new_enc text:='v1.'||repeat('i',16)||'.'||repeat('c',60);
begin
 -- Who works now: an unknown or inactive staff member is refused before anything is read.
 answer:=public.nelio_office_action(base||'{"action":"approve","actor":"S9"}');
 assert answer->>'code'='BAD_ACTOR','inactive actor refused';
 answer:=public.nelio_office_action(base||'{"action":"approve","actor":"S77"}');
 assert answer->>'code'='BAD_ACTOR','unknown actor refused';
 answer:=public.nelio_office_action(base||'{"action":"approve","requestId":"NOPE"}');
 assert answer->>'code'='NOT_FOUND','unknown request';
 answer:=public.nelio_office_action(base||'{"action":"dropTables"}');
 assert answer->>'code'='BAD_REQUEST','unknown action';

 -- WhatsApp: preview with the real link, only what is missing, no writes.
 answer:=public.nelio_office_action(base||jsonb_build_object('action','whatsapp','dryRun',true,'token',tok));
 assert answer->>'ok'='true' and answer->>'linkMissing'='false','whatsapp preview';
 assert position('#t='||tok in answer->>'text')>0,'preview has the personal link';
 assert position('פירוט אשראי' in answer->>'text')>0 and position('דף בנק' in answer->>'text')=0,'only missing documents';
 assert position('מסמך אחר' in answer->>'text')=0,'optional document never in a reminder';
 assert (select reminder_count from public.requests where request_id='QA_OFF_REQ')=0,'dry run writes nothing';
 -- A token that no longer matches the hash is ignored.
 answer:=public.nelio_office_action(base||jsonb_build_object('action','whatsapp','dryRun',true,'token',repeat('z',43)));
 assert answer->>'linkMissing'='true' and position('#t=' in answer->>'text')=0,'stale token ignored';
 answer:=public.nelio_office_action(base||jsonb_build_object('action','whatsapp','token',tok));
 assert answer->>'ok'='true','whatsapp logged';
 assert (select reminder_count from public.requests where request_id='QA_OFF_REQ')=1,'reminder counted';
 assert (select count(*) from public.activity_log where request_id='QA_OFF_REQ' and event='office_whatsapp' and actor='office:S2' and position('#t=' in details)=0)=1,'log without link';
 delete from public.templates where template_id='WHATSAPP';
 answer:=public.nelio_office_action(base||'{"action":"whatsapp","dryRun":true}');
 assert answer->>'code'='TEMPLATE_MISSING','missing template is a clear error';
 insert into public.templates(template_id,name_he,recipient,subject,body) values('WHATSAPP','תזכורת בוואטסאפ','client','','[מה שחסר] [קישור]');

 -- Approve only from submitted.
 answer:=public.nelio_office_action(base||'{"action":"approve"}');
 assert answer->>'code'='NOT_ALLOWED','partial cannot be approved';

 -- Unreadable, per file (D48).
 answer:=public.nelio_office_action(base||'{"action":"reject","uploadId":"QA_U3","reason":"מטושטש"}');
 assert answer->>'code'='NOT_ALLOWED','pending upload cannot be rejected';
 answer:=public.nelio_office_action(base||'{"action":"reject","uploadId":"QA_U1","reason":"   "}');
 assert answer->>'code'='BAD_REASON','reason required';
 answer:=public.nelio_office_action(base||'{"action":"reject","uploadId":"QA_U1","reason":"התמונה מטושטשת","dryRun":true}');
 assert position('התמונה מטושטשת' in answer->>'text')>0 and position('דף בנק' in answer->>'text')>0,'reject preview';
 assert (select status from public.uploads where upload_id='QA_U1')='active','preview writes nothing';
 answer:=public.nelio_office_action(base||jsonb_build_object('action','reject','uploadId','QA_U1','reason','התמונה מטושטשת','token',tok));
 assert answer->>'ok'='true' and answer->>'requestStatus'='partial' and answer->>'messageStatus'='simulated','rejected';
 assert (select status from public.uploads where upload_id='QA_U1')='rejected','file marked rejected, not deleted';
 assert (select status from public.uploads where upload_id='QA_U2')='active','other file stays active';
 assert (select status||file_count||reject_reason from public.items where item_id='QA_OFF_BANK')='rejected1התמונה מטושטשת','item rejected, count of active files';
 assert (select count(*) from public.messages where request_id='QA_OFF_REQ' and template_id='REJECTED' and status='simulated' and position('#t='||tok in body)>0)=1,'demo message recorded with link';
 answer:=public.nelio_office_action(base||'{"action":"reject","uploadId":"QA_U1","reason":"שוב"}');
 assert answer->>'code'='NOT_ALLOWED','already rejected file';

 -- The client finishes, the office approves, then a late unreadable file cancels the approval (data-model 3.2).
 update public.items set status='received',reject_reason='' where item_id='QA_OFF_BANK';
 update public.items set status='not_applicable' where item_id='QA_OFF_CREDIT';
 perform public.nelio_recompute('QA_OFF_REQ','בדיקה');
 assert (select status from public.requests where request_id='QA_OFF_REQ')='submitted','submitted';
 answer:=public.nelio_office_action(base||'{"action":"whatsapp","dryRun":true}');
 assert answer->>'code'='NOT_ALLOWED','no reminder once submitted';
 answer:=public.nelio_office_action(base||'{"action":"approve"}');
 assert answer->>'requestStatus'='complete','approved';
 assert (select completed_by from public.requests where request_id='QA_OFF_REQ')='S2','approver recorded';
 answer:=public.nelio_office_action(base||'{"action":"reject","uploadId":"QA_U2","reason":"חסר עמוד"}');
 assert answer->>'requestStatus'='partial' and answer->>'linkMissing'='true','rejection cancels approval';
 assert (select completed_by||completion_note from public.requests where request_id='QA_OFF_REQ')='','approval cleared';
 assert (select position('הקישור האישי שקיבלתם' in body)>0 from public.messages where request_id='QA_OFF_REQ' and template_id='REJECTED' and position('חסר עמוד' in body)>0),'fallback text without link';

 -- Manual completion needs a note.
 answer:=public.nelio_office_action(base||'{"action":"completeManual","note":""}');
 assert answer->>'code'='BAD_NOTE','note required';
 answer:=public.nelio_office_action(base||'{"action":"completeManual","note":"קיבלנו בדואר"}');
 assert answer->>'requestStatus'='complete','manual complete';
 assert (select completion_note from public.requests where request_id='QA_OFF_REQ')='קיבלנו בדואר','note saved';
 answer:=public.nelio_office_action(base||'{"action":"completeManual","note":"שוב"}');
 assert answer->>'code'='NOT_ALLOWED','already complete';

 -- New link (D47): the old link stops at once, the new one works, the token never reaches the log.
 answer:=public.nelio_office_action(base||jsonb_build_object('action','rotateLink','newToken','short','newTokenEnc',new_enc));
 assert answer->>'code'='BAD_REQUEST','weak token refused';
 answer:=public.nelio_office_action(base||jsonb_build_object('action','rotateLink','newToken',new_tok,'newTokenEnc','plain'));
 assert answer->>'code'='BAD_REQUEST','unencrypted value refused';
 answer:=public.nelio_office_action(base||jsonb_build_object('action','rotateLink','newToken',new_tok,'newTokenEnc',new_enc));
 assert answer->>'ok'='true' and answer->>'link'='https://shedmi-cpa.github.io/nelio/#t='||new_tok,'new link';
 assert (select token_enc from public.clients where client_id='QA_OFF')=new_enc,'ciphertext stored';
 assert (select count(*) from public.messages where request_id='QA_OFF_REQ' and template_id='NEW_LINK')=1,'new link message';
 assert not exists(select 1 from public.activity_log where request_id='QA_OFF_REQ' and position(new_tok in details)>0),'token not logged';
 answer:=public.nelio_api(jsonb_build_object('token',tok,'action','hello'));
 assert answer->>'code'='BAD_TOKEN','old link stops working';
 answer:=public.nelio_api(jsonb_build_object('token',new_tok,'action','hello'));
 assert answer->>'ok'='true' and answer->>'requestStatus'='complete','new link works';

 assert not has_function_privilege('anon','public.nelio_office_action(jsonb)','EXECUTE'),'anonymous RPC denied';
 assert not has_function_privilege('authenticated','public.nelio_office_action(jsonb)','EXECUTE'),'authenticated RPC denied';
 assert not has_column_privilege('anon','public.clients','token_enc','SELECT'),'ciphertext private';
end $$;
rollback;
