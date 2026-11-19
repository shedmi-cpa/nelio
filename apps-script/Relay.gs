/**
 * Nelio · the mail relay (D53, stage 7.3). The only job Apps Script still has.
 *
 * Supabase cannot send email (its Edge Functions block the mail ports), so every minute this
 * script asks the office server (nelio-office) which emails are due, sends them from the office's
 * Gmail, and reports back "sent" or "failed". It decides nothing: who gets a real email, when, and
 * with which text is decided in the database (D58, D63). It does not touch the spreadsheet.
 *
 * Setting up, once, in the Apps Script editor (no code is edited here, D30):
 *   1. Office board, tab "מצב הדגמה": "יצירת סוד לשליח המיילים". Copy the secret.
 *   2. Project Settings (gear) > Script Properties > Add: NELIO_RELAY_SECRET = the secret.
 *   3. Editor: choose relaySetup and click Run. Approve the permissions (send email as you,
 *      connect to an external service, run on a schedule). It sends whatever is due and
 *      creates the one-minute trigger.
 * To stop: run relayStop.
 */

const RELAY = {
  url: 'https://ryqcyjajdioaxtpbxjzf.supabase.co/functions/v1/nelio-office',
  secretProperty: 'NELIO_RELAY_SECRET',
  everyMinutes: 1,
};

// Creates the trigger (once) and runs one round now, so mistakes show right away.
function relaySetup() {
  if (!PropertiesService.getScriptProperties().getProperty(RELAY.secretProperty)) {
    throw new Error('Add the script property ' + RELAY.secretProperty + ' first (Project Settings > Script Properties).');
  }
  relayStop();
  ScriptApp.newTrigger('relayRun').timeBased().everyMinutes(RELAY.everyMinutes).create();
  const result = relayRun();
  Logger.log('The relay is on. Sent now: ' + result.sent + ', failed: ' + result.failed + '.');
}

function relayStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'relayRun') ScriptApp.deleteTrigger(t);
  });
}

// One round: get the due emails, send each, report back. One round at a time.
function relayRun() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { sent: 0, failed: 0 };
  try {
    const pulled = relayCall_({ action: 'relayPull' });
    const results = [];
    let sent = 0;
    let failed = 0;
    (pulled.messages || []).forEach(function (m) {
      try {
        MailApp.sendEmail({ to: m.to, subject: m.subject, body: m.text, htmlBody: m.html, name: pulled.officeName || undefined });
        results.push({ id: m.id, ok: true });
        sent++;
      } catch (err) {
        results.push({ id: m.id, ok: false, error: String(err && err.message || err).slice(0, 200) });
        failed++;
      }
    });
    if (results.length) relayCall_({ action: 'relayReport', results: results });
    return { sent: sent, failed: failed };
  } finally {
    lock.releaseLock();
  }
}

function relayCall_(payload) {
  const secret = PropertiesService.getScriptProperties().getProperty(RELAY.secretProperty);
  if (!secret) throw new Error('Missing script property ' + RELAY.secretProperty);
  const response = UrlFetchApp.fetch(RELAY.url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Nelio-Relay': secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const code = response.getResponseCode();
  let data = {};
  try { data = JSON.parse(response.getContentText()); } catch (err) { data = {}; }
  if (code !== 200 || !data.ok) throw new Error('nelio-office answered ' + code + ' ' + (data.code || ''));
  return data;
}
