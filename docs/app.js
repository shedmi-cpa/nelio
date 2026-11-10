/* Nelio · client page · stage 5.2: the full page
 *
 * 1. Reads the personal token from the link (#t=...).
 * 2. Asks the server ("hello") whether the link is valid, which month is open, and which
 *    documents the client has to send.
 * 3. Shows the documents as the client's folder (D38): a line per document, and under the line
 *    that is open, what the client can do with it: photograph, choose files, or say "לא היה לי
 *    מסמך כזה החודש".
 * 4. Uploads the chosen files one after another ("upload"), each to the document it was chosen
 *    for. Before sending, a photo is shrunk on the phone (D29).
 * 5. When every required document is received or marked, the page says thank you, with the stamp.
 *
 * The upload progress bar counts completed files and estimates time within the current file.
 * It does not measure transferred bytes. The API is now Supabase Edge Functions (0.6.0).
 *
 * The link #t=...&debug=1 also shows the technical details of every upload (for the tests).
 */
(function () {
  'use strict';

  const PAGE_VERSION = '0.6.0';
  const API_URL = String((window.NELIO_CONFIG && window.NELIO_CONFIG.apiUrl) || '').trim();
  const REQUEST_TIMEOUT_MS = 180000; // 3 minutes
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];
  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];
  const OTHER_DOC_TYPE = 'OTHER';

  // Shrinking a photo. 2000 pixels on the long side is about 170 dpi on an A4 page: a receipt or
  // a bank statement stays readable. A photo that is already small is sent as it is.
  const MAX_SIDE_PX = 2000;
  const JPEG_QUALITY = 0.8;
  const JPEG_QUALITY_LOW = 0.65;   // second try, when the first result is still big
  const BIG_RESULT_BYTES = 1200 * 1024;
  const SKIP_SHRINK_BYTES = 350 * 1024;
  const MAX_PHOTO_MB = 40;         // a photo bigger than this is not even opened (memory of the phone)

  // The estimate for the bar: the server's own part is about 6 seconds, and the sending speed
  // starts as a guess (about 1.2 Mbit per second) and is replaced by what the phone measures.
  const SERVER_SECONDS_GUESS = 6;
  const BASE64_FACTOR = 4 / 3;
  const START_SPEED_BYTES_PER_SECOND = 150 * 1024;

  const MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט',
    'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  // Squares like a paper form (D38): checked, empty, with an X, and with a dash (not this month).
  const ICONS = {
    received: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 12.5l2.5 2.5l4.5-5"/></svg>',
    missing: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    rejected: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9.5 9.5l5 5m0-5l-5 5"/></svg>',
    not_applicable: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8.5 12h7"/></svg>',
  };

  const TEXT = {
    noServerTitle: 'השרת עוד לא מחובר',
    noServerText: 'חסרה כתובת השרת בקובץ config.js, או שיש בקובץ טעות.',
    noTokenTitle: 'הקישור לא שלם',
    noTokenText: 'פתחו את הקישור האישי שקיבלתם מהמשרד, במלואו.',
    badTokenTitle: 'הקישור לא פעיל',
    offlineTitle: 'אין חיבור',
    offlineText: 'לא הצלחנו להגיע לשרת. בדקו את החיבור לאינטרנט ונסו שוב.',
    offlineHint: 'לבדיקה: אם האינטרנט תקין, נסו שוב בעוד כמה דקות. אם הבעיה נמשכת, פנו למשרד.',
    errorTitle: 'משהו השתבש',
    badResponse: 'השרת החזיר תשובה לא צפויה. נסו שוב בעוד כמה דקות.',
    noRequestTitle: 'שלום, ',

    // The top of the page
    titleOpen: 'המסמכים של {period}',
    titleDone: 'תודה, קיבלנו הכול',
    dueFuture: 'צריך עד {date}.',
    dueToday: 'צריך עד היום.',
    duePast: 'התאריך היה {date}.',
    missingMany: 'חסרים עוד {n}.',
    missingOne: 'חסר עוד מסמך אחד.',
    subtitleDone: 'כל המסמכים של {period} אצלנו. נשלח אליכם אישור במייל. אם יש עוד משהו להוסיף, אפשר להמשיך כאן.',

    // The documents
    state: { missing: 'חסר', received: 'התקבל', rejected: 'לא קריא', not_applicable: 'לא היה החודש', optional: 'לא חובה' },
    receivedMany: 'התקבל ({n} קבצים)',
    rejectedPanel: 'נא להעלות שוב.',
    rejectedReason: ' הסיבה: {reason}',
    naPanel: 'סימנתם שלא היה לכם מסמך כזה החודש.',
    naPanelNote: ' ההערה שלכם: {note}',
    camera: 'צילום והעלאה',
    cameraMore: 'הוספת צילום או עמוד',
    cameraAgain: 'צילום והעלאה מחדש',
    pickFiles: 'או בחירת תמונה או קובץ מהמכשיר',
    notThisMonth: 'לא היה לי מסמך כזה החודש',
    undoNa: 'בעצם יש לי, ביטול הסימון',
    naLabel: 'רוצים להוסיף הערה? (לא חובה)',
    naSubmit: 'לא היה לי החודש',
    cancel: 'ביטול',

    // The note to the office
    noteOpen: 'יש משהו להגיד למשרד?',
    noteSend: 'שליחה',
    noteSent: 'ההערה נשלחה למשרד.',
    noteEmpty: 'כתבו את ההערה ואז שלחו.',

    // Uploading
    waiting: 'ממתין…',
    shrinking: 'מכווצים את התמונה…',
    uploading: 'מעלים…',
    received: 'התקבל',
    retry: 'נסו שוב',
    offline: 'אין חיבור לאינטרנט. כשהחיבור יחזור, אפשר לנסות שוב.',
    emptyFile: 'הקובץ ריק.',
    badType: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
    tooBig: 'הקובץ גדול מדי ({size}). הגודל המקסימלי הוא {max} מגה-בייט. אפשר לסרוק פחות עמודים או באיכות נמוכה יותר, או לשלוח את הקובץ למשרד: ',
    photoTooBig: 'התמונה גדולה מדי ({size}). נסו לצלם שוב, או לבחור תמונה קטנה יותר.',
    imageFailed: 'לא הצלחנו לעבד את התמונה. נסו לצלם שוב.',
    readError: 'לא הצלחנו לקרוא את הקובץ מהמכשיר. נסו לבחור אותו שוב.',
    timeout: 'ההעלאה לקחה יותר מדי זמן. בדקו את החיבור ונסו שוב.',
    connectionLost: 'החיבור לשרת נכשל. בדקו את החיבור ונסו שוב.',
    progressFile: 'מעלים קובץ {n} מתוך {total}',
    allUploaded: 'כל הקבצים הועלו.',
    someFailed: 'חלק מהקבצים לא הועלו. פרטים מתחת לכל מסמך.',

    // Technical details (only with debug=1, and the line at the bottom)
    seconds: 'שניות',
    onServer: 'בשרת',
    opened: 'נפתח תוך',
    shrunk: 'כווצה מ-{from} ל-{to}',
  };

  // Server answers after which trying again can help. Anything else needs a different file.
  const RETRY_CODES = ['BUSY', 'SERVER_ERROR', 'BAD_FILE', 'BAD_RESPONSE', 'UPLOAD_PENDING'];

  const els = {
    logo: document.getElementById('office-logo'),
    message: document.getElementById('view-message'),
    messageTitle: document.getElementById('message-title'),
    messageText: document.getElementById('message-text'),
    messageHint: document.getElementById('message-hint'),
    retry: document.getElementById('retry-button'),
    page: document.getElementById('view-page'),
    stamp: document.getElementById('stamp'),
    title: document.getElementById('title'),
    subtitle: document.getElementById('subtitle'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progress-text'),
    progressFill: document.getElementById('progress-fill'),
    tab: document.getElementById('folder-tab'),
    docs: document.getElementById('docs'),
    officeNote: document.getElementById('office-note'),
    noteOpen: document.getElementById('note-open'),
    noteForm: document.getElementById('note-form'),
    noteText: document.getElementById('note-text'),
    noteSend: document.getElementById('note-send'),
    noteCancel: document.getElementById('note-cancel'),
    noteStatus: document.getElementById('note-status'),
    camera: document.getElementById('camera-input'),
    files: document.getElementById('files-input'),
    versions: document.getElementById('versions'),
  };

  const params = readHashParams();
  const state = {
    token: readToken(params),
    debug: params.get('debug') === '1',
    maxFileMb: 10,             // replaced by the server's value (Settings > max_file_mb, D32)
    officeEmail: '',
    today: '',                 // "dd/mm/yyyy", the server's date
    periodLabel: '',
    dueDate: '',
    queue: Promise.resolve(),  // uploads run one after another
    firstOpen: true,           // the opening time is shown only for the first try, not after "נסו שוב"
    items: [],                 // the documents of the open month, as the server sent them
    docEls: {},                // docTypeId -> the elements of its line
    target: '',                // the document the next chosen files belong to
    openDoc: '',               // the document whose line is open
    wasDone: null,             // null until the first time the top of the page is painted
    speed: START_SPEED_BYTES_PER_SECOND,
    batch: { total: 0, done: 0, failed: 0 },
    current: null,             // { startedAt, estimateSeconds } of the file being sent
    timer: 0,
  };

  window.addEventListener('hashchange', function () { window.location.reload(); });
  els.retry.addEventListener('click', start);
  els.camera.addEventListener('change', onFilesChosen);
  els.files.addEventListener('change', onFilesChosen);
  els.noteOpen.addEventListener('click', openNoteForm);
  els.noteCancel.addEventListener('click', closeNoteForm);
  els.noteForm.addEventListener('submit', sendNote);
  showVersions('');
  start();

  // ---------- Opening the page ----------

  async function start() {
    if (!isConfigured(API_URL)) return showMessage(TEXT.noServerTitle, TEXT.noServerText);
    if (!state.token) return showMessage(TEXT.noTokenTitle, TEXT.noTokenText);

    show('page');
    const firstOpen = state.firstOpen;
    state.firstOpen = false;
    let res;
    try {
      res = await callServer({ action: 'hello', token: state.token });
    } catch (err) {
      return showMessage(TEXT.offlineTitle, TEXT.offlineText, { retry: true, hint: TEXT.offlineHint });
    }

    if (res.ok && res.state === 'noRequest') {
      // A client with no request in the open month, for example bimonthly in an odd month.
      showMessage(TEXT.noRequestTitle + (res.businessName || ''), res.message);
      showVersions(res.version);
    } else if (res.ok) {
      state.maxFileMb = Number(res.maxFileMb) || state.maxFileMb;
      state.officeEmail = String(res.officeEmail || '');
      state.today = String(res.today || '');
      state.periodLabel = String(res.periodLabel || '');
      state.dueDate = String(res.dueDate || '');
      state.items = Array.isArray(res.items) ? res.items : [];
      els.tab.textContent = '';
      els.tab.appendChild(isolated(res.businessName || ''));
      buildDocs();
      paintTop();
      els.officeNote.hidden = false;
      els.page.setAttribute('aria-busy', 'false');
      // How long the page took to open, from the tap on the link (for the tests).
      // performance.now() counts from the moment the browser started loading the page.
      const openSeconds = firstOpen && window.performance && typeof performance.now === 'function'
        ? performance.now() / 1000 : 0;
      showVersions(res.version, openSeconds, res.serverMs);
    } else if (res.code === 'BAD_TOKEN') {
      showMessage(TEXT.badTokenTitle, res.message);
    } else {
      showMessage(TEXT.errorTitle, res.message || TEXT.badResponse, { retry: true });
    }
  }

  // ---------- The top of the page ----------

  // The title, the line under it, and the stamp. The stamp lands with a movement only when the
  // last document was closed during this visit; a client who comes back sees it at rest.
  function paintTop() {
    const left = missingCount();
    const done = state.items.length > 0 && left === 0;
    const period = shortPeriod(state.periodLabel);
    els.title.classList.remove('skeleton-text');
    els.subtitle.classList.remove('skeleton-text');
    if (done) {
      els.title.textContent = TEXT.titleDone;
      els.subtitle.textContent = TEXT.subtitleDone.replace('{period}', period);
    } else {
      els.title.textContent = TEXT.titleOpen.replace('{period}', period);
      const parts = [];
      const due = dueSentence();
      if (due) parts.push(due);
      if (state.items.length) parts.push(left === 1 ? TEXT.missingOne : TEXT.missingMany.replace('{n}', String(left)));
      els.subtitle.textContent = parts.join(' ');
    }
    els.subtitle.hidden = !els.subtitle.textContent;

    const justDone = done && state.wasDone === false;
    els.stamp.hidden = !done;
    els.stamp.classList.remove('animate');
    if (justDone) {
      void els.stamp.offsetWidth;      // lets the browser start the movement again
      els.stamp.classList.add('animate');
      scrollToTop();
    }
    state.wasDone = done;
  }

  function missingCount() {
    return state.items.filter(function (i) {
      return i.required && (i.status === 'missing' || i.status === 'rejected');
    }).length;
  }

  // "אוקטובר 2026" is "אוקטובר" while the year is this year.
  function shortPeriod(label) {
    const year = (state.today.match(/(\d{4})$/) || [])[1];
    return year ? String(label).replace(new RegExp(' ' + year + '$'), '') : String(label);
  }

  // "צריך עד 12 בנובמבר." / "צריך עד היום." / "התאריך היה 12 בנובמבר."
  function dueSentence() {
    const due = parseDate(state.dueDate);
    if (!due) return '';
    const today = parseDate(state.today);
    let text = due.d + ' ב' + MONTHS[due.m - 1];
    if (today && due.y !== today.y) text += ' ' + due.y;
    if (today) {
      const a = due.y * 10000 + due.m * 100 + due.d;
      const b = today.y * 10000 + today.m * 100 + today.d;
      if (a === b) return TEXT.dueToday;
      if (a < b) return TEXT.duePast.replace('{date}', text);
    }
    return TEXT.dueFuture.replace('{date}', text);
  }

  function parseDate(text) {
    const m = String(text || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? { d: Number(m[1]), m: Number(m[2]), y: Number(m[3]) } : null;
  }

  function scrollToTop() {
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' });
    } catch (err) {
      window.scrollTo(0, 0);
    }
  }

  // ---------- The list of documents ----------

  function buildDocs() {
    els.docs.textContent = '';
    state.docEls = {};
    state.items.forEach(function (item) {
      const d = createDoc(item);
      els.docs.appendChild(d.li);
      state.docEls[item.docTypeId] = d;
      paintItem(item);
    });
    // The first document that still needs something is open, so the client starts right there.
    const first = state.items.filter(function (i) { return i.status === 'missing' || i.status === 'rejected'; })[0];
    if (first) toggleDoc(first.docTypeId, true);
  }

  function createDoc(item) {
    const id = item.docTypeId;
    const li = make('li', 'doc');
    const row = make('button', 'doc-row');
    const box = make('span', 'box');
    const name = make('span', 'doc-name');
    const stateEl = make('span', 'doc-state');
    const panel = make('div', 'doc-panel');
    const desc = make('p', 'doc-desc');
    const rejected = make('p', 'reject-reason');
    const naText = make('p', 'na-text');
    const actions = make('div', 'actions');
    const results = make('ul', 'results');

    row.type = 'button';
    row.setAttribute('aria-expanded', 'false');
    row.setAttribute('aria-controls', 'panel-' + id);
    name.textContent = item.name;
    panel.id = 'panel-' + id;
    panel.hidden = true;
    row.appendChild(box);
    row.appendChild(name);
    row.appendChild(stateEl);
    row.addEventListener('click', function () { toggleDoc(id); });

    const camera = actionButton('', 'button', function () { chooseFor(id, els.camera); });
    const pick = actionButton(TEXT.pickFiles, 'linkish', function () { chooseFor(id, els.files); });
    const notThisMonth = actionButton(TEXT.notThisMonth, 'linkish', function () { openNaForm(id); });
    const undoNa = actionButton(TEXT.undoNa, 'linkish', function () { undoNotApplicable(id); });
    actions.appendChild(camera);
    actions.appendChild(pick);
    actions.appendChild(notThisMonth);
    actions.appendChild(undoNa);

    // "לא היה לי": an optional note, then the button that sends it.
    const naForm = make('div', 'na-form');
    const naLabel = make('label', '');
    const naInput = make('input', '');
    const naError = make('p', 'form-error');
    const naButtons = make('div', 'form-actions');
    naLabel.textContent = TEXT.naLabel;
    naLabel.setAttribute('for', 'na-' + id);
    naInput.type = 'text';
    naInput.id = 'na-' + id;
    naInput.maxLength = 200;
    naInput.autocomplete = 'off';
    naError.hidden = true;
    const naSubmit = actionButton(TEXT.naSubmit, 'button small', function () { submitNotApplicable(id); });
    const naCancel = actionButton(TEXT.cancel, 'linkish', function () { closeNaForm(id); });
    naButtons.appendChild(naSubmit);
    naButtons.appendChild(naCancel);
    naForm.appendChild(naLabel);
    naForm.appendChild(naInput);
    naForm.appendChild(naError);
    naForm.appendChild(naButtons);
    naForm.hidden = true;
    naInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); submitNotApplicable(id); }
    });

    results.className = 'results';
    panel.appendChild(desc);
    panel.appendChild(rejected);
    panel.appendChild(naText);
    panel.appendChild(actions);
    panel.appendChild(naForm);
    panel.appendChild(results);
    li.appendChild(row);
    li.appendChild(panel);

    return {
      li: li, row: row, box: box, state: stateEl, panel: panel, desc: desc, rejected: rejected,
      naText: naText, camera: camera, pick: pick, notThisMonth: notThisMonth, undoNa: undoNa,
      naForm: naForm, naInput: naInput, naError: naError, naSubmit: naSubmit, results: results,
    };
  }

  function make(tag, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    return el;
  }

  function actionButton(label, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  // One line open at a time.
  function toggleDoc(docTypeId, forceOpen) {
    Object.keys(state.docEls).forEach(function (id) {
      const d = state.docEls[id];
      const open = id === docTypeId && (forceOpen === true || state.openDoc !== docTypeId);
      d.panel.hidden = !open;
      d.row.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    state.openDoc = state.docEls[docTypeId] && !state.docEls[docTypeId].panel.hidden ? docTypeId : '';
  }

  function chooseFor(docTypeId, input) {
    state.target = docTypeId;
    input.click();
  }

  // Everything that depends on the state of one document: the square, the word, and what is under the line.
  function paintItem(item) {
    const d = state.docEls[item.docTypeId];
    if (!d) return;
    const status = item.status || 'missing';
    const optionalEmpty = item.other && status === 'missing';
    d.li.dataset.state = optionalEmpty ? 'optional' : status;
    d.box.innerHTML = ICONS[status === 'missing' || optionalEmpty ? 'missing' : status] || ICONS.missing;

    let word = optionalEmpty ? TEXT.state.optional : (TEXT.state[status] || TEXT.state.missing);
    if (status === 'received' && item.fileCount > 1) word = TEXT.receivedMany.replace('{n}', String(item.fileCount));
    d.state.textContent = word;

    d.desc.textContent = item.description || '';
    d.desc.hidden = !item.description;

    const isRejected = status === 'rejected';
    d.rejected.hidden = !isRejected;
    d.rejected.textContent = isRejected
      ? TEXT.rejectedPanel + (item.rejectReason ? TEXT.rejectedReason.replace('{reason}', item.rejectReason) : '')
      : '';

    const isNa = status === 'not_applicable';
    d.naText.hidden = !isNa;
    d.naText.textContent = isNa
      ? TEXT.naPanel + (item.naNote ? TEXT.naPanelNote.replace('{note}', item.naNote) : '')
      : '';

    d.camera.textContent = isRejected ? TEXT.cameraAgain : status === 'received' ? TEXT.cameraMore : TEXT.camera;
    d.camera.className = status === 'received' ? 'button outline' : 'button';
    d.notThisMonth.hidden = item.other || !(status === 'missing' || isRejected);
    d.undoNa.hidden = !isNa;
    if (!(status === 'missing' || isRejected)) closeNaForm(item.docTypeId);
  }

  // The server's new view of one document (after an upload or "לא היה לי").
  function applyItem(view) {
    for (let i = 0; i < state.items.length; i++) {
      if (state.items[i].docTypeId === view.docTypeId) state.items[i] = view;
    }
    paintItem(view);
    paintTop();
  }

  // ---------- "לא היה לי מסמך כזה החודש" ----------

  function openNaForm(docTypeId) {
    const d = state.docEls[docTypeId];
    if (!d) return;
    d.naForm.hidden = false;
    d.notThisMonth.hidden = true;
    d.naError.hidden = true;
    d.naInput.focus();
  }

  function closeNaForm(docTypeId) {
    const d = state.docEls[docTypeId];
    if (!d || d.naForm.hidden) return;
    d.naForm.hidden = true;
    d.naInput.value = '';
    d.naError.hidden = true;
    const item = state.items.filter(function (i) { return i.docTypeId === docTypeId; })[0];
    if (item) d.notThisMonth.hidden = item.other || !(item.status === 'missing' || item.status === 'rejected');
  }

  async function submitNotApplicable(docTypeId) {
    const d = state.docEls[docTypeId];
    if (!d || d.naSubmit.disabled) return;
    d.naSubmit.disabled = true;
    d.naError.hidden = true;
    try {
      const res = await callServer({ action: 'markNa', token: state.token, docTypeId: docTypeId, note: d.naInput.value });
      if (!res.ok) {
        d.naError.textContent = res.message || TEXT.badResponse;
        d.naError.hidden = false;
      } else {
        d.naForm.hidden = true;   // paintItem (below) puts everything else in order
        d.naInput.value = '';
        if (res.item) applyItem(res.item);
      }
    } catch (err) {
      d.naError.textContent = TEXT.connectionLost;
      d.naError.hidden = false;
    } finally {
      d.naSubmit.disabled = false;
    }
  }

  async function undoNotApplicable(docTypeId) {
    const d = state.docEls[docTypeId];
    if (!d || d.undoNa.disabled) return;
    d.undoNa.disabled = true;
    try {
      const res = await callServer({ action: 'unmarkNa', token: state.token, docTypeId: docTypeId });
      if (res.ok && res.item) applyItem(res.item);
      else d.naText.textContent = res.message || TEXT.badResponse;
    } catch (err) {
      d.naText.textContent = TEXT.connectionLost;
    } finally {
      d.undoNa.disabled = false;
    }
  }

  // ---------- The note to the office ----------

  function openNoteForm() {
    els.noteForm.hidden = false;
    els.noteStatus.hidden = true;
    els.noteOpen.hidden = true;
    els.noteOpen.setAttribute('aria-expanded', 'true');
    els.noteText.focus();
  }

  function closeNoteForm() {
    els.noteForm.hidden = true;
    els.noteOpen.hidden = false;
    els.noteOpen.setAttribute('aria-expanded', 'false');
  }

  async function sendNote(event) {
    event.preventDefault();
    if (els.noteSend.disabled) return;
    const text = els.noteText.value.trim();
    showNoteStatus(text ? '' : TEXT.noteEmpty, true);
    if (!text) return;
    els.noteSend.disabled = true;
    try {
      const res = await callServer({ action: 'note', token: state.token, note: text });
      if (res.ok) {
        els.noteText.value = '';
        closeNoteForm();
        showNoteStatus(TEXT.noteSent, false);
      } else {
        showNoteStatus(res.message || TEXT.badResponse, true);
      }
    } catch (err) {
      showNoteStatus(TEXT.connectionLost, true);
    } finally {
      els.noteSend.disabled = false;
    }
  }

  function showNoteStatus(text, isError) {
    els.noteStatus.textContent = text;
    els.noteStatus.hidden = !text;
    els.noteStatus.style.color = isError ? 'var(--rejected)' : '';
  }

  // ---------- Uploading ----------

  function onFilesChosen(event) {
    const input = event.target;
    const files = Array.prototype.slice.call(input.files || []);
    input.value = ''; // so the same file can be chosen again
    const docTypeId = state.target;
    if (!docTypeId || !state.docEls[docTypeId]) return;
    files.forEach(function (file) {
      enqueue(file, addRow(file, docTypeId), docTypeId);
    });
  }

  function enqueue(file, row, docTypeId) {
    // A new batch after the last one finished: the counters start again.
    if (state.batch.done >= state.batch.total) state.batch = { total: 0, done: 0, failed: 0 };
    state.batch.total += 1;
    paintProgress();
    state.queue = state.queue.then(function () { return uploadOne(file, row, docTypeId); });
  }

  async function uploadOne(file, row, docTypeId) {
    startCurrent(file.size);
    try {
      await processFile(file, row, docTypeId);
    } finally {
      state.batch.done += 1;
      endCurrent();
    }
  }

  async function processFile(file, row, docTypeId) {
    const problem = checkChosenFile(file);
    if (problem) return fail(row, problem);

    const startedAt = now();
    let blob = file;
    let sentName = file.name || '';
    if (isImage(file)) {
      row.busy(TEXT.shrinking);
      try {
        const shrunk = await shrinkImage(file);
        blob = shrunk.blob;
        sentName = shrunk.name;
      } catch (err) {
        // The browser could not open the photo (for example HEIC on a computer). The original
        // goes as it is, if the server would accept it; otherwise the client is told.
        if (file.size > state.maxFileMb * 1024 * 1024) return fail(row, TEXT.imageFailed);
      }
    }
    if (blob.size > state.maxFileMb * 1024 * 1024) {
      return fail(row, TEXT.tooBig.replace('{size}', formatSize(blob.size)).replace('{max}', String(state.maxFileMb)),
        { office: true });
    }
    const shrinkSeconds = (now() - startedAt) / 1000;

    row.busy(TEXT.uploading);
    startCurrent(blob.size);
    let data;
    try {
      data = await readAsBase64(blob);
    } catch (err) {
      return fail(row, TEXT.readError);
    }

    if (window.navigator && window.navigator.onLine === false) {
      return fail(row, TEXT.offline, { retry: function () { retry(file, row, docTypeId); } });
    }

    const sendStartedAt = now();
    let res;
    try {
      res = await callServer({
        action: 'upload',
        token: state.token,
        docTypeId: docTypeId,
        uploadKey: row.uploadKey,   // the server deduplicates retries using this key
        fileName: sentName,
        mimeType: blob.type || file.type || '',
        size: blob.size,
        data: data,
      });
    } catch (err) {
      return fail(row, err && err.name === 'AbortError' ? TEXT.timeout : TEXT.connectionLost,
        { retry: function () { retry(file, row, docTypeId); } });
    }

    if (!res.ok) {
      const again = RETRY_CODES.indexOf(res.code) !== -1 ? { retry: function () { retry(file, row, docTypeId); } } : {};
      return fail(row, res.message || TEXT.badResponse, again);
    }

    const sendSeconds = (now() - sendStartedAt) / 1000;
    learnSpeed(blob.size, sendSeconds, res.serverMs);
    if (res.item) applyItem(res.item);
    row.ok(res, file, blob, shrinkSeconds, (now() - startedAt) / 1000);
  }

  function retry(file, row, docTypeId) {
    row.reset();
    state.batch.failed = Math.max(0, state.batch.failed - 1);
    enqueue(file, row, docTypeId);
  }

  // options.retry: a function that tries the file again. options.office: add the office's address.
  function fail(row, text, options) {
    state.batch.failed += 1;
    row.error(text, options || {});
  }

  // The checks before anything is done with the file, so the client hears about a problem at once.
  // The size limit of the server (D32) is checked after shrinking, because a photo shrinks.
  function checkChosenFile(file) {
    if (!file.size) return TEXT.emptyFile;
    const type = String(file.type || '').toLowerCase();
    const typeOk = ALLOWED_TYPES.indexOf(type) !== -1 ||
      ((!type || type === 'application/octet-stream') && ALLOWED_EXTENSIONS.indexOf(extensionOf(file.name)) !== -1);
    if (!typeOk) return TEXT.badType;
    if (isImage(file) && file.size > MAX_PHOTO_MB * 1024 * 1024) {
      return TEXT.photoTooBig.replace('{size}', formatSize(file.size));
    }
    return '';
  }

  function isImage(file) {
    const type = String(file.type || '').toLowerCase();
    if (type) return type.indexOf('image/') === 0;
    return IMAGE_EXTENSIONS.indexOf(extensionOf(file.name)) !== -1;
  }

  // ---------- Shrinking a photo ----------

  // Returns { blob, name }. Throws if the browser cannot open the photo.
  async function shrinkImage(file) {
    const img = await loadImage(file);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new Error('no size');
    const type = String(file.type || '').toLowerCase();
    const scale = Math.min(1, MAX_SIDE_PX / Math.max(width, height));

    // Already a small JPEG: nothing to gain.
    if (scale === 1 && type === 'image/jpeg' && file.size <= SKIP_SHRINK_BYTES) {
      return { blob: file, name: file.name || 'photo.jpg' };
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';   // a PNG with a transparent background becomes white, not black
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    let blob = await canvasToBlob(canvas, JPEG_QUALITY);
    if (blob && blob.size > BIG_RESULT_BYTES) blob = await canvasToBlob(canvas, JPEG_QUALITY_LOW) || blob;
    canvas.width = 0;            // lets the phone free the memory
    canvas.height = 0;
    if (!blob) throw new Error('no blob');

    // Never send something bigger than what the phone gave us.
    if (type === 'image/jpeg' && scale === 1 && blob.size >= file.size) {
      return { blob: file, name: file.name || 'photo.jpg' };
    }
    return { blob: blob, name: withExtension(file.name || 'photo', 'jpg') };
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('cannot open')); };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== 'function') return resolve(null);
      canvas.toBlob(function (blob) { resolve(blob); }, 'image/jpeg', quality);
    });
  }

  // ---------- Progress ----------

  // The bar: finished files, plus the part of the current file that the estimate says is done.
  // The estimate: the sending (size after base64, at the speed we measured) plus the server's own time.
  function startCurrent(bytes) {
    const seconds = SERVER_SECONDS_GUESS + (bytes * BASE64_FACTOR) / state.speed;
    state.current = { startedAt: now(), estimateSeconds: seconds };
    if (!state.timer) state.timer = setInterval(paintProgress, 250);
    paintProgress();
  }

  function endCurrent() {
    state.current = null;
    paintProgress();
    if (state.batch.done >= state.batch.total) {
      clearInterval(state.timer);
      state.timer = 0;
    }
  }

  // After a successful upload: the speed of this phone on this network, not counting the server.
  function learnSpeed(bytes, sendSeconds, serverMs) {
    const networkSeconds = sendSeconds - (Number(serverMs) || 0) / 1000;
    if (networkSeconds < 0.5 || bytes < 50 * 1024) return;   // too small to tell
    const measured = (bytes * BASE64_FACTOR) / networkSeconds;
    state.speed = Math.max(20 * 1024, Math.min(5 * 1024 * 1024, (state.speed + measured) / 2));
  }

  function paintProgress() {
    const b = state.batch;
    const busy = b.total > 0 && b.done < b.total;
    els.progress.hidden = b.total === 0;
    if (b.total === 0) return;
    let fraction = b.done;
    if (busy && state.current) {
      const elapsed = (now() - state.current.startedAt) / 1000;
      fraction += Math.min(0.9, elapsed / state.current.estimateSeconds);   // never "full" before the answer
    }
    els.progressFill.style.width = Math.round(100 * fraction / b.total) + '%';
    if (busy) {
      els.progressText.textContent = TEXT.progressFile.replace('{n}', String(b.done + 1)).replace('{total}', String(b.total));
    } else {
      els.progressText.textContent = b.failed ? TEXT.someFailed : TEXT.allUploaded;
      if (!b.failed) els.progressFill.style.width = '100%';
    }
  }

  // ---------- Talking to the server ----------

  // Returns the server's JSON answer. Throws only when the server could not be reached.
  async function callServer(payload) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, REQUEST_TIMEOUT_MS) : null;
    try {
      // A string body goes out as text/plain: a "simple" request, with no CORS preflight.
      const response = await fetch(API_URL, {
        method: 'POST',
        body: JSON.stringify(payload),
        redirect: 'follow',
        signal: controller ? controller.signal : undefined,
      });
      const text = await response.text();
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') return data;
      } catch (err) {
        // Not JSON, for example an error page. Handled below.
      }
      return { ok: false, code: 'BAD_RESPONSE', message: TEXT.badResponse };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma === -1 ? '' : result.slice(comma + 1));
      };
      reader.onerror = function () { reject(reader.error || new Error('read failed')); };
      reader.readAsDataURL(file);
    });
  }

  // ---------- Screen ----------

  function show(name) {
    els.page.hidden = name !== 'page';
    els.message.hidden = name !== 'message';
  }

  function showMessage(title, text, options) {
    const opts = options || {};
    els.messageTitle.textContent = title;
    els.messageText.textContent = text || '';
    els.messageHint.textContent = opts.hint || '';
    els.messageHint.hidden = !opts.hint;
    els.retry.hidden = !opts.retry;
    show('message');
  }

  // "דף 0.5.0, שרת 0.5.0, נפתח תוך 4.3 שניות (בשרת: 0.6)"
  function showVersions(serverVersion, openSeconds, serverMs) {
    let text = 'דף ' + PAGE_VERSION + (serverVersion ? ', שרת ' + serverVersion : '');
    if (openSeconds) {
      text += ', ' + TEXT.opened + ' ' + openSeconds.toFixed(1) + ' ' + TEXT.seconds;
      if (serverMs) text += ' (' + TEXT.onServer + ': ' + (serverMs / 1000).toFixed(1) + ')';
    }
    els.versions.textContent = text;
  }

  // One line per file, under its document: name and status. With debug=1 also technical details
  // for the tests: the size before and after shrinking, the times, and the time of each step on the server.
  function addRow(file, docTypeId) {
    const li = document.createElement('li');
    const name = document.createElement('div');
    const status = document.createElement('div');
    const retryButton = actionButton(TEXT.retry, 'linkish retry', function () {});
    const meta = document.createElement('div');
    const steps = document.createElement('div');
    name.className = 'name';
    name.appendChild(isolated(file.name || 'קובץ'));
    status.className = 'status';
    status.textContent = TEXT.waiting;
    retryButton.hidden = true;
    meta.className = 'meta';
    steps.className = 'meta';
    steps.hidden = true;
    li.appendChild(name);
    li.appendChild(status);
    li.appendChild(retryButton);
    li.appendChild(meta);
    li.appendChild(steps);
    state.docEls[docTypeId].results.appendChild(li);

    return {
      uploadKey: newUploadKey(),
      reset: function () {
        status.className = 'status';
        status.textContent = TEXT.waiting;
        retryButton.hidden = true;
        meta.textContent = '';
      },
      busy: function (text) {
        status.className = 'status busy';
        status.textContent = text;
      },
      error: function (text, options) {
        status.className = 'status error';
        status.textContent = text;
        if (options.office && state.officeEmail) {
          const mail = isolated(state.officeEmail);
          mail.dir = 'ltr';
          status.appendChild(mail);
        }
        retryButton.hidden = typeof options.retry !== 'function';
        retryButton.onclick = options.retry || null;
      },
      ok: function (res, original, sent, shrinkSeconds, totalSeconds) {
        status.className = 'status ok';
        status.textContent = res.duplicateOf ? 'התקבל. שימו לב: קובץ זהה כבר הועלה בתקופה הזאת.' : TEXT.received;
        retryButton.hidden = true;
        if (!state.debug) return;
        let timing = totalSeconds.toFixed(1) + ' ' + TEXT.seconds;
        if (res.serverMs) timing += ' (' + TEXT.onServer + ': ' + (res.serverMs / 1000).toFixed(1) + ')';
        const parts = [];
        if (sent !== original && sent.size < original.size) {
          parts.push(TEXT.shrunk.replace('{from}', formatSize(original.size)).replace('{to}', formatSize(sent.size)) +
            ' (' + shrinkSeconds.toFixed(1) + ' ' + TEXT.seconds + ')');
        } else {
          parts.push(formatSize(res.sizeBytes || sent.size));
        }
        parts.push(timing);
        parts.push(isolated(res.storedName));
        setParts(meta, parts);
        if (res.timingText) {
          steps.textContent = res.timingText;
          steps.hidden = false;
        }
      },
    };
  }

  function setParts(el, parts) {
    el.textContent = '';
    parts.forEach(function (part, i) {
      if (i > 0) el.appendChild(document.createTextNode(', '));
      el.appendChild(typeof part === 'string' ? document.createTextNode(part) : part);
    });
  }

  // <bdi> keeps an English file name from scrambling the Hebrew around it.
  function isolated(text) {
    const el = document.createElement('bdi');
    el.textContent = String(text || '');
    return el;
  }

  // ---------- Small helpers ----------

  function readHashParams() {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    try {
      return new URLSearchParams(hash);
    } catch (err) {
      return new URLSearchParams('');
    }
  }

  function readToken(searchParams) {
    const token = String(searchParams.get('t') || '').trim();
    return /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : '';
  }

  function isConfigured(url) {
    return /^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/nelio-api$/.test(url) ||
      /^https:\/\/script\.google\.com\/.+\/exec$/.test(url);
  }

  function newUploadKey() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function extensionOf(fileName) {
    const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/);
    return match ? match[1] : '';
  }

  function withExtension(fileName, extension) {
    const base = String(fileName || 'photo').replace(/\.[A-Za-z0-9]{1,5}$/, '');
    return (base || 'photo') + '.' + extension;
  }

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' קילו-בייט';
    return (bytes / 1024 / 1024).toFixed(1) + ' מגה-בייט';
  }

  function now() {
    return window.performance && typeof performance.now === 'function' ? performance.now() : Date.now();
  }
})();
