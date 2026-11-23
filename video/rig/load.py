"""Builds a local copy of the Nelio demo database: every migration, the Apps Script defaults and
demo/seed.json, exactly as the live database was built (see supabase/tools/make-demo-snapshot.py).
Only fictional data. David (C04) gets a known local link token so the client page can open."""
import hashlib, json, os, re, subprocess, sys, uuid
from pathlib import Path
import psycopg
from psycopg.types.json import Jsonb

HERE = Path(__file__).resolve().parent
REPO = str(HERE.parents[1])
WORK = HERE / 'work'
DSN = 'host=localhost port=%s user=postgres' % os.environ.get('NELIO_PG_PORT', '54329')
TOKENS = {'C04': 'local-video-token-david-c04-0000000000'}

def run_sql_file(conn, path):
    sql = open(path, encoding='utf-8').read()
    with conn.cursor() as cur:
        cur.execute(sql)

def main():
    with psycopg.connect(DSN + ' dbname=postgres', autocommit=True) as c:
        c.execute('drop database if exists nelio with (force)')
        c.execute('create database nelio')
    conn = psycopg.connect(DSN + ' dbname=nelio', autocommit=True)
    conn.execute('''
     do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
     end $$;
     create schema extensions; grant usage on schema extensions to service_role;
     create extension pgcrypto with schema extensions;
     create schema storage; grant usage on schema storage to service_role;
     create table storage.objects(bucket_id text, name text, metadata jsonb);
     create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
     grant select on storage.objects to service_role;
     grant usage on schema public to service_role, anon, authenticated;''')
    migs = sorted(os.listdir(REPO + '/supabase/migrations'))
    early = [m for m in migs if m < '20261119200000']
    late = [m for m in migs if m >= '20261119200000']
    for m in early:
        run_sql_file(conn, REPO + '/supabase/migrations/' + m)

    ref = json.loads(subprocess.run(['node', str(HERE / 'ref.mjs')], capture_output=True, text=True, check=True).stdout)
    seed = json.load(open(REPO + '/demo/seed.json', encoding='utf-8'))
    cur = conn.cursor()
    for k, v, d in ref['settings']:
        cur.execute('insert into public.settings(key,value,description) values(%s,%s,%s) on conflict(key) do update set value=excluded.value', (k, v, d))
    for s in seed['staff']:
        cur.execute('insert into public.staff(staff_id,name,role,email,active) values(%s,%s,%s,%s,%s)',
                    (s['staff_id'], s['name'], s['role'], 'shedmi.cpa+%s@gmail.com' % s['email_tag'], s['active']))
    for d in ref['docTypes']:
        cur.execute('insert into public.doc_types(doc_type_id,name_he,description_he,required,file_label,sort_order) values(%s,%s,%s,%s,%s,%s)',
                    (d['doc_type_id'], d['name_he'], d['description_he'], d['required'], d['file_label'], d['sort_order']))
    for p in ref['profiles']:
        cur.execute('insert into public.profiles(profile_id,name_he,applies_when,doc_types) values(%s,%s,%s,%s)',
                    (p['profile_id'], p['name_he'], p['applies_when'], p['doc_types']))
    for t in ref['templates']:
        cur.execute('insert into public.templates(template_id,name_he,recipient,subject,body) values(%s,%s,%s,%s,%s)',
                    (t['template_id'], t['name_he'], t['recipient'], t['subject'], t['body']))
    for h in seed['holidays']:
        cur.execute('insert into public.holidays(date,name) values(%s,%s) on conflict do nothing', (h['date'], h['name']))
    for c in seed['clients']:
        tok = TOKENS.get(c['client_id'], 'local-unused-' + c['client_id'] + '-' + uuid.uuid4().hex)
        cur.execute('''insert into public.clients(client_id,business_name,contact_name,email,phone,profile_id,has_employees,frequency,
            legal_type,bookkeeper_id,token_hash,token_created_at,active,notes) values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (c['client_id'], c['business_name'], c['contact_name'], 'shedmi.cpa+%s@gmail.com' % c['email_tag'], c['phone'], c['profile_id'],
             c['has_employees'], c['frequency'], c['legal_type'], c['bookkeeper_id'], hashlib.sha256(tok.encode()).hexdigest(),
             c['token_created_at'] or None, c['active'], c['notes']))
    n = lambda v: v if v not in ('', None) else None
    for y in seed['cycles']:
        cur.execute('''insert into public.cycles(cycle_id,due_date,includes_bimonthly,status,opened_at,closed_at,reminder1_sent_at,reminder2_sent_at,
            last_day_sent_at,call_list_sent_at,summary_sent_at) values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (y['cycle_id'], y['due_date'], y['includes_bimonthly'], y['status'], n(y['opened_at']), n(y['closed_at']), n(y['reminder1_sent_at']),
             n(y['reminder2_sent_at']), n(y['last_day_sent_at']), n(y['call_list_sent_at']), n(y['summary_sent_at'])))
    for r in seed['requests']:
        cur.execute('''insert into public.requests(request_id,cycle_id,client_id,period,status,reminder_count,last_reminder_at,last_activity,
            last_activity_at,client_note,submitted_at,completed_at,completed_by,completion_note) values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (r['request_id'], r['cycle_id'], r['client_id'], r['period'], r['status'], int(r['reminder_count'] or 0), n(r['last_reminder_at']),
             r['last_activity'], n(r['last_activity_at']), r['client_note'], n(r['submitted_at']), n(r['completed_at']), r['completed_by'], r['completion_note']))
    for i in seed['items']:
        cur.execute('''insert into public.items(item_id,request_id,doc_type_id,required,status,file_count,na_note,reject_reason,updated_at,updated_by,last_seq)
            values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (i['item_id'], i['request_id'], i['doc_type_id'], i['required'], i['status'], int(i['file_count'] or 0), i['na_note'], i['reject_reason'],
             n(i['updated_at']), i['updated_by'], int(i['last_seq'] or 0)))
    clients = {c['client_id']: c for c in seed['clients']}
    labels = {d['doc_type_id']: d['file_label'] for d in ref['docTypes']}
    periods = {r['request_id']: r['period'] for r in seed['requests']}
    assets = {}
    for u in seed['uploads']:
        biz = clients[u['client_id']]['business_name'].replace('"', '״')
        biz = re.sub(r'[\\/:*?<>|]', '-', biz)
        biz = re.sub(r'[\s_‐-―−-]+', '-', biz)[:40].strip('-.')
        ext = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp'}.get(u['mime_type'], 'pdf')
        stored = '%s_%s_%s_%02d.%s' % (biz, periods[u['request_id']], labels[u['item_id'].split('_', 2)[2]], int(u['seq']), ext)
        cur.execute('''insert into public.uploads(upload_id,uploaded_at,item_id,request_id,client_id,uploaded_by,original_name,stored_name,seq,mime_type,
            size_bytes,file_hash,duplicate_of,upload_key,status,storage_path,storage_provider,ingest_status) values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (u['upload_id'], u['uploaded_at'], u['item_id'], u['request_id'], u['client_id'], u['uploaded_by'], u['original_name'], stored, int(u['seq']),
             u['mime_type'], 400000, hashlib.sha256(u['upload_id'].encode()).hexdigest(), u['duplicate_of'], u['upload_key'], u['status'],
             '%s/%s/%s' % (u['client_id'], periods[u['request_id']], u['upload_id']), 'supabase', 'ready'))
        assets['%s/%s/%s' % (u['client_id'], periods[u['request_id']], u['upload_id'])] = u['asset']
    json.dump(assets, open(WORK / 'assets-map.json', 'w'))
    tmpl = {t['template_id']: t for t in ref['templates']}
    for m in seed['messages']:
        t = tmpl.get(m['template_id'], {'subject': m['template_id']})
        to = 'shedmi.cpa+%s@gmail.com' % m['client_id'].lower() if m['client_id'] else 'shedmi.cpa+s1@gmail.com'
        cur.execute('''insert into public.messages(message_id,created_at,send_after,template_id,cycle_id,request_id,client_id,staff_id,to_email,subject,body,
            status,sent_at,note,created_by) values(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''',
            (m['message_id'], m['created_at'], n(m['send_after']), m['template_id'], m['cycle_id'] or None, m['request_id'] or None, m['client_id'] or None, m['staff_id'] or None,
             to, t['subject'], '', m['status'], n(m['sent_at']), m['note'], m['created_by']))
    for l in seed['log']:
        cur.execute('insert into public.activity_log(at,real_at,actor,event,client_id,request_id,item_id,details) values(%s,%s,%s,%s,%s,%s,%s,%s)',
                    (l['at'], l['at'], l['actor'], l['event'], l['client_id'], l['request_id'], l['item_id'], l['details']))
    for m in late:
        run_sql_file(conn, REPO + '/supabase/migrations/' + m)
    # Local only: David alone gets real email, as on the live database (D63).
    cur.execute("update public.settings set value='C04' where key='demo_real_email_clients'")
    print('loaded:', {t: cur.execute('select count(*) from public.' + t).fetchone()[0] for t in ['clients', 'requests', 'items', 'uploads', 'messages', 'activity_log']})
    print(cur.execute("select key,value from public.settings where key like 'demo%'").fetchall())

if __name__ == '__main__':
    main()
