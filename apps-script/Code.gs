/**
 * Nelio · server · Google Apps Script, bound to the "Nelio – נתונים" spreadsheet.
 *
 * The skeleton (stage 3):
 *   setup()   Run from the editor after a change in the tabs. Creates what is missing: tabs,
 *             columns, settings, the Drive root folder and the test clients. Safe to run again.
 *   doGet()   Health check. Opening the web app address in a browser shows that the server is up.
 *   doPost()  The API of the client page: "hello" checks the link, "upload" saves one file
 *             in the client's folder for the month, and records it in the sheet.
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
  version: '0.2.1',
  officeEmail: 'shedmi.cpa@gmail.com',   // setup() refuses to run from any other account
  timeZone: 'Asia/Jerusalem',
  clientPageUrl: 'https://shedmi-cpa.github.io/nelio/',
  rootFolderName: 'שדמי – מסמכי לקוחות',
  defaultMaxFileMb: 10,                  // D32: covers real documents, and uploads stay far from the page's time limit
  lockTimeoutMs: 30000,
  cacheSeconds: 600,                     // 10 minutes (D29)
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

// Until the DocTypes tab exists (stage 4), every upload of the skeleton is "מסמך אחר".
const SKELETON_DOC_TYPE = { id: 'OTHER', fileLabel: 'מסמך-אחר' };

// Two test clients until stage 4 brings the 60 invented clients. Their links are in Settings.
// The second has ' and " in its name, to test names in Drive with real uploads.
const TEST_CLIENTS = [
  { clientId: 'TEST', businessName: 'לקוח בדיקה', linkSetting: 'test_link' },
  { clientId: 'T2', businessName: 'ג\'ו שיפוצים בע"מ', linkSetting: 'test_link_2' },
];

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

// The tabs used so far, in their order in the spreadsheet (the full model: data-model.md,
// chapter 5). Each column: [name, Hebrew note shown on the header, format].
// Formats: 'text' keeps the value exactly as written, 'datetime', 'number', 'checkbox'.
const SCHEMA = {
  Settings: [
    ['key', 'שם ההגדרה. הקוד קורא אותו, ולכן לא משנים אותו', 'text'],
    ['value', 'הערך', 'text'],
    ['description', 'הסבר', 'text'],
  ],
  Clients: [
    ['client_id', 'מזהה הלקוח. מופיע גם בשם התיקייה שלו ב-Drive', 'text'],
    ['business_name', 'שם העסק (בדוי)', 'text'],
    ['contact_name', 'איש הקשר', 'text'],
    ['email', 'כתובת פלוס של חשבון המשרד (D12)', 'text'],
    ['phone', 'טלפון בדוי בבירור', 'text'],
    ['profile_id', 'סוג העסק, מהלשונית Profiles', 'text'],
    ['has_employees', 'יש עובדים', 'checkbox'],
    ['frequency', 'monthly (חודשי) או bimonthly (דו-חודשי)', 'text'],
    ['legal_type', 'licensed (עוסק מורשה) או company (חברה בע״מ). לתצוגה בלבד', 'text'],
    ['bookkeeper_id', 'מנהל החשבונות, מהלשונית Staff', 'text'],
    ['token', 'הטוקן של הקישור האישי. סודי: לא מעתיקים אותו לשום מקום אחר', 'text'],
    ['token_created_at', 'מתי נוצר הטוקן', 'datetime'],
    ['active', 'פעיל. לקוח לא פעיל לא יכול להעלות', 'checkbox'],
    ['drive_folder_id', 'התיקייה של הלקוח ב-Drive. נוצרת בהעלאה הראשונה', 'text'],
    ['notes', 'הערות פנימיות של המשרד', 'text'],
  ],
  Uploads: [
    ['upload_id', 'מזהה ההעלאה', 'text'],
    ['uploaded_at', 'מתי הועלה', 'datetime'],
    ['item_id', 'הפריט: סוג המסמך בבקשה', 'text'],
    ['request_id', 'הבקשה: הלקוח בחודש', 'text'],
    ['client_id', 'הלקוח', 'text'],
    ['uploaded_by', 'מי העלה: client, מזהה של איש צוות, או demo', 'text'],
    ['original_name', 'שם הקובץ בטלפון', 'text'],
    ['stored_name', 'השם הקבוע ב-Drive (D31)', 'text'],
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
  ['max_file_mb', String(CONFIG.defaultMaxFileMb), 'גודל מקסימלי לקובץ, במגה-בייט (D32)'],
  ['test_link', '', 'הקישור של "לקוח בדיקה". יוחלף בקישורים האישיים של הלקוחות'],
  ['test_link_2', '', 'הקישור של לקוח הבדיקה השני, עם גרש ומירכאות בשם'],
];

// The naming lab of stage 3.2 finished its job (D31). setup() moves its folder to the trash.
const OLD_LAB_FOLDER_NAME = 'בדיקת שמות – שלב 3.2';

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
  orderSheets_(ss);
  removeEmptyExtraSheets_(ss);
  ensureDefaultSettings_();

  const root = ensureRootFolder_();
  trashFolderByName_(root, OLD_LAB_FOLDER_NAME);
  const links = ensureTestClients_();
  forgetCached_('settings');
  forgetCached_('clients');

  logEvent_({ actor: 'system', event: 'setup', details: 'הגדרה הושלמה, גרסה ' + CONFIG.version });
  ss.setActiveSheet(ss.getSheetByName('Settings'));
  SpreadsheetApp.flush();

  console.log('ההגדרה הושלמה. גרסה ' + CONFIG.version);
  console.log('תיקיית השורש ב-Drive: ' + root.getUrl());
  links.forEach(function (line) { console.log(line); });
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
  const headers = readHeaderRow_(sheet);
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
  forgetCached_('headers:' + name);
}

// The tabs in the order of SCHEMA (the order of data-model.md).
function orderSheets_(ss) {
  Object.keys(SCHEMA).forEach(function (name, i) {
    const sheet = ss.getSheetByName(name);
    if (!sheet) return;
    ss.setActiveSheet(sheet);
    ss.moveActiveSheet(i + 1);
  });
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
  forgetCached_('settings');
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

function trashFolderByName_(parent, name) {
  const found = parent.getFoldersByName(name);
  while (found.hasNext()) found.next().setTrashed(true);
}

// The test clients live in the Clients tab, like real clients. Their tokens are in that private
// tab only, never in the code, so they never reach the public repo. "לקוח בדיקה" keeps the token
// of stage 3.1, so the link saved then still works.
function ensureTestClients_() {
  const props = PropertiesService.getScriptProperties();
  const existing = readTable_('Clients');
  const lines = [];
  TEST_CLIENTS.forEach(function (test) {
    const row = existing.filter(function (r) { return String(r.client_id) === test.clientId; })[0];
    let token = row ? String(row.token || '') : '';
    if (!row) {
      token = (test.clientId === 'TEST' && props.getProperty('TEST_TOKEN')) || newToken_();
      appendRow_('Clients', {
        client_id: test.clientId,
        business_name: test.businessName,
        has_employees: false,
        frequency: 'monthly',
        token: token,
        token_created_at: now_(),
        active: true,
        notes: 'לקוח בדיקה של שלב השלד. הקישור שלו בלשונית Settings, בשורה ' + test.linkSetting,
      });
    }
    const link = buildClientLink_(token);
    setSetting_(test.linkSetting, link);
    lines.push(test.businessName + ': ' + link);
  });
  props.deleteProperty('TEST_TOKEN');  // the token now lives in Clients
  forgetCached_('clients');
  return lines;
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

// The page calls this when it opens: is the link valid, and what should it show?
function handleHello_(request, watch) {
  const client = findClientByToken_(request.token);
  if (!client) return fail_('BAD_TOKEN', MESSAGES.badToken);
  watch.lap('checks');
  const officeName = getSetting_('office_name');
  const maxFileMb = getMaxFileMb_();
  watch.lap('settings');
  return {
    ok: true,
    businessName: client.businessName,
    officeName: officeName,
    maxFileMb: maxFileMb,
    version: CONFIG.version,
    serverMs: watch.totalMs(),
    timingText: formatLaps_(watch.laps()),
  };
}

// Data model, chapter 2, steps 4-10 (the skeleton version).
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

  const period = currentPeriod_();
  const requestId = period + '_' + client.clientId;
  const itemId = requestId + '_' + SKELETON_DOC_TYPE.id;

  // Step 5: one upload at a time, so two uploads never get the same number or row.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONFIG.lockTimeoutMs)) return fail_('BUSY', MESSAGES.busy);
  watch.lap('lock');
  try {
    // Step 6: Drive. The client's folder and the month folder are created on the first upload,
    // and from then on found by their saved IDs (D29), never searched by name.
    const at = now_();
    const folder = getMonthFolder_(client, period, requestId);
    watch.lap('folder');
    const seq = nextSeq_(itemId);
    const storedName = buildFileName_(client, period, SKELETON_DOC_TYPE.fileLabel, seq, ALLOWED_TYPES[mimeType]);
    watch.lap('seq');
    const file = folder.createFile(blob.setName(storedName));
    watch.lap('save');

    // Step 7: a row in Uploads. (Items and the request status arrive in stage 5.)
    const uploadId = itemId + '_' + pad2_(seq);
    appendRow_('Uploads', {
      upload_id: uploadId,
      uploaded_at: at,
      item_id: itemId,
      request_id: requestId,
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

    // Step 9: the log. Its row holds the times up to here (it cannot time its own writing).
    logEvent_({
      actor: 'client:' + client.clientId,
      event: 'upload',
      client_id: client.clientId,
      request_id: requestId,
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
      folderPath: clientFolderName_(client) + ' / ' + period,
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

// Until the Cycles tab exists (stage 4), the open cycle is last month: the October cycle runs
// in November (data-model.md, chapter 1). For monthly clients, the period is the cycle.
function currentPeriod_() {
  const now = now_();
  const year = Number(Utilities.formatDate(now, CONFIG.timeZone, 'yyyy'));
  const month = Number(Utilities.formatDate(now, CONFIG.timeZone, 'MM'));
  const cycleYear = month === 1 ? year - 1 : year;
  const cycleMonth = month === 1 ? 12 : month - 1;
  return cycleYear + '-' + pad2_(cycleMonth);
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

// The month folder of a request. Until the Requests tab exists (stage 4), its ID is kept in the
// script properties under the request ID, and then it moves to Requests.drive_folder_id.
// A folder moved to the trash is an edge case for stage 8.
function getMonthFolder_(client, period, requestId) {
  const props = PropertiesService.getScriptProperties();
  const key = 'MONTH_FOLDER:' + requestId;
  const savedId = props.getProperty(key);
  if (savedId) {
    try {
      return DriveApp.getFolderById(savedId);
    } catch (err) {
      // Deleted. A new one is created below.
    }
  }
  const folder = getClientFolder_(client).createFolder(period);
  props.setProperty(key, folder.getId());
  return folder;
}

// The next number for a document type in a request (D31): one more than the files it already
// has, rejected ones included, so a number never repeats. Rows in Uploads are never deleted.
function nextSeq_(itemId) {
  const sheet = getSheet_('Uploads');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const column = getHeaders_(sheet).indexOf('item_id') + 1;
  const found = sheet.getRange(2, column, lastRow - 1, 1)
    .createTextFinder(itemId).matchEntireCell(true).findAll();
  return found.length + 1;
}

function pad2_(n) {
  return n < 10 ? '0' + n : String(n);
}

// ============================================================
// Names in Drive (D31, rules.md)
// ============================================================

// Invisible characters: control characters, and marks that change the direction of text.
// A name could use them to look different from what it is, so they are removed.
const INVISIBLE_CHARS = /[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
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
    .replace(/"/g, '\u05F4')            // " -> ״ (gershayim), so בע"מ stays readable
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
    .replace(/[\s_\u2010-\u2015\u2212-]+/g, '-')   // spaces, _ and every kind of dash
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
// An edit in Settings or Clients counts at once, without waiting 10 minutes.
// (Inserting or deleting a whole row is not an "edit" for Google: then the change counts
// within 10 minutes. The dashboard will forget the cache by itself when it changes a client.)
function onEdit(e) {
  try {
    const sheet = e && e.range ? e.range.getSheet() : null;
    if (!sheet) return;
    const name = sheet.getName();
    if (name === 'Settings') forgetCached_('settings');
    if (name === 'Clients') forgetCached_('clients');
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
  const row = readTable_('Settings').filter(function (r) { return r.key === key; })[0];
  const description = (DEFAULT_SETTINGS.filter(function (s) { return s[0] === key; })[0] || [])[2] || '';
  if (!row) {
    appendRow_('Settings', { key: key, value: String(value), description: description });
  } else {
    const sheet = getSheet_('Settings');
    const column = getHeaders_(sheet).indexOf('value') + 1;
    sheet.getRange(row._row, column).setValue(String(value));
  }
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
  decode: 'פענוח הקובץ',
  hash: 'טביעת אצבע',
  settings: 'הגדרות',
  lock: 'מנעול',
  folder: 'תיקייה',
  seq: 'מספור',
  save: 'שמירת הקובץ',        // in Drive
  uploads: 'רישום הקובץ',     // the row in Uploads
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
