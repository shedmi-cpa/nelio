-- Nelio 0.7.0, stage 6.3.1: office write actions (D47, D48, D50).
-- Only the nelio-office Edge Function (service role) may execute these routines.
-- No RLS change and no new privilege for anon or authenticated.

-- D47: the personal link token, encrypted by nelio-office (AES-GCM). The key never reaches the database.
alter table public.clients add column token_enc text not null default '' check (length(token_enc) <= 1000);

-- Replaces every [field] of a template. Unknown fields stay as they are.
create function public.nelio_fill(p_text text, p_fields jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare k text; v text; result text := coalesce(p_text, '');
begin
 for k, v in select key, value from jsonb_each_text(p_fields) loop
  result := replace(result, k, coalesce(v, ''));
 end loop;
 return result;
end $$;

-- Writes one message from a template. Demo mode records it without sending (D11); real sending is stage 7.
create function public.nelio_queue_message(p_template text, p_request public.requests, p_client public.clients, p_fields jsonb, p_actor text)
returns text
language plpgsql set search_path = '' as $$
declare t public.templates; demo boolean; id text := gen_random_uuid()::text;
begin
 select * into t from public.templates where template_id = p_template;
 if not found then raise exception 'TEMPLATE_MISSING'; end if;
 select upper(value) = 'TRUE' into demo from public.settings where key = 'demo_mode';
 insert into public.messages(message_id, created_at, send_after, template_id, cycle_id, request_id, client_id, to_email, subject, body, status, sent_at, note, created_by)
 values (id, now(), now(), p_template, p_request.cycle_id, p_request.request_id, p_client.client_id, p_client.email,
  public.nelio_fill(t.subject, p_fields), public.nelio_fill(t.body, p_fields),
  case when coalesce(demo, true) then 'simulated' else 'queued' end,
  case when coalesce(demo, true) then now() end,
  case when coalesce(demo, true) then 'מצב הדגמה: נרשמה ולא נשלחה' else '' end,
  p_actor);
 return case when coalesce(demo, true) then 'simulated' else 'queued' end;
end $$;

create function public.nelio_office_action(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
 a text := p->>'action'; dry boolean := coalesce((p->>'dryRun')::boolean, false);
 s public.staff; r public.requests; c public.clients; cy public.cycles; i public.items; u public.uploads; d public.doc_types; t public.templates;
 office text; base text; tok text; link text; link_missing boolean; actor text; reason text; note_text text; missing text;
 fields jsonb; result_status text; message_status text; body_text text; new_token text;
begin
 if jsonb_typeof(p) <> 'object' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
 select * into s from public.staff where staff_id = p->>'actor' and active;
 if not found then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
 actor := 'office:' || s.staff_id;
 select * into r from public.requests where request_id = p->>'requestId' for update;
 if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 -- Locks the client like nelio_api does, so a link change and a client action never interleave.
 select * into strict c from public.clients where client_id = r.client_id for update;
 select * into cy from public.cycles where cycle_id = r.cycle_id;
 select value into office from public.settings where key = 'office_name';
 select value into base from public.settings where key = 'client_page_url';
 base := coalesce(nullif(base, ''), 'https://shedmi-cpa.github.io/nelio/');

 -- The decrypted token is used only if it still matches the stored hash (an old ciphertext is ignored).
 tok := nullif(p->>'token', '');
 if tok is not null and (tok !~ '^[A-Za-z0-9_-]{20,128}$' or encode(extensions.digest(tok, 'sha256'), 'hex') <> c.token_hash) then tok := null; end if;
 link_missing := tok is null;
 link := case when tok is null then 'הקישור האישי שקיבלתם מאיתנו במייל' else base || '#t=' || tok end;
 fields := jsonb_build_object('[שם איש הקשר]', c.contact_name, '[שם העסק]', c.business_name, '[חודש]', public.nelio_period_label(r.period),
  '[תאריך היעד]', coalesce(to_char(cy.due_date, 'DD/MM/YYYY'), ''), '[שם המשרד]', coalesce(office, ''), '[קישור]', link);

 if a = 'reject' then
  reason := btrim(coalesce(p->>'reason', ''));
  if length(reason) not between 1 and 300 then return jsonb_build_object('ok', false, 'code', 'BAD_REASON'); end if;
  select * into u from public.uploads where upload_id = p->>'uploadId' and request_id = r.request_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if u.ingest_status <> 'ready' or u.status <> 'active' then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
  select * into strict i from public.items where item_id = u.item_id for update;
  select * into strict d from public.doc_types where doc_type_id = i.doc_type_id;
  -- data-model 3.1: only a received document becomes unreadable (or one already marked, for a second bad file).
  if i.status not in ('received', 'rejected') then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
  fields := fields || jsonb_build_object('[סוג המסמך]', d.name_he, '[סיבה]', reason);
  select * into t from public.templates where template_id = 'REJECTED';
  if not found then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
  if dry then return jsonb_build_object('ok', true, 'text', public.nelio_fill(t.body, fields), 'linkMissing', link_missing); end if;
  update public.uploads set status = 'rejected' where upload_id = u.upload_id;
  update public.items set status = 'rejected', reject_reason = reason, na_note = '',
   file_count = (select count(*) from public.uploads where item_id = i.item_id and ingest_status = 'ready' and status = 'active'),
   updated_at = now(), updated_by = actor where item_id = i.item_id;
  -- data-model 3.2: an unreadable document cancels an earlier approval.
  if r.status = 'complete' then
   update public.requests set status = 'partial', completed_at = null, completed_by = '', completion_note = '' where request_id = r.request_id;
  end if;
  result_status := public.nelio_recompute(r.request_id, 'המשרד סימן לא קריא: ' || d.name_he);
  message_status := public.nelio_queue_message('REJECTED', r, c, fields, actor);
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, item_id, details)
  values (now(), now(), actor, 'office_reject', c.client_id, r.request_id, i.item_id, d.name_he || ': ' || reason || ' (' || u.stored_name || ')');

 elsif a = 'approve' then
  if r.status <> 'submitted' then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
  update public.requests set status = 'complete', completed_at = now(), completed_by = s.staff_id, completion_note = '',
   last_activity = 'המשרד אישר: בדקתי, תקין', last_activity_at = now() where request_id = r.request_id;
  result_status := 'complete';
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), actor, 'office_approve', c.client_id, r.request_id, 'בדקתי, תקין');

 elsif a = 'completeManual' then
  note_text := btrim(coalesce(p->>'note', ''));
  if length(note_text) not between 1 and 300 then return jsonb_build_object('ok', false, 'code', 'BAD_NOTE'); end if;
  if r.status = 'complete' then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
  update public.requests set status = 'complete', completed_at = now(), completed_by = s.staff_id, completion_note = note_text,
   last_activity = 'הושלם ידנית: ' || note_text, last_activity_at = now() where request_id = r.request_id;
  result_status := 'complete';
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), actor, 'office_complete_manual', c.client_id, r.request_id, note_text);

 elsif a = 'whatsapp' then
  -- data-model 3.2: reminders only while the client still has something to do.
  if r.status not in ('not_started', 'partial') then return jsonb_build_object('ok', false, 'code', 'NOT_ALLOWED'); end if;
  select string_agg(dt.name_he, ', ' order by dt.sort_order) into missing
  from public.items it join public.doc_types dt using (doc_type_id)
  where it.request_id = r.request_id and it.required and it.doc_type_id <> 'OTHER' and it.status in ('missing', 'rejected');
  if missing is null then return jsonb_build_object('ok', false, 'code', 'NOTHING_MISSING'); end if;
  select * into t from public.templates where template_id = 'WHATSAPP';
  if not found then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
  body_text := public.nelio_fill(t.body, fields || jsonb_build_object('[מה שחסר]', missing));
  if dry then return jsonb_build_object('ok', true, 'text', body_text, 'linkMissing', link_missing); end if;
  update public.requests set reminder_count = reminder_count + 1, last_reminder_at = now(),
   last_activity = 'תזכורת בוואטסאפ', last_activity_at = now() where request_id = r.request_id;
  result_status := r.status;
  -- The log keeps the text without the personal link.
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), actor, 'office_whatsapp', c.client_id, r.request_id, 'מה שחסר: ' || missing);
  return jsonb_build_object('ok', true, 'requestStatus', result_status, 'text', body_text, 'linkMissing', link_missing);

 elsif a = 'rotateLink' then
  new_token := p->>'newToken';
  if new_token is null or new_token !~ '^[A-Za-z0-9_-]{40,128}$' or coalesce(p->>'newTokenEnc', '') !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{40,}$' or length(p->>'newTokenEnc') > 1000 then
   return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  select * into t from public.templates where template_id = 'NEW_LINK';
  if not found then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
  update public.clients set token_hash = encode(extensions.digest(new_token, 'sha256'), 'hex'), token_enc = p->>'newTokenEnc', token_created_at = now()
  where client_id = c.client_id;
  link := base || '#t=' || new_token;
  fields := fields || jsonb_build_object('[קישור]', link);
  message_status := public.nelio_queue_message('NEW_LINK', r, c, fields, actor);
  update public.requests set last_activity = 'נוצר קישור חדש', last_activity_at = now() where request_id = r.request_id;
  result_status := r.status;
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), actor, 'office_new_link', c.client_id, r.request_id, 'נוצר קישור חדש. הקישור הקודם הפסיק לעבוד');
  return jsonb_build_object('ok', true, 'requestStatus', result_status, 'link', link, 'messageStatus', message_status);

 else
  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
 end if;

 return jsonb_build_object('ok', true, 'requestStatus', result_status, 'messageStatus', message_status, 'linkMissing', link_missing);
exception when raise_exception then
 if sqlerrm = 'TEMPLATE_MISSING' then return jsonb_build_object('ok', false, 'code', 'TEMPLATE_MISSING'); end if;
 raise;
end $$;

revoke all on function public.nelio_fill(text, jsonb), public.nelio_queue_message(text, public.requests, public.clients, jsonb, text), public.nelio_office_action(jsonb) from public, anon, authenticated;
grant execute on function public.nelio_fill(text, jsonb), public.nelio_queue_message(text, public.requests, public.clients, jsonb, text), public.nelio_office_action(jsonb) to service_role;
