/**
 * Nelio · server · Google Apps Script, bound to the "Nelio – נתונים" spreadsheet.
 *
 * Stage 3.1, the skeleton:
 *   setup()   Run from the editor. Creates the tabs used so far, the Drive root folder
 *             and a test link. Safe to run again: it only adds what is missing.
 *   doGet()   Health check. Opening the web app address in a browser shows that the server is up.
 *   doPost()  The API of the client page: "hello" checks the link, "upload" saves one file
 *             to Drive and records it in the sheet.
 *
 * The source of truth is apps-script/Code.gs in github.com/shedmi-cpa/nelio.
 * After every change: copy the whole file into the editor, then deploy a new version
 * (Deploy > Manage deployments > Edit > Version: New version). The address stays the same.
 */

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  version: '0.1.0',
  officeEmail: 'shedmi.cpa@gmail.com',   // setup() refuses to run from any other account
  timeZone: 'Asia/Jerusalem',
  clientPageUrl: 'https://shedmi-cpa.github.io/nelio/',
  rootFolderName: 'שדמי – מסמכי לקוחות',
  testFolderName: 'בדיקות שלד',
  defaultMaxFileMb: 20,                  // temporary, decided in stage 3.2
  lockTimeoutMs: 30000,
};

// Israeli format, 24-hour clock (rules.md). The same format, spelled for two tools:
const SHEET_DATETIME_FORMAT = 'dd/mm/yyyy hh:mm:ss';  // Google Sheets number format
const TEXT_DATETIME_FORMAT = 'dd/MM/yyyy HH:mm:ss';   // Utilities.formatDate

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

// Everything the client may see is in Hebrew (rules.md).
const MESSAGES = {
  badRequest: 'הבקשה לא תקינה.',
  badToken: 'הקישור הזה לא פעיל. לקבלת קישור חדש, פנו למשרד.',
  noFile: 'לא התקבל קובץ. נסו שוב.',
  badType: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
  badFile: 'הקובץ הגיע פגום. נסו להעלות אותו שוב.',
  emptyFile: 'הקובץ ריק.',
  tooBig: 'הקובץ גדול מדי. הגודל המקסימלי הוא {mb} מגה-בייט.',
  busy: 'המערכת עמוסה כרגע. נסו שוב בעוד רגע.',
  serverError: 'משהו השתבש אצלנו. נסו שוב בעוד כמה דקות.',
};

// The tabs used so far (the full model: data-model.md, chapter 5).
// Each column: [name, Hebrew note shown on the header, format].
// Formats: 'text' keeps the value exactly as written, 'datetime', 'number'.
const SCHEMA = {
  Settings: [
    ['key', 'שם ההגדרה. הקוד קורא אותו, ולכן לא משנים אותו', 'text'],
    ['value', 'הערך', 'text'],
    ['description', 'הסבר', 'text'],
  ],
  Uploads: [
    ['upload_id', 'מזהה ההעלאה', 'text'],
    ['uploaded_at', 'מתי הועלה', 'datetime'],
    ['item_id', 'הפריט: סוג המסמך בבקשה', 'text'],
    ['request_id', 'הבקשה: הלקוח בחודש', 'text'],
    ['client_id', 'הלקוח', 'text'],
    ['uploaded_by', 'מי העלה: client, מזהה של איש צוות, או demo', 'text'],
    ['original_name', 'שם הקובץ בטלפון', 'text'],
    ['stored_name', 'השם הקבוע ב-Drive', 'text'],
    ['seq', 'המספר הרץ בשם הקובץ', 'number'],
    ['drive_file_id', 'הקובץ ב-Drive', 'text'],
    ['mime_type', 'סוג הקובץ', 'text'],
    ['size_bytes', 'גודל בבתים', 'number'],
    ['file_hash', 'טביעת האצבע של הקובץ (SHA-256)', 'text'],
    ['duplicate_of', 'אם זה קובץ שכבר הועלה: ההעלאה הקודמת', 'text'],
    ['upload_key', 'מזהה של ניסיון ההעלאה, נגד שמירה כפולה', 'text'],
    ['status', 'active (פעיל) או rejected (נדחה)', 'text'],
  ],
  Log: [
    ['at', 'מתי. במצב הדגמה: הזמן המדומה', 'datetime'],
    ['real_at', 'מתי באמת', 'datetime'],
    ['actor', 'מי: client:C07, staff:S2, system או demo', 'text'],
    ['event', 'סוג האירוע', 'text'],
    ['client_id', 'הלקוח', 'text'],
    ['request_id', 'הבקשה', 'text'],
    ['item_id', 'הפריט', 'text'],
    ['details', 'פרטים', 'text'],
  ],
};

// Settings rows that setup() adds when missing (the full list: data-model.md, "Settings").
const DEFAULT_SETTINGS = [
  ['office_name', "שדמי ושות', רואי חשבון", 'שם המשרד'],
  ['system_name', 'Nelio', 'שם המערכת'],
  ['office_email', CONFIG.officeEmail, 'הכתובת שממנה יוצאים המיילים'],
  ['client_page_url', CONFIG.clientPageUrl, 'כתובת הדף של הלקוח. ממנה נבנה הקישור האישי'],
  ['drive_root_folder_id', '', 'תיקיית השורש ב-Drive. נוצרת ב-setup'],
  ['max_file_mb', String(CONFIG.defaultMaxFileMb), 'גודל מקסימלי לקובץ, במגה-בייט. זמני: ייקבע בשלב 3.2'],
  ['test_link', '', 'קישור לבדיקה בשלב השלד. יוחלף בקישורים האישיים של הלקוחות'],
];

// ============================================================
// Setup (run from the editor)
// ============================================================

function setup() {
  assertOfficeAccount_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('הסקריפט לא מחובר לגיליון. פתחו אותו מתוך הגיליון: תוספים > Apps Script.');
  }
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  ss.setSpreadsheetTimeZone(CONFIG.timeZone);

  Object.keys(SCHEMA).forEach(function (name) {
    ensureSheet_(ss, name, SCHEMA[name]);
  });
  removeEmptyExtraSheets_(ss);
  ensureDefaultSettings_();

  const root = ensureRootFolder_();
  const link = ensureTestLink_();

  logEvent_({ actor: 'system', event: 'setup', details: 'הגדרה הושלמה, גרסה ' + CONFIG.version });
  ss.setActiveSheet(ss.getSheetByName('Settings'));
  SpreadsheetApp.flush();

  console.log('ההגדרה הושלמה. גרסה ' + CONFIG.version);
  console.log('תיקיית השורש ב-Drive: ' + root.getUrl());
  console.log('קישור הבדיקה (נמצא גם בלשונית Settings): ' + link);
}

function assertOfficeAccount_() {
  const me = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (me && me !== CONFIG.officeEmail) {
    throw new Error('הסקריפט רץ מהחשבון ' + me + ' ולא מחשבון המשרד (' + CONFIG.officeEmail +
      '). פתחו את הגיליון בחשבון המשרד והריצו שוב.');
  }
}

function ensureSheet_(ss, name, columns) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name, ss.getNumSheets());
  sheet.setRightToLeft(true);

  // Add missing columns at the end. Never reorder or delete: the code finds columns by name.
  const headers = getHeaders_(sheet);
  columns.forEach(function (column) {
    const columnName = column[0];
    const note = column[1];
    const format = column[2];
    let index = headers.indexOf(columnName);
    if (index === -1) {
      headers.push(columnName);
      index = headers.length - 1;
      sheet.getRange(1, index + 1).setValue(columnName);
    }
    sheet.getRange(1, index + 1).setNote(note);
    const rows = sheet.getMaxRows() - 1;
    if (rows > 0) sheet.getRange(2, index + 1, rows, 1).setNumberFormat(numberFormat_(format));
  });

  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#eef1f5');
  sheet.setFrozenRows(1);
}

// A new spreadsheet starts with an empty tab ("גיליון1" or "Sheet1"). Remove it.
function removeEmptyExtraSheets_(ss) {
  ss.getSheets().forEach(function (sheet) {
    const isOurs = Object.prototype.hasOwnProperty.call(SCHEMA, sheet.getName());
    const isEmpty = sheet.getLastRow() === 0 && sheet.getLastColumn() === 0;
    if (!isOurs && isEmpty && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  });
}

function ensureDefaultSettings_() {
  const existing = readTable_('Settings').map(function (row) { return String(row.key); });
  DEFAULT_SETTINGS.forEach(function (setting) {
    if (existing.indexOf(setting[0]) === -1) {
      appendRow_('Settings', { key: setting[0], value: setting[1], description: setting[2] });
    }
  });
}

function ensureRootFolder_() {
  const id = getSetting_('drive_root_folder_id');
  if (id) {
    try {
      const existing = DriveApp.getFolderById(id);
      if (!existing.isTrashed()) return existing;
    } catch (err) {
      // The folder was deleted. A new one is created below.
    }
  }
  const folder = DriveApp.createFolder(CONFIG.rootFolderName);
  setSetting_('drive_root_folder_id', folder.getId());
  return folder;
}

// Stage 3.1 has one test "client". Its token is kept in Script Properties, outside the code,
// so it never reaches the public repo. Running setup() again keeps the same token.
function ensureTestLink_() {
  const props = PropertiesService.getScriptProperties();
  let token = props.getProperty('TEST_TOKEN');
  if (!token) {
    token = newToken_();
    props.setProperty('TEST_TOKEN', token);
  }
  const link = buildClientLink_(token);
  setSetting_('test_link', link);
  return link;
}

// ============================================================
// Web app: health check and API
// ============================================================

function doGet() {
  return json_({ ok: true, system: 'Nelio', version: CONFIG.version, serverTime: formatDateTime_(now_()) });
}

// The page sends JSON as plain text. That keeps it a "simple" request, without a CORS
// preflight, which Apps Script cannot answer.
function doPost(e) {
  let request = null;
  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_(fail_('BAD_REQUEST', MESSAGES.badRequest));
  }
  const action = request && typeof request === 'object' ? String(request.action || '') : '';
  try {
    if (action === 'hello') return json_(handleHello_(request));
    if (action === 'upload') return json_(handleUpload_(request));
    return json_(fail_('BAD_REQUEST', MESSAGES.badRequest));
  } catch (err) {
    logError_('doPost:' + action, err);
    return json_(fail_('SERVER_ERROR', MESSAGES.serverError));
  }
}

// The page calls this when it opens: is the link valid, and what should it show?
function handleHello_(request) {
  const client = findClientByToken_(request.token);
  if (!client) return fail_('BAD_TOKEN', MESSAGES.badToken);
  return {
    ok: true,
    businessName: client.businessName,
    officeName: getSetting_('office_name'),
    maxFileMb: getMaxFileMb_(),
    version: CONFIG.version,
  };
}

// Data model, chapter 2, steps 4-10 (the skeleton version).
function handleUpload_(request) {
  const startedAt = Date.now();

  // Step 4: checks. If anything is wrong, nothing is saved.
  const client = findClientByToken_(request.token);
  if (!client) return fail_('BAD_TOKEN', MESSAGES.badToken);

  const originalName = cleanFileName_(request.fileName);
  const mimeType = resolveMimeType_(request.mimeType, originalName);
  if (!mimeType) return fail_('BAD_TYPE', MESSAGES.badType);
  if (!request.data) return fail_('NO_FILE', MESSAGES.noFile);

  let bytes;
  try {
    bytes = Utilities.base64Decode(String(request.data));
  } catch (err) {
    return fail_('BAD_FILE', MESSAGES.badFile);
  }
  if (!bytes.length) return fail_('EMPTY_FILE', MESSAGES.emptyFile);
  const maxMb = getMaxFileMb_();
  if (bytes.length > maxMb * 1024 * 1024) {
    return fail_('TOO_BIG', MESSAGES.tooBig.replace('{mb}', maxMb));
  }

  // Step 5: one upload at a time, so two uploads never write to the same row.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.lockTimeoutMs)) return fail_('BUSY', MESSAGES.busy);
  try {
    // Step 6: Drive. The test folder is created on the first upload.
    const at = now_();
    const folder = getOrCreateFolder_(ensureRootFolder_(), CONFIG.testFolderName);
    const storedName = buildTestFileName_(at, originalName, mimeType);
    const file = folder.createFile(Utilities.newBlob(bytes, mimeType, storedName));

    // Step 7: a row in Uploads. (Items and the request status arrive in stage 5.)
    const uploadId = 'TEST_' + Utilities.formatDate(at, CONFIG.timeZone, 'yyyyMMdd-HHmmss') +
      '_' + file.getId().slice(-4);
    appendRow_('Uploads', {
      upload_id: uploadId,
      uploaded_at: at,
      client_id: client.clientId,
      uploaded_by: 'client',
      original_name: originalName,
      stored_name: storedName,
      drive_file_id: file.getId(),
      mime_type: mimeType,
      size_bytes: bytes.length,
      file_hash: sha256Hex_(bytes),
      upload_key: String(request.uploadKey || '').slice(0, 64),
      status: 'active',
    });

    // Step 9: the log.
    logEvent_({
      actor: 'client:' + client.clientId,
      event: 'upload',
      client_id: client.clientId,
      details: 'הועלה קובץ בדיקה: ' + originalName + ' (' + formatSize_(bytes.length) + ')',
    });
    SpreadsheetApp.flush();

    // Step 10: the phone shows "התקבל".
    return {
      ok: true,
      uploadId: uploadId,
      storedName: storedName,
      mimeType: mimeType,
      sizeBytes: bytes.length,
      receivedAt: formatDateTime_(at),
      serverMs: Date.now() - startedAt,
    };
  } finally {
    lock.releaseLock();
  }
}

// Stage 3.1: one test token. Stage 3.2 moves this to the Clients tab.
function findClientByToken_(token) {
  if (typeof token !== 'string' || token.length < 20) return null;
  const testToken = PropertiesService.getScriptProperties().getProperty('TEST_TOKEN');
  if (testToken && token === testToken) return { clientId: 'TEST', businessName: 'לקוח בדיקה' };
  return null;
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

// A temporary name for the skeleton. The real naming scheme is decided in stage 3.2.
function buildTestFileName_(at, originalName, mimeType) {
  const stamp = Utilities.formatDate(at, CONFIG.timeZone, 'yyyy-MM-dd_HH-mm-ss');
  const base = originalName.replace(/\.[^.]*$/, '').slice(0, 60) || 'file';
  return 'test_' + stamp + '_' + base + '.' + ALLOWED_TYPES[mimeType];
}

function getOrCreateFolder_(parent, name) {
  const found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

function getMaxFileMb_() {
  const value = Number(getSetting_('max_file_mb'));
  return value > 0 ? value : CONFIG.defaultMaxFileMb;
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); })
    .join('');
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

// ============================================================
// The sheet
// ============================================================

let spreadsheetCache_ = null;

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
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('חסרה הלשונית ' + name + '. הריצו את setup.');
  return sheet;
}

function getHeaders_(sheet) {
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

// Writes a row by column names. The format is set before the value, so text stays text
// (otherwise Sheets turns "2026-10" into a date). Call it inside the lock, or from setup().
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
}

function columnFormat_(sheetName, header) {
  const column = (SCHEMA[sheetName] || []).filter(function (c) { return c[0] === header; })[0];
  return column ? column[2] : 'text';
}

function numberFormat_(format) {
  if (format === 'datetime') return SHEET_DATETIME_FORMAT;
  if (format === 'number') return '0';
  return '@';  // plain text
}

function getSetting_(key) {
  const row = readTable_('Settings').filter(function (r) { return r.key === key; })[0];
  return row ? String(row.value) : '';
}

function setSetting_(key, value) {
  const row = readTable_('Settings').filter(function (r) { return r.key === key; })[0];
  if (!row) {
    appendRow_('Settings', { key: key, value: String(value), description: '' });
    return;
  }
  const sheet = getSheet_('Settings');
  const column = getHeaders_(sheet).indexOf('value') + 1;
  sheet.getRange(row._row, column).setValue(String(value));
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

function formatSize_(bytes) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function fail_(code, message) {
  return { ok: false, code: code, message: message };
}
