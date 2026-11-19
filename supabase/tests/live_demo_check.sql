-- A rehearsal of the video on the live database (D64), always rolled back: the DO block ends with
-- an exception that carries the result, so nothing it does is kept. No tokens, links or ciphertext in the output.
do $$
declare r jsonb := '{}'; a jsonb;
begin
 r := r || jsonb_build_object('before', jsonb_build_object(
  'snapshot', (select jsonb_build_object('cycles', (select count(*) from nelio_demo.cycles), 'requests', (select count(*) from nelio_demo.requests),
    'items', (select count(*) from nelio_demo.items), 'uploads', (select count(*) from nelio_demo.uploads), 'messages', (select count(*) from nelio_demo.messages),
    'log', (select count(*) from nelio_demo.activity_log))),
  'settings', (select jsonb_object_agg(key, value) from public.settings where key in ('demo_mode', 'demo_now', 'demo_real_email_clients', 'client_page_url', 'office_name')),
  'staff', (select jsonb_agg(jsonb_build_object('id', staff_id, 'role', role, 'active', active, 'email', email)) from public.staff),
  'c04', (select jsonb_build_object('email', email, 'active', active, 'hasLink', token_enc <> '') from public.clients where client_id = 'C04'),
  'templates', (select jsonb_object_agg(template_id, left(body, 90)) from public.templates where template_id in ('LAST_DAY', 'SUMMARY', 'REJECTED', 'CONFIRMATION')),
  'queuedNow', (select count(*) from public.messages where status = 'queued')));
 a := public.nelio_demo('{"action":"reset","actor":"S1","confirm":"איפוס"}');
 r := r || jsonb_build_object('reset', a);
 a := public.nelio_demo('{"action":"state"}');
 r := r || jsonb_build_object('stateAfterReset', jsonb_build_object('now', a->'now', 'waiting', a->'waiting', 'plan', a->'plan', 'realClients', a->'realClients', 'owners', a->'owners'));
 r := r || jsonb_build_object('countsAfterReset', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.requests where cycle_id = '2026-10' group by status) x)
  || jsonb_build_object('total', (select count(*) from public.requests where cycle_id = '2026-10')));
 r := r || jsonb_build_object('c04Items', (select jsonb_agg(jsonb_build_object('doc', doc_type_id, 'status', status, 'seq', last_seq) order by doc_type_id) from public.items where request_id = '2026-10_C04'));
 a := public.nelio_demo('{"action":"jump","actor":"S1","target":"2026-11-11T09:00:00+02:00"}');
 r := r || jsonb_build_object('jump11', a);
 r := r || jsonb_build_object('c04LastDay', (select jsonb_build_object('status', status, 'to', to_email, 'subject', subject, 'body', body, 'sendAfter', send_after)
  from public.messages where client_id = 'C04' and template_id = 'LAST_DAY' and created_at >= '2026-11-11'));
 r := r || jsonb_build_object('lastDayStatuses', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.messages where template_id = 'LAST_DAY' and created_at >= '2026-11-11' group by status) x));
 r := r || jsonb_build_object('hello', (select jsonb_build_object('today', x->'today', 'ok', x->'ok') from (select public.nelio_api(jsonb_build_object('action', 'hello', 'token', repeat('z', 43))) x) y));
 a := public.nelio_demo('{"action":"jump","actor":"S1","target":"2026-11-13T09:00:00+02:00"}');
 r := r || jsonb_build_object('jump13', a);
 r := r || jsonb_build_object('summary', (select jsonb_build_object('status', status, 'to', to_email, 'subject', subject, 'body', body)
  from public.messages where template_id = 'SUMMARY' and created_at >= '2026-11-13'));
 raise exception using message = 'NELIO_CHECK ' || r::text;
end $$;
