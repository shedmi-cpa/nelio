-- What the video needs (D62, D63): simulated time, the tick, jump and reset, routing and the relay's side.
-- Always rolled back. Fictional data only.
begin;
insert into public.clients(client_id, business_name, contact_name, email, profile_id, frequency, bookkeeper_id, token_hash, active) values
 ('QA_REAL', 'מחשב לבדיקה', 'דוד לבדיקה', 'shedmi.cpa+qareal@gmail.com', 'SERVICE', 'monthly', 'S2', encode(extensions.digest(repeat('r', 43), 'sha256'), 'hex'), true),
 ('QA_SIM', 'עסק מדומה', 'איש קשר', 'shedmi.cpa+qasim@gmail.com', 'SERVICE', 'monthly', 'S2', encode(extensions.digest(repeat('s', 43), 'sha256'), 'hex'), true),
 ('QA_DONE', 'עסק ששלח הכול', 'איש קשר', 'shedmi.cpa+qadone@gmail.com', 'SERVICE', 'monthly', 'S2', encode(extensions.digest(repeat('t', 43), 'sha256'), 'hex'), true);
insert into public.requests(request_id, cycle_id, client_id, period, status) values
 ('QA_REAL_REQ', '2026-10', 'QA_REAL', '2026-10', 'partial'), ('QA_SIM_REQ', '2026-10', 'QA_SIM', '2026-10', 'not_started'),
 ('QA_DONE_REQ', '2026-10', 'QA_DONE', '2026-10', 'submitted');
insert into public.items(item_id, request_id, doc_type_id, required, status, file_count, last_seq) values
 ('QA_REAL_BANK', 'QA_REAL_REQ', 'BANK_STATEMENT', true, 'received', 1, 1), ('QA_REAL_CC', 'QA_REAL_REQ', 'CREDIT_CARD', true, 'missing', 0, 0),
 ('QA_SIM_BANK', 'QA_SIM_REQ', 'BANK_STATEMENT', true, 'missing', 0, 0),
 ('QA_DONE_BANK', 'QA_DONE_REQ', 'BANK_STATEMENT', true, 'received', 1, 1);
insert into public.uploads(upload_id, uploaded_at, item_id, request_id, client_id, uploaded_by, stored_name, seq, mime_type, size_bytes, status, storage_provider, storage_path, ingest_status) values
 ('QA_V1', '2026-11-08 10:00+02', 'QA_REAL_BANK', 'QA_REAL_REQ', 'QA_REAL', 'client', 'מחשב-לבדיקה_2026-10_דף-בנק_01.jpg', 1, 'image/jpeg', 100, 'active', 'supabase', 'QA_REAL/2026-10/v1', 'ready');
update public.cycles set opened_at = '2026-11-01 09:00+02', reminder1_sent_at = '2026-11-05 09:00+02', reminder2_sent_at = '2026-11-09 09:00+02' where cycle_id = '2026-10';
update public.settings set value = 'QA_REAL' where key = 'demo_real_email_clients';
-- The opening snapshot, as the snapshot migration takes it.
insert into nelio_demo.cycles select * from public.cycles;
insert into nelio_demo.requests select * from public.requests;
insert into nelio_demo.items select * from public.items;
insert into nelio_demo.uploads select * from public.uploads;
insert into nelio_demo.messages select * from public.messages;
insert into nelio_demo.activity_log select * from public.activity_log;
set local role service_role;
do $$
declare a jsonb; m public.messages; secret_hash text := encode(extensions.digest('relay-secret-for-tests', 'sha256'), 'hex'); id text;
begin
 assert public.nelio_due_day_text('2026-11-12', '2026-11-11') = 'מחר, יום חמישי, 12/11', 'due day text';
 assert public.nelio_due_day_text('2026-12-10', '2026-12-07') = 'יום חמישי, 10/12', 'due day text, not tomorrow';
 assert not public.nelio_demo_active() and abs(extract(epoch from public.nelio_now() - now())) < 1, 'no demo clock: real time';
 a := public.nelio_demo('{"action":"jump","actor":"S2","target":"2026-11-11T09:00:00+02:00"}');
 assert a->>'code' = 'NEED_RESET', 'jump needs the demo clock';
 a := public.nelio_demo('{"action":"jump","actor":"S9","target":"2026-11-11T09:00:00+02:00"}');
 assert a->>'code' = 'BAD_ACTOR', 'inactive staff';

 -- The demo clock: 9/11/2026 19:30, moving forward from there.
 insert into public.settings(key, value) values ('demo_now', '2026-11-09T17:30:00Z'), ('demo_now_set_at', now()::text)
  on conflict (key) do update set value = excluded.value;
 assert public.nelio_demo_active() and public.nelio_now() = '2026-11-09 19:30 Asia/Jerusalem'::timestamptz, 'demo clock';
 a := public.nelio_demo('{"action":"state"}');
 assert a->>'demoMode' = 'true' and (a->>'waiting')::int = 2 and a->'realClients'->0->>'clientId' = 'QA_REAL' and a->'relay'->>'configured' = 'false', 'state';
 assert (select count(*) from jsonb_array_elements(a->'plan')) = 6, 'plan in state';

 -- Jump to Wednesday 11/11 09:00: "מחר היום האחרון" goes out to the two clients with something missing.
 a := public.nelio_demo('{"action":"jump","actor":"S2","target":"2026-11-11T09:00:00+02:00"}');
 assert a->>'ok' = 'true' and jsonb_array_length(a->'steps') = 1 and a->'steps'->0->>'step' = 'last_day', 'one step on the way';
 assert (a->'steps'->0->>'count')::int = 2 and (a->'steps'->0->>'real')::int = 1, 'two clients, one real email';
 assert (select count(*) from public.messages where template_id = 'LAST_DAY') = 2, 'two messages';
 select * into m from public.messages where template_id = 'LAST_DAY' and client_id = 'QA_REAL';
 assert m.status = 'queued' and m.sent_at is null and m.send_after = '2026-11-11 09:00 Asia/Jerusalem'::timestamptz, 'real client queued at the step time';
 assert position('מחר, יום חמישי, 12/11 הוא היום האחרון' in m.body) > 0 and position('פירוט אשראי' in m.body) > 0 and position('[קישור]' in m.body) > 0, 'text of the real message';
 assert position('דף בנק' in m.body) = 0, 'only what is missing';
 select * into m from public.messages where template_id = 'LAST_DAY' and client_id = 'QA_SIM';
 assert m.status = 'simulated' and m.sent_at = '2026-11-11 09:00 Asia/Jerusalem'::timestamptz and position('[הקישור האישי]' in m.body) > 0, 'other client recorded';
 assert not exists(select 1 from public.messages where client_id = 'QA_DONE' and template_id = 'LAST_DAY'), 'nothing to whoever sent everything';
 assert (select reminder_count from public.requests where request_id = 'QA_REAL_REQ') = 1, 'reminder counted';
 assert (select last_day_sent_at from public.cycles where cycle_id = '2026-10') = '2026-11-11 09:00 Asia/Jerusalem'::timestamptz, 'step marked';
 assert exists(select 1 from public.activity_log where event = 'cycle_step' and position('יצאה ל־2 לקוחות' in details) > 0), 'logged';
 assert public.nelio_now() >= '2026-11-11 09:00 Asia/Jerusalem'::timestamptz and public.nelio_now() < '2026-11-11 09:01 Asia/Jerusalem'::timestamptz, 'clock moved';
 a := public.nelio_tick(public.nelio_now());
 assert jsonb_array_length(a->'steps') = 0, 'a second tick sends nothing';
 a := public.nelio_demo('{"action":"jump","actor":"S2","target":"2026-11-10T09:00:00+02:00"}');
 assert a->>'code' = 'NOT_FORWARD', 'only forward';

 -- A real action is recorded at the demo time (D57); the real time stays in real_at.
 insert into public.activity_log(at, real_at, actor, event) values (now(), now(), 'client:QA_REAL', 'qa');
 assert (select at from public.activity_log where event = 'qa') between '2026-11-11 09:00 Asia/Jerusalem'::timestamptz and '2026-11-11 09:01 Asia/Jerusalem'::timestamptz, 'stamped with demo time';
 assert (select real_at from public.activity_log where event = 'qa') = now(), 'real time kept';

 -- "לא קריא" for the real client: the email is queued without the link.
 a := public.nelio_office_action(jsonb_build_object('action', 'reject', 'actor', 'S2', 'requestId', 'QA_REAL_REQ', 'uploadId', 'QA_V1', 'reason', 'התמונה מטושטשת', 'token', repeat('r', 43)));
 assert a->>'ok' = 'true' and a->>'messageStatus' = 'queued', 'reject: real email';
 select * into m from public.messages where template_id = 'REJECTED' and client_id = 'QA_REAL';
 assert m.status = 'queued' and position('#t=' in m.body) = 0 and position('[קישור]' in m.body) > 0, 'no link in the queue (D61)';
 assert m.created_at > '2026-11-11 08:59 Asia/Jerusalem'::timestamptz and m.created_at < '2026-11-11 09:01 Asia/Jerusalem'::timestamptz, 'at demo time';

 -- The relay: a wrong secret is refused; the right one gets the due messages once.
 a := public.nelio_relay(jsonb_build_object('action', 'setSecret', 'actor', 'S2', 'secretHash', secret_hash));
 assert a->>'ok' = 'true', 'secret stored';
 a := public.nelio_relay(jsonb_build_object('action', 'pull', 'secretHash', repeat('0', 64)));
 assert a->>'code' = 'FORBIDDEN', 'wrong secret';
 a := public.nelio_relay(jsonb_build_object('action', 'pull', 'secretHash', secret_hash));
 assert a->>'ok' = 'true' and jsonb_array_length(a->'messages') = 2, 'two due messages';
 assert a->'messages'->0->>'clientId' = 'QA_REAL' and a->>'baseUrl' like 'https://%', 'message details';
 id := a->'messages'->0->>'id';
 a := public.nelio_relay(jsonb_build_object('action', 'pull', 'secretHash', secret_hash));
 assert jsonb_array_length(a->'messages') = 0, 'leased messages are not handed out twice';
 a := public.nelio_relay(jsonb_build_object('action', 'report', 'secretHash', secret_hash, 'results', jsonb_build_array(jsonb_build_object('id', id, 'ok', true))));
 assert (a->>'updated')::int = 1 and (select status from public.messages where message_id = id) = 'sent', 'reported sent';
 assert (select sent_at from public.messages where message_id = id) between '2026-11-11 09:00 Asia/Jerusalem'::timestamptz and '2026-11-11 09:01 Asia/Jerusalem'::timestamptz, 'sent at demo time';
 a := public.nelio_relay(jsonb_build_object('action', 'link', 'secretHash', secret_hash, 'clientId', 'QA_REAL',
  'tokenHash', encode(extensions.digest(repeat('x', 43), 'sha256'), 'hex'), 'tokenEnc', 'v1.' || repeat('i', 16) || '.' || repeat('c', 60)));
 assert a->>'ok' = 'true' and (select token_enc from public.clients where client_id = 'QA_REAL') like 'v1.%', 'new link for a queued email';
 a := public.nelio_relay(jsonb_build_object('action', 'link', 'secretHash', secret_hash, 'clientId', 'QA_SIM',
  'tokenHash', encode(extensions.digest(repeat('y', 43), 'sha256'), 'hex'), 'tokenEnc', 'v1.' || repeat('i', 16) || '.' || repeat('c', 60)));
 assert a->>'code' = 'NOT_FOUND', 'no new link without a queued email';

 -- Friday 13/11 09:00: the call list on the way (recorded), then the summary to the owner (real).
 a := public.nelio_demo('{"action":"jump","actor":"S2","target":"2026-11-13T09:00:00+02:00"}');
 assert a->>'ok' = 'true' and jsonb_array_length(a->'steps') = 2 and a->'steps'->0->>'step' = 'call_list' and a->'steps'->1->>'step' = 'summary', 'two steps in order';
 assert (select status from public.messages where template_id = 'CALL_LIST' and staff_id = 'S2') = 'simulated', 'call list recorded';
 select * into m from public.messages where template_id = 'SUMMARY';
 assert m.status = 'queued' and m.staff_id = 'S1' and m.to_email = 'shedmi.cpa+s1@gmail.com', 'summary to the owner, real';
 assert m.subject = 'סיכום אוקטובר 2026' and position('1 מתוך 3 לקוחות שלחו' in m.body) > 0 and position('עוד לא השלימו (2): מחשב לבדיקה, עסק מדומה' in m.body) > 0, 'summary text';

 -- Reset: back to the snapshot and to 9/11 19:30.
 a := public.nelio_demo('{"action":"reset","actor":"S2","confirm":"כן"}');
 assert a->>'code' = 'BAD_CONFIRM', 'reset needs the word';
 a := public.nelio_demo('{"action":"reset","actor":"S2","confirm":"איפוס"}');
 assert a->>'ok' = 'true' and (a->>'outside')::int = 0, 'reset';
 assert not exists(select 1 from public.messages where template_id in ('LAST_DAY', 'SUMMARY', 'REJECTED')), 'messages back to the snapshot';
 assert (select status from public.uploads where upload_id = 'QA_V1') = 'active' and (select status from public.items where item_id = 'QA_REAL_BANK') = 'received', 'documents back';
 assert (select reminder_count from public.requests where request_id = 'QA_REAL_REQ') = 0, 'requests back';
 assert (select last_day_sent_at from public.cycles where cycle_id = '2026-10') is null, 'cycle back';
 assert public.nelio_now() >= '2026-11-09 19:30 Asia/Jerusalem'::timestamptz and public.nelio_now() < '2026-11-09 19:31 Asia/Jerusalem'::timestamptz, 'clock back';
 assert (select count(*) from public.activity_log) = 1 and exists(select 1 from public.activity_log where event = 'demo_reset'), 'log back, with the reset';
 assert (select token_enc from public.clients where client_id = 'QA_REAL') like 'v1.%', 'links are not reset';

 -- The client page shows the demo date.
 a := public.nelio_api(jsonb_build_object('action', 'hello', 'token', repeat('x', 43)));
 assert a->>'ok' = 'true' and a->>'today' = '09/11/2026', 'client page date';
end $$;
rollback;
