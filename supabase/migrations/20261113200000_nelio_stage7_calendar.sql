-- Nelio 0.8.0, stage 7.1: the calendar and the clock (project/stage-7.md).
-- Read-only helpers that do not depend on the open stage 7 decisions: they write nothing,
-- send nothing and decide nothing about collisions; they only compute and report.
-- Only the service role may execute them. No RLS change and no new privilege for anon or authenticated.
-- All local times are Asia/Jerusalem (rules.md).

-- The next moment a message may go out (rules.md: not on Shabbat, a holiday or at night;
-- from friday_cutoff on Fridays and holiday eves). p_day_start is where a moved message lands
-- on its new day: quiet_end for a message created at a random time, send_time for a scheduled step.
-- Assumes quiet_start > quiet_end, as nelio_office_settings enforces.
create function public.nelio_next_allowed(p_at timestamptz, p_quiet_start time, p_quiet_end time,
 p_friday_cutoff time, p_day_start time)
returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
 local_at timestamp := p_at at time zone 'Asia/Jerusalem';
 day_start time := greatest(coalesce(p_day_start, p_quiet_end), p_quiet_end);
 d date; t time; i int;
begin
 if p_at is null then return null; end if;
 for i in 1..60 loop
  d := local_at::date;
  t := local_at::time;
  if extract(isodow from d) = 6 or exists (select 1 from public.holidays h where h.date = d) then
   local_at := (d + 1) + day_start;                       -- Shabbat or holiday: the whole day is closed
  elsif (extract(isodow from d) = 5 or exists (select 1 from public.holidays h where h.date = d + 1))
   and t >= p_friday_cutoff then
   local_at := (d + 1) + day_start;                       -- Friday or holiday eve, after the cutoff
  elsif t >= p_quiet_start then
   local_at := (d + 1) + day_start;                       -- late evening
  elsif t < p_quiet_end then
   local_at := d + day_start;                             -- early morning, same day
  else
   return local_at at time zone 'Asia/Jerusalem';
  end if;
 end loop;
 raise exception 'NO_ALLOWED_TIME';                      -- 60 closed days in a row: the holiday table is wrong
end $$;

-- The same, with the office's settings (or their defaults).
create function public.nelio_setting(p_key text) returns text
language sql stable set search_path = '' as $$
 select coalesce((select nullif(btrim(value), '') from public.settings where key = p_key),
  public.nelio_setting_default(p_key),
  case p_key when 'request_day' then '1' when 'bimonthly_months' then '2,4,6,8,10,12' end);
$$;

create function public.nelio_next_allowed(p_at timestamptz, p_scheduled boolean default false)
returns timestamptz
language sql stable set search_path = '' as $$
 select public.nelio_next_allowed(p_at, public.nelio_setting('quiet_start')::time, public.nelio_setting('quiet_end')::time,
  public.nelio_setting('friday_cutoff')::time,
  case when p_scheduled then public.nelio_setting('send_time')::time else public.nelio_setting('quiet_end')::time end);
$$;

-- The period a client's request covers in a cycle, or null when the client is not in that cycle
-- (brief.md: bimonthly clients only in the months of bimonthly_months, for both months together).
create function public.nelio_cycle_period(p_cycle text, p_frequency text, p_bimonthly_months text)
returns text
language plpgsql immutable set search_path = '' as $$
declare m int; prev date;
begin
 if p_cycle !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return null; end if;
 if p_frequency = 'monthly' then return p_cycle; end if;
 if p_frequency <> 'bimonthly' then return null; end if;
 m := substring(p_cycle, 6, 2)::int;
 if not m::text = any (string_to_array(replace(coalesce(p_bimonthly_months, ''), ' ', ''), ',')) then return null; end if;
 prev := (p_cycle || '-01')::date - interval '1 month';
 -- 2026-10 covers 2026-09_10. A January cycle would span two years; the period then keeps both.
 return case when extract(year from prev)::int = left(p_cycle, 4)::int
  then to_char(prev, 'YYYY-MM') || '_' || substring(p_cycle, 6, 2)
  else to_char(prev, 'YYYY-MM') || '_' || p_cycle end;
end $$;

-- The steps of a cycle and when each goes out (data-model.md, Settings and Cycles).
-- Planned dates are computed, never stored: moving the due date moves every step not yet sent.
-- "shifted": the allowed time is later than the plan. "collides": after the shift, the step lands on
-- the day of the next step, or (a client step) on or after the due date. What to do then is
-- decision 3 in project/stage-7.md; this function only reports it.
create function public.nelio_cycle_plan(p_cycle text)
returns table(step text, template_id text, planned_date date, planned_at timestamptz, send_at timestamptz,
 shifted boolean, collides boolean, sent_at timestamptz)
language plpgsql stable set search_path = '' as $$
declare
 cy public.cycles; send_time time := public.nelio_setting('send_time')::time;
 open_date date; due date;
 steps text[] := array['request', 'reminder1', 'reminder2', 'last_day', 'call_list', 'summary'];
 templates text[] := array['REQUEST', 'REMINDER_1', 'REMINDER_2', 'LAST_DAY', 'CALL_LIST', 'SUMMARY'];
 dates date[]; sent timestamptz[]; sends timestamptz[] := '{}'; i int;
begin
 select * into cy from public.cycles c where c.cycle_id = p_cycle;
 if not found or cy.due_date is null then return; end if;
 due := cy.due_date;
 open_date := ((p_cycle || '-01')::date + interval '1 month')::date + (public.nelio_setting('request_day')::int - 1);
 dates := array[open_date,
  due - public.nelio_setting('reminder1_days_before')::int,
  due - public.nelio_setting('reminder2_days_before')::int,
  due - public.nelio_setting('last_day_days_before')::int,
  due,
  due + public.nelio_setting('summary_days_after')::int];
 sent := array[cy.opened_at, cy.reminder1_sent_at, cy.reminder2_sent_at, cy.last_day_sent_at, cy.call_list_sent_at, cy.summary_sent_at];
 for i in 1..6 loop
  sends := sends || public.nelio_next_allowed((dates[i] + send_time) at time zone 'Asia/Jerusalem', true);
 end loop;
 for i in 1..6 loop
  step := steps[i]; template_id := templates[i]; planned_date := dates[i];
  planned_at := (dates[i] + send_time) at time zone 'Asia/Jerusalem';
  send_at := sends[i];
  shifted := send_at > planned_at;
  collides := shifted and (
   (i < 6 and (send_at at time zone 'Asia/Jerusalem')::date >= dates[i + 1])
   or (i between 2 and 4 and (send_at at time zone 'Asia/Jerusalem')::date >= due));
  sent_at := sent[i];
  return next;
 end loop;
end $$;

-- What a reminder lists: required documents still missing or unreadable, in the order of the
-- document list, the unreadable ones marked like the historical messages ("דף בנק (לא קריא)").
-- Null when nothing is missing.
create function public.nelio_missing_text(p_request text) returns text
language sql stable set search_path = '' as $$
 select string_agg(dt.name_he || case when it.status = 'rejected' then ' (לא קריא)' else '' end, ', ' order by dt.sort_order, dt.doc_type_id)
 from public.items it join public.doc_types dt using (doc_type_id)
 where it.request_id = p_request and it.required and it.doc_type_id <> 'OTHER' and it.status in ('missing', 'rejected');
$$;

-- Whether an automatic client reminder applies to a request right now (data-model.md 3.2:
-- only "not started" or "partial", in the open cycle, for an active client, with something missing).
create function public.nelio_needs_reminder(p_request text) returns boolean
language sql stable set search_path = '' as $$
 select coalesce((
  select r.status in ('not_started', 'partial') and cy.status = 'open' and c.active
   and public.nelio_missing_text(r.request_id) is not null
  from public.requests r join public.cycles cy using (cycle_id) join public.clients c on c.client_id = r.client_id
  where r.request_id = p_request), false);
$$;

revoke all on function public.nelio_next_allowed(timestamptz, time, time, time, time), public.nelio_setting(text),
 public.nelio_next_allowed(timestamptz, boolean), public.nelio_cycle_period(text, text, text), public.nelio_cycle_plan(text),
 public.nelio_missing_text(text), public.nelio_needs_reminder(text) from public, anon, authenticated;
grant execute on function public.nelio_next_allowed(timestamptz, time, time, time, time), public.nelio_setting(text),
 public.nelio_next_allowed(timestamptz, boolean), public.nelio_cycle_period(text, text, text), public.nelio_cycle_plan(text),
 public.nelio_missing_text(text), public.nelio_needs_reminder(text) to service_role;
