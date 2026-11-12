-- Nelio 0.7.1, stage 6.3.2: reminder now, today's call list, upload on the client's behalf.
-- Only the nelio-office Edge Function (service role) may execute these routines.
-- No RLS change and no new privilege for anon or authenticated.

-- Who works now (D50): an active staff member, recorded in the log only.
create function public.nelio_office_actor(p_actor text) returns public.staff
language sql stable set search_path = '' as $$
 select * from public.staff where staff_id = p_actor and active;
$$;

-- What a reminder lists: required documents still missing or unreadable (data-model 3.2). Null when nothing is missing.
create function public.nelio_missing(p_request text) returns text
language sql stable set search_path = '' as $$
 select string_agg(dt.name_he, ', ' order by dt.sort_order)
 from public.items it join public.doc_types dt using (doc_type_id)
 where it.request_id = p_request and it.required and it.doc_type_id <> 'OTHER' and it.status in ('missing', 'rejected');
$$;

-- "Send a reminder now" (brief.md): the REMINDER_1 text, recorded in demo mode (D11), counted like any reminder.
create function public.nelio_office_remind(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.staff; r public.requests; c public.clients; cy public.cycles; t public.templates;
 tok text; base text; office text; missing text; fields jsonb; message_status text; demo boolean;
begin
 s := public.nelio_office_actor(p->>'actor');
 if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
 select * into r from public.requests where request_id = p->>'requestId' for update;
 if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 if r.status not in ('not_started', 'partial') then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
 select * into strict c from public.clients where client_id = r.client_id;
 select * into cy from public.cycles where cycle_id = r.cycle_id;
 if cy.status <> 'open' then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
 missing := public.nelio_missing(r.request_id);
 if missing is null then return jsonb_build_object('ok', false, 'code', 'NOTHING_MISSING'); end if;
 select * into t from public.templates where template_id = 'REMINDER_1';
 if not found then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
 tok := nullif(p->>'token', '');
 if tok is not null and (tok !~ '^[A-Za-z0-9_-]{20,128}$' or encode(extensions.digest(tok, 'sha256'), 'hex') <> c.token_hash) then tok := null; end if;
 select value into base from public.settings where key = 'client_page_url';
 select value into office from public.settings where key = 'office_name';
 fields := jsonb_build_object('[שם איש הקשר]', c.contact_name, '[שם העסק]', c.business_name, '[חודש]', public.nelio_period_label(r.period),
  '[תאריך היעד]', coalesce(to_char(cy.due_date, 'DD/MM/YYYY'), ''), '[שם המשרד]', coalesce(office, ''), '[מה שחסר]', missing,
  '[קישור]', case when tok is null then 'הקישור האישי שקיבלתם מאיתנו במייל' else coalesce(nullif(base, ''), 'https://shedmi-cpa.github.io/nelio/') || '#t=' || tok end);
 if coalesce((p->>'dryRun')::boolean, false) then
  select upper(value) = 'TRUE' into demo from public.settings where key = 'demo_mode';
  return jsonb_build_object('ok', true, 'subject', public.nelio_fill(t.subject, fields), 'text', public.nelio_fill(t.body, fields),
   'toEmail', c.email, 'demo', coalesce(demo, true), 'linkMissing', tok is null);
 end if;
 message_status := public.nelio_queue_message('REMINDER_1', r, c, fields, 'office:' || s.staff_id);
 update public.requests set reminder_count = reminder_count + 1, last_reminder_at = now(),
  last_activity = 'תזכורת במייל מהמשרד', last_activity_at = now() where request_id = r.request_id;
 insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
 values (now(), now(), 'office:' || s.staff_id, 'office_remind', c.client_id, r.request_id, 'מה שחסר: ' || missing);
 return jsonb_build_object('ok', true, 'requestStatus', r.status, 'messageStatus', message_status, 'linkMissing', tok is null);
exception when raise_exception then
 if sqlerrm = 'TEMPLATE_MISSING' then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
 raise;
end $$;

-- Today's call list (brief.md): clients of a cycle who still have something to do, and whether someone already called today.
create function public.nelio_office_calls(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.staff; r public.requests; cy public.cycles; note_text text; today date := (now() at time zone 'Asia/Jerusalem')::date; rows jsonb;
begin
 if p->>'action' = 'callDone' then
  s := public.nelio_office_actor(p->>'actor');
  if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
  select * into r from public.requests where request_id = p->>'requestId';
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  note_text := btrim(coalesce(p->>'note', ''));
  if length(note_text) > 300 then return jsonb_build_object('ok', false, 'code', 'BAD_NOTE'); end if;
  update public.requests set last_activity = 'שיחת טלפון מהמשרד', last_activity_at = now() where request_id = r.request_id;
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), 'office:' || s.staff_id, 'office_call', r.client_id, r.request_id, coalesce(nullif(note_text, ''), 'שיחת טלפון'));
  return jsonb_build_object('ok', true);
 end if;
 if p->>'action' <> 'callList' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
 if p ? 'cycleId' then select * into cy from public.cycles where cycle_id = p->>'cycleId';
 else select * into cy from public.cycles where status = 'open'; end if;
 if cy.cycle_id is null then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 select coalesce(jsonb_agg(x order by x->>'businessName'), '[]') into rows from (
  select jsonb_build_object('requestId', q.request_id, 'clientId', c.client_id, 'businessName', c.business_name, 'contactName', c.contact_name,
   'phone', c.phone, 'bookkeeperId', c.bookkeeper_id, 'status', q.status, 'reminderCount', q.reminder_count,
   'missing', coalesce(public.nelio_missing(q.request_id), ''),
   'calledAt', (select max(l.at) from public.activity_log l where l.request_id = q.request_id and l.event = 'office_call'
     and (l.at at time zone 'Asia/Jerusalem')::date = today),
   'calledBy', (select l.actor from public.activity_log l where l.request_id = q.request_id and l.event = 'office_call'
     and (l.at at time zone 'Asia/Jerusalem')::date = today order by l.at desc limit 1)) as x
  from public.requests q join public.clients c using (client_id)
  where q.cycle_id = cy.cycle_id and q.status in ('not_started', 'partial')) list;
 return jsonb_build_object('ok', true, 'cycleId', cy.cycle_id, 'dueDate', cy.due_date, 'today', today,
  'fromDueDate', cy.due_date is not null and today >= cy.due_date, 'rows', rows);
end $$;

-- Upload on the client's behalf (brief.md; D25: after a cycle closes this is the only way in).
-- Same three steps as the client page: reserve, save the bytes in Storage, confirm.
create function public.nelio_office_upload(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.staff; r public.requests; c public.clients; i public.items; d public.doc_types; u public.uploads;
 seq_no bigint; id text; stored text; name_part text; path_value text; duplicate_id text; max_mb numeric; result_status text;
begin
 s := public.nelio_office_actor(p->>'actor');
 if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
 select * into r from public.requests where request_id = p->>'requestId' for update;
 if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 select * into strict c from public.clients where client_id = r.client_id;
 select * into i from public.items where request_id = r.request_id and item_id = p->>'itemId' for update;
 if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 select * into strict d from public.doc_types where doc_type_id = i.doc_type_id;

 if p->>'action' = 'reserve' then
  if coalesce(p->>'mimeType', '') not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf') then
   return jsonb_build_object('ok', false, 'code', 'BAD_TYPE'); end if;
  select least(10, greatest(1, value::numeric)) into max_mb from public.settings where key = 'max_file_mb';
  if coalesce((p->>'sizeBytes')::bigint, 0) not between 1 and (coalesce(max_mb, 10) * 1048576)::bigint then
   return jsonb_build_object('ok', false, 'code', 'TOO_BIG'); end if;
  if coalesce(p->>'fileHash', '') !~ '^[a-f0-9]{64}$' or length(coalesce(p->>'uploadKey', '')) not between 8 and 64 then
   return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  select * into u from public.uploads where request_id = r.request_id and upload_key = p->>'uploadKey';
  if found then
   if u.item_id <> i.item_id or u.file_hash <> p->>'fileHash' or u.size_bytes <> (p->>'sizeBytes')::bigint then
    return jsonb_build_object('ok', false, 'code', 'UPLOAD_CONFLICT'); end if;
   return jsonb_build_object('ok', true, 'uploadId', u.upload_id, 'storagePath', u.storage_path, 'storedName', u.stored_name, 'ready', u.ingest_status = 'ready', 'duplicateOf', u.duplicate_of);
  end if;
  if (select count(*) from public.uploads where request_id = r.request_id) >= 200 then return jsonb_build_object('ok', false, 'code', 'QUOTA_EXCEEDED'); end if;
  seq_no := i.last_seq + 1; id := gen_random_uuid()::text;
  -- Same naming rule as nelio_api (rules.md, D31).
  name_part := left(regexp_replace(regexp_replace(replace(c.business_name, '"', '״'), '[\\/:*?<>|]', '-', 'g'), '[[:space:]_‐-―−-]+', '-', 'g'), 40);
  stored := trim(both '-.' from name_part) || '_' || r.period || '_' || d.file_label || '_' || lpad(seq_no::text, greatest(2, length(seq_no::text)), '0') || '.' ||
   case p->>'mimeType' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'image/heic' then 'heic' when 'image/heif' then 'heif' else 'pdf' end;
  path_value := c.client_id || '/' || r.period || '/' || id;
  select upload_id into duplicate_id from public.uploads where request_id = r.request_id and file_hash = p->>'fileHash' and ingest_status = 'ready' order by uploaded_at limit 1;
  insert into public.uploads(upload_id, uploaded_at, item_id, request_id, client_id, uploaded_by, original_name, stored_name, seq, mime_type, size_bytes, file_hash, duplicate_of, upload_key, status, storage_path, storage_provider, ingest_status)
  values (id, now(), i.item_id, r.request_id, c.client_id, 'office:' || s.staff_id, left(coalesce(p->>'fileName', ''), 120), stored, seq_no, p->>'mimeType', (p->>'sizeBytes')::bigint,
   p->>'fileHash', coalesce(duplicate_id, ''), p->>'uploadKey', 'active', path_value, 'supabase', 'pending');
  update public.items set last_seq = seq_no where item_id = i.item_id;
  return jsonb_build_object('ok', true, 'uploadId', id, 'storagePath', path_value, 'storedName', stored, 'ready', false, 'duplicateOf', coalesce(duplicate_id, ''));
 end if;

 if p->>'action' = 'finish' then
  select * into u from public.uploads where upload_id = p->>'uploadId' and request_id = r.request_id and item_id = i.item_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if u.ingest_status = 'ready' then return jsonb_build_object('ok', true, 'uploadId', u.upload_id, 'storedName', u.stored_name, 'requestStatus', r.status); end if;
  -- Storage must hold the bytes before the document counts as received.
  if not exists(select 1 from storage.objects where bucket_id = 'nelio-documents' and name = u.storage_path and (metadata->>'size')::bigint = u.size_bytes) then
   return jsonb_build_object('ok', false, 'code', 'UPLOAD_PENDING'); end if;
  update public.uploads set ingest_status = 'ready' where upload_id = u.upload_id;
  update public.items set status = 'received', na_note = '', reject_reason = '', updated_at = now(), updated_by = 'office:' || s.staff_id,
   file_count = (select count(*) from public.uploads where item_id = i.item_id and ingest_status = 'ready' and status = 'active')
  where item_id = i.item_id;
  -- An approved request stays approved (data-model 3.2); the upload shows in the log and as last activity.
  result_status := public.nelio_recompute(r.request_id, 'המשרד העלה בשם הלקוח: ' || d.name_he);
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, item_id, details)
  values (now(), now(), 'office:' || s.staff_id, 'office_upload', c.client_id, r.request_id, i.item_id, u.stored_name);
  return jsonb_build_object('ok', true, 'uploadId', u.upload_id, 'storedName', u.stored_name, 'requestStatus', result_status);
 end if;
 return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end $$;

revoke all on function public.nelio_office_actor(text), public.nelio_missing(text), public.nelio_office_remind(jsonb), public.nelio_office_calls(jsonb), public.nelio_office_upload(jsonb) from public, anon, authenticated;
grant execute on function public.nelio_office_actor(text), public.nelio_missing(text), public.nelio_office_remind(jsonb), public.nelio_office_calls(jsonb), public.nelio_office_upload(jsonb) to service_role;
