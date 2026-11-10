import {createOfficeHandler} from './core.ts';
const env={
 url:Deno.env.get('SUPABASE_URL')||'',
 anonKey:Deno.env.get('SUPABASE_ANON_KEY')||'',
 serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'',
 driveCredentials:Deno.env.get('NELIO_DRIVE_SERVICE_ACCOUNT_JSON')||'',
};
// This is separate from the customer upload API. Never expose the service key in a browser.
Deno.serve(createOfficeHandler(env));
