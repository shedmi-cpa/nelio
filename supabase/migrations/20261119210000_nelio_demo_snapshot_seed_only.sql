-- Nelio 0.9.1: only the 60 demo clients (C01–C60) belong to the opening snapshot (D59, D64).
-- The live rehearsal found one more request in October: a test client added after the import
-- (supabase/tests/live_api.py). After "אפס את הדמו" the month shows 60 clients, as in the video.
delete from nelio_demo.uploads where client_id !~ '^C[0-9]{2}$';
delete from nelio_demo.messages where coalesce(client_id, '') <> '' and client_id !~ '^C[0-9]{2}$';
delete from nelio_demo.items where request_id in (select request_id from nelio_demo.requests where client_id !~ '^C[0-9]{2}$');
delete from nelio_demo.requests where client_id !~ '^C[0-9]{2}$';
delete from nelio_demo.activity_log where client_id <> '' and client_id !~ '^C[0-9]{2}$';
