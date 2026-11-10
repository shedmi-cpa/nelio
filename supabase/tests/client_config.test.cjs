const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const root = resolve(__dirname, '../..');
const app = readFileSync(resolve(root, 'docs/app.js'), 'utf8');
const token = 'fictional_migration_test_token_12345';

function configuredUrl(path) {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(resolve(root, path), 'utf8'), context);
  return context.window.NELIO_CONFIG.apiUrl;
}

async function openPage(apiUrl, hash = '#t=' + token) {
  const elements = new Map();
  const requests = [];
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { addEventListener() {}, textContent: '', hidden: false });
      return elements.get(id);
    },
  };
  vm.runInNewContext(app, {
    document, URLSearchParams,
    window: { NELIO_CONFIG: { apiUrl }, location: { hash }, addEventListener() {} },
    async fetch(url, options) {
      requests.push({ url, method: options.method, body: JSON.parse(options.body) });
      return { async text() { return JSON.stringify({ ok: false, code: 'BAD_TOKEN', message: 'קישור בדיקה לא פעיל' }); } };
    },
  });
  await new Promise(setImmediate);
  return { requests, title: document.getElementById('message-title').textContent };
}

test('The shipped Supabase configuration reaches the API with the personal-link token', async () => {
  const apiUrl = configuredUrl('docs/config.js');
  assert.match(apiUrl, /\.supabase\.co\/functions\/v1\/nelio-api$/);
  const page = await openPage(apiUrl);
  assert.deepEqual(page.requests, [{ url: apiUrl, method: 'POST', body: { action: 'hello', token } }]);
  assert.equal(page.title, 'הקישור לא פעיל');
});

test('The preserved Apps Script configuration remains usable for controlled rollback', async () => {
  const apiUrl = configuredUrl('supabase/legacy-config.js');
  const page = await openPage(apiUrl);
  assert.equal(page.requests.length, 1);
  assert.equal(page.requests[0].url, apiUrl);
  assert.equal(page.title, 'הקישור לא פעיל');
});

test('A missing personal link shows the link error with the Supabase configuration', async () => {
  const page = await openPage(configuredUrl('docs/config.js'), '');
  assert.equal(page.title, 'הקישור לא שלם');
  assert.equal(page.requests.length, 0);
});

test('Missing configuration never sends the token', async () => {
  const page = await openPage('');
  assert.equal(page.title, 'השרת עוד לא מחובר');
  assert.equal(page.requests.length, 0);
});

test('Malformed or lookalike Supabase endpoints never receive the token', async () => {
  for (const url of [
    'http://ryqcyjajdioaxtpbxjzf.supabase.co/functions/v1/nelio-api',
    'https://ryqcyjajdioaxtpbxjzf.supabase.co.example.test/functions/v1/nelio-api',
    'https://ryqcyjajdioaxtpbxjzf.supabase.co/functions/v1/other-function',
  ]) {
    const page = await openPage(url);
    assert.equal(page.title, 'השרת עוד לא מחובר');
    assert.equal(page.requests.length, 0);
  }
});
