-- Nelio 0.7.3, stage 6.3.4: the file list for a ZIP export (D49).
-- The browser packs the ZIP; each file is still fetched through openFile, which checks the request.
-- This routine reads only, apart from one log entry. Service role only; no RLS change.

create function public.nelio_office_files(p jsonb) returns jsonb
language plpgsql set search_path = '' as $$
declare s public.staff; scope text := p->>'scope'; r public.requests; c public.clients; cy public.cycles; files jsonb; n int; total bigint; label text;
begin
 s := public.nelio_office_actor(p->>'actor');
 if s.staff_id is null then return jsonb_build_object('ok', false, 'code', 'BAD_ACTOR'); end if;
 if scope in ('request', 'docType') then
  select * into r from public.requests where request_id = p->>'requestId';
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  if scope = 'docType' and not exists(select 1 from public.items where request_id = r.request_id and doc_type_id = p->>'docTypeId') then
   return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
  select * into strict c from public.clients where client_id = r.client_id;
 elsif scope = 'client' then
  select * into c from public.clients where client_id = p->>'clientId';
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 elsif scope = 'cycle' then
  select * into cy from public.cycles where cycle_id = p->>'cycleId';
  if not found then return jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); end if;
 else
  return jsonb_build_object('ok', false, 'code', 'BAD_REQUEST');
 end if;

 -- Up to 1,001 rows, so the browser can tell the office that the selection is over the limit of 1,000.
 select coalesce(jsonb_agg(f order by ord), '[]'), count(*), coalesce(sum((f->>'sizeBytes')::bigint), 0) into files, n, total from (
  select jsonb_build_object('requestId', u.request_id, 'uploadId', u.upload_id, 'clientId', cl.client_id, 'businessName', cl.business_name,
   'period', q.period, 'docTypeId', i.doc_type_id, 'docName', dt.name_he, 'storedName', u.stored_name, 'originalName', u.original_name,
   'mimeType', u.mime_type, 'sizeBytes', u.size_bytes, 'rejected', u.status = 'rejected') as f,
   row_number() over (order by cl.business_name, cl.client_id, q.period, dt.sort_order, u.seq, u.uploaded_at) as ord
  from public.uploads u
  join public.requests q on q.request_id = u.request_id
  join public.clients cl on cl.client_id = q.client_id
  join public.items i on i.item_id = u.item_id
  join public.doc_types dt on dt.doc_type_id = i.doc_type_id
  where u.ingest_status = 'ready'
   and (coalesce((p->>'includeRejected')::boolean, true) or u.status <> 'rejected')
   and case scope
    when 'request' then u.request_id = r.request_id
    when 'docType' then u.request_id = r.request_id and i.doc_type_id = p->>'docTypeId'
    when 'client' then q.client_id = c.client_id
    else q.cycle_id = cy.cycle_id end
  order by ord
  limit 1001) list;

 if not coalesce((p->>'dryRun')::boolean, false) then
  label := case scope when 'cycle' then 'כל הלקוחות, ' || public.nelio_period_label(cy.cycle_id)
   when 'client' then c.business_name || ', כל המחזורים'
   when 'docType' then c.business_name || ', ' || public.nelio_period_label(r.period) || ', ' || coalesce((select name_he from public.doc_types where doc_type_id = p->>'docTypeId'), '')
   else c.business_name || ', ' || public.nelio_period_label(r.period) end;
  insert into public.activity_log(at, real_at, actor, event, client_id, request_id, details)
  values (now(), now(), 'office:' || s.staff_id, 'office_export', coalesce(c.client_id, ''), coalesce(r.request_id, ''),
   label || ': ' || least(n, 1000) || ' קבצים');
 end if;
 return jsonb_build_object('ok', true, 'files', files, 'count', n, 'totalBytes', total, 'overLimit', n > 1000);
end $$;

revoke all on function public.nelio_office_files(jsonb) from public, anon, authenticated;
grant execute on function public.nelio_office_files(jsonb) to service_role;
