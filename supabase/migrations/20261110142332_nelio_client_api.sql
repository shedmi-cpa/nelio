-- Only the Edge Function's service role may execute these routines.
-- SECURITY INVOKER deliberately preserves the caller's privileges.
create function public.nelio_period_label(p text) returns text
language sql immutable set search_path = '' as $$
 select (array['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'])[substring(p,6,2)::int]
 || case when length(p)>7 then '–'||(array['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'])[substring(p,9,2)::int] else '' end || ' ' || left(p,4);
$$;

create function public.nelio_item_view(p_item text) returns jsonb
language sql stable set search_path = '' as $$
 select jsonb_build_object('docTypeId',i.doc_type_id,'name',d.name_he,'description',d.description_he,
 'required',i.required,'other',i.doc_type_id='OTHER','status',i.status,'fileCount',i.file_count,
 'naNote',i.na_note,'rejectReason',i.reject_reason)
 from public.items i join public.doc_types d using(doc_type_id) where i.item_id=p_item;
$$;

create function public.nelio_recompute(p_request text, p_activity text) returns text
language plpgsql set search_path = '' as $$
declare r public.requests; c public.clients; t public.templates; new_status text; office text; demo boolean; subj text; body_text text;
begin
 select * into strict r from public.requests where request_id=p_request for update;
 if r.status='complete' then new_status:='complete';
 elsif exists(select 1 from public.items where request_id=p_request and required and doc_type_id<>'OTHER')
 and not exists(select 1 from public.items where request_id=p_request and required and doc_type_id<>'OTHER' and status not in ('received','not_applicable')) then new_status:='submitted';
 elsif exists(select 1 from public.items where request_id=p_request and doc_type_id<>'OTHER' and status in ('received','not_applicable','rejected')) then new_status:='partial';
 else new_status:='not_started'; end if;
 update public.requests set status=new_status,last_activity=p_activity,last_activity_at=now(),
 submitted_at=case when new_status='submitted' then coalesce(submitted_at,now()) else submitted_at end where request_id=p_request;
 if new_status='submitted' and r.submitted_at is null and not exists(select 1 from public.messages where request_id=p_request and template_id='CONFIRMATION' and status<>'cancelled') then
  select * into strict c from public.clients where client_id=r.client_id;
  select * into strict t from public.templates where template_id='CONFIRMATION';
  select value into office from public.settings where key='office_name';
  select upper(value)='TRUE' into demo from public.settings where key='demo_mode';
  subj:=replace(replace(t.subject,'[חודש]',public.nelio_period_label(r.period)),'[שם המשרד]',coalesce(office,''));
  body_text:=replace(replace(replace(t.body,'[חודש]',public.nelio_period_label(r.period)),'[שם המשרד]',coalesce(office,'')),'[שם איש הקשר]',c.contact_name);
  insert into public.messages(message_id,created_at,send_after,template_id,cycle_id,request_id,client_id,to_email,subject,body,status,sent_at,note,created_by)
  values(gen_random_uuid()::text,now(),now(),'CONFIRMATION',r.cycle_id,p_request,r.client_id,c.email,subj,body_text,
  case when coalesce(demo,true) then 'simulated' else 'queued' end,case when coalesce(demo,true) then now() end,
  case when coalesce(demo,true) then 'מצב הדגמה: נרשמה ולא נשלחה' else '' end,'system');
 end if;
 return new_status;
end $$;

create function public.nelio_api(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
 c public.clients; r public.requests; cy public.cycles; i public.items; d public.doc_types; u public.uploads;
 a text:=p->>'action'; note_text text:=coalesce(p->>'note',''); answer jsonb; result_status text;
 seq_no bigint; upload_id_value text; path_value text; name_part text; stored text; calls_count int;
 max_bytes bigint; max_mb numeric; request_total bigint; duplicate_id text; item_json jsonb;
begin
 if jsonb_typeof(p)<>'object' or length(coalesce(p->>'token','')) not between 24 and 256 then
  return jsonb_build_object('ok',false,'code','BAD_TOKEN'); end if;
 -- Serializes requests per client, including token rotation/deactivation.
 select * into c from public.clients where token_hash=encode(extensions.digest(p->>'token','sha256'),'hex') and active for update;
 if not found then return jsonb_build_object('ok',false,'code','BAD_TOKEN'); end if;
 insert into public.api_limits(client_id,window_start,calls) values(c.client_id,now(),1)
 on conflict(client_id) do update set
 calls=case when api_limits.window_start<now()-interval '1 minute' then 1 else api_limits.calls+1 end,
 window_start=case when api_limits.window_start<now()-interval '1 minute' then now() else api_limits.window_start end
 returning calls into calls_count;
 if calls_count>120 then return jsonb_build_object('ok',false,'code','BUSY'); end if;
 select * into cy from public.cycles where status='open' for share;
 select * into r from public.requests where cycle_id=cy.cycle_id and client_id=c.client_id for update;
 select least(10,greatest(1,value::numeric)) into max_mb from public.settings where key='max_file_mb';
 max_mb:=coalesce(max_mb,10); max_bytes:=(max_mb*1048576)::bigint;
 if a='hello' then
  answer:=jsonb_build_object('ok',true,'businessName',c.business_name,'officeName',(select value from public.settings where key='office_name'),
  'officeEmail',(select value from public.settings where key='office_email'),'today',to_char(now() at time zone 'Asia/Jerusalem','DD/MM/YYYY'),
  'maxFileMb',max_mb,'version','0.6.0');
  if r.request_id is null then return answer||jsonb_build_object('state','noRequest','message','אין כרגע מסמכים להעלות.'); end if;
  select coalesce(jsonb_agg(public.nelio_item_view(it.item_id) order by dt.sort_order),'[]') into item_json
  from public.items it join public.doc_types dt using(doc_type_id) where it.request_id=r.request_id;
  return answer||jsonb_build_object('state','open','periodLabel',public.nelio_period_label(r.period),'dueDate',to_char(cy.due_date,'DD/MM/YYYY'),
  'items',item_json,'requestStatus',r.status);
 end if;
 if r.request_id is null then return jsonb_build_object('ok',false,'code','NO_REQUEST'); end if;
 if a='note' then
  if length(note_text)=0 then return jsonb_build_object('ok',false,'code','EMPTY_NOTE'); end if;
  if length(note_text)>500 then return jsonb_build_object('ok',false,'code','BAD_REQUEST'); end if;
  update public.requests set client_note=note_text,last_activity='כתב הערה למשרד',last_activity_at=now() where request_id=r.request_id;
  insert into public.activity_log(at,real_at,actor,event,client_id,request_id,details)
  values(now(),now(),'client:'||c.client_id,'client_note',c.client_id,r.request_id,note_text);
  return jsonb_build_object('ok',true);
 end if;
 select * into i from public.items where request_id=r.request_id and doc_type_id=p->>'docTypeId' for update;
 if not found then return jsonb_build_object('ok',false,'code','BAD_ITEM'); end if;
 select * into strict d from public.doc_types where doc_type_id=i.doc_type_id;
 if a in ('markNa','unmarkNa') then
  if i.doc_type_id='OTHER' then return jsonb_build_object('ok',false,'code','NA_NOT_OPTIONAL'); end if;
  if (a='markNa' and i.status not in ('missing','rejected','not_applicable')) or
     (a='unmarkNa' and i.status not in ('missing','not_applicable')) then return jsonb_build_object('ok',false,'code','NA_NOT_ALLOWED'); end if;
  update public.items set status=case when a='markNa' then 'not_applicable' else 'missing' end,
  na_note=case when a='markNa' then left(note_text,300) else '' end,reject_reason='',updated_at=now(),updated_by='client' where item_id=i.item_id;
  result_status:=public.nelio_recompute(r.request_id,case when a='markNa' then 'סימן לא היה לי: ' else 'ביטל לא היה לי: ' end||d.name_he);
 elsif a='reserveUpload' then
  if length(coalesce(p->>'uploadKey','')) not between 8 and 64 or coalesce(p->>'fileHash','') !~ '^[a-f0-9]{64}$'
  then return jsonb_build_object('ok',false,'code','BAD_REQUEST'); end if;
  if p->>'mimeType' not in ('image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf') then return jsonb_build_object('ok',false,'code','BAD_TYPE'); end if;
  if coalesce((p->>'sizeBytes')::bigint,0) not between 1 and max_bytes then return jsonb_build_object('ok',false,'code','TOO_BIG'); end if;
  select * into u from public.uploads where request_id=r.request_id and upload_key=p->>'uploadKey';
  if found then
   if u.item_id<>i.item_id or u.file_hash<>p->>'fileHash' or u.mime_type<>p->>'mimeType' or u.size_bytes<>(p->>'sizeBytes')::bigint then
    return jsonb_build_object('ok',false,'code','UPLOAD_CONFLICT'); end if;
   return jsonb_build_object('ok',true,'uploadId',u.upload_id,'storagePath',u.storage_path,'storedName',u.stored_name,'ready',u.ingest_status='ready','duplicateOf',u.duplicate_of,
    'item',public.nelio_item_view(i.item_id),'requestStatus',r.status);
  end if;
  select coalesce(sum(size_bytes),0) into request_total from public.uploads where request_id=r.request_id;
  if request_total+(p->>'sizeBytes')::bigint>262144000 or (select count(*) from public.uploads where request_id=r.request_id)>=200 then
   return jsonb_build_object('ok',false,'code','QUOTA_EXCEEDED'); end if;
  seq_no:=i.last_seq+1;
  upload_id_value:=gen_random_uuid()::text;
  name_part:=left(regexp_replace(regexp_replace(replace(c.business_name,'"','״'),'[\\/:*?<>|]','-','g'),'[[:space:]_‐-―−-]+','-','g'),40);
  stored:=trim(both '-.' from name_part)||'_'||r.period||'_'||d.file_label||'_'||lpad(seq_no::text,greatest(2,length(seq_no::text)),'0')||'.'||case p->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' else 'pdf' end;
  path_value:=c.client_id||'/'||r.period||'/'||upload_id_value;
  select upload_id into duplicate_id from public.uploads where request_id=r.request_id and file_hash=p->>'fileHash' and ingest_status='ready' order by uploaded_at limit 1;
  insert into public.uploads(upload_id,uploaded_at,item_id,request_id,client_id,uploaded_by,original_name,stored_name,seq,mime_type,size_bytes,file_hash,duplicate_of,upload_key,status,storage_path,storage_provider,ingest_status)
  values(upload_id_value,now(),i.item_id,r.request_id,c.client_id,'client',left(p->>'fileName',120),stored,seq_no,p->>'mimeType',(p->>'sizeBytes')::bigint,p->>'fileHash',coalesce(duplicate_id,''),p->>'uploadKey','active',path_value,'supabase','pending');
  update public.items set last_seq=seq_no where item_id=i.item_id;
  return jsonb_build_object('ok',true,'uploadId',upload_id_value,'storagePath',path_value,'storedName',stored,'ready',false,'duplicateOf',coalesce(duplicate_id,''));
 elsif a='finishUpload' then
  select * into u from public.uploads where upload_id=p->>'uploadId' and request_id=r.request_id and item_id=i.item_id for update;
  if not found then return jsonb_build_object('ok',false,'code','BAD_ITEM'); end if;
  if u.ingest_status='ready' then return jsonb_build_object('ok',true,'uploadId',u.upload_id,'storedName',u.stored_name,'item',public.nelio_item_view(i.item_id),'requestStatus',r.status,'duplicateOf',u.duplicate_of); end if;
  -- Storage must have confirmed the bytes before an item can become received.
  if not exists(select 1 from storage.objects where bucket_id='nelio-documents' and name=u.storage_path and (metadata->>'size')::bigint=u.size_bytes) then
   return jsonb_build_object('ok',false,'code','UPLOAD_PENDING'); end if;
  update public.uploads set ingest_status='ready' where upload_id=u.upload_id;
  update public.items set status='received',file_count=file_count+1,na_note='',reject_reason='',updated_at=now(),updated_by='client' where item_id=i.item_id;
  result_status:=public.nelio_recompute(r.request_id,'העלה '||d.name_he);
 else return jsonb_build_object('ok',false,'code','BAD_REQUEST'); end if;
 insert into public.activity_log(at,real_at,actor,event,client_id,request_id,item_id,details)
 values(now(),now(),'client:'||c.client_id,a,c.client_id,r.request_id,i.item_id,case when a='finishUpload' then u.stored_name else left(note_text,300) end);
 answer:=jsonb_build_object('ok',true,'item',public.nelio_item_view(i.item_id),'requestStatus',result_status);
 if a='finishUpload' then answer:=answer||jsonb_build_object('uploadId',u.upload_id,'storedName',u.stored_name,'mimeType',u.mime_type,'sizeBytes',u.size_bytes,'duplicateOf',u.duplicate_of,
 'folderPath',c.business_name||' ('||c.client_id||') / '||r.period,'receivedAt',to_char(now() at time zone 'Asia/Jerusalem','DD/MM/YYYY HH24:MI:SS')); end if;
 return answer;
end $$;

revoke all on function public.nelio_period_label(text),public.nelio_item_view(text),public.nelio_recompute(text,text),public.nelio_api(jsonb) from public,anon,authenticated;
grant execute on function public.nelio_period_label(text),public.nelio_item_view(text),public.nelio_recompute(text,text),public.nelio_api(jsonb) to service_role;
