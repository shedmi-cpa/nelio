/**
 * Nelio · server · Google Apps Script, bound to the "Nelio – נתונים" spreadsheet.
 *
 * The files of the server:
 *   Code.gs      The API of the client page, and the shared helpers (this file).
 *   Setup.gs     The 13 tabs of data-model.md and their default rows. setup() runs from the editor.
 *   Messages.gs  The templates of the messages, and how a message is written from a template.
 *   Seed.gs      The demo office (D36, D37): seedDemo() runs from the editor.
 *
 *   doGet()   Health check. Opening the web app address in a browser shows that the server is up.
 *   doPost()  The API of the client page: "hello" checks the link and says which month is open,
 *             "upload" saves one file in the client's folder for the month and records it.
 *   onEdit()  Runs by itself when someone edits the sheet, so the server forgets old copies.
 *
 * The source of truth is apps-script/ in github.com/shedmi-cpa/nelio.
 * A push to main that changes apps-script/ deploys the server by itself
 * (.github/workflows/deploy-server.yml, D30): clasp uploads the code and deploys a new version
 * to the same address. Do not edit the code in the Apps Script editor: the next push
 * replaces everything there with the files from GitHub.
 */

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  version: '0.3.1',
  officeEmail: 'shedmi.cpa@gmail.com',   // setup() refuses to run from any other account
  timeZone: 'Asia/Jerusalem',
  clientPageUrl: 'https://shedmi-cpa.github.io/nelio/',
  rootFolderName: 'שדמי – מסמכי לקוחות',
  rejectedFolderName: 'נדחו',            // D31: a rejected file moves here, inside the month folder
  defaultMaxFileMb: 10,                  // D32: covers real documents, and uploads stay far from the page's time limit
  lockTimeoutMs: 30000,
  cacheSeconds: 600,                     // 10 minutes (D29)
};

// Israeli format, 24-hour clock (rules.md). The same format, spelled for two tools:
const SHEET_DATETIME_FORMAT = 'dd/mm/yyyy hh:mm:ss';  // Google Sheets number format
const SHEET_DATE_FORMAT = 'dd/mm/yyyy';
const TEXT_DATETIME_FORMAT = 'dd/MM/yyyy HH:mm:ss';   // Utilities.formatDate
const TEXT_DATE_FORMAT = 'dd/MM/yyyy';

const MONTHS_HE = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט',
  'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

// File types we accept: MIME type -> extension of the stored file.
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
};

// Used when the browser does not report a type (some phones do this for HEIC).
const EXTENSION_TYPES = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
};

// Until the full client page of stage 5 lets the client choose the type of each document,
// every upload goes to the request's "מסמך אחר".
const UPLOAD_DOC_TYPE = 'OTHER';

// Everything the client may see is in Hebrew (rules.md).
const MESSAGES = {
  badRequest: 'הבקשה לא תקינה.',
  badToken: 'הקישור הזה לא פעיל. לקבלת קישור חדש, פנו למשרד.',
  noRequest: 'אין כרגע מסמכים להעלות.',
  noFile: 'לא התקבל קובץ. נסו שוב.',
  badType: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
  badFile: 'הקובץ הגיע פגום. נסו להעלות אותו שוב.',
  emptyFile: 'הקובץ ריק.',
  tooBig: 'הקובץ גדול מדי. הגודל המקסימלי הוא {mb} מגה-בייט.',
  busy: 'המערכת עמוסה כרגע. נסו שוב בעוד רגע.',
  serverError: 'משהו השתבש אצלנו. נסו שוב בעוד כמה דקות.',
};

// ============================================================
// Web app: health check and API
// ============================================================

function doGet() {
  return json_({ ok: true, system: 'Nelio', version: CONFIG.version, serverTime: formatDateTime_(now_()) });
}

// The page sends JSON as plain text. That keeps it a "simple" request, without a CORS
// preflight, which Apps Script cannot answer.
function doPost(e) {
  const watch = newStopwatch_();
  let request = null;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(fail_('BAD_REQUEST', MESSAGES.badRequest));
  }
  watch.lap('parse');
  const action = request && typeof request === 'object' ? String(request.action || '') : '';
  try {
    if (action === 'hello') return json_(handleHello_(request, watch));
    if (action === 'upload') return json_(handleUpload_(request, watch));
    return json_(fail_('BAD_REQUEST', MESSAGES.badRequest));
  } catch (err) {
    logError_('doPost:' + action, err);
    return json_(fail_('SERVER_ERROR', MESSAGES.serverError));
  }
}

// The page calls this when it opens: is the link valid, and which month should it show?
function handleHello_(request, watch) {
  const client = findClientByToken_(request.token);
  if (!client) return fail_('BAD_TOKEN', MESSAGES.badToken);
  watch.lap('checks');
  const found = findOpenRequest_(client);
  watch.lap('cycle');
  const answer = {
    ok: true,
    businessName: client.businessName,
    officeName: getSetting_('office_name'),
    maxFileMb: getMaxFileMb_(),
    version: CONFIG.version,
  };
  watch.lap('settings');
  if (found) {
    answer.state = 'open';
    answer.periodLabel = periodLabel_(found.req.period);   // "אוקטובר 2026"
    answer.dueDate = found.cycle.dueDate ? formatDate_(new Date(found.cycle.dueDate)) : '';
  } else {
    // data-model.md 3.3: a client without a request in the open cycle, for example a
    // bimonthly client in an odd month.
    answer.state = 'noRequest';
    answer.message = MESSAGES.noRequest + nextRequestText_();
  }
  answer.serverMs = watch.totalMs();
  answer.timingText = formatLaps_(watch.laps());
  return answer;
}

// Data model, chapter 2, steps 4-10. Until stage 5, the file goes to the request's
// "מסמך אחר", which does not change the status of the request (data-model.md 3.1).
// The stopwatch times each step (D29). The times reach the page and the Log tab.
function handleUpload_(request, watch) {
  // Step 4: checks. If anything is wrong, nothing is saved.
  const client = findClientByToken_(request.token);
  if (!client) return fail_('BAD_TOKEN', MESSAGES.badToken);

  const originalName = cleanFileName_(request.fileName);
  const mimeType = resolveMimeType_(request.mimeType, originalName);
  if (!mimeType) return fail_('BAD_TYPE', MESSAGES.badType);
  const data = typeof request.data === 'string' ? request.data : '';
  if (!data) return fail_('NO_FILE', MESSAGES.noFile);
  // The size is known from the length of the text, so a file that is too big is turned away
  // before the slow part (decoding).
  const sizeBytes = base64Size_(data);
  if (sizeBytes <= 0) return fail_('EMPTY_FILE', MESSAGES.emptyFile);
  const maxMb = getMaxFileMb_();
  if (sizeBytes > maxMb * 1024 * 1024) {
    return fail_('TOO_BIG', MESSAGES.tooBig.replace('{mb}', maxMb));
  }
  const found = findOpenRequest_(client);
  if (!found) return fail_('NO_REQUEST', MESSAGES.noRequest + nextRequestText_());
  const docType = getDocTypes_()[UPLOAD_DOC_TYPE];
  if (!docType) throw new Error('חסר סוג המסמך ' + UPLOAD_DOC_TYPE + ' בלשונית DocTypes. הריצו את setup.');
  const cycleId = found.cycle.cycleId;
  const req = found.req;
  const itemId = req.requestId + '_' + UPLOAD_DOC_TYPE;
  watch.lap('checks');

  let blob;
  try {
    blob = Utilities.newBlob(Utilities.base64Decode(data), mimeType);
  } catch (err) {
    return fail_('BAD_FILE', MESSAGES.badFile);
  }
  watch.lap('decode');
  const fileHash = sha256OfText_(data);
  watch.lap('hash');

  // Step 5: one upload at a time, so two uploads never get the same number or row.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.lockTimeoutMs)) return fail_('BUSY', MESSAGES.busy);
  watch.lap('lock');
  try {
    const at = now_();
    // The item's row holds the last number given to its files (Items.last_seq), so the number
    // comes without searching Uploads (findings of stage 3.2).
    const item = readItem_(cycleId, itemId);
    if (!item) throw new Error('הפריט ' + itemId + ' לא נמצא בלשונית Items');
    watch.lap('item');

    // Step 6: Drive. The client's folder and the month folder are created on the first upload,
    // and from then on found by their saved IDs (D29), never searched by name.
    const folder = getRequestFolder_(client, req, cycleId);
    watch.lap('folder');
    const seq = (Number(item.record.last_seq) || 0) + 1;
    const storedName = buildFileName_(client, req.period, docType.fileLabel, seq, ALLOWED_TYPES[mimeType]);
    const file = folder.createFile(blob.setName(storedName));
    watch.lap('save');

    // Step 7: the item, a row in Uploads, and the request's last activity.
    item.record.status = 'received';
    item.record.file_count = (Number(item.record.file_count) || 0) + 1;
    item.record.updated_at = at;
    item.record.updated_by = 'client';
    item.record.last_seq = seq;
    writeRecordAt_('Items', item.row, item.record);
    const uploadId = itemId + '_' + pad2_(seq);
    appendRow_('Uploads', {
      upload_id: uploadId,
      uploaded_at: at,
      item_id: itemId,
      request_id: req.requestId,
      client_id: client.clientId,
      uploaded_by: 'client',
      original_name: originalName,
      stored_name: storedName,
      seq: seq,
      drive_file_id: file.getId(),
      mime_type: mimeType,
      size_bytes: sizeBytes,
      file_hash: fileHash,
      upload_key: String(request.uploadKey || '').slice(0, 64),
      status: 'active',
    });
    watch.lap('uploads');
    updateRecord_('Requests', req.row, 'request_id', req.requestId, {
      last_activity: 'העלה ' + docType.nameHe,
      last_activity_at: at,
    });
    watch.lap('request');

    // Step 9: the log. Its row holds the times up to here (it cannot time its own writing).
    logEvent_({
      actor: 'client:' + client.clientId,
      event: 'upload',
      client_id: client.clientId,
      request_id: req.requestId,
      item_id: itemId,
      details: 'הועלה קובץ: ' + storedName + ' (' + formatSize_(sizeBytes) + '). ' +
        'זמנים בשרת: ' + formatLaps_(watch.laps()),
    });
    SpreadsheetApp.flush();
    watch.lap('log');

    // Step 10: the phone shows "התקבל".
    return {
      ok: true,
      uploadId: uploadId,
      storedName: storedName,
      folderPath: clientFolderName_(client) + ' / ' + req.period,
      mimeType: mimeType,
      sizeBytes: sizeBytes,
      receivedAt: formatDateTime_(at),
      serverMs: watch.totalMs(),
      timingText: formatLaps_(watch.laps()),
    };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// Clients
// ============================================================

// The clients, from the cache when possible (D29). The tokens stay inside the server.
function getClients_() {
  return cached_('clients', function () {
    return readTable_('Clients')
      .filter(function (row) { return String(row.client_id || '').trim(); })
      .map(function (row) {
        return {
          clientId: String(row.client_id).trim(),
          businessName: String(row.business_name || '').trim(),
          token: String(row.token || '').trim(),
          active: isChecked_(row.active),
          folderId: String(row.drive_folder_id || '').trim(),
        };
      });
  });
}

// Only an active client with exactly this token. Anything else gets the same answer, so the
// page cannot tell an unknown link from a cancelled one.
function findClientByToken_(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  return getClients_().filter(function (client) {
    return client.active && client.token && client.token === token;
  })[0] || null;
}

// Writes the ID of the client's new folder in Clients. The row is found by the client ID at the
// moment of writing, never by a remembered row number, which could be out of date.
function saveClientFolderId_(clientId, folderId) {
  const sheet = getSheet_('Clients');
  const headers = getHeaders_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const match = sheet.getRange(2, headers.indexOf('client_id') + 1, lastRow - 1, 1)
      .createTextFinder(clientId).matchEntireCell(true).findNext();
    if (match) sheet.getRange(match.getRow(), headers.indexOf('drive_folder_id') + 1).setValue(folderId);
  }
  forgetCached_('clients');
}

function isChecked_(value) {
  return value === true || String(value).toUpperCase() === 'TRUE';
}

// ============================================================
// The month: cycles, requests and items (data-model.md, chapters 3 and 5)
// ============================================================

// The open cycle. There is at most one (data-model.md 3.3). { cycleId, dueDate } or null.
function getOpenCycle_() {
  const found = cached_('openCycle', function () {
    const row = readTable_('Cycles').filter(function (r) { return String(r.status) === 'open'; })[0];
    if (!row) return { none: true };
    return {
      cycleId: String(row.cycle_id),
      dueDate: row.due_date instanceof Date ? row.due_date.getTime() : null,
    };
  });
  return found.none ? null : found;
}

// The requests of a cycle, by client: the row in the sheet, the period and the month folder.
function getCycleRequests_(cycleId) {
  return cached_('requests:' + cycleId, function () {
    const byClient = {};
    readTable_('Requests').forEach(function (r) {
      if (String(r.cycle_id) !== cycleId) return;
      byClient[String(r.client_id)] = {
        requestId: String(r.request_id),
        period: String(r.period),
        row: r._row,
        folderId: String(r.drive_folder_id || ''),
      };
    });
    return byClient;
  });
}

// The client's request in the open cycle: { cycle, req }, or null if there is none.
function findOpenRequest_(client) {
  const cycle = getOpenCycle_();
  if (!cycle) return null;
  const req = getCycleRequests_(cycle.cycleId)[client.clientId];
  return req ? { cycle: cycle, req: req } : null;
}

// Where each item of a cycle is in the Items tab: { itemId: row }. Only the ID column is read.
function getCycleItemRows_(cycleId) {
  return cached_('itemRows:' + cycleId, function () {
    const sheet = getSheet_('Items');
    const lastRow = sheet.getLastRow();
    const rows = {};
    if (lastRow < 2) return rows;
    const column = getHeaders_(sheet).indexOf('item_id') + 1;
    const prefix = cycleId + '_';
    sheet.getRange(2, column, lastRow - 1, 1).getValues().forEach(function (value, i) {
      const id = String(value[0]);
      if (id.indexOf(prefix) === 0) rows[id] = i + 2;
    });
    return rows;
  });
}

// An item's row, read fresh inside the lock: { row, record }. If the remembered row no longer
// holds this item (someone sorted the tab), the index is built again once.
function readItem_(cycleId, itemId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const row = getCycleItemRows_(cycleId)[itemId];
    if (row) {
      const record = readRecordAt_('Items', row);
      if (record && String(record.item_id) === itemId) return { row: row, record: record };
    }
    forgetCached_('itemRows:' + cycleId);
  }
  return null;
}

// The month folder of a request (D31). Its ID is kept in Requests.drive_folder_id.
// A folder moved to the trash is an edge case for stage 8.
function getRequestFolder_(client, req, cycleId) {
  if (req.folderId) {
    try {
      return DriveApp.getFolderById(req.folderId);
    } catch (err) {
      // Deleted. A new one is created below.
    }
  }
  const folder = getClientFolder_(client).createFolder(req.period);
  updateRecord_('Requests', req.row, 'request_id', req.requestId, { drive_folder_id: folder.getId() });
  req.folderId = folder.getId();
  forgetCached_('requests:' + cycleId);
  return folder;
}

// The document types, by ID, from the cache.
function getDocTypes_() {
  return cached_('docTypes', function () {
    const types = {};
    readTable_('DocTypes').forEach(function (r) {
      if (!r.doc_type_id) return;
      types[String(r.doc_type_id)] = {
        nameHe: String(r.name_he || ''),
        fileLabel: String(r.file_label || ''),
        required: isChecked_(r.required),
        sortOrder: Number(r.sort_order) || 0,
      };
    });
    return types;
  });
}

// "2026-10" -> "אוקטובר 2026". "2026-09_10" -> "ספטמבר–אוקטובר 2026".
function periodLabel_(period) {
  const match = String(period).match(/^(\d{4})-(\d{2})(?:_(\d{2}))?$/);
  if (!match) return String(period);
  const first = MONTHS_HE[Number(match[2]) - 1];
  return match[3] ? first + '–' + MONTHS_HE[Number(match[3]) - 1] + ' ' + match[1] : first + ' ' + match[1];
}

// " הבקשה הבאה תגיע ב-1 בדצמבר." The next cycle opens on the 1st of the month after next:
// the October cycle runs in November, so the November cycle opens on 1 December.
function nextRequestText_() {
  const cycle = getOpenCycle_();
  if (!cycle) return '';
  const month = Number(cycle.cycleId.split('-')[1]);   // 1-12
  const opens = (month + 1) % 12;                      // the month after next, 0-11
  return ' הבקשה הבאה תגיע ב-1 ב' + MONTHS_HE[opens] + '.';
}

// Forgets everything the server keeps about the months. setup() and seedDemo() call it.
function forgetModelCache_() {
  const cycle = getOpenCycle_();
  if (cycle) {
    forgetCached_('requests:' + cycle.cycleId);
    forgetCached_('itemRows:' + cycle.cycleId);
  }
  ['openCycle', 'clients', 'settings', 'docTypes'].forEach(forgetCached_);
}

// ============================================================
// Files and Drive
// ============================================================

function resolveMimeType_(mimeType, fileName) {
  const type = String(mimeType || '').toLowerCase().trim();
  if (ALLOWED_TYPES[type]) return type;
  if (!type || type === 'application/octet-stream') {
    const ext = extensionOf_(fileName);
    if (EXTENSION_TYPES[ext]) return EXTENSION_TYPES[ext];
  }
  return '';
}

function extensionOf_(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
  return match ? match[1] : '';
}

function cleanFileName_(name) {
  const cleaned = String(name || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '-').trim();
  return (cleaned || 'file').slice(0, 120);
}

// The size of a file from the length of its base64 text: every 4 characters are 3 bytes,
// minus the "=" padding at the end.
function base64Size_(text) {
  const padding = /==$/.test(text) ? 2 : /=$/.test(text) ? 1 : 0;
  return Math.floor(text.length * 3 / 4) - padding;
}

// SHA-256 of the file's base64 text. It finds duplicates exactly like a hash of the bytes, and
// it is much faster here: a text reaches Google's service in one piece, while an array of
// millions of bytes is passed number by number (findings of stage 3.2). In stage 5 the page
// computes the fingerprint of the original file itself (data-model.md, chapter 2).
function sha256OfText_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.US_ASCII)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
}

function getMaxFileMb_() {
  const value = Number(getSetting_('max_file_mb'));
  return value > 0 ? value : CONFIG.defaultMaxFileMb;
}

// The client's folder (D31). Its ID is saved in Clients on the first upload (D29). If the saved
// folder was deleted, a new one is created.
function getClientFolder_(client) {
  if (client.folderId) {
    try {
      return DriveApp.getFolderById(client.folderId);
    } catch (err) {
      // Deleted. A new one is created below.
    }
  }
  const rootId = getSetting_('drive_root_folder_id');
  if (!rootId) throw new Error('חסרה תיקיית השורש ב-Drive. הריצו את setup מהעורך.');
  const folder = DriveApp.getFolderById(rootId).createFolder(clientFolderName_(client));
  saveClientFolderId_(client.clientId, folder.getId());
  client.folderId = folder.getId();
  return folder;
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

// ============================================================
// Names in Drive (D31, rules.md)
// ============================================================

// Invisible characters: control characters, and marks that change the direction of text.
// A name could use them to look different from what it is, so they are removed.
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f؜​-‏‪-‮⁠-⁩﻿]/g;
// Characters Windows does not allow in file names. A downloaded ZIP would break on them.
const WINDOWS_UNSAFE_CHARS = /[\\\/:*?<>|]/g;

// "מאפיית השקד (C07)": the business name and the client ID (D31).
function clientFolderName_(client) {
  return (cleanFolderName_(client.businessName) || client.clientId) + ' (' + client.clientId + ')';
}

// "מאפיית-השקד_2026-10_דף-בנק_01.jpg": business, period, document type, number (D31).
function buildFileName_(client, period, docLabel, seq, extension) {
  const business = cleanFileNamePart_(client.businessName) || client.clientId;
  return [business, period, cleanFileNamePart_(docLabel), pad2_(seq)].join('_') + '.' + extension;
}

// A business name as a folder name: keeps spaces and dashes, and replaces only what
// Windows cannot hold. "ג'ו שיפוצים בע"מ" -> "ג'ו שיפוצים בע״מ", "24/7 מיזוג" -> "24-7 מיזוג".
function cleanFolderName_(text, maxLength) {
  const name = String(text || '').normalize('NFC')
    .replace(/\s+/g, ' ')                // tabs and line breaks become spaces
    .replace(INVISIBLE_CHARS, '')
    .replace(/"/g, '״')            // " -> ״ (gershayim), so בע"מ stays readable
    .replace(WINDOWS_UNSAFE_CHARS, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '');   // Windows drops a dot or a space at the end
  return cutText_(name, maxLength || 80).replace(/[\s.]+$/g, '');
}

// One part of a file name (the business name, the document type). Like a folder name, but
// spaces and every kind of dash become a single "-", because "_" separates the parts.
// "Pixel – צילום אירועים" -> "Pixel-צילום-אירועים".
function cleanFileNamePart_(text, maxLength) {
  const part = cleanFolderName_(text, 200)
    .replace(/[\s_‐-―−-]+/g, '-')   // spaces, _ and every kind of dash
    .replace(/^-+|-+$/g, '');
  return cutText_(part, maxLength || 40).replace(/[-.]+$/g, '');
}

// Cuts by characters, not by UTF-16 units, so a character is never cut in half.
function cutText_(text, maxLength) {
  const chars = Array.from(String(text));
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : String(text);
}

// ============================================================
// Links and tokens
// ============================================================

// The token goes after "#": the browser does not send that part to GitHub's server,
// so it never appears in their logs.
function buildClientLink_(token) {
  const base = getSetting_('client_page_url') || CONFIG.clientPageUrl;
  return base.replace(/\/?$/, '/') + '#t=' + token;
}

// 32 random URL-safe characters (192 bits). Impossible to guess.
function newToken_() {
  const seed = Utilities.getUuid() + Utilities.getUuid();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return Utilities.base64EncodeWebSafe(digest).replace(/=+$/, '').slice(0, 32);
}

// "shedmi.cpa+c07@gmail.com": a "plus" address of the office account (D12).
function plusAddress_(tag) {
  const email = getSetting_('office_email') || CONFIG.officeEmail;
  const at = email.indexOf('@');
  return email.slice(0, at) + '+' + String(tag).toLowerCase() + email.slice(at);
}

// ============================================================
// Cache (D29): fewer reads of the sheet in every request
// ============================================================

// CacheService keeps a value between runs, here for up to 10 minutes. The server forgets it at
// once when the tab changes: onEdit() for edits by hand, forgetCached_() where the code writes.
// The version is part of the key, so a new version of the server starts with a clean cache.
// Within one run, memo_ keeps every value, so nothing is read twice in the same request.
const memo_ = {};

function cacheKey_(name) {
  return 'nelio:' + CONFIG.version + ':' + name;
}

function cached_(name, load) {
  if (Object.prototype.hasOwnProperty.call(memo_, name)) return memo_[name];
  const cache = CacheService.getScriptCache();
  let value = null;
  try {
    const hit = cache.get(cacheKey_(name));
    if (hit !== null) value = JSON.parse(hit);
  } catch (err) {
    value = null;
  }
  if (value === null) {
    value = load();
    try {
      cache.put(cacheKey_(name), JSON.stringify(value), CONFIG.cacheSeconds);
    } catch (err) {
      // Too big for the cache, or the cache is busy: the value is simply read again next time.
    }
  }
  memo_[name] = value;
  return value;
}

function forgetCached_(name) {
  delete memo_[name];
  try {
    CacheService.getScriptCache().remove(cacheKey_(name));
  } catch (err) {
    // The value expires by itself within 10 minutes.
  }
}

// A simple trigger: Google runs it by itself whenever someone edits the spreadsheet by hand.
// An edit counts at once, without waiting 10 minutes.
// (Inserting or deleting a whole row is not an "edit" for Google: then the change counts
// within 10 minutes. The dashboard will forget the cache by itself when it changes a client.)
function onEdit(e) {
  try {
    const sheet = e && e.range ? e.range.getSheet() : null;
    if (!sheet) return;
    const name = sheet.getName();
    if (name === 'Settings') forgetCached_('settings');
    if (name === 'Clients') forgetCached_('clients');
    if (name === 'DocTypes') forgetCached_('docTypes');
    if (name === 'Cycles' || name === 'Requests' || name === 'Items') forgetModelCache_();
    if (e.range.getRow() === 1) forgetCached_('headers:' + name);
  } catch (err) {
    // A simple trigger cannot show errors. The cache expires by itself within 10 minutes.
  }
}

// ============================================================
// The sheet
// ============================================================

let spreadsheetCache_ = null;
const sheetMemo_ = {};

function getSpreadsheet_() {
  if (spreadsheetCache_) return spreadsheetCache_;
  let ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (id) ss = SpreadsheetApp.openById(id);
  }
  if (!ss) throw new Error('הגיליון לא נמצא. הריצו את setup מתוך העורך.');
  spreadsheetCache_ = ss;
  return ss;
}

function getSheet_(name) {
  if (sheetMemo_[name]) return sheetMemo_[name];
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('חסרה הלשונית ' + name + '. הריצו את setup.');
  sheetMemo_[name] = sheet;
  return sheet;
}

// The names of the columns, from the cache when possible.
function getHeaders_(sheet) {
  return cached_('headers:' + sheet.getName(), function () { return readHeaderRow_(sheet); });
}

function readHeaderRow_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(String);
}

// Rows as objects, by column name: { key: 'office_name', value: '...', _row: 2 }.
function readTable_(sheetName) {
  const sheet = getSheet_(sheetName);
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 2 || lastColumn === 0) return [];
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function (row, i) {
    const record = { _row: i + 2 };
    headers.forEach(function (header, c) {
      if (header) record[header] = row[c];
    });
    return record;
  });
}

// One row as an object, by column name.
function readRecordAt_(sheetName, row) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  if (row < 2 || row > sheet.getLastRow()) return null;
  const values = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
  const record = {};
  headers.forEach(function (header, c) { if (header) record[header] = values[c]; });
  return record;
}

// Writes a whole row from an object, by column name. Call it inside the lock.
function writeRecordAt_(sheetName, row, record) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const values = headers.map(function (header) {
    const value = record[header];
    return value === undefined || value === null ? '' : value;
  });
  sheet.getRange(row, 1, 1, headers.length).setValues([values]);
}

// Changes some fields of a row, after checking that the row still holds the same ID.
function updateRecord_(sheetName, row, idColumn, expectedId, fields) {
  const record = readRecordAt_(sheetName, row);
  if (!record || String(record[idColumn]) !== String(expectedId)) {
    throw new Error('השורה ' + row + ' בלשונית ' + sheetName + ' כבר לא שייכת ל-' + expectedId);
  }
  Object.keys(fields).forEach(function (key) { record[key] = fields[key]; });
  writeRecordAt_(sheetName, row, record);
}

// Writes a row by column names. The format is set before the value, so text stays text
// (otherwise Sheets turns "2026-10" into a date). Yes/no columns become checkboxes.
// Call it inside the lock, or from setup().
function appendRow_(sheetName, record) {
  const sheet = getSheet_(sheetName);
  const headers = getHeaders_(sheet);
  const values = headers.map(function (header) {
    const value = record[header];
    return value === undefined || value === null ? '' : value;
  });
  const formats = headers.map(function (header) {
    return numberFormat_(columnFormat_(sheetName, header));
  });
  const row = sheet.getLastRow() + 1;
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 100);
  const range = sheet.getRange(row, 1, 1, headers.length);
  range.setNumberFormats([formats]);
  range.setValues([values]);
  headers.forEach(function (header, i) {
    if (columnFormat_(sheetName, header) === 'checkbox') {
      sheet.getRange(row, i + 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
    }
  });
}

function columnFormat_(sheetName, header) {
  const column = (SCHEMA[sheetName] || []).filter(function (c) { return c[0] === header; })[0];
  return column ? column[2] : 'text';
}

function numberFormat_(format) {
  if (format === 'datetime') return SHEET_DATETIME_FORMAT;
  if (format === 'date') return SHEET_DATE_FORMAT;
  if (format === 'number') return '0';
  if (format === 'checkbox') return '0.###############';  // automatic: TRUE and FALSE stay as they are
  return '@';  // plain text
}

// Settings as { key: value }, read once and kept in the cache (D29).
function getSettings_() {
  return cached_('settings', function () {
    const settings = {};
    readTable_('Settings').forEach(function (row) {
      if (row.key) settings[String(row.key)] = String(row.value);
    });
    return settings;
  });
}

function getSetting_(key) {
  const value = getSettings_()[key];
  return value === undefined || value === null ? '' : String(value);
}

function setSetting_(key, value) {
  setSettings_([[key, value]]);
}

// Writes several settings with one read of the tab. A missing key is added with its description
// from the defaults (Setup.gs).
function setSettings_(pairs) {
  const sheet = getSheet_('Settings');
  const valueColumn = getHeaders_(sheet).indexOf('value') + 1;
  const rows = {};
  readTable_('Settings').forEach(function (r) { rows[String(r.key)] = r._row; });
  const descriptions = {};
  defaultSettings_().forEach(function (s) { descriptions[s[0]] = s[2]; });
  pairs.forEach(function (pair) {
    const key = pair[0];
    const value = String(pair[1]);
    if (rows[key]) {
      sheet.getRange(rows[key], valueColumn).setValue(value);
    } else {
      appendRow_('Settings', { key: key, value: value, description: descriptions[key] || '' });
      rows[key] = sheet.getLastRow();
    }
  });
  forgetCached_('settings');
}

// ============================================================
// Log, clock, responses
// ============================================================

// appendRow() is atomic, so the log is safe even outside the lock.
// Log values are dates and Hebrew text, which Sheets never converts.
function logEvent_(entry) {
  const sheet = getSheet_('Log');
  const record = Object.assign({ at: now_(), real_at: new Date() }, entry);
  sheet.appendRow(getHeaders_(sheet).map(function (header) {
    const value = record[header];
    return value === undefined || value === null ? '' : value;
  }));
}

function logError_(where, err) {
  console.error(where, err && err.stack ? err.stack : err);
  try {
    logEvent_({ actor: 'system', event: 'error', details: where + ': ' + (err && err.message ? err.message : err) });
  } catch (logErr) {
    console.error('Could not write the error to the Log tab', logErr);
  }
}

// The one clock of the system (data-model.md, chapter 6, rule 7).
// In demo mode (stage 7) it will return the simulated time.
function now_() {
  return new Date();
}

function formatDateTime_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, TEXT_DATETIME_FORMAT);
}

function formatDate_(date) {
  return Utilities.formatDate(date, CONFIG.timeZone, TEXT_DATE_FORMAT);
}

function formatSize_(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ============================================================
// Timing (D29): where does the time go in each request?
// ============================================================

// The names of the steps, as the page and the Log tab show them. Hebrew only: an English
// word next to a number would scramble the order of the line (rules.md, "quality").
const LAP_NAMES = {
  parse: 'קריאת הבקשה',
  checks: 'בדיקות',
  cycle: 'מחזור ובקשה',
  decode: 'פענוח הקובץ',
  hash: 'טביעת אצבע',
  settings: 'הגדרות',
  lock: 'מנעול',
  item: 'פריט',
  folder: 'תיקייה',
  save: 'שמירת הקובץ',        // in Drive
  uploads: 'רישום הקובץ',     // the row in Uploads
  request: 'עדכון הבקשה',
  log: 'יומן',
};

// watch.lap('save') records the time since the previous lap under the name "save".
function newStopwatch_() {
  const startedAt = Date.now();
  let lastAt = startedAt;
  const laps = [];
  return {
    lap: function (name) {
      const at = Date.now();
      laps.push({ name: name, ms: at - lastAt });
      lastAt = at;
    },
    laps: function () { return laps.slice(); },
    totalMs: function () { return Date.now() - startedAt; },
  };
}

// "קריאת הבקשה 0.12 · בדיקות 0.00 · ... (שניות)"
function formatLaps_(laps) {
  return laps.map(function (lap) {
    return (LAP_NAMES[lap.name] || lap.name) + ' ' + (lap.ms / 1000).toFixed(2);
  }).join(' · ') + ' (שניות)';
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  return { ok: false, code: code, message: message };
}
