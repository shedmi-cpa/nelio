# Nelio Supabase backend (0.6.0)

This backend replaces Apps Script and Sheets for the existing client page. It does not implement the stage 6 office dashboard or stage 7 scheduler/email delivery.

## Architecture

- `docs/` remains a static Hebrew RTL client on GitHub Pages.
- `nelio-api` is a Deno Edge Function with custom personal-link authentication. `verify_jwt=false` is intentional: clients have no Supabase Auth login. Every operation validates the personal token in PostgreSQL.
- Tokens are SHA-256 hashes in `clients.token_hash`; existing links continue to work. No browser key, service key, token, or export belongs in this repository.
- All 14 public tables have RLS enabled, no client policies, and no `anon`/`authenticated` grants. Only the server's `service_role` accesses them. All SQL routines use SECURITY INVOKER, a fixed search path, and service-role-only execution.
- The 13 business tables map to the legacy tabs; `api_limits` adds a durable per-client limit (120 calls/minute). Requests serialize per client/request to prevent conflicting counters and duplicate confirmations.
- Existing files remain private in Drive, identified by `uploads.drive_file_id`. New uploads go to the private `nelio-documents` bucket. `storage_provider` distinguishes them. Names shown/downloaded remain Hebrew; internal Storage paths use stable ASCII IDs.
- A new upload first reserves an ID and sequence, then saves its bytes, then marks the database row ready. Missing objects cannot become received. A retry reuses the same reservation and validates its content hash. Pending rows remain retryable; they do not affect `file_count`.
- Same content with a different upload key is accepted with a duplicate warning. Historical files use the legacy hash of base64, so cross-backend duplicate detection requires rehashing old bytes later.
- Maximum upload: 10 MiB (or lower Settings limit). Per request: 200 files/reservations and 250 MiB. File signatures and MIME allowlists are checked on the server.
- Confirmation messages retain the old semantics: once per request, simulated in demo mode, queued otherwise. No mail is sent by this backend. Quiet-hour handling and actual delivery remain stage 7.

## Deploy

The initial development deployment was applied through the connected Supabase tools. Migration filenames match the remote migration history.

For repeatable deployments from GitHub, set repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, then run **Deploy Supabase** on `main`. This workflow is manual until those credentials are configured and verified. The CLI is pinned to 2.83.0 because v3 changed deployment behavior. No paid plan is needed by this implementation.

```sh
npx --yes supabase@2.83.0 link --project-ref ryqcyjajdioaxtpbxjzf
npx --yes supabase@2.83.0 db push --linked
npx --yes supabase@2.83.0 functions deploy nelio-api --project-ref ryqcyjajdioaxtpbxjzf
```

Do not reapply an already recorded migration. Future changes get a new migration with `supabase migration new <name>`.

## Import an existing sheet

`tools/prepare-import.py` accepts a JSON object keyed by exact legacy tab names, with each value a Sheets Values array (header first), exported using `UNFORMATTED_VALUE`.

```sh
python supabase/tools/prepare-import.py /private/sheets.json /private/import
```

The tool converts Sheets serial dates in Asia/Jerusalem, hashes tokens, excludes `test_link` settings, and preserves Drive IDs, notes, message history and logs. Apply the generated batches in filename order **once to an empty schema**, then verify counts and relationships. Do not commit the export or generated SQL, which contains private links and message history. The importer intentionally refuses paths inside the public repository. Re-running inserts is not an update operation.

The pre-cutover snapshot contained 60 clients, 158 requests, 900 items, 1,028 uploads, 494 messages and 1,241 log entries. Historical documents were not copied or deleted. The legacy spreadsheet is unchanged. Until cutover, the public site still writes to the legacy spreadsheet. Reconcile changes before switching; after cutover, retain the spreadsheet as an archive rather than a second writable source.

## Verification

```sh
npx --yes deno@2.5.6 check supabase/functions/nelio-api/index.ts
npx --yes deno@2.5.6 test supabase/tests/core_test.ts
node --check docs/app.js
node --test supabase/tests/client_config.test.cjs
```

- `tests/client_config.test.cjs`: exercises client startup with the shipped Supabase and legacy configurations, missing links, and invalid endpoints. Uses a mocked API and no dependencies.
- `tests/database.sql`: transactional integration checks against seeded development data; rolls back all test changes. Run via SQL editor or connected execute_sql.
- `tests/live_api.py`: opt-in live HTTP/Storage test. Requires `NELIO_TEST_TOKEN` for a dedicated client named `בדיקת מעבר אוטומטית`, with the SERVICE document list. Uses Pillow for a document labeled לדוגמה; never run it on an office client. It creates test files and audit entries. Repeated runs preserve prior test uploads.
- Supabase advisors report `rls_enabled_no_policy` informational entries by design: direct browser access is denied. Do not add permissive policies to suppress these notices.
- Real phone camera/gallery, cellular disconnect, iPhone format conversion and end-user timing still need a physical phone.

## Recovery

- A transient Storage/DB interruption leaves a pending upload. Retry with the same key; never manually mark it ready. Investigate old pending rows before any housekeeping; don't delete business documents.
- Storage and database are separate services. A cycle closure between reservation and finalization can leave a pending object; stage 6/7 administrative recovery must reconcile it.
- `legacy-config.js` records the previous endpoint for emergency rollback. Restoring it alone does **not** reconcile uploads/notes created after cutover; first preserve and reconcile those changes. Never run both backends as simultaneous writable sources.
- The legacy deployment workflow is manual only. The former clasp secret is not used by Supabase; removing it is a separate account cleanup step.

## Cutover hold

The package was applied to `migration/supabase-0-6-0`, based on commit `9581afc902e64c450bd812dd34176a01da44891a`. GitHub branch creation now succeeds. The PR to `main` must remain open with no merge or auto-merge until changes in the legacy sheet since the snapshot have been checked and reconciled as needed. The public Pages frontend still uses Apps Script.

The package's client startup guard accepted only Apps Script URLs. It now accepts the Supabase `nelio-api` endpoint too; the startup regression tests cover both configurations and invalid endpoints.

Current verification: Deno type check and 5 tests, 5 Node client startup tests, JavaScript syntax, Python compilation, all 13 transactional SQL assertions, and a mocked Chromium smoke check passed. SQL changes were rolled back and no QA_SQL records remain. The opt-in HTTP/Storage test was not rerun: its dedicated QA token is unavailable and QA_MIGRATION is disabled. Physical-phone checks remain pending.

Before publishing, compare the legacy sheet with the imported snapshot and reconcile any changes since the export. The importer is for an empty database and must not be rerun blindly on the already imported database. No automated incremental synchronization exists yet.
