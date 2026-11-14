# Nelio Supabase backend (0.6.0)

This backend replaces Apps Script and Sheets for the existing client page. Stage 6.1 adds an office-only read API and a Google Auth login page. The complete office dashboard and stage 7 scheduler/email delivery are not implemented yet.

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

## Office actions (stage 6.3.1, `nelio-office` 0.7.0)

- Write actions: `reject` (per file, D48), `approve`, `completeManual`, `whatsapp` (preview with `dryRun`, then logged and counted), `rotateLink`. Every call passes the same Google office check as the reads (D45), and names the staff member working now (`actor`, log only, not a permission).
- All state changes happen in one routine, `nelio_office_action` (migration `20261112120000_nelio_office_actions.sql`), executable only by `service_role`. It follows the allowed transitions in `project/data-model.md` 3.1 and 3.2, writes `activity_log`, and records messages as `simulated` in demo mode. No RLS or grant changes.
- D47: `clients.token_enc` holds the personal-link token encrypted with AES-256-GCM, bound to the client id. Only `nelio-office` encrypts or decrypts, with the Edge secret `NELIO_LINK_KEY` (32 random bytes, base64, e.g. `openssl rand -base64 32`). The ciphertext never reaches the browser and the token never reaches the log. Without the secret, rotation answers `LINK_KEY_MISSING` and messages point to the link in the client's email.
- Stage 6.3.2 (`nelio-office` 0.7.1, migration `20261112160000_nelio_office_more.sql`): `remindNow` (REMINDER_1, demo-recorded), `callList` / `callDone` (today's call list; a call is a log entry only), `uploadStart` / `uploadFinish` (upload on the client's behalf: the database reserves the path, the server returns a signed Storage upload URL for that exact path, the browser PUTs the bytes, and the database confirms only when the object exists with the reserved size).
- Stage 6.3.3 (`nelio-office` 0.7.2, migration `20261113100000_nelio_office_log_settings.sql`): `logList` (activity log merged with messages, per cycle, newest 500) and `settingsGet` / `settingsSave` / `templateSave` (nine listed settings only, with order and quiet-hour rules; a template that carried `[קישור]` must keep it; every change logged). Request bodies may now be up to 8 KB for message templates.
- Stage 6.3.4 (`nelio-office` 0.7.3, migration `20261113120000_nelio_office_files.sql`): `zipFiles` returns the ready files of one scope (request, one document type of a request, one client in all cycles, one cycle for all clients), up to 1,000, without storage identifiers, and logs `office_export` unless `dryRun`. The browser (`docs/office/zip-export.js`) fetches each file through `openFile` and writes a store-only ZIP with UTF-8 names (D49).
- Stage 7.1 (migration `20261113200000_nelio_stage7_calendar.sql`, 0.8.0, not deployed yet): read-only helpers for the monthly cycle. `nelio_next_allowed` (quiet hours, Shabbat, holidays, Friday and holiday-eve cutoff, Asia/Jerusalem), `nelio_cycle_plan` (the six steps of a cycle, planned and actual send times, shifted and colliding steps; it reports, it does not decide), `nelio_cycle_period` (monthly and bimonthly periods), `nelio_missing_text` and `nelio_needs_reminder`. No table, grant or RLS change; service role only. The plan and the open decisions: `project/stage-7.md`.
- Local SQL tests: `bash supabase/tests/run_sql_tests.sh` applies every migration to a throwaway PostgreSQL with stubs for the Supabase roles and storage, then runs `database.sql`, the office tests and `stage7_calendar.sql`. CI runs it on every pull request.

## Deploy

The initial development deployment was applied through the connected Supabase tools. Migration filenames match the remote migration history.

For repeatable deployments from GitHub, set repository secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, then run **Deploy Supabase** on `main`. This workflow is manual until those credentials are configured and verified. The CLI is pinned to 2.83.0 because v3 changed deployment behavior. No paid plan is needed by this implementation.

```sh
npx --yes supabase@2.83.0 link --project-ref ryqcyjajdioaxtpbxjzf
npx --yes supabase@2.83.0 db push --linked
npx --yes supabase@2.83.0 functions deploy nelio-api --project-ref ryqcyjajdioaxtpbxjzf
npx --yes supabase@2.83.0 functions deploy nelio-office --project-ref ryqcyjajdioaxtpbxjzf
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

## Cutover status (2026-11-10)

- PR #1 was squash-merged to `main` at `e26a12a6c0b0154632682b3516edb9439dd54430` by explicit user direction (decision D44). The versioned website source now selects the deployed `nelio-api` endpoint.
- Before merge, six live legacy Sheet row counts matched the corresponding imported snapshot totals: 60 clients, 158 requests, 900 items, 1,028 uploads, 494 messages and 1,241 log entries. **No row-by-row or field-level delta check was done**, per D44. Keep legacy data and archive for recovery; do not destroy or blindly re-import it.
- The backend deployment already existed and did not require a new database migration at cutover. GitHub Pages publication and a physical-device smoke test still need independent verification. Do not declare stage 5 complete before the physical test.
- Historic Drive files are preserved; new uploads use private Supabase Storage. Do not activate both legacy and Supabase backends for new writes.
- Later: stage 6 authenticated office dashboard, stage 7 email and scheduling. GitHub Actions deployment secrets may be configured separately before future automated backend deployments.

## Stage 6.1: office access (pending live OAuth setup)

- The new `nelio-office` Edge Function is separate from client upload function `nelio-api`; it checks a bearer token against Supabase Auth for every request and only authorizes the verified Google identity for `shedmi.cpa@gmail.com`.
- `docs/office/` has a read-only login/overview page, using only a publishable browser key. The service-role key stays on the Edge Function server. `public` tables retain restrictive RLS policies; no SQL migration was required.
- Configure Google OAuth and the allowed redirect URL as described in `project/stage-6-1.md` before expecting sign-in to work. A signed-in Google user without the office identity still gets a 403.
- For the first-time deployment, deploy the separate function `nelio-office` after reviewing/merging the PR, then validate negative security tests before checking authorized access. Do not publish credentials or create a new paid service.
- Tests: `node --experimental-strip-types --test supabase/tests/office_auth.test.mjs` and `node --check docs/office/app.js`.
