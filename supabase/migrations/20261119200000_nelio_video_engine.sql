-- Nelio 0.9.0: what the video needs from stage 7 (D62, D63), for the open cycle only.
-- 7.2 the engine: simulated time (D57), one tick that sends each step once and only to whoever
--     still has something missing, the summary with the late clients by name.
-- 7.3 the relay's side: real email only for demo_real_email_clients and the owner's summary (D58, D63),
--     the personal link kept out of the queue (D61), a shared secret stored only as a hash.
-- 7.4 the panel's side: "קפוץ ל..." and "אפס את הדמו" from a snapshot in the database (D59).
-- Only the service role may execute these routines. No RLS change and no new privilege for anon or authenticated.

-- ============================================================
-- Settings for the video (D63)
-- ============================================================
insert into public.settings(key, value, description) values
 ('demo_real_email_clients', 'C04', 'הלקוחות שמקבלים מייל אמיתי גם במצב הדגמה (D63)')
on conflict (key) do update set value = excluded.value;

-- ============================================================
-- Simulated time (D57)
-- ============================================================
-- Demo mode with demo_now set. demo_now_set_at is the real moment demo_now was set, so the
-- simulated clock keeps moving forward from there at the normal speed.
create function public.nelio_demo_active() returns boolean
language sql stable set search_path = '' as $$
 select coalesce((select upper(btrim(value)) = 'TRUE' from public.settings where key = 'demo_mode'), false)
  and coalesce((select nullif(btrim(value), '') is not null from public.settings where key = 'demo_now'), false);
$$;

create function public.nelio_now() returns timestamptz
language sql stable set search_path = '' as $$
 select case when public.nelio_demo_active() then
   (select btrim(value)::timestamptz from public.settings where key = 'demo_now')
   + greatest(interval '0', now() - coalesce((select nullif(btrim(value), '')::timestamptz from public.settings where key = 'demo_now_set_at'), now()))
  else now() end;
$$;

-- While the demo clock runs, a real action (an upload, "לא קריא", "בדקתי, תקין") is recorded at
-- the simulated time (D57). Every routine stamps with now(), the transaction's time, so a column
-- equal to now() was stamped in this transaction; the real time stays in activity_log.real_at.
-- Times written on purpose (the tick's simulated step times) are left alone.
create function public.nelio_demo_stamp() returns trigger
language plpgsql set search_path = '' as $$
declare tx timestamptz := now(); sim timestamptz;
begin
 if coalesce(current_setting('nelio.restoring', true), '') = 'on' or not public.nelio_demo_active() then return new; end if;
 sim := public.nelio_now();
 if tg_table_name = 'activity_log' then
  if new.at = tx then new.at := sim; end if;
 elsif tg_table_name = 'messages' then
  if new.created_at = tx then new.created_at := sim; end if;
  if new.send_after = tx then new.send_after := sim; end if;
  if new.sent_at = tx then new.sent_at := sim; end if;
 elsif tg_table_name = 'uploads' then
  if new.uploaded_at = tx then new.uploaded_at := sim; end if;
 elsif tg_table_name = 'requests' then
  if new.last_reminder_at = tx then new.last_reminder_at := sim; end if;
  if new.last_activity_at = tx then new.last_activity_at := sim; end if;
  if new.submitted_at = tx then new.submitted_at := sim; end if;
  if new.completed_at = tx then new.completed_at := sim; end if;
 elsif tg_table_name = 'items' then
  if new.updated_at = tx then new.updated_at := sim; end if;
 end if;
 return new;
end $$;

create trigger nelio_a_demo_stamp before insert or update on public.activity_log for each row execute function public.nelio_demo_stamp();
create trigger nelio_a_demo_stamp before insert or update on public.messages for each row execute function public.nelio_demo_stamp();
create trigger nelio_a_demo_stamp before insert or update on public.uploads for each row execute function public.nelio_demo_stamp();
create trigger nelio_a_demo_stamp before insert or update on public.requests for each row execute function public.nelio_demo_stamp();
create trigger nelio_a_demo_stamp before insert or update on public.items for each row execute function public.nelio_demo_stamp();

-- ============================================================
-- Who gets a real email, and the link kept out of the queue (D58, D61, D63)
-- ============================================================
-- One rule for every message, whoever writes it: in demo mode only the clients in
-- demo_real_email_clients and the owner's monthly summary are queued for the relay; everything
-- else is recorded with its full text and not sent (D11). A queued message waits for the next
-- allowed time (rules.md). The body never holds the personal link: "[קישור]" in a queued message
-- (the relay's server writes the link when it sends), "[הקישור האישי]" in a recorded one.
create function public.nelio_message_route() returns trigger
language plpgsql set search_path = '' as $$
declare demo boolean; is_real boolean; link_re constant text := 'https?://[^[:space:]]*#t=[A-Za-z0-9_-]+';
begin
 if coalesce(current_setting('nelio.restoring', true), '') = 'on' or new.status not in ('simulated', 'queued') then return new; end if;
 demo := coalesce((select upper(btrim(value)) = 'TRUE' from public.settings where key = 'demo_mode'), true);
 if demo then
  is_real := (coalesce(new.client_id, '') <> '' and new.client_id = any(string_to_array(replace(coalesce(
    (select value from public.settings where key = 'demo_real_email_clients'), ''), ' ', ''), ',')))
   or (new.template_id = 'SUMMARY' and exists(select 1 from public.staff s where s.staff_id = new.staff_id and s.role = 'owner'));
  if is_real then
   new.status := 'queued'; new.sent_at := null; new.note := '';
  else
   new.status := 'simulated'; new.sent_at := coalesce(new.sent_at, new.created_at, now());
   if coalesce(new.note, '') = '' then new.note := 'מצב הדגמה: נרשמה ולא נשלחה'; end if;
  end if;
 end if;
 if new.status = 'queued' then
  new.send_after := public.nelio_next_allowed(coalesce(new.send_after, public.nelio_now()), false);
  new.body := replace(regexp_replace(coalesce(new.body, ''), link_re, '[קישור]', 'g'), 'הקישור האישי שקיבלתם מאיתנו במייל', '[קישור]');
 else
  new.body := replace(regexp_replace(coalesce(new.body, ''), link_re, '[הקישור האישי]', 'g'), '[קישור]', '[הקישור האישי]');
 end if;
 return new;
end $$;

create trigger nelio_b_message_route before insert on public.messages for each row execute function public.nelio_message_route();

-- D61: links already in the queue are replaced by text (no row is deleted).
update public.messages set body = regexp_replace(body, 'https?://[^[:space:]]*#t=[A-Za-z0-9_-]+', '[הקישור האישי]', 'g')
where body ~ '#t=[A-Za-z0-9_-]';

-- The office's message routine now reports what the routing decided.
create or replace function public.nelio_queue_message(p_template text, p_request public.requests, p_client public.clients, p_fields jsonb, p_actor text)
returns text
language plpgsql set search_path = '' as $$
declare t public.templates; demo boolean; result text;
begin
 select * into t from public.templates where template_id = p_template;
 if not found then raise exception 'TEMPLATE_MISSING'; end if;
 select upper(value) = 'TRUE' into demo from public.settings where key = 'demo_mode';
 insert into public.messages(message_id, created_at, send_after, template_id, cycle_id, request_id, client_id, to_email, subject, body, status, sent_at, note, created_by)
 values (gen_random_uuid()::text, now(), now(), p_template, p_request.cycle_id, p_request.request_id, p_client.client_id, p_client.email,
  public.nelio_fill(t.subject, p_fields), public.nelio_fill(t.body, p_fields),
  case when coalesce(demo, true) then 'simulated' else 'queued' end,
  case when coalesce(demo, true) then now() end, '', p_actor)
 returning status into result;
 return result;
end $$;

-- The client page shows the demo's date ("צריך עד מחר"), not the real one (D57).
alter function public.nelio_api(jsonb) rename to nelio_api_core;
create function public.nelio_api(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare r jsonb := public.nelio_api_core(p); sim timestamptz;
begin
 if coalesce((r->>'ok')::boolean, false) and public.nelio_demo_active() then
  sim := public.nelio_now();
  if r ? 'today' then r := r || jsonb_build_object('today', to_char(sim at time zone 'Asia/Jerusalem', 'DD/MM/YYYY')); end if;
  if r ? 'receivedAt' then r := r || jsonb_build_object('receivedAt', to_char(sim at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI:SS')); end if;
 end if;
 return r;
end $$;

-- ============================================================
-- The texts (D56; the summary as in D63: who sent everything and who is late, by name)
-- ============================================================
insert into public.templates(template_id, name_he, recipient, subject, body) values
 ('REMINDER_2', 'תזכורת שנייה', 'client', 'תזכורת שנייה: מסמכים ל[חודש]', 'שלום [שם איש הקשר],
תאריך היעד למסמכים של [חודש] הוא [תאריך היעד], ועדיין חסר לנו: [מה שחסר].
בלי המסמכים האלה לא נוכל להגיש את הדוח בזמן. מעלים כאן, בדקה: [קישור]
אם משהו לא ברור, אפשר פשוט להשיב למייל הזה.

תודה,
[שם המשרד]'),
 ('LAST_DAY', 'מחר היום האחרון', 'client', 'מחר היום האחרון: מסמכים ל[חודש]', 'שלום [שם איש הקשר],
[יום היעד] הוא היום האחרון למסמכים של [חודש]. עוד חסר: [מה שחסר].
[קישור]

תודה,
[שם המשרד]'),
 ('CALL_LIST', 'רשימת טלפונים', 'bookkeeper', 'רשימת טלפונים להיום: [חודש]', 'שלום [שם איש הצוות],
היום תאריך היעד של [חודש]. ללקוחות האלה עוד חסר משהו:
[רשימת הלקוחות]

את הפרטים המלאים רואים בלוח הבקרה.'),
 ('SUMMARY', 'סיכום חודשי', 'owner', 'סיכום [חודש]', 'שלום [שם איש הצוות],
סיכום [חודש]: [X] מתוך [Y] לקוחות שלחו את כל המסמכים, ו־[נבדקו] מהם כבר נבדקו.
עוד לא השלימו ([מספר המאחרים]): [רשימה].
מסמכים שסומנו כלא קריאים החודש: [מספר].

את הפרטים המלאים רואים בלוח הבקרה.')
on conflict (template_id) do nothing;

-- D56: "היום האחרון" names the day, so it stays right when the due date moves. Only the draft text changes.
update public.templates set body = replace(body, 'מחר היום האחרון למסמכים של [חודש]', '[יום היעד] הוא היום האחרון למסמכים של [חודש]')
where template_id = 'LAST_DAY' and position('מחר היום האחרון למסמכים של [חודש]' in body) > 0;
update public.templates set body = 'שלום [שם איש הצוות],
סיכום [חודש]: [X] מתוך [Y] לקוחות שלחו את כל המסמכים, ו־[נבדקו] מהם כבר נבדקו.
עוד לא השלימו ([מספר המאחרים]): [רשימה].
מסמכים שסומנו כלא קריאים החודש: [מספר].

את הפרטים המלאים רואים בלוח הבקרה.'
where template_id = 'SUMMARY' and position('לקוחות השלימו ([אחוז])' in body) > 0;

-- ============================================================
-- The engine (7.2), open cycle only (D62)
-- ============================================================
-- "מחר, יום חמישי, 12/11" (D56).
create function public.nelio_due_day_text(p_due date, p_on date) returns text
language sql immutable set search_path = '' as $$
 select case when p_due = p_on + 1 then 'מחר, ' when p_due = p_on then 'היום, ' else '' end
  || 'יום ' || (array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])[extract(dow from p_due)::int + 1]
  || ', ' || to_char(p_due, 'DD/MM');
$$;

-- One message written by the system at a given (possibly simulated) time. The routing trigger decides real or recorded.
create function public.nelio_system_message(p_template text, p_cycle text, p_request text, p_client text, p_staff text,
 p_to text, p_subject text, p_body text, p_at timestamptz) returns text
language plpgsql set search_path = '' as $$
declare demo boolean; result text;
begin
 select upper(value) = 'TRUE' into demo from public.settings where key = 'demo_mode';
 insert into public.messages(message_id, created_at, send_after, template_id, cycle_id, request_id, client_id, staff_id, to_email, subject, body, status, sent_at, note, created_by)
 values (gen_random_uuid()::text, p_at, p_at, p_template, p_cycle, p_request, p_client, p_staff, coalesce(p_to, ''), p_subject, p_body,
  case when coalesce(demo, true) then 'simulated' else 'queued' end, case when coalesce(demo, true) then p_at end, '', 'system')
 returning status into result;
 return result;
end $$;

-- Marks a step of a cycle as done (the "יצא ב..." columns).
create function public.nelio_mark_step(p_cycle text, p_step text, p_at timestamptz) returns void
language sql set search_path = '' as $$
 update public.cycles set
  reminder1_sent_at = case when p_step = 'reminder1' then p_at else reminder1_sent_at end,
  reminder2_sent_at = case when p_step = 'reminder2' then p_at else reminder2_sent_at end,
  last_day_sent_at = case when p_step = 'last_day' then p_at else last_day_sent_at end,
  call_list_sent_at = case when p_step = 'call_list' then p_at else call_list_sent_at end,
  summary_sent_at = case when p_step = 'summary' then p_at else summary_sent_at end
 where cycle_id = p_cycle;
$$;

-- One step of a cycle, at its time: who still has something missing gets the reminder, each
-- bookkeeper gets the call list, the owner gets the summary. The text is written now, so it lists
-- what is missing at this moment (data-model.md 3.4).
create function public.nelio_cycle_step(p_cycle text, p_step text, p_at timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare
 cy public.cycles; t public.templates; r record; s record; tpl text; office text; label text; fields jsonb; st text;
 n int := 0; n_real int := 0; n_clients int := 0; local_day date := (p_at at time zone 'Asia/Jerusalem')::date;
 lines text; late text; x int; y int; done int; late_n int; bad int; demo boolean; details text;
begin
 select * into strict cy from public.cycles where cycle_id = p_cycle;
 tpl := case p_step when 'reminder1' then 'REMINDER_1' when 'reminder2' then 'REMINDER_2' when 'last_day' then 'LAST_DAY'
  when 'call_list' then 'CALL_LIST' when 'summary' then 'SUMMARY' end;
 if tpl is null then raise exception 'BAD_STEP'; end if;
 select * into t from public.templates where template_id = tpl;
 if not found then raise exception 'TEMPLATE_MISSING'; end if;
 office := coalesce((select value from public.settings where key = 'office_name'), '');
 label := public.nelio_period_label(p_cycle);
 demo := coalesce((select upper(btrim(value)) = 'TRUE' from public.settings where key = 'demo_mode'), true);

 if p_step in ('reminder1', 'reminder2', 'last_day') then
  for r in select q.request_id, q.period, c.client_id, c.contact_name, c.business_name, c.email
   from public.requests q join public.clients c on c.client_id = q.client_id
   where q.cycle_id = p_cycle and public.nelio_needs_reminder(q.request_id) order by c.client_id loop
   fields := jsonb_build_object('[שם איש הקשר]', r.contact_name, '[שם העסק]', r.business_name, '[חודש]', public.nelio_period_label(r.period),
    '[תאריך היעד]', to_char(cy.due_date, 'DD/MM/YYYY'), '[יום היעד]', public.nelio_due_day_text(cy.due_date, local_day),
    '[שם המשרד]', office, '[מה שחסר]', public.nelio_missing_text(r.request_id));
   st := public.nelio_system_message(tpl, p_cycle, r.request_id, r.client_id, null, r.email,
    public.nelio_fill(t.subject, fields), public.nelio_fill(t.body, fields), p_at);
   update public.requests set reminder_count = reminder_count + 1, last_reminder_at = p_at,
    last_activity = 'תזכורת אוטומטית: ' || t.name_he, last_activity_at = p_at where request_id = r.request_id;
   n := n + 1; if st = 'queued' then n_real := n_real + 1; end if;
  end loop;
  details := t.name_he || ': יצאה ל־' || n || ' לקוחות שעוד חסר להם משהו';

 elsif p_step = 'call_list' then
  for s in select st2.staff_id, st2.name, st2.email from public.staff st2 where st2.active order by st2.staff_id loop
   select string_agg('• ' || c.business_name || ' (' || c.client_id || '): ' || coalesce(public.nelio_missing_text(q.request_id), 'ממתין לבדיקה'), E'\n' order by c.business_name),
    count(*) into lines, x
   from public.requests q join public.clients c on c.client_id = q.client_id
   where q.cycle_id = p_cycle and q.status in ('not_started', 'partial') and c.bookkeeper_id = s.staff_id;
   if x = 0 then continue; end if;
   fields := jsonb_build_object('[שם איש הצוות]', split_part(s.name, ' ', 1), '[חודש]', label, '[רשימת הלקוחות]', lines, '[שם המשרד]', office);
   st := public.nelio_system_message(tpl, p_cycle, null, null, s.staff_id, s.email, public.nelio_fill(t.subject, fields), public.nelio_fill(t.body, fields), p_at);
   n := n + 1; n_clients := n_clients + x; if st = 'queued' then n_real := n_real + 1; end if;
  end loop;
  details := t.name_he || ': נשלחה ל־' || n || ' מנהלי חשבונות, ' || n_clients || ' לקוחות להתקשר אליהם';

 else
  select count(*), count(*) filter (where status in ('submitted', 'complete')), count(*) filter (where status = 'complete')
   into y, x, done from public.requests where cycle_id = p_cycle;
  late_n := y - x;
  select string_agg(name, ', ' order by name) into late from (
   select c.business_name as name from public.requests q join public.clients c on c.client_id = q.client_id
   where q.cycle_id = p_cycle and q.status in ('not_started', 'partial') order by c.business_name limit 10) l;
  if late_n > 10 then late := late || ' ועוד ' || (late_n - 10); end if;
  select count(*) into bad from public.uploads u join public.requests q on q.request_id = u.request_id
  where q.cycle_id = p_cycle and u.status = 'rejected';
  for s in select st2.staff_id, st2.name, st2.email from public.staff st2 where st2.active and st2.role = 'owner' order by st2.staff_id loop
   fields := jsonb_build_object('[שם איש הצוות]', split_part(s.name, ' ', 1), '[חודש]', label, '[X]', x, '[Y]', y,
    '[אחוז]', case when y > 0 then round(100.0 * x / y) || '%' else '—' end, '[נבדקו]', done, '[מספר המאחרים]', late_n,
    '[רשימה]', coalesce(late, 'אין'), '[מספר]', bad, '[שם המשרד]', office);
   st := public.nelio_system_message(tpl, p_cycle, null, null, s.staff_id, s.email, public.nelio_fill(t.subject, fields), public.nelio_fill(t.body, fields), p_at);
   n := n + 1; if st = 'queued' then n_real := n_real + 1; end if;
  end loop;
  details := t.name_he || ' ' || label || ': ' || x || ' מתוך ' || y || ' לקוחות שלחו הכול, ' || late_n || ' עוד לא השלימו';
 end if;

 if demo then
  details := details || case when n_real > 0 then ' (' || n_real || ' במייל אמיתי, השאר בהדגמה)' else ' (הדגמה)' end;
 end if;
 insert into public.activity_log(at, real_at, actor, event, details) values (p_at, now(), 'system', 'cycle_step', details);
 return jsonb_build_object('step', p_step, 'templateId', tpl, 'name', t.name_he, 'at', p_at, 'count', n, 'real', n_real, 'details', details);
end $$;

-- The tick (7.2): every step of the open cycle whose time has come and that did not go out yet,
-- in order, each exactly once. A step that collides after a Shabbat or holiday shift (D55), or
-- whose time passed while a later step is also due, is skipped and logged.
create function public.nelio_tick(p_at timestamptz) returns jsonb
language plpgsql set search_path = '' as $$
declare cy public.cycles; pl record; stale boolean; steps jsonb := '[]'; res jsonb; step_name text; details text;
begin
 select * into cy from public.cycles where status = 'open' for update;
 if not found then return jsonb_build_object('ok', true, 'steps', steps); end if;
 for pl in select * from public.nelio_cycle_plan(cy.cycle_id) where step <> 'request' order by send_at loop
  if pl.sent_at is not null or pl.send_at > p_at then continue; end if;
  stale := exists(select 1 from public.nelio_cycle_plan(cy.cycle_id) p2
   where p2.step <> 'request' and p2.sent_at is null and p2.send_at > pl.send_at and p2.send_at <= p_at);
  if pl.collides or stale then
   select name_he into step_name from public.templates where template_id = pl.template_id;
   details := coalesce(step_name, pl.step) || ': דולג, ' || case when pl.collides then 'אחרי ההזזה הוא נופל על הצעד הבא' else 'הזמן שלו עבר והצעד הבא כבר הגיע' end;
   insert into public.activity_log(at, real_at, actor, event, details) values (p_at, now(), 'system', 'cycle_step_skipped', details);
   perform public.nelio_mark_step(cy.cycle_id, pl.step, p_at);
   steps := steps || jsonb_build_array(jsonb_build_object('step', pl.step, 'templateId', pl.template_id, 'skipped', true, 'details', details, 'at', p_at));
  else
   res := public.nelio_cycle_step(cy.cycle_id, pl.step, pl.send_at);
   perform public.nelio_mark_step(cy.cycle_id, pl.step, pl.send_at);
   steps := steps || jsonb_build_array(res);
  end if;
 end loop;
 return jsonb_build_object('ok', true, 'steps', steps);
end $$;

-- ============================================================
-- The demo panel (7.4): state, "קפוץ ל...", "אפס את הדמו" (D59)
-- ============================================================
create schema nelio_demo;
revoke all on schema nelio_demo from public, anon, authenticated;
grant usage on schema nelio_demo to service_role;
create table nelio_demo.cycles (like public.cycles);
create table nelio_demo.requests (like public.requests);
create table nelio_demo.items (like public.items);
create table nelio_demo.uploads (like public.uploads);
create table nelio_demo.messages (like public.messages);
create table nelio_demo.activity_log (like public.activity_log);
revoke all on all tables in schema nelio_demo from public, anon, authenticated;
grant select on all tables in schema nelio_demo to service_role;

create function public.nelio_demo(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
 a text := p->>'action'; s public.staff; demo boolean; cy public.cycles; cur timestamptz; target timestamptz;
 pl record; steps jsonb := '[]'; outside int; snap constant timestamptz := '2026-11-09 19:30 Asia/Jerusalem';
begin
 demo := coalesce((select upper(btrim(value)) = 'TRUE' from public.settings where key = 'demo_mode'), false);
 select * into cy from public.cycles where status = 'open';
 if a = 'state' then
  return jsonb_build_object('ok', true, 'demoMode', demo, 'clockSet', public.nelio_demo_active(), 'now', public.nelio_now(), 'snapshotAt', snap,
   'cycle', case when cy.cycle_id is null then null else jsonb_build_object('cycleId', cy.cycle_id, 'dueDate', cy.due_date, 'label', public.nelio_period_label(cy.cycle_id)) end,
   'plan', coalesce((select jsonb_agg(jsonb_build_object('step', x.step, 'templateId', x.template_id, 'name', coalesce(t.name_he, x.template_id),
     'sendAt', x.send_at, 'sentAt', x.sent_at, 'shifted', x.shifted, 'collides', x.collides) order by x.send_at)
    from public.nelio_cycle_plan(cy.cycle_id) x left join public.templates t on t.template_id = x.template_id), '[]'),
   'waiting', (select count(*) from public.requests q where q.cycle_id = cy.cycle_id and public.nelio_needs_reminder(q.request_id)),
   'realClients', coalesce((select jsonb_agg(jsonb_build_object('clientId', c.client_id, 'businessName', c.business_name, 'contactName', c.contact_name,
     'hasLink', c.token_enc <> '') order by c.client_id)
    from public.clients c where c.client_id = any(string_to_array(replace(coalesce((select value from public.settings where key = 'demo_real_email_clients'), ''), ' ', ''), ','))), '[]'),
   'owners', coalesce((select jsonb_agg(st.name order by st.staff_id) from public.staff st where st.active and st.role = 'owner'), '[]'),
   'relay', jsonb_build_object(
    'configured', exists(select 1 from public.settings where key = 'relay_secret_hash' and value ~ '^[a-f0-9]{64}$'),
    'lastSeen', (select nullif(value, '')::timestamptz from public.settings where key = 'relay_last_seen'),
    'queued', (select count(*) from public.messages where status = 'queued'),
    'failed', (select count(*) from public.messages where status = 'failed'),
    'lastSent', (select max(sent_at) from public.messages where status = 'sent'),
    'lastError', (select note from public.messages where status = 'failed' order by created_at desc limit 1)));
 end if;

 s := public.nelio_office_actor(p->>'actor');
 if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
 if not demo then return jsonb_build_object('ok', false, 'code', 'NOT_DEMO'); end if;

 if a = 'jump' then
  if not public.nelio_demo_active() then return jsonb_build_object('ok', false, 'code', 'NEED_RESET'); end if;
  begin target := (p->>'target')::timestamptz; exception when others then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE'); end;
  cur := public.nelio_now();
  if target is null or target <= cur then return jsonb_build_object('ok', false, 'code', 'NOT_FORWARD'); end if;
  if target > cur + interval '45 days' then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE'); end if;
  -- Time passes step by step: each step that comes due on the way goes out at its own time.
  if cy.cycle_id is not null then
   for pl in select * from public.nelio_cycle_plan(cy.cycle_id) where step <> 'request' and sent_at is null and send_at <= target order by send_at loop
    steps := steps || (public.nelio_tick(pl.send_at)->'steps');
   end loop;
  end if;
  insert into public.settings(key, value, description) values ('demo_now', to_char(target at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'התאריך והשעה המדומים במצב הדגמה')
   on conflict (key) do update set value = excluded.value;
  insert into public.settings(key, value) values ('demo_now_set_at', now()::text) on conflict (key) do update set value = excluded.value;
  insert into public.activity_log(at, real_at, actor, event, details)
  values (target, now(), 'office:' || s.staff_id, 'demo_jump', 'מצב הדגמה: הזמן קפץ ל־' || to_char(target at time zone 'Asia/Jerusalem', 'DD/MM/YYYY HH24:MI'));
  return jsonb_build_object('ok', true, 'now', target, 'steps', steps);
 end if;

 if a = 'reset' then
  if p->>'confirm' is distinct from 'איפוס' then return jsonb_build_object('ok', false, 'code', 'BAD_CONFIRM'); end if;
  if not exists(select 1 from nelio_demo.requests) then return jsonb_build_object('ok', false, 'code', 'NO_SNAPSHOT'); end if;
  select count(*) into outside from public.uploads u where not exists(select 1 from nelio_demo.uploads x where x.upload_id = u.upload_id);
  perform set_config('nelio.restoring', 'on', true);
  delete from public.activity_log;
  delete from public.messages;
  delete from public.uploads;
  delete from public.items;
  delete from public.requests;
  delete from public.cycles;
  insert into public.cycles select * from nelio_demo.cycles;
  insert into public.requests select * from nelio_demo.requests;
  insert into public.items select * from nelio_demo.items;
  insert into public.uploads select * from nelio_demo.uploads;
  insert into public.messages select * from nelio_demo.messages;
  insert into public.activity_log overriding system value select * from nelio_demo.activity_log;
  insert into public.settings(key, value, description) values ('demo_now', '2026-11-09T17:30:00Z', 'התאריך והשעה המדומים במצב הדגמה')
   on conflict (key) do update set value = excluded.value;
  insert into public.settings(key, value) values ('demo_now_set_at', now()::text) on conflict (key) do update set value = excluded.value;
  insert into public.activity_log(at, real_at, actor, event, details)
  values (snap, now(), 'office:' || s.staff_id, 'demo_reset', 'מצב הדגמה: הדמו חזר ליום שני, 9/11/2026, 19:30'
   || case when outside > 0 then '. ' || outside || ' קבצים שהועלו בהדגמה נשארו באחסון, מחוץ לצילום הפתיחה' else '' end);
  perform set_config('nelio.restoring', 'off', true);
  return jsonb_build_object('ok', true, 'now', snap, 'outside', outside);
 end if;
 return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end $$;

-- ============================================================
-- The relay's side (7.3, D53)
-- ============================================================
-- The Apps Script relay proves itself with a shared secret; the database keeps only its SHA-256.
create function public.nelio_relay(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare a text := p->>'action'; s public.staff; n int := 0; x jsonb; rows jsonb; lim int;
begin
 if a = 'setSecret' then
  s := public.nelio_office_actor(p->>'actor');
  if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
  if coalesce(p->>'secretHash', '') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  insert into public.settings(key, value, description) values ('relay_secret_hash', p->>'secretHash', 'SHA-256 של הסוד המשותף עם שליח המיילים (D53)')
   on conflict (key) do update set value = excluded.value;
  insert into public.activity_log(at, real_at, actor, event, details) values (now(), now(), 'office:' || s.staff_id, 'office_relay_secret', 'נוצר סוד חדש לשליח המיילים');
  return jsonb_build_object('ok', true);
 end if;

 if coalesce(p->>'secretHash', '') !~ '^[a-f0-9]{64}$'
  or not exists(select 1 from public.settings where key = 'relay_secret_hash' and value = p->>'secretHash') then
  return jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
 end if;
 insert into public.settings(key, value) values ('relay_last_seen', now()::text) on conflict (key) do update set value = excluded.value;

 if a = 'pull' then
  lim := least(20, greatest(1, coalesce((p->>'limit')::int, 10)));
  -- A message handed to the relay is leased for 5 minutes, so two runs never send it twice.
  with picked as (
   select m.message_id from public.messages m
   where m.status = 'queued' and m.send_after <= public.nelio_now()
    and case when m.note like 'lease:%' then substring(m.note from 7)::timestamptz < now() - interval '5 minutes' else true end
   order by m.created_at limit lim for update skip locked),
  leased as (
   update public.messages m set note = 'lease:' || now()::text from picked where m.message_id = picked.message_id
   returning m.message_id, m.client_id, m.template_id, m.to_email, m.subject, m.body, m.created_at)
  select coalesce(jsonb_agg(jsonb_build_object('id', l.message_id, 'clientId', coalesce(l.client_id, ''), 'templateId', l.template_id,
    'to', l.to_email, 'subject', l.subject, 'body', l.body, 'tokenEnc', coalesce(c.token_enc, ''), 'tokenHash', coalesce(c.token_hash, ''))
    order by l.created_at), '[]') into rows
  from leased l left join public.clients c on c.client_id = l.client_id;
  return jsonb_build_object('ok', true, 'messages', rows,
   'baseUrl', coalesce((select nullif(value, '') from public.settings where key = 'client_page_url'), 'https://shedmi-cpa.github.io/nelio/'),
   'officeName', coalesce((select value from public.settings where key = 'office_name'), ''),
   'officeEmail', coalesce((select value from public.settings where key = 'office_email'), ''));
 end if;

 if a = 'report' then
  if jsonb_typeof(p->'results') <> 'array' or jsonb_array_length(p->'results') > 50 then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  for x in select value from jsonb_array_elements(p->'results') loop
   update public.messages set status = case when (x->>'ok')::boolean then 'sent' else 'failed' end,
    sent_at = case when (x->>'ok')::boolean then now() end,
    note = case when (x->>'ok')::boolean then '' else 'השליח: ' || left(coalesce(x->>'error', 'שגיאה לא ידועה'), 200) end
   where message_id = x->>'id' and status = 'queued';
   if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'updated', n);
 end if;

 -- A client with a queued email and no usable stored link gets a new one (D47); the old link stops working.
 if a = 'link' then
  if coalesce(p->>'tokenHash', '') !~ '^[a-f0-9]{64}$' or coalesce(p->>'tokenEnc', '') !~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{40,}$' or length(p->>'tokenEnc') > 1000 then
   return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  update public.clients set token_hash = p->>'tokenHash', token_enc = p->>'tokenEnc', token_created_at = now()
  where client_id = p->>'clientId' and exists(select 1 from public.messages m where m.client_id = p->>'clientId' and m.status = 'queued');
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  insert into public.activity_log(at, real_at, actor, event, client_id, details)
  values (now(), now(), 'system', 'relay_new_link', p->>'clientId', 'נוצר קישור אישי חדש עם המייל הבא. הקישור הקודם הפסיק לעבוד');
  return jsonb_build_object('ok', true);
 end if;
 return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end $$;

revoke all on function public.nelio_demo_active(), public.nelio_now(), public.nelio_demo_stamp(), public.nelio_message_route(),
 public.nelio_queue_message(text, public.requests, public.clients, jsonb, text), public.nelio_api_core(jsonb), public.nelio_api(jsonb),
 public.nelio_due_day_text(date, date), public.nelio_system_message(text, text, text, text, text, text, text, text, timestamptz),
 public.nelio_mark_step(text, text, timestamptz), public.nelio_cycle_step(text, text, timestamptz), public.nelio_tick(timestamptz),
 public.nelio_demo(jsonb), public.nelio_relay(jsonb) from public, anon, authenticated;
grant execute on function public.nelio_demo_active(), public.nelio_now(), public.nelio_demo_stamp(), public.nelio_message_route(),
 public.nelio_queue_message(text, public.requests, public.clients, jsonb, text), public.nelio_api_core(jsonb), public.nelio_api(jsonb),
 public.nelio_due_day_text(date, date), public.nelio_system_message(text, text, text, text, text, text, text, text, timestamptz),
 public.nelio_mark_step(text, text, timestamptz), public.nelio_cycle_step(text, text, timestamptz), public.nelio_tick(timestamptz),
 public.nelio_demo(jsonb), public.nelio_relay(jsonb) to service_role;
