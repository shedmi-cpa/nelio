/* Office document preview: private files load only after a user selects one. */
(() => {
 'use strict';
 const MAX_PREVIEW_BYTES = 16 * 1024 * 1024;
 const byId = id => document.getElementById(id);
 const kindFor = file => {
  const mime = String(file.mime_type || '').toLowerCase().split(';')[0].trim();
  if (mime === 'application/pdf') return 'pdf';
  if (/^image\/(jpeg|png|webp|gif)$/.test(mime)) return 'image';
  if (mime && mime !== 'application/octet-stream') return null;
  const name = String(file.name || '').toLowerCase();
  if (/\.pdf$/.test(name)) return 'pdf';
  if (/\.(jpe?g|png|webp|gif)$/.test(name)) return 'image';
  return null;
 };
 const safeName = name => String(name || 'מסמך-לקוח').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').slice(0, 150) || 'מסמך-לקוח';
 const userError = code => ({
  UNAUTHORIZED: 'פג תוקף ההתחברות. התחברו מחדש כדי לצפות במסמך.',
  FORBIDDEN: 'אין הרשאה לצפות במסמך זה.',
  NOT_FOUND: 'המסמך אינו זמין או אינו שייך לתיק הזה.',
  DRIVE_NOT_CONFIGURED: 'ארכיון Drive אינו מוגדר בשרת.',
  DRIVE_UNAVAILABLE: 'לא הצלחנו לקרוא את הקובץ מארכיון Drive.',
  PREVIEW_TOO_LARGE: 'הקובץ גדול מדי לתצוגה כאן. אפשר להוריד אותו.',
  INVALID_URL: 'התקבלה כתובת קובץ לא תקינה.',
  HTTP_ERROR: 'לא ניתן לטעון את הקובץ כרגע. נסו שוב.'
 })[code] || 'לא ניתן לפתוח את המסמך. נסו שוב.';
 function create({officeCall, getCurrentRequest, supabaseUrl, isNarrow = () => false, onChange = () => {}}) {
  // "inline" is the side pane next to the client drawer (wide screens). Narrow screens use the modal only.
  const inline = byId('inline-preview'), modal = byId('preview-modal');
  const inlineBody = byId('inline-preview-content'), modalBody = byId('preview-modal-content');
  const state = {files: [], index: -1, generation: 0, url: null, blob: null, pending: null, text: null, inertBefore: null};
  let origin;
  try { origin = new URL(supabaseUrl).origin; } catch { origin = ''; }
  const active = () => state.files[state.index];
  const alive = (generation, requestId) => generation === state.generation && requestId === getCurrentRequest();
  function clearObject() {
   inlineBody.replaceChildren();
   modalBody.replaceChildren();
   if (state.url) URL.revokeObjectURL(state.url);
   state.url = null; state.blob = null; state.text = null;
  }
  function cancel() {
   ++state.generation;
   state.pending?.abort();
   state.pending = null;
   clearObject();
  }
  function updateControls() {
   const file = active();
   byId('preview-title').textContent = file?.name || 'תצוגת מסמך';
   byId('inline-preview-title').textContent = file?.name || 'תצוגת מסמך';
   for (const id of ['inline-prev', 'modal-prev']) byId(id).disabled = state.index <= 0;
   for (const id of ['inline-next', 'modal-next']) byId(id).disabled = state.index >= state.files.length - 1;
   byId('inline-count').textContent = byId('modal-count').textContent =
    state.files.length && state.index >= 0 ? (state.index + 1) + ' מתוך ' + state.files.length : '';
   byId('preview-expand').disabled = !state.url;
   for (let i = 0; i < state.files.length; i++) {
    state.files[i].button?.setAttribute('aria-pressed', String(i === state.index));
   }
  }
  function contentNode(file, url) {
   const kind = kindFor(file);
   if (kind === 'image') {
    const img = document.createElement('img'); img.src = url;
    img.alt = 'תצוגת ' + file.name; img.className = 'preview-image';
    return img;
   }
   const frame = document.createElement('iframe'); frame.src = url;
   frame.title = 'תצוגת PDF: ' + file.name; frame.className = 'preview-pdf';
   return frame;
  }
  function textNode() {
   const p = document.createElement('p'); p.className = state.text.error ? 'preview-error' : 'preview-info';
   p.textContent = state.text.text; return p;
  }
  function renderReady() {
   const file = active();
   if (!file || !state.url) return;
   state.text = null;
   inlineBody.replaceChildren(contentNode(file, state.url));
   if (!modal.hidden) modalBody.replaceChildren(contentNode(file, state.url));
   updateControls();
  }
  function showText(text, error = false) {
   state.text = {text, error};
   for (const target of [inlineBody, modalBody]) target.replaceChildren(textNode());
   byId('preview-expand').disabled = true;
  }
  function validatedUrl(value) {
   let address;
   try { address = new URL(value); } catch { throw Object.assign(Error('INVALID_URL'), {code:'INVALID_URL'}); }
   if (!origin || address.origin !== origin || address.protocol !== 'https:' ||
       !address.pathname.startsWith('/storage/v1/object/sign/nelio-documents/')) {
    throw Object.assign(Error('INVALID_URL'), {code:'INVALID_URL'});
   }
   return address.href;
  }
  async function loadBlob(file, controller) {
   const requestId = file.requestId, uploadId = file.uploadId;
   let result = await officeCall('openFile', {requestId, uploadId});
   if (result.driveBlob) return result.driveBlob;
   for (let attempt = 0; attempt < 2; attempt++) {
    const address = validatedUrl(result.url);
    const response = await fetch(address, {method:'GET', mode:'cors', credentials:'omit', cache:'no-store',
     referrerPolicy:'no-referrer', signal:controller.signal});
    if (response.ok) {
     const bytes = Number(response.headers.get('content-length') || 0);
     if (bytes > MAX_PREVIEW_BYTES) throw Object.assign(Error('PREVIEW_TOO_LARGE'), {code:'PREVIEW_TOO_LARGE'});
     return await response.blob();
    }
    if (attempt === 0 && (response.status === 401 || response.status === 403 || response.status === 400)) {
     result = await officeCall('openFile', {requestId, uploadId}); // refresh a possible expired signed URL
    } else throw Object.assign(Error('HTTP_ERROR'), {code:'HTTP_ERROR'});
   }
   throw Object.assign(Error('HTTP_ERROR'), {code:'HTTP_ERROR'});
  }
  function showModal() {
   if (!modal.hidden) return;
   const background = [document.querySelector('main'), document.querySelector('header.top'),
    document.querySelector('footer'), byId('client-detail'), inline];
   state.inertBefore = background.map(node => [node, node.inert]);
   modal.hidden = false;
   for (const [node] of state.inertBefore) node.inert = true;
   if (state.url) modalBody.replaceChildren(contentNode(active(), state.url));
   else if (state.text) modalBody.replaceChildren(textNode());
   byId('preview-close').focus();
  }
  function hideModal() {
   if (modal.hidden) return;
   modal.hidden = true; modalBody.replaceChildren();
   for (const [node, wasInert] of state.inertBefore || []) node.inert = wasInert;
   state.inertBefore = null;
  }
  // Wide screens: the pane beside the drawer. Narrow screens: no room beside it, so the modal is the preview.
  function present() {
   if (isNarrow()) { inline.hidden = true; showModal(); }
   else inline.hidden = false;
  }
  async function select(index, button = null) {
   if (!Number.isInteger(index) || index < 0 || index >= state.files.length) return;
   cancel(); const ticket = state.generation;
   state.index = index;
   const file = active();
   present(); updateControls(); onChange();
   if (!button) file.button?.scrollIntoView?.({block:'nearest'});
   if (!kindFor(file)) { showText('אין תצוגה מקדימה לסוג קובץ זה. אפשר להוריד אותו.', false); return; }
   showText('טוענים את המסמך…');
   const controller = new AbortController(); state.pending = controller;
   try {
    const blob = await loadBlob(file, controller);
    if (!alive(ticket, file.requestId)) return;
    if (blob.size > MAX_PREVIEW_BYTES) throw Object.assign(Error('PREVIEW_TOO_LARGE'), {code:'PREVIEW_TOO_LARGE'});
    const type = kindFor(file) === 'pdf' ? 'application/pdf' :
     ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif'}[String(file.name).toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/)?.[0]] ||
      (String(file.mime_type).toLowerCase().match(/^image\/(jpeg|png|webp|gif)$/)?.[0] || 'image/jpeg'));
    // Explicit type prevents HTML/script files from being embedded as active documents.
    state.blob = blob;
    state.url = URL.createObjectURL(blob.type === type ? blob : new Blob([blob], {type}));
    renderReady();
   } catch (e) {
    if (!alive(ticket, file.requestId) || e?.name === 'AbortError') return;
    showText(userError(e.code), true);
   } finally { if (alive(ticket, file.requestId)) state.pending = null; }
  }
  function move(delta) {
   const next = state.index + delta;
   if (next >= 0 && next < state.files.length) void select(next);
  }
  function openEnlarged() {
   if (!state.url || !modal.hidden) return;
   showModal(); onChange();
  }
  // Closes the preview entirely and releases the file; the drawer and its scroll position stay as they were.
  function closePreview(restore = true) {
   if (state.index < 0 && inline.hidden && modal.hidden) return;
   const button = active()?.button;
   hideModal(); cancel(); state.index = -1; inline.hidden = true;
   updateControls(); onChange();
   if (restore && button?.isConnected) button.focus();
  }
  // Leaving the enlarged view returns to the side pane; on a narrow screen the modal is the whole preview.
  function closeEnlarged() {
   if (modal.hidden) return;
   if (isNarrow() || state.index < 0) { closePreview(); return; }
   hideModal(); inline.hidden = false; onChange();
   byId('preview-expand').focus();
  }
  // Called when the window crosses the wide/narrow boundary while a document is open.
  function syncLayout() {
   if (state.index < 0) return;
   if (isNarrow()) { inline.hidden = true; if (modal.hidden) { showModal(); onChange(); } }
   else if (modal.hidden && inline.hidden) { inline.hidden = false; onChange(); }
  }
  async function download() {
   const file = active(); if (!file) return;
   const buttons = [byId('preview-download'), byId('inline-download')];
   for (const btn of buttons) btn.disabled = true;
   let temporary = null;
   const ticket = state.generation;
   try {
    let address = state.url;
    if (!address) {
     const controller = new AbortController();
     const blob = await loadBlob(file, controller);
     if (!alive(ticket, file.requestId)) return;
     temporary = URL.createObjectURL(blob); address = temporary;
    }
    const link = document.createElement('a');
    link.href = address; link.download = safeName(file.name);
    document.body.append(link); link.click(); link.remove();
   } catch (e) { if (alive(ticket, file.requestId)) showText(userError(e.code), true); }
   finally {
    for (const btn of buttons) btn.disabled = false;
    if (temporary) setTimeout(() => URL.revokeObjectURL(temporary), 10000);
   }
  }
  function reset() {
   hideModal();
   cancel(); state.files = []; state.index = -1;
   inline.hidden = true; updateControls(); onChange();
  }
  function setFiles(files) { reset(); state.files = files.slice(); updateControls(); }
  function trapFocus(event) {
   const focusables = [...modal.querySelectorAll('button:not([disabled])')];
   if (!focusables.length) return;
   const first = focusables[0], last = focusables[focusables.length - 1];
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  for (const [id, delta] of [['inline-prev',-1],['modal-prev',-1],['inline-next',1],['modal-next',1]]) {
   byId(id).addEventListener('click', () => move(delta));
  }
  byId('preview-expand').addEventListener('click', openEnlarged);
  byId('preview-close').addEventListener('click', () => closeEnlarged());
  byId('inline-close').addEventListener('click', () => closePreview());
  for (const id of ['preview-download', 'inline-download']) byId(id).addEventListener('click', () => void download());
  modal.addEventListener('click', e => { if (e.target === modal) closeEnlarged(); });
  document.addEventListener('keydown', e => {
   if (modal.hidden) {
    // Escape closes the side pane first; a second Escape then closes the client drawer.
    if (e.key === 'Escape' && !inline.hidden) {e.preventDefault(); e.stopImmediatePropagation(); closePreview();}
    return;
   }
   if (e.key === 'Escape') {e.preventDefault(); e.stopImmediatePropagation(); closeEnlarged();}
   else if (e.key === 'Tab') trapFocus(e);
   else if (e.key === 'ArrowLeft' && e.target.tagName !== 'IFRAME') move(1);
   else if (e.key === 'ArrowRight' && e.target.tagName !== 'IFRAME') move(-1);
  }, true);
  return {select, reset, setFiles, closePreview, syncLayout,
   isModalOpen: () => !modal.hidden, isPaneOpen: () => !inline.hidden};
 }
 window.NelioDocumentPreview = {create, kindFor, safeName};
 if (typeof module !== 'undefined' && module.exports) module.exports = {kindFor, safeName};
})();