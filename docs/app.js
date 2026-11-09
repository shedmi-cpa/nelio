/* Nelio · client page · test page until the full page of stage 5
 *
 * 1. Reads the personal token from the link (#t=...).
 * 2. Asks the server ("hello") whether the link is valid, and which month is open.
 * 3. Uploads the chosen files one at a time ("upload"). Until stage 5 every file is
 *    saved as "מסמך אחר" of the client's request.
 *
 * There is no byte-by-byte progress bar on purpose: listening to upload progress makes the
 * browser send a CORS "preflight" request first, and Apps Script cannot answer it.
 */
(function () {
  'use strict';

  const PAGE_VERSION = '0.3.1';
  const API_URL = String((window.NELIO_CONFIG && window.NELIO_CONFIG.apiUrl) || '').trim();
  const REQUEST_TIMEOUT_MS = 180000; // 3 minutes
  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];
  const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf'];

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
    uploading: 'מעלה…',
    received: 'התקבל',
    emptyFile: 'הקובץ ריק.',
    badType: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
    tooBig: 'הקובץ גדול מדי ({size}). הגודל המקסימלי הוא {max} מגה-בייט.',
    readError: 'לא הצלחנו לקרוא את הקובץ מהמכשיר. נסו לבחור אותו שוב.',
    timeout: 'ההעלאה לקחה יותר מדי זמן. בדקו את החיבור ונסו שוב.',
    connectionLost: 'החיבור לשרת נכשל באמצע ההעלאה. בדקו את החיבור ונסו שוב.',
    seconds: 'שניות',
    onServer: 'בשרת',
    opened: 'נפתח תוך',
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
    camera: document.getElementById('camera-input'),
    files: document.getElementById('files-input'),
    results: document.getElementById('results'),
    versions: document.getElementById('versions'),
  };

  const state = {
    token: readToken(),
    maxFileMb: 10,             // replaced by the server's value (Settings > max_file_mb, D32)
    queue: Promise.resolve(),  // uploads run one after another
    firstOpen: true,           // the opening time is shown only for the first try, not after "נסו שוב"
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
      show('upload');
      // How long the page took to open, from the tap on the link (for the tests in stage 3.2).
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

  // ---------- Uploading ----------

  function onFilesChosen(event) {
    const input = event.target;
    const files = Array.prototype.slice.call(input.files || []);
    input.value = ''; // so the same file can be chosen again
    files.forEach(function (file) {
      const row = addRow(file);
      state.queue = state.queue.then(function () { return uploadOne(file, row); });
    });
  }

  async function uploadOne(file, row) {
    const problem = checkFile(file);
    if (problem) return row.error(problem);

    row.busy(TEXT.uploading);
    const startedAt = now();

    let data;
    try {
      data = await readAsBase64(file);
    } catch (err) {
      return row.error(TEXT.readError);
    }

    let res;
    try {
      res = await callServer({
        action: 'upload',
        token: state.token,
        uploadKey: newUploadKey(),
        fileName: file.name || '',
        mimeType: file.type || '',
        size: file.size,
        data: data,
      });
    } catch (err) {
      return row.error(err && err.name === 'AbortError' ? TEXT.timeout : TEXT.connectionLost);
    }

    const seconds = (now() - startedAt) / 1000;
    if (res.ok) row.ok(res, file, seconds);
    else row.error(res.message || TEXT.badResponse);
  }

  // The same checks the server makes, so the client hears about a problem right away.
  function checkFile(file) {
    if (!file.size) return TEXT.emptyFile;
    const type = String(file.type || '').toLowerCase();
    const typeOk = ALLOWED_TYPES.indexOf(type) !== -1 ||
      ((!type || type === 'application/octet-stream') && ALLOWED_EXTENSIONS.indexOf(extensionOf(file.name)) !== -1);
    if (!typeOk) return TEXT.badType;
    if (file.size > state.maxFileMb * 1024 * 1024) {
      return TEXT.tooBig.replace('{size}', formatSize(file.size)).replace('{max}', String(state.maxFileMb));
    }
    return '';
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

  // "דף 0.1.1 · שרת 0.1.1 · נפתח תוך 4.3 שניות (בשרת: 0.6)"
  function showVersions(serverVersion, openSeconds, serverMs) {
    let text = 'דף ' + PAGE_VERSION + (serverVersion ? ' · שרת ' + serverVersion : '');
    if (openSeconds) {
      text += ' · ' + TEXT.opened + ' ' + openSeconds.toFixed(1) + ' ' + TEXT.seconds;
      if (serverMs) text += ' (' + TEXT.onServer + ': ' + (serverMs / 1000).toFixed(1) + ')';
    }
    els.versions.textContent = text;
  }

  // One line per file: name, status, and (on success) technical details for the tests:
  // the stored name, type, size and time, and below them the time of each step on the server.
  function addRow(file) {
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
    els.results.appendChild(li);

    return {
      busy: function (text) {
        status.className = 'status busy';
        status.textContent = text;
      },
      error: function (text) {
        status.className = 'status error';
        status.textContent = text;
      },
      ok: function (res, chosenFile, seconds) {
        status.className = 'status ok';
        status.textContent = TEXT.received;
        let timing = seconds.toFixed(1) + ' ' + TEXT.seconds;
        if (res.serverMs) timing += ' (' + TEXT.onServer + ': ' + (res.serverMs / 1000).toFixed(1) + ')';
        setParts(meta, [
          // where the file was saved: "לקוח בדיקה (TEST) / 2026-10 / לקוח-בדיקה_2026-10_מסמך-אחר_01.jpg"
          isolated(res.folderPath ? res.folderPath + ' / ' + res.storedName : res.storedName),
          isolated(res.mimeType || chosenFile.type),
          formatSize(res.sizeBytes || chosenFile.size),
          timing,
        ]);
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

  function formatSize(bytes) {
    if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + ' קילו-בייט';
    return (bytes / 1024 / 1024).toFixed(1) + ' מגה-בייט';
  }

  function now() {
    return window.performance && typeof performance.now === 'function' ? performance.now() : Date.now();
  }
})();
