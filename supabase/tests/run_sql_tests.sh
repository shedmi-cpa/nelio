#!/usr/bin/env bash
# Applies every migration to a throwaway local PostgreSQL and runs the SQL tests.
# It never connects to Supabase. The stubs below stand in for what Supabase provides
# (the roles, the extensions schema and storage.objects).
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -n 1)"
[ -x "$bin/initdb" ] || { echo 'PostgreSQL server binaries not found'; exit 1; }
work="$(mktemp -d)"
run=()
if [ "$(id -u)" = 0 ]; then chown postgres "$work"; run=(runuser -u postgres --); fi
cleanup(){ "${run[@]}" "$bin/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
"${run[@]}" "$bin/initdb" -D "$work/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
"${run[@]}" "$bin/pg_ctl" -D "$work/data" -o "-k $work -c listen_addresses=''" -l "$work/log" -w start >/dev/null
psql_run(){ "${run[@]}" psql -h "$work" -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
psql_run <<'SQL'
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema extensions; grant usage on schema extensions to service_role;
create extension pgcrypto with schema extensions;
create schema storage; grant usage on schema storage to service_role;
create table storage.objects(bucket_id text, name text, metadata jsonb);
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
grant select on storage.objects to service_role;
grant usage on schema public to service_role, anon, authenticated;
SQL
for f in "$repo"/supabase/migrations/*.sql; do echo "migration: $(basename "$f")"; psql_run -f "$f"; done
psql_run -f "$repo/supabase/tests/fixture.sql"
for f in database.sql office_actions.sql office_more.sql office_log_settings.sql office_files.sql; do echo "test: $f"; psql_run -f "$repo/supabase/tests/$f"; done
echo 'SQL tests passed'
