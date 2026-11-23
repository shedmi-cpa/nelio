// Nelio video rig: the real server code (both edge functions, unchanged) on a local copy of the
// demo database, with a small stand-in for the parts of Supabase it talks to (auth, the REST
// reads, the RPC calls and private Storage). Nothing here reaches the live system.
//
//   node --experimental-strip-types server.mjs        (listens on http://localhost:8787)
//
// The browser (capture.py) sends every request for the Supabase host here, unchanged.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO = process.env.NELIO_REPO || path.resolve(HERE, '../..');
const SUPA = 'https://ryqcyjajdioaxtpbxjzf.supabase.co';
const STORE = process.env.NELIO_STORE || path.join(HERE, 'work/store');
const ASSETS = process.env.NELIO_ASSETS || path.join(HERE, 'work/demo-assets');
const MAP = JSON.parse(fs.readFileSync(path.join(HERE, 'work/assets-map.json'), 'utf8'));
const pool = new pg.Pool({host: 'localhost', port: Number(process.env.NELIO_PG_PORT || 54329), user: 'postgres', database: 'nelio', max: 4});
pool.on('connect', c => c.query("set timezone='UTC'"));

const OFFICE_USER = {id: '00000000-0000-4000-8000-000000000001', email: 'shedmi.cpa@gmail.com', email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: {providers: ['google']}, identities: [{provider: 'google'}]};
const TABLES = new Set(['requests', 'clients', 'staff', 'items', 'uploads', 'doc_types', 'templates', 'cycles', 'settings', 'messages']);
const STORAGE_CORS = {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': '*', 'Access-Control-Expose-Headers': '*'};

const json = (v, status = 200, extra = {}) => new Response(JSON.stringify(v), {status, headers: {'Content-Type': 'application/json', ...extra}});
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw Error('bad identifier ' + s); return '"' + s + '"'; };

// A small part of PostgREST: select, eq., in.(), order and limit. That is all the office code uses.
async function restRead(table, params) {
  if (!TABLES.has(table)) return json({message: 'unknown table'}, 404);
  const cols = (params.get('select') || '*').split(',').map(c => c === '*' ? '*' : ident(c)).join(',');
  const where = [], args = [];
  let order = '', limit = '';
  for (const [k, v] of params) {
    if (k === 'select') continue;
    if (k === 'order') { const [c, dir] = v.split('.'); order = ' order by ' + ident(c) + (dir === 'desc' ? ' desc' : ' asc'); continue; }
    if (k === 'limit') { limit = ' limit ' + Number(v); continue; }
    if (v.startsWith('eq.')) { args.push(v.slice(3)); where.push(ident(k) + '::text = $' + args.length); continue; }
    if (v.startsWith('in.(')) { args.push(v.slice(4, -1).split(',')); where.push(ident(k) + '::text = any($' + args.length + ')'); continue; }
    throw Error('unsupported filter ' + k + '=' + v);
  }
  const sql = 'select coalesce(json_agg(t), \'[]\'::json) as rows from (select ' + cols + ' from public.' + ident(table) +
    (where.length ? ' where ' + where.join(' and ') : '') + order + limit + ') t';
  const {rows} = await pool.query(sql, args);
  return json(rows[0].rows);
}

function storagePath(p, prefix) {
  const rest = decodeURIComponent(p.slice(prefix.length));
  if (rest.split('/').some(s => s === '..' || s === '')) throw Error('bad path');
  return rest;
}
function fileFor(name) {
  const own = path.join(STORE, name);
  if (fs.existsSync(own)) return own;
  if (MAP[name]) return path.join(ASSETS, MAP[name]);
  return null;
}
async function saveObject(name, bytes) {
  fs.mkdirSync(path.dirname(path.join(STORE, name)), {recursive: true});
  fs.writeFileSync(path.join(STORE, name), bytes);
  await pool.query('delete from storage.objects where bucket_id=$1 and name=$2', ['nelio-documents', name]);
  await pool.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)', ['nelio-documents', name, {size: bytes.length}]);
}
const MIME = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf'};

async function fakeSupabase(req) {
  const url = new URL(req.url), p = url.pathname;
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: STORAGE_CORS});
  if (p === '/auth/v1/user') return json(OFFICE_USER);
  if (p.startsWith('/rest/v1/rpc/')) {
    const name = p.slice('/rest/v1/rpc/'.length);
    if (!/^nelio_[a-z_]+$/.test(name)) return json({message: 'unknown rpc'}, 404);
    const body = await req.json();
    const {rows} = await pool.query('select public.' + ident(name) + '($1::jsonb) as r', [JSON.stringify(body.p)]);
    return json(rows[0].r);
  }
  if (p.startsWith('/rest/v1/')) return restRead(p.slice('/rest/v1/'.length), url.searchParams);
  // Storage. Signed addresses carry a token in the real system; here any token opens the file.
  if (p.startsWith('/storage/v1/object/upload/sign/nelio-documents/')) {
    const name = storagePath(p, '/storage/v1/object/upload/sign/nelio-documents/');
    if (req.method === 'POST') return json({url: '/object/upload/sign/nelio-documents/' + name + '?token=local'});
    await saveObject(name, Buffer.from(await req.arrayBuffer()));
    return json({Key: 'nelio-documents/' + name}, 200, STORAGE_CORS);
  }
  if (p.startsWith('/storage/v1/object/sign/nelio-documents/')) {
    const name = storagePath(p, '/storage/v1/object/sign/nelio-documents/');
    if (req.method === 'POST') return json({signedURL: '/object/sign/nelio-documents/' + name + '?token=local'});
    const file = fileFor(name);
    if (!file) return json({message: 'not found'}, 404, STORAGE_CORS);
    const {rows} = await pool.query('select mime_type from public.uploads where storage_path=$1', [name]);
    const type = rows[0]?.mime_type || MIME[path.extname(file)] || 'application/octet-stream';
    return new Response(fs.readFileSync(file), {headers: {'Content-Type': type, ...STORAGE_CORS}});
  }
  if (p.startsWith('/storage/v1/object/authenticated/nelio-documents/')) {
    const file = fileFor(storagePath(p, '/storage/v1/object/authenticated/nelio-documents/'));
    return file ? new Response(fs.readFileSync(file)) : json({message: 'not found'}, 404);
  }
  if (p.startsWith('/storage/v1/object/nelio-documents/') && req.method === 'POST') {
    const name = storagePath(p, '/storage/v1/object/nelio-documents/');
    if (fileFor(name) && fs.existsSync(path.join(STORE, name))) return json({statusCode: '409', error: 'Duplicate'}, 409);
    await saveObject(name, Buffer.from(await req.arrayBuffer()));
    return json({Key: 'nelio-documents/' + name});
  }
  return json({message: 'not here: ' + p}, 404);
}

// The edge functions run unchanged; Deno.serve only hands their handler to us.
const ENV = {SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-service',
  NELIO_LINK_KEY: crypto.randomBytes(32).toString('base64')};
let captured = null;
globalThis.Deno = {env: {get: k => ENV[k]}, serve: h => { captured = h; }};
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const req = input instanceof Request && !init ? input : new Request(input, init);
  return req.url.startsWith(SUPA + '/') && !req.url.includes('/functions/v1/') ? fakeSupabase(req) : realFetch(input, init);
};
await import(path.join(REPO, 'supabase/functions/nelio-api/index.ts'));
const apiHandler = captured;
await import(path.join(REPO, 'supabase/functions/nelio-office/index.ts'));
const officeHandler = captured;

http.createServer(async (nreq, nres) => {
  try {
    const chunks = [];
    for await (const c of nreq) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [k, v] of Object.entries(nreq.headers)) if (k !== 'host' && k !== 'content-length') headers.set(k, Array.isArray(v) ? v.join(',') : v);
    const req = new Request(SUPA + nreq.url, {method: nreq.method, headers, body: ['GET', 'HEAD'].includes(nreq.method) ? undefined : body});
    const p = new URL(req.url).pathname;
    const res = p === '/functions/v1/nelio-api' ? await apiHandler(req) : p === '/functions/v1/nelio-office' ? await officeHandler(req) : await fakeSupabase(req);
    const out = Buffer.from(await res.arrayBuffer());
    const h = {};
    res.headers.forEach((v, k) => { h[k] = v; });
    nres.writeHead(res.status, h);
    nres.end(out);
  } catch (e) {
    console.error('rig error', e);
    nres.writeHead(500, {'Content-Type': 'application/json'});
    nres.end(JSON.stringify({message: String(e)}));
  }
}).listen(Number(process.env.NELIO_RIG_PORT || 8787), () => console.log('Nelio rig on http://localhost:' + (process.env.NELIO_RIG_PORT || 8787)));
