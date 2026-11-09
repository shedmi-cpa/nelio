/**
 * Nelio · the messages (data-model.md, Templates and Messages).
 *
 * A template has fields in square brackets, in Hebrew, like [שם העסק]. A message is written from
 * its template only at the moment it is sent, so a reminder lists what is missing at that moment
 * (data-model.md 3.4). The texts are drafts from brief.md, with small wording fixes. Stage 7
 * decides the final texts, including the second reminder.
 */

function defaultTemplates_() {
  const signature = '\n\nתודה,\n[שם המשרד]';
  return [
    { template_id: 'REQUEST', name_he: 'בקשה חודשית', recipient: 'client',
      subject: 'מסמכים ל[חודש]: [שם המשרד]',
      body: 'שלום [שם איש הקשר],\nמתחילים לאסוף את המסמכים של [חודש]. כדי שנגיש את הדוח בזמן, ' +
        'צריך מכם עד [תאריך היעד]:\n[רשימת המסמכים]\n\nמעלים מהטלפון, בדקה: [קישור]' + signature },
    { template_id: 'REMINDER_1', name_he: 'תזכורת ראשונה', recipient: 'client',
      subject: 'תזכורת: מסמכים ל[חודש]',
      body: 'שלום [שם איש הקשר],\nעוד חסר לנו ל[חודש]: [מה שחסר].\nאפשר להעלות כאן: [קישור]\n' +
        'אם לא היה לכם מסמך כזה החודש, אפשר לסמן "לא היה לי".' + signature },
    { template_id: 'REMINDER_2', name_he: 'תזכורת שנייה', recipient: 'client',
      subject: 'תזכורת שנייה: מסמכים ל[חודש]',
      body: 'שלום [שם איש הקשר],\nתאריך היעד למסמכים של [חודש] הוא [תאריך היעד], ועדיין חסר לנו: ' +
        '[מה שחסר].\nבלי המסמכים האלה לא נוכל להגיש את הדוח בזמן. מעלים כאן, בדקה: [קישור]\n' +
        'אם משהו לא ברור, אפשר פשוט להשיב למייל הזה.' + signature },
    { template_id: 'LAST_DAY', name_he: 'מחר היום האחרון', recipient: 'client',
      subject: 'מחר היום האחרון: מסמכים ל[חודש]',
      body: 'שלום [שם איש הקשר],\nמחר היום האחרון למסמכים של [חודש]. עוד חסר: [מה שחסר].\n[קישור]' + signature },
    { template_id: 'REJECTED', name_he: 'מסמך לא קריא', recipient: 'client',
      subject: 'צריך להעלות שוב: [סוג המסמך]',
      body: 'שלום [שם איש הקשר],\nהקובץ שהעליתם ב"[סוג המסמך]" לא קריא: [סיבה].\n' +
        'אפשר לצלם שוב ולהעלות כאן? [קישור]' + signature },
    { template_id: 'CONFIRMATION', name_he: 'אישור', recipient: 'client',
      subject: 'קיבלנו את כל המסמכים ל[חודש]',
      body: 'שלום [שם איש הקשר],\nתודה! קיבלנו את כל המסמכים ל[חודש]. אם נצטרך עוד משהו, נעדכן.\n\n[שם המשרד]' },
    { template_id: 'CALL_LIST', name_he: 'רשימת טלפונים', recipient: 'bookkeeper',
      subject: 'רשימת טלפונים להיום: [חודש]',
      body: 'שלום [שם איש הצוות],\nהיום תאריך היעד של [חודש]. ללקוחות האלה עוד חסר משהו:\n' +
        '[רשימת הלקוחות]\n\nאת הפרטים המלאים רואים בלוח הבקרה.' },
    { template_id: 'SUMMARY', name_he: 'סיכום חודשי', recipient: 'owner',
      subject: 'סיכום [חודש]',
      body: 'שלום [שם איש הצוות],\nסיכום [חודש]: [X] מתוך [Y] לקוחות השלימו ([אחוז]).\n' +
        'באיחור: [רשימה].\nמסמכים שסומנו כלא קריאים: [מספר].' },
    { template_id: 'WHATSAPP', name_he: 'תזכורת בוואטסאפ', recipient: 'client', subject: '',
      body: 'שלום [שם איש הקשר], כאן [שם המשרד]. עוד חסר לנו ל[חודש]: [מה שחסר]. אפשר להעלות כאן: [קישור]' },
    { template_id: 'NEW_LINK', name_he: 'קישור חדש', recipient: 'client',
      subject: 'קישור חדש להעלאת מסמכים',
      body: 'שלום [שם איש הקשר],\nיצרנו לכם קישור חדש להעלאת המסמכים: [קישור]\nהקישור הקודם כבר לא פעיל.' + signature },
  ];
}

// Replaces every [field] that has a value. A field without a value stays as it is, so a typo in
// a template is easy to see.
function renderTemplate_(text, values) {
  return String(text || '').replace(/\[([^\[\]\n]+)\]/g, function (match, field) {
    return Object.prototype.hasOwnProperty.call(values, field) ? String(values[field]) : match;
  });
}

// The values of the fields for one message.
//   message: { templateId, ctx } (ctx: what the message is about, see demo/generate_seed.py)
//   world:   { client, staff, request, cycleId, docNames, clientsById, link, officeName }
function messageValues_(message, world) {
  const ctx = message.ctx || {};
  const names = world.docNames;
  const values = {
    'שם המשרד': world.officeName,
    'חודש': periodLabel_(world.request ? world.request.period : world.cycleId),
  };
  if (world.client) {
    values['שם איש הקשר'] = world.client.contact_name;
    values['שם העסק'] = world.client.business_name;
    values['קישור'] = world.link || '';
  }
  if (world.staff) values['שם איש הצוות'] = String(world.staff.name).split(' ')[0];
  if (ctx.due) values['תאריך היעד'] = formatDate_(dateOf_(ctx.due));
  if (ctx.docs) values['רשימת המסמכים'] = ctx.docs.map(function (d) { return '• ' + names[d]; }).join('\n');
  if (ctx.missing) values['מה שחסר'] = missingText_(ctx.missing, names);
  if (ctx.doc) values['סוג המסמך'] = names[ctx.doc];
  if (ctx.reason) values['סיבה'] = ctx.reason;
  if (ctx.clients) {
    values['רשימת הלקוחות'] = ctx.clients.map(function (c) {
      const client = world.clientsById[c.client_id];
      return '• ' + client.business_name + ' (' + c.client_id + '): ' + missingText_(c.missing, names);
    }).join('\n');
  }
  if (ctx.y) {
    values['X'] = ctx.x;
    values['Y'] = ctx.y;
    values['אחוז'] = Math.round(100 * ctx.x / ctx.y) + '%';
    values['רשימה'] = ctx.late.length
      ? ctx.late.map(function (id) { return world.clientsById[id].business_name; }).join(', ')
      : 'אין';
    values['מספר'] = ctx.rejected_count;
  }
  return values;
}

// "דף בנק (לא קריא), חשבוניות ספקים"
function missingText_(missing, names) {
  return missing.map(function (m) { return names[m.doc] + (m.rejected ? ' (לא קריא)' : ''); }).join(', ');
}

// ============================================================
// The confirmation to the client (stage 5.2)
// ============================================================

// A client's request just reached "ממתין לבדיקה": the confirmation goes into the queue
// (data-model.md 3.2 and 3.4). It is written from the template now, because it says nothing that
// changes later. In demo mode it is recorded with its full text and not sent (D11). Real sending,
// the quiet hours (send_after) and the few clients who get a real email in demo mode are stage 7.
// Call it inside the lock.
function queueConfirmation_(client, req, cycleId, at) {
  const clientRow = readTable_('Clients').filter(function (r) {
    return String(r.client_id).trim() === client.clientId;
  })[0];
  if (!clientRow) return;
  const template = readTable_('Templates').filter(function (r) {
    return String(r.template_id) === 'CONFIRMATION';
  })[0] || defaultTemplates_().filter(function (t) { return t.template_id === 'CONFIRMATION'; })[0];
  const values = messageValues_({ templateId: 'CONFIRMATION', ctx: {} }, {
    client: clientRow, staff: null, request: { period: req.period }, cycleId: cycleId,
    docNames: {}, clientsById: {}, officeName: getSetting_('office_name'),
    link: buildClientLink_(client.token),
  });
  const demo = isChecked_(getSetting_('demo_mode'));
  const messageId = nextMessageId_();
  appendRow_('Messages', {
    message_id: messageId,
    created_at: at,
    send_after: at,
    template_id: 'CONFIRMATION',
    cycle_id: cycleId,
    request_id: req.requestId,
    client_id: client.clientId,
    to_email: String(clientRow.email || '').trim(),
    subject: renderTemplate_(template.subject, values),
    body: renderTemplate_(template.body, values),
    status: demo ? 'simulated' : 'queued',
    sent_at: demo ? at : '',
    note: demo ? 'מצב הדגמה: נרשמה ולא נשלחה' : '',
    created_by: 'system',
  });
  logEvent_({
    actor: 'system',
    event: 'message',
    client_id: client.clientId,
    request_id: req.requestId,
    details: 'הודעת אישור ' + messageId + (demo ? ' נרשמה (מצב הדגמה)' : ' נכנסה לתור'),
  });
}

// "M00413": one more than the highest number in the Messages tab.
function nextMessageId_() {
  const sheet = getSheet_('Messages');
  const last = sheet.getLastRow();
  let highest = 0;
  if (last >= 2) {
    const column = getHeaders_(sheet).indexOf('message_id') + 1;
    sheet.getRange(2, column, last - 1, 1).getValues().forEach(function (row) {
      const n = Number(String(row[0]).replace(/\D/g, '')) || 0;
      if (n > highest) highest = n;
    });
  }
  return 'M' + ('0000' + (highest + 1)).slice(-5);
}
