-- Nelio 0.7.2, stage 6.3.3: the activity log and the settings screen.
-- Only the nelio-office Edge Function (service role) may execute these routines.
-- No RLS change and no new privilege for anon or authenticated.

-- The log of one cycle (or the latest entries): activity_log plus the messages, newest first.
-- System entries without a request (opening a cycle, for example) belong to the cycle by time.
create function public.nelio_office_log(p jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare cy public.cycles; rows jsonb; from_at timestamptz; to_at timestamptz;
begin
 if p ? 'cycleId' then
  select * into cy from public.cycles where cycle_id = p->>'cycleId';
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  from_at := coalesce(cy.opened_at, '-infinity'::timestamptz);
  to_at := coalesce(cy.closed_at, 'infinity'::timestamptz);
 end if;
 select coalesce(jsonb_agg(x order by (x->>'at')::timestamptz desc), '[]') into rows from (
  select x from (
   select jsonb_build_object('kind', 'log', 'at', l.at, 'actor', l.actor, 'event', l.event, 'clientId', l.client_id,
    'businessName', coalesce(c.business_name, ''), 'details', l.details) as x, l.at
   from public.activity_log l
   left join public.clients c on c.client_id = l.client_id
   left join public.requests q on q.request_id = l.request_id
   where cy.cycle_id is null or q.cycle_id = cy.cycle_id or (l.request_id = '' and l.at >= from_at and l.at < to_at)
   union all
   select jsonb_build_object('kind', 'message', 'at', m.created_at, 'actor', m.created_by, 'event', m.template_id, 'clientId', m.client_id,
    'businessName', coalesce(c.business_name, ''), 'details', coalesce(t.name_he, m.template_id), 'status', m.status) as x, m.created_at
   from public.messages m
   left join public.clients c on c.client_id = m.client_id
   left join public.templates t on t.template_id = m.template_id
   where cy.cycle_id is null or m.cycle_id = cy.cycle_id
   order by 2 desc nulls last
   limit 500) newest) list;
 return jsonb_build_object('ok', true, 'cycleId', cy.cycle_id, 'rows', rows);
end $$;

-- The settings the office may change from the dashboard (data-model.md, Settings). Stage 7 uses them.
create function public.nelio_setting_default(p_key text) returns text
language sql immutable set search_path = '' as $$
 select case p_key when 'due_day' then '12' when 'reminder1_days_before' then '7' when 'reminder2_days_before' then '3'
  when 'last_day_days_before' then '1' when 'summary_days_after' then '1' when 'send_time' then '09:00'
  when 'quiet_start' then '21:00' when 'quiet_end' then '08:00' when 'friday_cutoff' then '13:00' end;
$$;

create function public.nelio_office_settings(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare
 keys text[] := array['due_day', 'reminder1_days_before', 'reminder2_days_before', 'last_day_days_before', 'summary_days_after',
  'send_time', 'quiet_start', 'quiet_end', 'friday_cutoff'];
 s public.staff; k text; v text; merged jsonb := '{}'; changes text := ''; old_value text; t public.templates; subj text; body_text text;
begin
 if p->>'action' = 'get' then
  return jsonb_build_object('ok', true,
   'settings', (select jsonb_agg(jsonb_build_object('key', key_name, 'value', coalesce(st.value, public.nelio_setting_default(key_name)),
     'stored', st.key is not null) order by ord)
    from unnest(keys) with ordinality as u(key_name, ord) left join public.settings st on st.key = key_name),
   'templates', (select coalesce(jsonb_agg(jsonb_build_object('templateId', template_id, 'name', name_he, 'recipient', recipient,
     'subject', subject, 'body', body) order by template_id), '[]') from public.templates),
   'holidays', (select coalesce(jsonb_agg(jsonb_build_object('date', h.date, 'name', h.name) order by h.date), '[]')
    from public.holidays h where h.date >= (now() at time zone 'Asia/Jerusalem')::date - 31));
 end if;

 s := public.nelio_office_actor(p->>'actor');
 if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;

 if p->>'action' = 'save' then
  if jsonb_typeof(p->'values') <> 'object' then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
  -- Start from what is stored (or the default), then apply the change, so the rules check the result.
  foreach k in array keys loop
   merged := merged || jsonb_build_object(k, coalesce((select value from public.settings where key = k), public.nelio_setting_default(k)));
  end loop;
  for k, v in select key, value from jsonb_each_text(p->'values') loop
   if not k = any(keys) then return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST'); end if;
   v := btrim(coalesce(v, ''));
   if k in ('send_time', 'quiet_start', 'quiet_end', 'friday_cutoff') then
    if v !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE', 'key', k); end if;
   elsif v !~ '^[0-9]{1,2}$' then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE', 'key', k);
   end if;
   merged := merged || jsonb_build_object(k, v);
  end loop;
  -- The rules of data-model.md: the reminders come in order, all before the due date.
  if (merged->>'due_day')::int not between 1 and 28 then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE', 'key', 'due_day'); end if;
  if (merged->>'summary_days_after')::int not between 1 and 10 then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE', 'key', 'summary_days_after'); end if;
  if (merged->>'last_day_days_before')::int < 1
   or (merged->>'reminder2_days_before')::int <= (merged->>'last_day_days_before')::int
   or (merged->>'reminder1_days_before')::int <= (merged->>'reminder2_days_before')::int
   or (merged->>'reminder1_days_before')::int >= (merged->>'due_day')::int then
   return jsonb_build_object('ok', false, 'code', 'BAD_ORDER');
  end if;
  if (merged->>'quiet_start') <= (merged->>'quiet_end') or (merged->>'send_time') < (merged->>'quiet_end') or (merged->>'send_time') >= (merged->>'quiet_start') then
   return jsonb_build_object('ok', false, 'code', 'BAD_QUIET');
  end if;
  foreach k in array keys loop
   select value into old_value from public.settings where key = k;
   if old_value is distinct from merged->>k and (old_value is not null or merged->>k <> public.nelio_setting_default(k)) then
    insert into public.settings(key, value) values (k, merged->>k) on conflict (key) do update set value = excluded.value;
    changes := changes || case when changes = '' then '' else '; ' end || k || ': ' || coalesce(old_value, public.nelio_setting_default(k)) || ' → ' || (merged->>k);
   end if;
  end loop;
  if changes <> '' then
   insert into public.activity_log(at, real_at, actor, event, details) values (now(), now(), 'office:' || s.staff_id, 'office_settings', changes);
  end if;
  return jsonb_build_object('ok', true, 'changed', changes <> '');
 end if;

 if p->>'action' = 'saveTemplate' then
  select * into t from public.templates where template_id = p->>'templateId' for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  subj := btrim(coalesce(p->>'subject', ''));
  body_text := btrim(regexp_replace(coalesce(p->>'body', ''), E'\r\n?', E'\n', 'g'));
  if length(body_text) not between 1 and 1500 or length(subj) > 200 then return jsonb_build_object('ok', false, 'code', 'BAD_VALUE'); end if;
  -- A client message that carried the personal link must keep it, or the client has nowhere to upload.
  if position('[קישור]' in t.body) > 0 and position('[קישור]' in body_text) = 0 then return jsonb_build_object('ok', false, 'code', 'LINK_REQUIRED'); end if;
  if subj = t.subject and body_text = t.body then return jsonb_build_object('ok', true, 'changed', false); end if;
  update public.templates set subject = subj, body = body_text where template_id = t.template_id;
  insert into public.activity_log(at, real_at, actor, event, details) values (now(), now(), 'office:' || s.staff_id, 'office_template', t.name_he);
  return jsonb_build_object('ok', true, 'changed', true);
 end if;
 return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
end $$;

revoke all on function public.nelio_office_log(jsonb), public.nelio_setting_default(text), public.nelio_office_settings(jsonb) from public, anon, authenticated;
grant execute on function public.nelio_office_log(jsonb), public.nelio_setting_default(text), public.nelio_office_settings(jsonb) to service_role;
