-- Nelio 0.6.0: typed legacy model, private by default. No tokens or customer data.

create extension if not exists pgcrypto with schema extensions;

create table public.settings (
  "key" text primary key,
  "value" text not null default '',
  "description" text not null default ''
);

alter table public.settings enable row level security;

revoke all on public.settings from anon, authenticated;

grant all on public.settings to service_role;

create table public.staff (
  "staff_id" text primary key,
  "name" text not null default '',
  "role" text not null default '',
  "email" text not null default '',
  "active" boolean not null default false
);

alter table public.staff enable row level security;

revoke all on public.staff from anon, authenticated;

grant all on public.staff to service_role;

create table public.doc_types (
  "doc_type_id" text primary key,
  "name_he" text not null default '',
  "description_he" text not null default '',
  "required" boolean not null default false,
  "file_label" text not null default '',
  "sort_order" bigint not null default 0 check (sort_order >= 0)
);

alter table public.doc_types enable row level security;

revoke all on public.doc_types from anon, authenticated;

grant all on public.doc_types to service_role;

create table public.profiles (
  "profile_id" text primary key,
  "name_he" text not null default '',
  "applies_when" text not null default '',
  "doc_types" text not null default ''
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;

grant all on public.profiles to service_role;

create table public.templates (
  "template_id" text primary key,
  "name_he" text not null default '',
  "recipient" text not null default '',
  "subject" text not null default '',
  "body" text not null default ''
);

alter table public.templates enable row level security;

revoke all on public.templates from anon, authenticated;

grant all on public.templates to service_role;

create table public.holidays (
  "date" date primary key,
  "name" text not null default ''
);

alter table public.holidays enable row level security;

revoke all on public.holidays from anon, authenticated;

grant all on public.holidays to service_role;

create table public.clients (
  "client_id" text primary key,
  "business_name" text not null default '',
  "contact_name" text not null default '',
  "email" text not null default '',
  "phone" text not null default '',
  "profile_id" text references public.profiles(profile_id),
  "has_employees" boolean not null default false,
  "frequency" text not null default '',
  "legal_type" text not null default '',
  "bookkeeper_id" text references public.staff(staff_id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  "token_created_at" timestamptz,
  "active" boolean not null default false,
  "drive_folder_id" text not null default '',
  "notes" text not null default '',
  check (frequency in ('monthly','bimonthly'))
);

alter table public.clients enable row level security;

revoke all on public.clients from anon, authenticated;

grant all on public.clients to service_role;

create index clients_profile_id_idx on public.clients(profile_id);

create index clients_bookkeeper_id_idx on public.clients(bookkeeper_id);

create table public.cycles (
  "cycle_id" text primary key,
  "due_date" date,
  "includes_bimonthly" boolean not null default false,
  "status" text not null default '',
  "opened_at" timestamptz,
  "closed_at" timestamptz,
  "reminder1_sent_at" timestamptz,
  "reminder2_sent_at" timestamptz,
  "last_day_sent_at" timestamptz,
  "call_list_sent_at" timestamptz,
  "summary_sent_at" timestamptz,
  check (status in ('open','closed'))
);

alter table public.cycles enable row level security;

revoke all on public.cycles from anon, authenticated;

grant all on public.cycles to service_role;

create table public.requests (
  "request_id" text primary key,
  "cycle_id" text references public.cycles(cycle_id),
  "client_id" text references public.clients(client_id),
  "period" text not null default '',
  "status" text not null default '',
  "reminder_count" bigint not null default 0 check (reminder_count >= 0),
  "last_reminder_at" timestamptz,
  "last_activity" text not null default '',
  "last_activity_at" timestamptz,
  "client_note" text not null default '',
  "submitted_at" timestamptz,
  "completed_at" timestamptz,
  "completed_by" text not null default '',
  "completion_note" text not null default '',
  "drive_folder_id" text not null default '',
  unique(cycle_id, client_id),
  unique(request_id, client_id),
  check (status in ('not_started','partial','submitted','complete'))
);

alter table public.requests enable row level security;

revoke all on public.requests from anon, authenticated;

grant all on public.requests to service_role;

create index requests_cycle_id_idx on public.requests(cycle_id);

create index requests_client_id_idx on public.requests(client_id);

create table public.items (
  "item_id" text primary key,
  "request_id" text references public.requests(request_id),
  "doc_type_id" text references public.doc_types(doc_type_id),
  "required" boolean not null default false,
  "status" text not null default '',
  "file_count" bigint not null default 0 check (file_count >= 0),
  "na_note" text not null default '',
  "reject_reason" text not null default '',
  "updated_at" timestamptz,
  "updated_by" text not null default '',
  "last_seq" bigint not null default 0 check (last_seq >= 0),
  unique(request_id,doc_type_id),
  unique(item_id,request_id),
  check (status in ('missing','received','rejected','not_applicable'))
);

alter table public.items enable row level security;

revoke all on public.items from anon, authenticated;

grant all on public.items to service_role;

create index items_request_id_idx on public.items(request_id);

create index items_doc_type_id_idx on public.items(doc_type_id);

create table public.uploads (
  "upload_id" text primary key,
  "uploaded_at" timestamptz,
  "item_id" text references public.items(item_id),
  "request_id" text references public.requests(request_id),
  "client_id" text references public.clients(client_id),
  "uploaded_by" text not null default '',
  "original_name" text not null default '',
  "stored_name" text not null default '',
  "seq" bigint not null default 0 check (seq >= 0),
  "drive_file_id" text not null default '',
  "mime_type" text not null default '',
  "size_bytes" bigint not null default 0 check (size_bytes >= 0),
  "file_hash" text not null default '',
  "duplicate_of" text not null default '',
  "upload_key" text not null default '',
  "status" text not null default '',
  storage_path text unique,
  storage_provider text not null default 'drive' check (storage_provider in ('drive','supabase')),
  ingest_status text not null default 'ready' check (ingest_status in ('pending','ready')),
  unique(item_id,seq),
  foreign key(item_id,request_id) references public.items(item_id,request_id),
  foreign key(request_id,client_id) references public.requests(request_id,client_id),
  check (status in ('active','rejected'))
);

alter table public.uploads enable row level security;

revoke all on public.uploads from anon, authenticated;

grant all on public.uploads to service_role;

create index uploads_item_id_idx on public.uploads(item_id);

create index uploads_request_id_idx on public.uploads(request_id);

create index uploads_client_id_idx on public.uploads(client_id);

create table public.messages (
  "message_id" text primary key,
  "created_at" timestamptz,
  "send_after" timestamptz,
  "template_id" text references public.templates(template_id),
  "cycle_id" text references public.cycles(cycle_id),
  "request_id" text references public.requests(request_id),
  "client_id" text references public.clients(client_id),
  "staff_id" text references public.staff(staff_id),
  "to_email" text not null default '',
  "subject" text not null default '',
  "body" text not null default '',
  "status" text not null default '',
  "sent_at" timestamptz,
  "note" text not null default '',
  "created_by" text not null default '',
  check (status in ('queued','sent','simulated','cancelled','failed'))
);

alter table public.messages enable row level security;

revoke all on public.messages from anon, authenticated;

grant all on public.messages to service_role;

create index messages_template_id_idx on public.messages(template_id);

create index messages_cycle_id_idx on public.messages(cycle_id);

create index messages_request_id_idx on public.messages(request_id);

create index messages_client_id_idx on public.messages(client_id);

create index messages_staff_id_idx on public.messages(staff_id);

create table public.activity_log (
  id bigint generated always as identity primary key,
  "at" timestamptz,
  "real_at" timestamptz,
  "actor" text not null default '',
  "event" text not null default '',
  "client_id" text not null default '',
  "request_id" text not null default '',
  "item_id" text not null default '',
  "details" text not null default ''
);

alter table public.activity_log enable row level security;

revoke all on public.activity_log from anon, authenticated;

grant all on public.activity_log to service_role;

create unique index cycles_one_open on public.cycles(status) where status='open';

create unique index uploads_retry_key on public.uploads(request_id,upload_key) where upload_key <> '';

create index uploads_hash on public.uploads(request_id,file_hash);

create index messages_confirmation on public.messages(request_id,template_id);

create index activity_log_request on public.activity_log(request_id,at);

create table public.api_limits (client_id text primary key references public.clients(client_id), window_start timestamptz not null, calls integer not null);

alter table public.api_limits enable row level security;

revoke all on public.api_limits from anon, authenticated;

grant all on public.api_limits to service_role;

grant usage, select on sequence public.activity_log_id_seq to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values ('nelio-documents','nelio-documents',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']) on conflict(id) do nothing;
