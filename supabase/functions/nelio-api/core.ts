export const VERSION = '0.6.0';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_BODY_BYTES = 14 * 1024 * 1024;
export const ERRORS: Record<string, string> = {
  BAD_REQUEST: 'הבקשה לא תקינה.', BAD_TOKEN: 'הקישור הזה לא פעיל. לקבלת קישור חדש, פנו למשרד.',
  NO_REQUEST: 'אין כרגע מסמכים להעלות.', BAD_ITEM: 'המסמך הזה לא ברשימה שלכם. רעננו את הדף ונסו שוב.',
  EMPTY_NOTE: 'כתבו את ההערה ואז שלחו.', BAD_TYPE: 'סוג הקובץ לא נתמך. אפשר להעלות תמונה או קובץ PDF.',
  BAD_FILE: 'הקובץ הגיע פגום. נסו להעלות אותו שוב.', EMPTY_FILE: 'הקובץ ריק.', NO_FILE: 'לא התקבל קובץ. נסו שוב.',
  TOO_BIG: 'הקובץ גדול מדי. הגודל המקסימלי הוא 10 מגה-בייט.', BUSY: 'המערכת עמוסה כרגע. נסו שוב בעוד רגע.',
  NA_NOT_ALLOWED: 'כבר התקבל קובץ למסמך הזה, ולכן אי אפשר לסמן שלא היה. אם הקובץ לא נכון, כתבו על זה הערה למשרד.',
  NA_NOT_OPTIONAL: 'את המסמך הזה לא צריך לסמן. אפשר פשוט לא להעלות אותו.',
  UPLOAD_CONFLICT: 'פרטי הקובץ השתנו. בחרו את הקובץ מחדש.', UPLOAD_PENDING: 'שמירת הקובץ עדיין לא הסתיימה. נסו שוב.',
  QUOTA_EXCEEDED: 'הגעתם למכסת ההעלאות לתקופה הזאת. פנו למשרד.',
  SERVER_ERROR: 'משהו השתבש אצלנו. נסו שוב בעוד כמה דקות.',
};
export class ApiError extends Error { constructor(public code: string) { super(code); } }
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  return Array.from(value.normalize('NFC').replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '').trim()).slice(0,max).join('');
}
export function preparePayload(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ApiError('BAD_REQUEST');
  const p = raw as Record<string, unknown>;
  if (!['hello','upload','markNa','unmarkNa','note'].includes(String(p.action))) throw new ApiError('BAD_REQUEST');
  if (typeof p.token !== 'string' || !/^[A-Za-z0-9_-]{24,256}$/.test(p.token)) throw new ApiError('BAD_TOKEN');
  // Explicit allowlist: callers cannot inject internal actions, object paths or IDs.
  return {action:p.action,token:p.token,docTypeId:cleanText(p.docTypeId,80),note:cleanText(p.note,p.action==='note'?500:300)};
}
export function decodeFile(raw: Record<string, unknown>) {
  const name = cleanText(raw.fileName,120).replace(/[\\/:*?"<>|]/g,'-') || 'file';
  const extensions: Record<string,string> = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',pdf:'application/pdf',heic:'image/heic',heif:'image/heif'};
  let mime = String(raw.mimeType || '').toLowerCase().trim();
  if (!mime || mime==='application/octet-stream') mime=extensions[name.split('.').pop()?.toLowerCase()||''];
  if (!Object.values(extensions).includes(mime)) throw new ApiError('BAD_TYPE');
  const data=raw.data;
  if (typeof data!=='string' || !data) throw new ApiError('NO_FILE');
  if (data.length > Math.ceil(MAX_FILE_BYTES/3)*4) throw new ApiError('TOO_BIG');
  if (data.length%4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) throw new ApiError('BAD_FILE');
  const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
  if (!bytes.length) throw new ApiError('EMPTY_FILE');
  if (bytes.length>MAX_FILE_BYTES) throw new ApiError('TOO_BIG');
  const ascii=(start:number,end:number)=>String.fromCharCode(...bytes.slice(start,end));
  const valid = mime==='application/pdf' ? ascii(0,5)==='%PDF-' :
    mime==='image/jpeg' ? bytes[0]===255&&bytes[1]===216&&bytes[2]===255 :
    mime==='image/png' ? [...bytes.slice(0,8)].join(',')==='137,80,78,71,13,10,26,10' :
    mime==='image/webp' ? ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP' :
    ascii(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8,32));
  if (!valid) throw new ApiError('BAD_FILE');
  if (typeof raw.uploadKey!=='string' || !/^[A-Za-z0-9_-]{8,64}$/.test(raw.uploadKey)) throw new ApiError('BAD_REQUEST');
  return {bytes,mime,name,uploadKey:raw.uploadKey};
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readJson(request: Request): Promise<unknown> {
  if (Number(request.headers.get('content-length'))>MAX_BODY_BYTES) throw new ApiError('TOO_BIG');
  const reader=request.body?.getReader(); if (!reader) throw new ApiError('BAD_REQUEST');
  const chunks:Uint8Array[]=[]; let length=0;
  while (true) {const {done,value}=await reader.read();if(done) break;length+=value.length;if(length>MAX_BODY_BYTES){await reader.cancel();throw new ApiError('TOO_BIG');}chunks.push(value);}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder().decode(body));}catch{throw new ApiError('BAD_REQUEST');}
}
