/* Nelio · client page · stage 5.1: the upload itself
 *
 * 1. Reads the personal token from the link (#t=...).
 * 2. Asks the server ("hello") whether the link is valid, which month is open, and which
 *    documents the client has to send.
 * 3. Uploads the chosen files one after another ("upload"), each to the document it was chosen
 *    for. Before sending, a photo is shrunk on the phone (D29): a photo of 2-4 MB becomes a few
 *    hundred KB, and the sending is where most of the time goes.
 *
 * There is no byte-by-byte progress bar on purpose: listening to upload progress makes the
 * browser send a CORS "preflight" request first, and Apps Script cannot answer it. The bar
 * counts files, and inside the current file it moves by an estimate of the time (findings.md).
 *
 * The look of the list is temporary. The final look (the folder, D38) is stage 5.2.
 */
(function () {
  'use strict';

  const PAGE_VERSION = '0.4.0';
  const API_URL = String((window.NELIO_CONFIG && window.NELIO_CONFIG.apiUrl) || '').trim();
  const REQUEST_TIMEOUT_MS = 180000; // 3 minutes
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];
  const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'];

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

  const TEXT = {
    noServerTitle: 'השרת עוד לא מחובר',
    noServerText: 'חסרה כתובת השרת בקובץ config.js, או שיש בקובץ טעות.',
    noTokenTitle: 'הקישור לא שלם',
    noTokenText: 'פתחו את הקישור האישי שקיבלתם מהמשרד, במלואו.',
    badTokenTitle: 'הקישור לא פעיל',
    offlineTitle: 'אין חיבור',
    offlineText: 'לא הצלחנו להגיע לשרת. בדקו את החיבור לאינטרנט ונסו שוב.',
    offlineHint: 'לבדיקה: אם האינטרנט תקין, ודאו שהפריסה ב-Apps Script מוגדרת לגישה של "כל אחד" (Anyone).',
    errorTitle: 'משהו השתבש',
    badResponse: 'השרת החזיר תשובה לא צפויה. נסו שוב בעוד כמה דקות.',
    greeting: 'שלום, ',
    documentsFor: 'מסמכים ל',
    until: 'עד',
    waiting: 'ממתין…',
    shrinking: 'מכווצים את התמונה…',
    uploading: 'מעלה…',
    received: 'התקבל',
    emptyFile: 'הקובץ ריק.',
    badType: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
    tooBig: 'הקובץ גדול מדי ({size}). הגודל המקסימלי הוא {max} מגה-בייט.',
    photoTooBig: 'התמונה גדולה מדי ({size}). נסו לצלם שוב, או לבחור תמונה קטנה יותר.',
    imageFailed: 'לא הצלחנו לעבד את התמונה. נסו לצלם שוב.',
    readError: 'לא הצלחנו לקרוא את הקובץ מהמכשיר. נסו לבחור אותו שוב.',
    timeout: 'ההעלאה לקחה יותר מדי זמן. בדקו את החיבור ונסו שוב.',
    connectionLost: 'החיבור לשרת נכשל באמצע ההעלאה. בדקו את החיבור ונסו שוב.',
    seconds: 'שניות',
    onServer: 'בשרת',
    opened: 'נפתח תוך',
    shrunk: 'כווצה מ-{from} ל-{to}',
    camera: 'צילום',
    pickFiles: 'בחירת קבצים',
    state: { missing: 'חסר', received: 'התקבל', rejected: 'לא קריא, נא להעלות שוב', not_applicable: 'לא היה החודש' },
    filesCount: 'קבצים: {n}',
    progressFile: 'מעלים קובץ {n} מתוך {total}',
    allUploaded: 'כל הקבצים הועלו.',
    someFailed: 'חלק מהקבצים לא הועלו. פרטים מתחת לכל מסמך.',
    missingLeft: 'חסרים עוד {n} מסמכים',
    missingLeftOne: 'חסר עוד מסמך אחד',
    allDone: 'כל המסמכים התקבלו',
  };

  const els = {
    office: document.getElementById('office-name'),
    loading: document.getElementById('view-loading'),
    message: document.getElementById('view-message'),
    messageTitle: document.getElementById('message-title'),
    messageText: document.getElementById('message-text'),
    messageHint: document.getElementById('message-hint'),
    retry: document.getElementById('retry-button'),
    upload: document.getElementById('view-upload'),
    greeting: document.getElementById('greeting'),
    period: document.getElementById('period-line'),
    summary: document.getElementById('summary-line'),
    progress: document.getElementById('progress'),
    progressText: document.getElementById('progress-text'),
    progressFill: document.getElementById('progress-fill'),
    docs: document.getElementById('docs'),
    camera: document.getElementById('camera-input'),
    files: document.getElementById('files-input'),
    versions: document.getElementById('versions'),
  };

  const state = {
    token: readToken(),
    maxFileMb: 10,             // replaced by the server's value (Settings > max_file_mb, D32)
    queue: Promise.resolve(),  // uploads run one after another
    firstOpen: true,           // the opening time is shown only for the first try, not after "נסו שוב"
    items: [],                 // the documents of the open month, as the server sent them
    docEls: {},                // docTypeId -> { state, count, results }
    target: '',                // the document the next chosen files belong to
    speed: START_SPEED_BYTES_PER_SECOND,
    batch: { total: 0, done: 0, failed: 0 },
    current: null,             // { startedAt, estimateSeconds } of the file being sent
    timer: 0,
  };

  window.addEventListener('hashchange', function () { window.location.reload(); });
  els.retry.addEventListener('click', start);
  els.camera.addEventListener('change', onFilesChosen);
  els.files.addEventListener('change', onFilesChosen);
  showVersions('');
  start();

  // ---------- Opening the page ----------

  async function start() {
    if (!isConfigured(API_URL)) return showMessage(TEXT.noServerTitle, TEXT.noServerText);
    if (!state.token) return showMessage(TEXT.noTokenTitle, TEXT.noTokenText);

    show('loading');
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
      if (res.officeName) els.office.textContent = res.officeName;
      showMessage(TEXT.greeting + (res.businessName || ''), res.message);
      showVersions(res.version);
    } else if (res.ok) {
      state.maxFileMb = Number(res.maxFileMb) || state.maxFileMb;
      if (res.officeName) els.office.textContent = res.officeName;
      els.greeting.textContent = TEXT.greeting + (res.businessName || '');
      // "מסמכים לאוקטובר 2026 · עד 12/11/2026" (brief.md, the client page)
      els.period.textContent = '';
      if (res.periodLabel) {
        els.period.appendChild(document.createTextNode(TEXT.documentsFor + res.periodLabel));
        if (res.dueDate) {
          els.period.appendChild(document.createTextNode(' · ' + TEXT.until + ' '));
          els.period.appendChild(isolated(res.dueDate));
        }
      }
      state.items = Array.isArray(res.items) ? res.items : [];
      renderDocs();
      show('upload');
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

  // ---------- The list of documents ----------

  function renderDocs() {
    els.docs.textContent = '';
    state.docEls = {};
    state.items.forEach(function (item) {
      const li = document.createElement('li');
      const head = document.createElement('div');
      const name = document.createElement('div');
      const stateEl = document.createElement('div');
      const desc = document.createElement('p');
      const actions = document.createElement('div');
      const results = document.createElement('ul');
      head.className = 'doc-head';
      name.className = 'doc-name';
      name.textContent = item.name;
      stateEl.className = 'doc-state';
      desc.className = 'doc-desc';
      desc.textContent = item.description || '';
      desc.hidden = !item.description;
      actions.className = 'doc-actions';
      actions.appendChild(actionButton(TEXT.camera, 'button', function () { chooseFor(item.docTypeId, els.camera); }));
      actions.appendChild(actionButton(TEXT.pickFiles, 'button secondary', function () { chooseFor(item.docTypeId, els.files); }));
      results.className = 'results';
      head.appendChild(name);
      head.appendChild(stateEl);
      li.appendChild(head);
      li.appendChild(desc);
      li.appendChild(actions);
      li.appendChild(results);
      els.docs.appendChild(li);
      state.docEls[item.docTypeId] = { state: stateEl, results: results };
      paintItem(item);
    });
    paintSummary();
  }

  function actionButton(label, className, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function chooseFor(docTypeId, input) {
    state.target = docTypeId;
    input.click();
  }

  function paintItem(item) {
    const el = state.docEls[item.docTypeId];
    if (!el) return;
    let text = TEXT.state[item.status] || TEXT.state.missing;
    if (item.fileCount > 0 && item.status === 'received') text += ' · ' + TEXT.filesCount.replace('{n}', String(item.fileCount));
    el.state.textContent = text;
    el.state.className = 'doc-state ' + (item.status || 'missing');
  }

  // "חסרים עוד 2 מסמכים", from the required documents that are still missing or unreadable.
  function paintSummary() {
    const left = state.items.filter(function (i) {
      return i.required && (i.status === 'missing' || i.status === 'rejected');
    }).length;
    els.summary.textContent = left === 0 ? TEXT.allDone
      : left === 1 ? TEXT.missingLeftOne : TEXT.missingLeft.replace('{n}', String(left));
  }

  // ---------- Uploading ----------

  function onFilesChosen(event) {
    const input = event.target;
    const files = Array.prototype.slice.call(input.files || []);
    input.value = ''; // so the same file can be chosen again
    const docTypeId = state.target;
    if (!docTypeId || !state.docEls[docTypeId]) return;
    // A new batch after the last one finished: the counters start again.
    if (state.batch.done >= state.batch.total) state.batch = { total: 0, done: 0, failed: 0 };
    files.forEach(function (file) {
      const row = addRow(file, docTypeId);
      state.batch.total += 1;
      paintProgress();
      state.queue = state.queue.then(function () { return uploadOne(file, row, docTypeId); });
    });
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
      return fail(row, TEXT.tooBig.replace('{size}', formatSize(blob.size)).replace('{max}', String(state.maxFileMb)));
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

    const sendStartedAt = now();
    let res;
    try {
      res = await callServer({
        action: 'upload',
        token: state.token,
        docTypeId: docTypeId,
        uploadKey: newUploadKey(),
        fileName: sentName,
        mimeType: blob.type || file.type || '',
        size: blob.size,
        data: data,
      });
    } catch (err) {
      return fail(row, err && err.name === 'AbortError' ? TEXT.timeout : TEXT.connectionLost);
    }

    if (!res.ok) return fail(row, res.message || TEXT.badResponse);

    const sendSeconds = (now() - sendStartedAt) / 1000;
    learnSpeed(blob.size, sendSeconds, res.serverMs);
    if (res.item) applyItem(res.item);
    row.ok(res, file, blob, shrinkSeconds, (now() - startedAt) / 1000);
  }

  function fail(row, text) {
    state.batch.failed += 1;
    row.error(text);
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

  function applyItem(view) {
    for (let i = 0; i < state.items.length; i++) {
      if (state.items[i].docTypeId === view.docTypeId) state.items[i] = view;
    }
    paintItem(view);
    paintSummary();
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
    els.loading.hidden = name !== 'loading';
    els.message.hidden = name !== 'message';
    els.upload.hidden = name !== 'upload';
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

  // "דף 0.4.0 · שרת 0.4.0 · נפתח תוך 4.3 שניות (בשרת: 0.6)"
  function showVersions(serverVersion, openSeconds, serverMs) {
    let text = 'דף ' + PAGE_VERSION + (serverVersion ? ' · שרת ' + serverVersion : '');
    if (openSeconds) {
      text += ' · ' + TEXT.opened + ' ' + openSeconds.toFixed(1) + ' ' + TEXT.seconds;
      if (serverMs) text += ' (' + TEXT.onServer + ': ' + (serverMs / 1000).toFixed(1) + ')';
    }
    els.versions.textContent = text;
  }

  // One line per file, under its document: name, status, and (on success) technical details for the
  // tests: the size before and after shrinking, the times, and the time of each step on the server.
  function addRow(file, docTypeId) {
    const li = document.createElement('li');
    const name = document.createElement('div');
    const status = document.createElement('div');
    const meta = document.createElement('div');
    const steps = document.createElement('div');
    name.className = 'name';
    name.appendChild(isolated(file.name || 'קובץ'));
    status.className = 'status';
    status.textContent = TEXT.waiting;
    meta.className = 'meta';
    steps.className = 'meta';
    steps.hidden = true;
    li.appendChild(name);
    li.appendChild(status);
    li.appendChild(meta);
    li.appendChild(steps);
    state.docEls[docTypeId].results.appendChild(li);

    return {
      busy: function (text) {
        status.className = 'status busy';
        status.textContent = text;
      },
      error: function (text) {
        status.className = 'status error';
        status.textContent = text;
      },
      ok: function (res, original, sent, shrinkSeconds, totalSeconds) {
        status.className = 'status ok';
        status.textContent = TEXT.received;
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
      if (i > 0) el.appendChild(document.createTextNode(' · '));
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

  function readToken() {
    const hash = String(window.location.hash || '').replace(/^#/, '');
    let token = '';
    try {
      token = new URLSearchParams(hash).get('t') || '';
    } catch (err) {
      token = '';
    }
    token = token.trim();
    return /^[A-Za-z0-9_-]{20,128}$/.test(token) ? token : '';
  }

  function isConfigured(url) {
    return /^https:\/\/script\.google\.com\/.+\/exec$/.test(url);
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
