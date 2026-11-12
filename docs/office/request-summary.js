/* Office client file: explains a request status from its items. Display only; the status itself is computed in the database. */
(() => {
 'use strict';
 const OTHER = 'OTHER';
 const closed = item => item.status === 'received' || item.status === 'not_applicable';
 // Same rule as nelio_recompute (data-model.md 3.2): "OTHER" and non-required items never affect the status.
 const counts = item => item.doc_type_id !== OTHER && item.required === true;
 const isOptional = item => !counts(item);
 function itemLabel(item) {
  if (isOptional(item) && item.status === 'missing') return {text: 'רשות, לא הועלה', tone: 'optional'};
  const text = ({received: 'התקבל', missing: 'חסר', rejected: 'לא קריא', not_applicable: 'לא היה החודש'})[item.status] || String(item.status || '');
  return {text, tone: item.status === 'received' ? 'received' : item.status === 'rejected' ? 'rejected' : item.status === 'not_applicable' ? 'optional' : 'missing'};
 }
 function requiredSummary(items, nameOf, requestStatus) {
  const required = (items || []).filter(counts);
  if (!required.length) return {text: '', mismatch: false};
  const open = required.filter(item => !closed(item));
  const head = 'מסמכי חובה: ' + (required.length - open.length) + ' מתוך ' + required.length + ' נסגרו.';
  if (open.length) {
   const names = open.map(item => nameOf(item.doc_type_id) + (item.status === 'rejected' ? ' (לא קריא)' : ''));
   return {text: head + ' עדיין פתוח: ' + names.join(', ') + '.', mismatch: requestStatus === 'submitted'};
  }
  const mismatch = requestStatus === 'partial' || requestStatus === 'not_started';
  return {text: head + (mismatch ? ' המצב הרשום אינו תואם לפריטים, כדאי לדווח על כך.' : ''), mismatch};
 }
 const api = {itemLabel, requiredSummary, isOptional};
 if (typeof window !== 'undefined') window.NelioRequestSummary = api;
 if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
