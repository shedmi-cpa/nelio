/**
 * Nelio · the structure of the spreadsheet (D23, data-model.md, chapter 5).
 *
 *   setup()   Run from the editor after a change in the tabs. Creates what is missing: tabs,
 *             columns, settings, the default rows and the Drive root folder. It never deletes
 *             data, so it is safe to run again.
 */

// The 13 tabs, in the order of data-model.md. Each column: [name, Hebrew note shown on the
// header, format]. Formats: 'text' keeps the value exactly as written, 'datetime', 'date',
// 'number', 'checkbox'. The code finds columns by name, never by position.
const SCHEMA = {
  Settings: [
    ['key', 'שם ההגדרה. הקוד קורא אותו, ולכן לא משנים אותו', 'text'],
    ['value', 'הערך', 'text'],
    ['description', 'הסבר', 'text'],
  ],
  Staff: [
    ['staff_id', 'מזהה איש הצוות', 'text'],
    ['name', 'שם (בדוי, D35)', 'text'],
    ['role', 'owner (בעל המשרד) או bookkeeper (מנהל חשבונות)', 'text'],
    ['email', 'כתובת פלוס של חשבון המשרד (D12)', 'text'],
    ['active', 'פעיל', 'checkbox'],
  ],
  DocTypes: [
    ['doc_type_id', 'מזהה סוג המסמך. הקוד קורא אותו, ולכן לא משנים אותו', 'text'],
    ['name_he', 'השם שהלקוח רואה', 'text'],
    ['description_he', 'הסבר קצר מתחת לשם', 'text'],
    ['required', 'חובה. "מסמך אחר" לא חובה', 'checkbox'],
    ['file_label', 'המילה בשם הקובץ ב-Drive: אותיות עבריות, ספרות ומקפים בלבד (D31)', 'text'],
    ['sort_order', 'הסדר בדף של הלקוח', 'number'],
  ],
  Profiles: [
    ['profile_id', 'מזהה סוג העסק', 'text'],
    ['name_he', 'השם', 'text'],
    ['applies_when', 'business_type (סוג העסק של הלקוח), has_employees (יש עובדים) או always (תמיד)', 'text'],
    ['doc_types', 'סוגי המסמכים, מופרדים בפסיק (D33)', 'text'],
  ],
  Templates: [
    ['template_id', 'מזהה הנוסח', 'text'],
    ['name_he', 'שם', 'text'],
    ['recipient', 'למי: client, bookkeeper או owner', 'text'],
    ['subject', 'נושא המייל', 'text'],
    ['body', 'הנוסח. השדות בסוגריים מרובעים מוחלפים ברגע השליחה, למשל [שם העסק]', 'text'],
  ],
  Holidays: [
    ['date', 'התאריך. בחג אין הודעות כל היום, ובערב החג אין הודעות מ-friday_cutoff', 'date'],
    ['name', 'שם החג', 'text'],
  ],
  Clients: [
    ['client_id', 'מזהה הלקוח. מופיע גם בשם התיקייה שלו ב-Drive', 'text'],
    ['business_name', 'שם העסק (בדוי)', 'text'],
    ['contact_name', 'איש הקשר', 'text'],
    ['email', 'כתובת פלוס של חשבון המשרד (D12)', 'text'],
    ['phone', 'טלפון בדוי בבירור: הספרות האמצעיות מוסתרות (D34)', 'text'],
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
  Cycles: [
    ['cycle_id', 'החודש של המסמכים. מחזור אוקטובר רץ בנובמבר', 'text'],
    ['due_date', 'תאריך היעד. המשרד יכול לשנות אותו באמצע המחזור', 'date'],
    ['includes_bimonthly', 'הלקוחות הדו-חודשיים במחזור הזה', 'checkbox'],
    ['status', 'open (פתוח) או closed (סגור). יש לכל היותר מחזור פתוח אחד', 'text'],
    ['opened_at', 'מתי נפתח', 'datetime'],
    ['closed_at', 'מתי נסגר', 'datetime'],
    ['reminder1_sent_at', 'מתי יצאה התזכורת הראשונה. ריק: עוד לא', 'datetime'],
    ['reminder2_sent_at', 'מתי יצאה התזכורת השנייה', 'datetime'],
    ['last_day_sent_at', 'מתי יצא "מחר היום האחרון"', 'datetime'],
    ['call_list_sent_at', 'מתי יצאה רשימת הטלפונים', 'datetime'],
    ['summary_sent_at', 'מתי יצא הסיכום החודשי', 'datetime'],
  ],
  Requests: [
    ['request_id', 'מזהה הבקשה: המחזור והלקוח', 'text'],
    ['cycle_id', 'המחזור', 'text'],
    ['client_id', 'הלקוח', 'text'],
    ['period', 'התקופה של המסמכים. אצל לקוח דו-חודשי: 2026-09_10', 'text'],
    ['status', 'not_started, partial, submitted (ממתין לבדיקה) או complete. מחושב', 'text'],
    ['reminder_count', 'כמה תזכורות נשלחו, כולל ידניות ווואטסאפ', 'number'],
    ['last_reminder_at', 'מתי נשלחה התזכורת האחרונה', 'datetime'],
    ['last_activity', 'הפעולה האחרונה, לטבלה בלוח', 'text'],
    ['last_activity_at', 'מתי', 'datetime'],
    ['client_note', 'ההערה האחרונה של הלקוח למשרד', 'text'],
    ['submitted_at', 'מתי הלקוח סיים (ממתין לבדיקה). לפי זה יודעים אם איחר', 'datetime'],
    ['completed_at', 'מתי המשרד סימן הושלם', 'datetime'],
    ['completed_by', 'מי סימן הושלם', 'text'],
    ['completion_note', 'חובה כשמסמנים הושלם למרות שחסר מסמך', 'text'],
    ['drive_folder_id', 'תיקיית החודש של הלקוח. נוצרת בהעלאה הראשונה', 'text'],
  ],
  Items: [
    ['item_id', 'מזהה הפריט: הבקשה וסוג המסמך', 'text'],
    ['request_id', 'הבקשה', 'text'],
    ['doc_type_id', 'סוג המסמך', 'text'],
    ['required', 'חובה. מועתק מ-DocTypes כשהמחזור נפתח', 'checkbox'],
    ['status', 'missing, received, rejected (לא קריא) או not_applicable (לא היה החודש)', 'text'],
    ['file_count', 'כמה קבצים פעילים יש לו', 'number'],
    ['na_note', 'ההערה של הלקוח ל"לא היה לי"', 'text'],
    ['reject_reason', 'הסיבה האחרונה ל"לא קריא"', 'text'],
    ['updated_at', 'השינוי האחרון', 'datetime'],
    ['updated_by', 'מי: client, מזהה איש צוות או system', 'text'],
    ['last_seq', 'המספר האחרון שניתן לקובץ של הפריט. לא יורד גם אחרי קובץ שנדחה (D31)', 'number'],
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
  Messages: [
    ['message_id', 'מזהה רץ', 'text'],
    ['created_at', 'מתי נוצרה', 'datetime'],
    ['send_after', 'לא לשלוח לפני. כאן נכנסות שעות השקט', 'datetime'],
    ['template_id', 'איזה נוסח', 'text'],
    ['cycle_id', 'המחזור', 'text'],
    ['request_id', 'הבקשה', 'text'],
    ['client_id', 'הלקוח', 'text'],
    ['staff_id', 'איש הצוות, בהודעה לצוות', 'text'],
    ['to_email', 'הנמען', 'text'],
    ['subject', 'נושא', 'text'],
    ['body', 'הנוסח המלא, כפי שנכתב ברגע השליחה', 'text'],
    ['status', 'queued, sent, simulated (במצב הדגמה: נרשמה ולא נשלחה, D11), cancelled או failed', 'text'],
    ['sent_at', 'מתי נשלחה או נרשמה', 'datetime'],
    ['note', 'סיבה לביטול או לכישלון', 'text'],
    ['created_by', 'system, או איש צוות ששלח ידנית', 'text'],
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

// ============================================================
// Default rows
// ============================================================

// Settings (data-model.md, Settings). setup() adds a missing key; it never changes a value.
function defaultSettings_() {
  return [
    ['office_name', "שדמי ושות', רואי חשבון", 'שם המשרד (D20)'],
    ['system_name', 'Nelio', 'שם המערכת (D20)'],
    ['office_email', CONFIG.officeEmail, 'הכתובת שממנה יוצאים המיילים'],
    ['client_page_url', CONFIG.clientPageUrl, 'כתובת הדף של הלקוח. ממנה נבנה הקישור האישי'],
    ['drive_root_folder_id', '', 'תיקיית השורש ב-Drive. נוצרת ב-setup'],
    ['max_file_mb', String(CONFIG.defaultMaxFileMb), 'גודל מקסימלי לקובץ, במגה-בייט (D32)'],
    ['request_day', '1', 'היום בחודש שבו נפתח מחזור ויוצאות הבקשות'],
    ['due_day', '12', 'תאריך היעד של כל מחזור חדש'],
    ['reminder1_days_before', '7', 'תזכורת ראשונה: כמה ימים לפני היעד'],
    ['reminder2_days_before', '3', 'תזכורת שנייה: כמה ימים לפני היעד'],
    ['last_day_days_before', '1', '"מחר היום האחרון": כמה ימים לפני היעד'],
    ['summary_days_after', '1', 'הסיכום לבעל המשרד: כמה ימים אחרי היעד'],
    ['send_time', '09:00', 'השעה שבה יוצאות ההודעות המתוזמנות'],
    ['quiet_start', '21:00', 'מתחילות שעות השקט בלילה'],
    ['quiet_end', '08:00', 'נגמרות שעות השקט בבוקר'],
    ['friday_cutoff', '13:00', 'מהשעה הזו בשישי ובערב חג אין הודעות'],
    ['bimonthly_months', '2,4,6,8,10,12', 'המחזורים שבהם נכללים הלקוחות הדו-חודשיים'],
    ['demo_mode', 'TRUE', 'מצב הדגמה: הודעות נרשמות ולא נשלחות (D11). seedDemo רץ רק כשזה TRUE'],
    ['demo_now', '', 'הזמן המדומה במצב הדגמה. ריק: הזמן האמיתי. ייבנה בשלב 7'],
    ['demo_real_email_clients', 'C01,C02,C03', 'הלקוחות שמקבלים מייל אמיתי גם במצב הדגמה (D11)'],
    ['test_link', '', 'קישור מוכן לבדיקה: מאפיית השקד (C07). נכתב ב-seedDemo'],
    ['test_link_2', '', "קישור מוכן לבדיקה: ג'ו שיפוצים בע״מ, עם גרש ומירכאות בשם. נכתב ב-seedDemo"],
  ];
}

function defaultStaff_() {
  return [
    { staff_id: 'S1', name: 'עמית שדמי', role: 'owner', email: plusAddress_('s1'), active: true },
    { staff_id: 'S2', name: 'מירב סלעי', role: 'bookkeeper', email: plusAddress_('s2'), active: true },
    { staff_id: 'S3', name: 'אסף מורג', role: 'bookkeeper', email: plusAddress_('s3'), active: true },
  ];
}

// D33: the types of documents, their labels in file names (Hebrew only, D31) and their order.
function defaultDocTypes_() {
  const rows = [
    ['Z_REPORTS', 'דוחות Z', 'דוחות הסיכום מהקופה לכל ימי החודש. אפשר צילום או קובץ מהקופה', true, 'דוחות-זד'],
    ['ISSUED_INVOICES', 'חשבוניות שהוצאתי', 'כל החשבוניות שהוצאתם החודש, או דוח מתוכנת החשבוניות', true, 'חשבוניות-שהוצאו'],
    ['SUPPLIER_INVOICES', 'חשבוניות ספקים', 'החשבוניות שקיבלתם מספקים, כולל קבלני משנה', true, 'חשבוניות-ספקים'],
    ['EXPENSE_RECEIPTS', 'קבלות על הוצאות', 'קבלות וחשבוניות על הוצאות העסק, למשל ציוד, תוכנה או חניה', true, 'קבלות-הוצאות'],
    ['FUEL_RECEIPTS', 'קבלות דלק', 'חשבוניות הדלק של החודש', true, 'קבלות-דלק'],
    ['BANK_STATEMENT', 'דף בנק', 'כל העמודים של החודש. אפשר צילום או קובץ מהאתר של הבנק', true, 'דף-בנק'],
    ['CREDIT_CARD', 'פירוט אשראי', 'פירוט החיובים בכרטיס האשראי של העסק', true, 'פירוט-אשראי'],
    ['EMPLOYEE_HOURS', 'דוח שעות עובדים', 'שעות העבודה של כל העובדים בחודש', true, 'דוח-שעות'],
    ['OTHER', 'מסמך אחר', 'כל מסמך נוסף, למשל מכתב מרשות המסים', false, 'מסמך-אחר'],
  ];
  return rows.map(function (r, i) {
    return { doc_type_id: r[0], name_he: r[1], description_he: r[2], required: r[3], file_label: r[4], sort_order: i + 1 };
  });
}

// D33: which documents each kind of business owes, as in brief.md.
function defaultProfiles_() {
  return [
    { profile_id: 'CASH_REGISTER', name_he: 'עסק עם קופה', applies_when: 'business_type',
      doc_types: 'Z_REPORTS,SUPPLIER_INVOICES,BANK_STATEMENT,CREDIT_CARD' },
    { profile_id: 'SERVICE', name_he: 'נותן שירות', applies_when: 'business_type',
      doc_types: 'ISSUED_INVOICES,EXPENSE_RECEIPTS,BANK_STATEMENT,CREDIT_CARD' },
    { profile_id: 'CONTRACTOR', name_he: 'קבלן או בעל מקצוע', applies_when: 'business_type',
      doc_types: 'ISSUED_INVOICES,SUPPLIER_INVOICES,FUEL_RECEIPTS,BANK_STATEMENT,CREDIT_CARD' },
    { profile_id: 'EMPLOYEES', name_he: 'עסק עם עובדים (תוספת)', applies_when: 'has_employees',
      doc_types: 'EMPLOYEE_HOURS' },
    { profile_id: 'ALL', name_he: 'כולם', applies_when: 'always', doc_types: 'OTHER' },
  ];
}

// The templates are in Messages.gs. Yom tov days: Tishrei 5787 (decisions.md, research of
// stage 4.1). Stage 7 fills the full list for the demo year.
function defaultHolidays_() {
  return [
    { date: dateOf_('2026-09-12'), name: 'ראש השנה' },
    { date: dateOf_('2026-09-13'), name: 'ראש השנה' },
    { date: dateOf_('2026-09-21'), name: 'יום כיפור' },
    { date: dateOf_('2026-09-26'), name: 'סוכות' },
    { date: dateOf_('2026-10-03'), name: 'שמחת תורה' },
  ];
}

// "2026-09-12" -> a date at midnight, Israel time.
function dateOf_(text) {
  const p = String(text).split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

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
  ensureDefaultRows_('Staff', 'staff_id', defaultStaff_());
  ensureDefaultRows_('DocTypes', 'doc_type_id', defaultDocTypes_());
  ensureDefaultRows_('Profiles', 'profile_id', defaultProfiles_());
  ensureDefaultRows_('Templates', 'template_id', defaultTemplates_());
  if (readTable_('Holidays').length === 0) defaultHolidays_().forEach(function (h) { appendRow_('Holidays', h); });

  const root = ensureRootFolder_();
  forgetModelCache_();

  logEvent_({ actor: 'system', event: 'setup', details: 'הגדרה הושלמה, גרסה ' + CONFIG.version });
  ss.setActiveSheet(ss.getSheetByName('Settings'));
  SpreadsheetApp.flush();

  console.log('ההגדרה הושלמה. גרסה ' + CONFIG.version);
  console.log('תיקיית השורש ב-Drive: ' + root.getUrl());
  console.log('כדי להקים את משרד הדמו, הריצו עכשיו את seedDemo.');
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
  defaultSettings_().forEach(function (setting) {
    if (existing.indexOf(setting[0]) === -1) {
      appendRow_('Settings', { key: setting[0], value: setting[1], description: setting[2] });
    }
  });
  forgetCached_('settings');
}

// Adds the default rows whose ID is missing. Rows the office changed stay as they are.
function ensureDefaultRows_(sheetName, idColumn, rows) {
  const existing = readTable_(sheetName).map(function (r) { return String(r[idColumn]); });
  rows.forEach(function (row) {
    if (existing.indexOf(String(row[idColumn])) === -1) appendRow_(sheetName, row);
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
