-- Stage 7.1: the calendar and the clock. Always rolled back. All dates fictional-data friendly.
begin;
insert into public.holidays(date, name) values
 ('2026-09-12', 'ראש השנה'), ('2026-09-13', 'ראש השנה'), ('2026-09-21', 'יום כיפור'), ('2027-04-22', 'פסח')
 on conflict (date) do nothing;
insert into public.doc_types(doc_type_id, name_he, required, file_label, sort_order) values ('SUPPLIER_INVOICES', 'חשבוניות ספקים', true, 'חשבוניות-ספקים', 2)
 on conflict do nothing;
insert into public.clients(client_id, business_name, contact_name, email, profile_id, frequency, bookkeeper_id, token_hash, active) values
 ('QA_C7', 'עסק לבדיקת המחזור', 'איש קשר', 'shedmi.cpa+qac7@gmail.com', 'SERVICE', 'monthly', 'S2', encode(extensions.digest(repeat('c', 43), 'sha256'), 'hex'), true),
 ('QA_C8', 'עסק לא פעיל', 'איש קשר', 'shedmi.cpa+qac8@gmail.com', 'SERVICE', 'monthly', 'S2', encode(extensions.digest(repeat('d', 43), 'sha256'), 'hex'), false);
insert into public.requests(request_id, cycle_id, client_id, period, status) values
 ('QA_C7_REQ', '2026-10', 'QA_C7', '2026-10', 'partial'), ('QA_C8_REQ', '2026-10', 'QA_C8', '2026-10', 'not_started');
insert into public.items(item_id, request_id, doc_type_id, required, status) values
 ('QA_C7_BANK', 'QA_C7_REQ', 'BANK_STATEMENT', true, 'rejected'),
 ('QA_C7_CC', 'QA_C7_REQ', 'CREDIT_CARD', true, 'received'),
 ('QA_C7_SUP', 'QA_C7_REQ', 'SUPPLIER_INVOICES', true, 'missing'),
 ('QA_C7_OTHER', 'QA_C7_REQ', 'OTHER', false, 'missing'),
 ('QA_C8_BANK', 'QA_C8_REQ', 'BANK_STATEMENT', true, 'missing');
-- The December cycle: its due date, 12/12/2026, is a Saturday (data-model.md, chapter 8).
insert into public.cycles(cycle_id, due_date, status) values ('2026-11', '2026-12-12', 'closed');
set local role service_role;
do $$
declare
 -- Local Israel time to timestamptz, and back to local text, to keep the assertions readable.
 q constant time := '21:00'; e constant time := '08:00'; f constant time := '13:00';
 p record; n int := 0;
begin
 -- An ordinary weekday morning stays as it is.
 assert public.nelio_next_allowed('2026-11-11 10:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-11-11 10:00 Asia/Jerusalem'::timestamptz, 'weekday';
 -- Late evening: next morning at quiet_end; a scheduled step at send_time.
 assert public.nelio_next_allowed('2026-11-11 23:30 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-11-12 08:00 Asia/Jerusalem'::timestamptz, 'night';
 assert public.nelio_next_allowed('2026-11-11 23:30 Asia/Jerusalem'::timestamptz, q, e, f, '09:00') = '2026-11-12 09:00 Asia/Jerusalem'::timestamptz, 'night, scheduled';
 assert public.nelio_next_allowed('2026-11-11 21:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-11-12 08:00 Asia/Jerusalem'::timestamptz, 'quiet starts at 21:00 sharp';
 -- Early morning: the same day.
 assert public.nelio_next_allowed('2026-11-12 05:10 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-11-12 08:00 Asia/Jerusalem'::timestamptz, 'early morning';
 -- Friday: allowed before the cutoff, not from it. Saturday: closed all day.
 assert public.nelio_next_allowed('2026-12-04 12:59 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-12-04 12:59 Asia/Jerusalem'::timestamptz, 'friday before cutoff';
 assert public.nelio_next_allowed('2026-12-04 13:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-12-06 08:00 Asia/Jerusalem'::timestamptz, 'friday from cutoff';
 assert public.nelio_next_allowed('2026-12-05 09:00 Asia/Jerusalem'::timestamptz, q, e, f, '09:00') = '2026-12-06 09:00 Asia/Jerusalem'::timestamptz, 'saturday (data-model 4: reminder 1 of December on Sunday 6/12)';
 assert public.nelio_next_allowed('2026-12-05 20:30 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-12-06 08:00 Asia/Jerusalem'::timestamptz, 'saturday evening is still saturday';
 -- Rosh Hashana 2026 is Saturday and Sunday: from Friday afternoon to Monday morning.
 assert public.nelio_next_allowed('2026-09-11 14:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-09-14 08:00 Asia/Jerusalem'::timestamptz, 'rosh hashana';
 -- A holiday eve on a weekday behaves like Friday.
 assert public.nelio_next_allowed('2026-09-20 12:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-09-20 12:00 Asia/Jerusalem'::timestamptz, 'yom kippur eve before cutoff';
 assert public.nelio_next_allowed('2026-09-20 13:30 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-09-22 08:00 Asia/Jerusalem'::timestamptz, 'yom kippur eve after cutoff';
 -- Passover 2027 is a Thursday: the Friday after it is allowed until the cutoff.
 assert public.nelio_next_allowed('2027-04-21 15:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2027-04-23 08:00 Asia/Jerusalem'::timestamptz, 'passover thursday';
 -- Daylight saving ends on 25/10/2026: the local clock still says 08:00.
 assert public.nelio_next_allowed('2026-10-24 10:00 Asia/Jerusalem'::timestamptz, q, e, f, e) = '2026-10-25 08:00 Asia/Jerusalem'::timestamptz, 'dst change';
 assert to_char(public.nelio_next_allowed('2026-10-24 10:00 Asia/Jerusalem'::timestamptz, q, e, f, e) at time zone 'Asia/Jerusalem', 'HH24:MI') = '08:00', 'dst local hour';
 assert public.nelio_next_allowed(null, q, e, f, e) is null, 'null in, null out';
 -- The settings wrapper uses the defaults when nothing is stored (fixture has none).
 assert public.nelio_next_allowed('2026-12-05 09:00 Asia/Jerusalem'::timestamptz) = '2026-12-06 08:00 Asia/Jerusalem'::timestamptz, 'wrapper, message';
 assert public.nelio_next_allowed('2026-12-05 09:00 Asia/Jerusalem'::timestamptz, true) = '2026-12-06 09:00 Asia/Jerusalem'::timestamptz, 'wrapper, scheduled step';

 -- Who is in a cycle, and for which period.
 assert public.nelio_cycle_period('2026-10', 'monthly', '2,4,6,8,10,12') = '2026-10', 'monthly';
 assert public.nelio_cycle_period('2026-10', 'bimonthly', '2,4,6,8,10,12') = '2026-09_10', 'bimonthly in an even month';
 assert public.nelio_cycle_period('2026-11', 'bimonthly', '2,4,6,8,10,12') is null, 'bimonthly not in an odd month';
 assert public.nelio_cycle_period('2027-02', 'bimonthly', '2, 4, 6, 8, 10, 12') = '2027-01_02', 'spaces in the setting';
 assert public.nelio_cycle_period('2027-01', 'bimonthly', '1,3,5,7,9,11') = '2026-12_2027-01', 'across a year';
 assert public.nelio_cycle_period('2026-13', 'monthly', '') is null and public.nelio_cycle_period('2026-10', 'weekly', '') is null, 'bad input';

 -- The October cycle (due Thursday 12/11/2026): nothing moves, nothing collides.
 for p in select * from public.nelio_cycle_plan('2026-10') loop
  n := n + 1;
  assert not p.shifted and not p.collides, 'october: ' || p.step;
  assert to_char(p.send_at at time zone 'Asia/Jerusalem', 'HH24:MI') = '09:00', 'october at send_time: ' || p.step;
 end loop;
 assert n = 6, 'six steps';
 assert (select string_agg(to_char(planned_date, 'DD/MM'), ' ' order by planned_date) from public.nelio_cycle_plan('2026-10'))
  = '01/11 05/11 09/11 11/11 12/11 13/11', 'october days are brief.md''s 1, 5, 9, 11, 12, 13';

 -- The December cycle (due Saturday 12/12/2026).
 select * into p from public.nelio_cycle_plan('2026-11') where step = 'reminder1';
 assert p.shifted and not p.collides and p.send_at = '2026-12-06 09:00 Asia/Jerusalem'::timestamptz, 'reminder 1 moves from saturday 5/12 to sunday 6/12';
 select * into p from public.nelio_cycle_plan('2026-11') where step = 'last_day';
 assert not p.shifted and p.send_at = '2026-12-11 09:00 Asia/Jerusalem'::timestamptz, 'last day on friday morning is allowed';
 select * into p from public.nelio_cycle_plan('2026-11') where step = 'call_list';
 assert p.shifted and p.collides and p.send_at = '2026-12-13 09:00 Asia/Jerusalem'::timestamptz, 'call list moves onto the summary day: reported, not decided';
 select * into p from public.nelio_cycle_plan('2026-11') where step = 'request';
 assert p.planned_date = '2026-12-01' and not p.shifted, 'request on tuesday 1/12';

 -- The due date moves: every step moves with it (brief.md edge case).
 update public.cycles set due_date = '2026-12-10' where cycle_id = '2026-11';
 assert not exists (select 1 from public.nelio_cycle_plan('2026-11') where collides), 'due thursday 10/12: no collision';
 assert (select planned_date from public.nelio_cycle_plan('2026-11') where step = 'reminder2') = '2026-12-07', 'reminder 2 follows the due date';
 -- A due date on Sunday: "tomorrow is the last day" falls on Saturday and lands on the due day itself.
 update public.cycles set due_date = '2026-12-13' where cycle_id = '2026-11';
 select * into p from public.nelio_cycle_plan('2026-11') where step = 'last_day';
 assert p.shifted and p.collides and p.send_at = '2026-12-13 09:00 Asia/Jerusalem'::timestamptz, 'last day collides with a sunday due date';
 -- Settings change the plan.
 insert into public.settings(key, value) values ('send_time', '10:30'), ('reminder2_days_before', '4');
 select * into p from public.nelio_cycle_plan('2026-10') where step = 'reminder2';
 assert p.planned_date = '2026-11-08' and to_char(p.send_at at time zone 'Asia/Jerusalem', 'HH24:MI') = '10:30', 'settings apply';
 delete from public.settings where key in ('send_time', 'reminder2_days_before');
 assert not exists (select 1 from public.nelio_cycle_plan('1999-01')), 'unknown cycle: no rows';
 -- What was already sent is shown.
 update public.cycles set reminder1_sent_at = '2026-11-05 09:00 Asia/Jerusalem' where cycle_id = '2026-10';
 assert (select sent_at from public.nelio_cycle_plan('2026-10') where step = 'reminder1') = '2026-11-05 09:00 Asia/Jerusalem'::timestamptz, 'sent time';

 -- What is missing, in document order, unreadable marked, optional "other" excluded.
 assert public.nelio_missing_text('QA_C7_REQ') = 'חשבוניות ספקים, דף בנק (לא קריא)', public.nelio_missing_text('QA_C7_REQ');
 assert public.nelio_needs_reminder('QA_C7_REQ'), 'partial with something missing';
 assert not public.nelio_needs_reminder('QA_C8_REQ'), 'inactive client';
 assert not public.nelio_needs_reminder('NO_SUCH_REQ'), 'unknown request';
 update public.items set status = 'received' where request_id = 'QA_C7_REQ' and doc_type_id in ('BANK_STATEMENT', 'SUPPLIER_INVOICES');
 assert public.nelio_missing_text('QA_C7_REQ') is null and not public.nelio_needs_reminder('QA_C7_REQ'), 'nothing missing, no reminder';
 update public.items set status = 'missing' where item_id = 'QA_C7_SUP';
 update public.requests set status = 'submitted' where request_id = 'QA_C7_REQ';
 assert not public.nelio_needs_reminder('QA_C7_REQ'), 'only not_started or partial get reminders';
end $$;
reset role;
-- Only the server may run these.
do $$ begin
 assert not has_function_privilege('anon', 'public.nelio_cycle_plan(text)', 'execute'), 'anon cannot run the plan';
 assert not has_function_privilege('authenticated', 'public.nelio_next_allowed(timestamptz, boolean)', 'execute'), 'authenticated cannot run the clock';
end $$;
rollback;
