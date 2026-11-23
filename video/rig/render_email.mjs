// Prints the branded email exactly as the relay sends it (renderEmail in nelio-office/core.ts).
// Input on stdin: {"body": "...", "link": "...", "officeName": "..."}. The office address is left
// out on purpose: Fiverr does not allow contact details in the video.
import path from 'node:path';
const REPO = process.env.NELIO_REPO || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const {renderEmail} = await import(path.join(REPO, 'supabase/functions/nelio-office/core.ts'));
let raw = ''; for await (const c of process.stdin) raw += c;
const x = JSON.parse(raw);
process.stdout.write(renderEmail(x.body, x.link, x.officeName, '').html);
