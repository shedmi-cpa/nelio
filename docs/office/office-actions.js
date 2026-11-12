/* Stages 6.3.1 and 6.3.2: office actions in the client drawer (D47, D48, D50).
 * The server checks the office account and every state change. This file only builds the controls,
 * shows previews and sends one request per action. Nothing here is stored in the browser. */
(() => {
 'use strict';
 const MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
 const REASONS=['התמונה מטושטשת','חסרים עמודים','זה לא המסמך הנכון','החודש לא נכון','הקובץ חתוך'];
 const LINK_PLACEHOLDER='[הקישור האישי]';
 const UPLOAD_TYPES=['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
 const MAX_UPLOAD=10*1048576;

 // Same rule as nelio_period_label: 2026-10 is "אוקטובר 2026", 2026-09_10 is "ספטמבר–אוקטובר 2026".
 function periodLabel(period) {
  const m=/^(\d{4})-(\d{2})(?:_(\d{2}))?$/.exec(String(period||''));
  if(!m)return String(period||'');
  const first=MONTHS[Number(m[2])-1]||m[2],second=m[3]?'–'+(MONTHS[Number(m[3])-1]||m[3]):'';
  return first+second+' '+m[1];
 }
 function fillTemplate(text,fields) {
  let out=String(text||'');
  for(const [key,value] of Object.entries(fields))out=out.split(key).join(String(value??''));
  return out;
 }
 function composeReason(preset,detail) {
  const a=String(preset||'').trim(),b=String(detail||'').replace(/\s+/g,' ').trim();
  if(!a)return b.slice(0,300);
  if(!b)return a.slice(0,300);
  return (a+'. '+b).slice(0,300);
 }
 // D34: the demo phone numbers are masked, so WhatsApp opens with the text and no number.
 function whatsappUrl(text){return 'https://wa.me/?text='+encodeURIComponent(String(text||''));}
 function canReject(file,item) {
  return Boolean(file&&item&&file.ingest_status==='ready'&&file.status!=='rejected'&&['received','rejected'].includes(item.status));
 }
 function available(status) {
  return {
   approve:status==='submitted',
   manual:status!=='complete',
   whatsapp:status==='not_started'||status==='partial'
  };
 }
 const ERRORS={
  NOT_ALLOWED:'הפעולה לא מתאימה למצב הנוכחי של הלקוח. רעננו את התיק ונסו שוב.',
  BAD_ACTOR:'בחרו מחדש בראש הלוח מי עובד עכשיו.',
  BAD_REASON:'כתבו סיבה.',BAD_NOTE:'כתבו הערה קצרה, למשל "קיבלנו בדואר".',
  NOTHING_MISSING:'לא חסר ללקוח אף מסמך חובה, ולכן אין תזכורת לשלוח.',
  TEMPLATE_MISSING:'נוסח ההודעה חסר במערכת, ולכן הפעולה לא בוצעה.',
  LINK_KEY_MISSING:'מפתח הקישורים עוד לא הוגדר בשרת, ולכן הקישור לא הוחלף.',
  BAD_TYPE:'סוג הקובץ לא נתמך.',TOO_BIG:'הקובץ גדול מדי.',QUOTA_EXCEEDED:'בבקשה הזו כבר יש מספר הקבצים המרבי.',
  UPLOAD_CONFLICT:'ההעלאה התנגשה בהעלאה קודמת. נסו שוב.',UPLOAD_PENDING:'הקובץ עוד לא נשמר. נסו שוב בעוד רגע.',
  STORAGE:'שמירת הקובץ נכשלה. בדקו את החיבור ונסו שוב.',TOO_LARGE:'הקובץ גדול מדי ל־ZIP אחד. בחרו טווח קטן יותר.',
  LINK_KEY_INVALID:'מפתח הקישורים בשרת לא תקין, ולכן הקישור לא הוחלף.',
  NOT_FOUND:'הלקוח או הקובץ לא נמצאו. רעננו את התיק.',
  UNAUTHORIZED:'ההתחברות פגה. התחברו מחדש.',FORBIDDEN:'אין הרשאה לפעולה הזו.'
 };
 // Israeli format, 24 hours, Asia/Jerusalem: 09/11/2026 09:00.
 function dateTime(value) {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem'})
   .formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return parts.day+'/'+parts.month+'/'+parts.year+' '+parts.hour+':'+parts.minute;
 }
 // Same limits as the server: the type list and 10 MiB. HEIC from iPhones has no reliable browser MIME, so the name decides.
 function uploadType(file) {
  const t=String(file?.type||'').toLowerCase(),n=String(file?.name||'').toLowerCase();
  if(UPLOAD_TYPES.includes(t))return t;
  if(n.endsWith('.heic'))return 'image/heic';
  if(n.endsWith('.heif'))return 'image/heif';
  return '';
 }
 function uploadProblem(file) {
  if(!file)return 'בחרו קובץ.';
  if(!uploadType(file))return 'סוג הקובץ לא נתמך. אפשר להעלות תמונה (JPG, PNG, WebP, HEIC) או PDF.';
  if(file.size<1)return 'הקובץ ריק.';
  if(file.size>MAX_UPLOAD)return 'הקובץ גדול מ־10 מגה־בייט. אפשר לסרוק באיכות נמוכה יותר או לפצל.';
  return '';
 }
 async function sha256Hex(buffer) {
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
 }
 function newUploadKey(){return 'office-'+Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');}
 function errorText(code){return ERRORS[code]||'הפעולה לא הצליחה. בדקו את החיבור ונסו שוב.';}

 function create({officeCall,getActor,setActor,staffList,onActorMissing,onChanged,staffName,announce,publishableKey,supabaseUrl,fetchImpl=(...a)=>fetch(...a)}) {
  const doc=document,el=id=>doc.getElementById(id);
  const dialog=el('action-dialog'),title=el('action-title'),body=el('action-body'),foot=el('action-foot'),note=el('action-message');
  let detail=null,returnFocus=null,busy=false,ticket=0,abortCurrent=null;

  function node(tag,attrs={},text) {
   const n=doc.createElement(tag);
   for(const [k,v] of Object.entries(attrs)){if(k==='className')n.className=v;else n.setAttribute(k,v);}
   if(text!==undefined)n.textContent=text;
   return n;
  }
  function button(text,cls,handler) {
   const b=node('button',{type:'button',className:cls},text);
   b.addEventListener('click',handler);return b;
  }
  function actorOrStop() {
   const actor=getActor();
   if(!actor)onActorMissing();
   return actor;
  }
  function fields() {
   const c=detail?.client||{};
   return {'[שם איש הקשר]':c.contact_name||'','[שם העסק]':c.business_name||'','[חודש]':periodLabel(detail?.request?.period),
    '[שם המשרד]':"שדמי ושות', רואי חשבון",'[קישור]':LINK_PLACEHOLDER};
  }
  function template(id){return (detail?.templates||[]).find(t=>t.template_id===id)?.body||'';}

  function open(heading,trigger) {
   ++ticket;returnFocus=trigger||doc.activeElement;busy=false;
   title.textContent=heading;body.replaceChildren();foot.replaceChildren();note.textContent='';note.className='';
   dialog.hidden=false;
   return ticket;
  }
  function close() {
   if(dialog.hidden)return;
   if(abortCurrent){abortCurrent();abortCurrent=null;}
   ++ticket;dialog.hidden=true;body.replaceChildren();foot.replaceChildren();
   if(returnFocus?.isConnected)returnFocus.focus();
   returnFocus=null;
  }
  function focusFirst() {
   const first=dialog.querySelector('select,textarea,input,button:not([disabled]),a[href]');
   (first||title).focus();
  }
  function say(text,error=false){note.textContent=text;note.className=error?'error':'';}
  async function send(action,payload,{onDone,keepOpen}={}) {
   if(busy)return null;
   const actor=actorOrStop();if(!actor)return null;
   const mine=ticket;busy=true;
   for(const b of foot.querySelectorAll('button'))b.disabled=true;
   try {
    const result=await officeCall(action,{requestId:detail.request.request_id,actor,...payload});
    if(mine!==ticket&&!dialog.hidden)return null;
    if(onDone)onDone(result);
    if(!keepOpen)close();
    onChanged();
    return result;
   } catch(e) {
    if(dialog.hidden)announce(errorText(e.code),true);else say(errorText(e.code),true);
    return null;
   } finally {
    busy=false;
    for(const b of foot.querySelectorAll('button'))b.disabled=false;
   }
  }

  function rejectDialog(file,itemName,trigger) {
   if(!actorOrStop())return;
   open(itemName+': לא קריא',trigger);
   const reasonLabel=node('label',{for:'reject-reason'},'סיבה');
   const select=node('select',{id:'reject-reason'});
   for(const r of REASONS)select.append(new Option(r,r));
   select.append(new Option('סיבה אחרת (כתבו בפירוט)',''));
   reasonLabel.append(select);
   const detailLabel=node('label',{for:'reject-detail'},'פירוט ללקוח (לא חובה)');
   const area=node('textarea',{id:'reject-detail',maxlength:'200',rows:'2'});
   detailLabel.append(area);
   const preview=node('div',{className:'message-preview','aria-live':'polite'});
   const fileLine=node('p',{className:'minor'},'הקובץ: '+(file.stored_name||file.original_name||'')+'. הוא לא נמחק: הוא מסומן "נדחה" ונשאר בתיק.');
   const update=()=>{
    const reason=composeReason(select.value,area.value)||'[סיבה]';
    preview.textContent=fillTemplate(template('REJECTED')||'[סוג המסמך]: [סיבה]',{...fields(),'[סוג המסמך]':itemName,'[סיבה]':reason});
   };
   select.addEventListener('change',update);area.addEventListener('input',update);update();
   const demo=node('p',{className:'minor'},'במצב הדגמה ההודעה נרשמת ביומן ולא נשלחת. אם הבקשה כבר אושרה, האישור מתבטל.');
   body.append(reasonLabel,detailLabel,node('p',{className:'minor'},'ההודעה ללקוח:'),preview,fileLine,demo);
   foot.append(
    button('סימון ושליחת בקשה','primary',()=>{
     const reason=composeReason(select.value,area.value);
     if(!reason){say(ERRORS.BAD_REASON,true);area.focus();return;}
     void send('reject',{uploadId:file.upload_id,reason},{onDone:r=>announce(r.linkMissing?
      'סומן "לא קריא". ההודעה נרשמה בלי קישור, כי ללקוח אין עדיין קישור שמור.':'סומן "לא קריא" והבקשה להעלות שוב נרשמה.')});
    }),
    button('ביטול','quiet',close));
   focusFirst();
  }

  function manualDialog(trigger) {
   if(!actorOrStop())return;
   open('הושלם ידני',trigger);
   const label=node('label',{for:'manual-note'},'מה התקבל ואיך (חובה)');
   const area=node('textarea',{id:'manual-note',maxlength:'300',rows:'3',placeholder:'למשל: קיבלנו את המסמכים בדואר'});
   label.append(area);
   body.append(node('p',{},'הבקשה תסומן "הושלם" גם אם חסרים בה מסמכים במערכת.'),label);
   foot.append(button('סימון כהושלם','primary',()=>{
    const text=area.value.replace(/\s+/g,' ').trim();
    if(!text){say(ERRORS.BAD_NOTE,true);area.focus();return;}
    void send('completeManual',{note:text},{onDone:()=>announce('הבקשה סומנה כהושלמה.')});
   }),button('ביטול','quiet',close));
   focusFirst();
  }

  async function whatsappDialog(trigger) {
   const actor=actorOrStop();if(!actor)return;
   const mine=open('תזכורת בוואטסאפ: '+(detail.client.business_name||''),trigger);
   const preview=node('div',{className:'message-preview','aria-live':'polite'},'מכינים את ההודעה…');
   body.append(preview);
   foot.append(button('ביטול','quiet',close));
   focusFirst();
   let text='';
   try {
    const r=await officeCall('whatsapp',{requestId:detail.request.request_id,actor,dryRun:true});
    if(mine!==ticket)return;
    text=r.text||'';preview.textContent=text;
    if(r.linkMissing)body.append(node('p',{className:'minor'},'ללקוח אין עדיין קישור שמור, ולכן ההודעה מפנה לקישור שבמייל. אפשר ליצור קישור חדש מהתיק.'));
   } catch(e) {
    if(mine!==ticket)return;
    preview.textContent='';say(errorText(e.code),true);return;
   }
   body.append(node('p',{className:'minor'},'וואטסאפ נפתח בלשונית חדשה, בלי מספר (הטלפונים בהדגמה בדויים). בוחרים את השיחה ביד. הלחיצה נרשמת ביומן ונספרת כתזכורת.'));
   const link=node('a',{className:'primary button-link',href:whatsappUrl(text),target:'_blank',rel:'noopener noreferrer'},'פתיחת וואטסאפ');
   link.addEventListener('click',()=>{void send('whatsapp',{dryRun:false},{onDone:()=>announce('התזכורת בוואטסאפ נרשמה ביומן.')});});
   const copy=button('העתקת ההודעה','quiet',async()=>{
    try{await navigator.clipboard.writeText(text);say('ההודעה הועתקה.');}catch{say('לא הצלחנו להעתיק. סמנו את הטקסט והעתיקו ידנית.',true);}
   });
   foot.replaceChildren(link,copy,button('ביטול','quiet',close));
   link.focus();
  }

  function linkDialog(trigger) {
   if(!actorOrStop())return;
   open('יצירת קישור חדש',trigger);
   body.append(
    node('p',{},'הקישור הנוכחי של '+(detail.client.business_name||'הלקוח')+' יפסיק לעבוד מיד, וייווצר קישור חדש.'),
    node('p',{className:'minor'},'משתמשים בזה כשהקישור הגיע למישהו אחר, או כשאין ללקוח קישור שמור. במצב הדגמה המייל ללקוח נרשם ביומן ולא נשלח.'));
   foot.append(button('יצירת קישור חדש','primary',()=>{
    void send('rotateLink',{},{keepOpen:true,onDone:r=>{
     title.textContent='הקישור החדש';
     const input=node('input',{id:'new-link',type:'text',readonly:'',dir:'ltr',value:r.link||''});
     const label=node('label',{for:'new-link'},'הקישור האישי החדש');label.append(input);
     body.replaceChildren(node('p',{},'הקישור הקודם כבר לא פעיל.'),label);
     foot.replaceChildren(
      button('העתקת הקישור','primary',async()=>{
       try{await navigator.clipboard.writeText(input.value);say('הקישור הועתק.');}catch{input.select();say('סמנו את הקישור והעתיקו ידנית.',true);}
      }),
      button('סגירה','quiet',close));
     input.focus();input.select();
    }});
   }),button('ביטול','quiet',close));
   focusFirst();
  }

  async function remindDialog(trigger) {
   const actor=actorOrStop();if(!actor)return;
   const mine=open('שליחת תזכורת עכשיו',trigger);
   const preview=node('div',{className:'message-preview','aria-live':'polite'},'מכינים את ההודעה…');
   body.append(preview);foot.append(button('ביטול','quiet',close));focusFirst();
   try {
    const r=await officeCall('remindNow',{requestId:detail.request.request_id,actor,dryRun:true});
    if(mine!==ticket)return;
    preview.textContent='';
    preview.append(node('strong',{},r.subject||''),'\n',r.text||'');
    const to=node('p',{className:'minor'},'אל: ');to.append(node('bdi',{dir:'ltr'},r.toEmail||''));
    body.append(to);
    body.append(node('p',{className:'minor'},r.demo?'מצב הדגמה: המייל נרשם ביומן ולא נשלח. השליחה האמיתית תיבנה בשלב 7.':'המייל נכנס לתור ויוצא בזמן המותר הבא.'));
    if(r.linkMissing)body.append(node('p',{className:'minor'},'ללקוח אין עדיין קישור שמור, ולכן ההודעה מפנה לקישור שבמייל הקודם.'));
    foot.replaceChildren(button('שליחת התזכורת','primary',()=>void send('remindNow',{dryRun:false},{onDone:x=>announce(x.messageStatus==='simulated'?'התזכורת נרשמה ביומן (הדגמה, לא נשלחה).':'התזכורת נכנסה לתור.')})),
     button('ביטול','quiet',close));
    foot.firstChild.focus();
   } catch(e){if(mine!==ticket)return;preview.textContent='';say(errorText(e.code),true);}
  }

  function uploadDialog(trigger) {
   if(!actorOrStop())return;
   open('העלאה בשם הלקוח',trigger);
   const types=new Map((detail.docTypes||[]).map(t=>[t.doc_type_id,t.name_he]));
   const docLabel=node('label',{for:'upload-item'},'לאיזה מסמך');
   const select=node('select',{id:'upload-item'});
   for(const item of detail.items||[])select.append(new Option(types.get(item.doc_type_id)||item.doc_type_id,item.item_id));
   const firstMissing=(detail.items||[]).find(i=>i.required&&['missing','rejected'].includes(i.status));
   if(firstMissing)select.value=firstMissing.item_id;
   docLabel.append(select);
   const fileLabel=node('label',{for:'upload-file'},'הקובץ (תמונה או PDF, עד 10 מגה־בייט)');
   const input=node('input',{id:'upload-file',type:'file',accept:UPLOAD_TYPES.join(',')+',.heic,.heif'});
   fileLabel.append(input);
   input.addEventListener('change',()=>{const problem=uploadProblem(input.files?.[0]);say(problem,Boolean(problem));});
   body.append(node('p',{},'למקרה שהלקוח שלח מסמך בוואטסאפ או במייל. הקובץ נשמר בתיק כאילו הלקוח העלה אותו, ונרשם ביומן בשם העובד.'),docLabel,fileLabel);
   const go=button('העלאה','primary',()=>void doUpload(select,input,go));
   foot.append(go,button('ביטול','quiet',close));
   focusFirst();
  }
  async function doUpload(select,input,go) {
   const file=input.files?.[0],problem=uploadProblem(file);
   if(problem){say(problem,true);input.focus();return;}
   const actor=actorOrStop();if(!actor||busy)return;
   const mine=ticket;busy=true;for(const b of foot.querySelectorAll('button'))b.disabled=true;
   const requestId=detail.request.request_id,itemId=select.value;
   try {
    say('מכינים את הקובץ…');
    const bytes=await file.arrayBuffer();
    const start=await officeCall('uploadStart',{requestId,actor,itemId,fileName:file.name.slice(0,120),mimeType:uploadType(file),sizeBytes:file.size,fileHash:await sha256Hex(bytes),uploadKey:newUploadKey()});
    if(mine!==ticket)return;
    if(start.uploadUrl) {
     say('מעלים את הקובץ…');
     const put=await fetchImpl(start.uploadUrl,{method:'PUT',headers:{'Content-Type':uploadType(file),'x-upsert':'false',apikey:publishableKey||''},body:new Blob([bytes],{type:uploadType(file)})});
     if(!put.ok)throw Object.assign(new Error('STORAGE'),{code:'STORAGE'});
    }
    let done=null;
    for(let attempt=0;attempt<3&&!done;attempt++) {
     try{done=await officeCall('uploadFinish',{requestId,actor,itemId,uploadId:start.uploadId});}
     catch(e){if(e.code!=='UPLOAD_PENDING'||attempt===2)throw e;await new Promise(r=>setTimeout(r,800));}
    }
    if(mine!==ticket)return;
    announce('הקובץ נשמר בשם הלקוח: '+(done.storedName||start.storedName||'')+(start.duplicateOf?'. שימו לב: קובץ זהה כבר קיים בבקשה הזו.':'.'));
    close();onChanged();
   } catch(e) {
    if(mine===ticket)say(errorText(e.code),true);
   } finally {
    busy=false;for(const b of foot.querySelectorAll('button'))b.disabled=false;
   }
  }


  // Stage 6.3.4 (D49): one ZIP for a choice of files. scopes: [{id,label,params}], docTypes for the "one type" choice.
  function zipDialog({title,scopes,docTypes=[]},trigger) {
   if(!actorOrStop())return;
   const Z=window.NelioZip;
   const mine=open(title||'הורדת ZIP',trigger);
   let manifest=null,controller=null,check=0;
   const choices=node('fieldset',{className:'choices'});choices.append(node('legend',{className:'minor'},'מה להוריד'));
   scopes.forEach((s,i)=>{
    const label=node('label',{});const radio=node('input',{type:'radio',name:'zip-scope',value:String(i)});if(i===0)radio.checked=true;
    label.append(radio,' '+s.label);
    if(s.withType&&docTypes.length){const sel=node('select',{id:'zip-doc-type','aria-label':'סוג מסמך'});for(const t of docTypes)sel.append(new Option(t.name,t.id));label.append(' ',sel);sel.addEventListener('change',()=>{radio.checked=true;void refresh();});}
    radio.addEventListener('change',()=>void refresh());
    choices.append(label);
   });
   const rejectedLabel=node('label',{className:'check-line'});const rejected=node('input',{type:'checkbox',id:'zip-rejected'});rejected.checked=true;
   rejectedLabel.append(rejected,' לכלול קבצים שנדחו (בתיקייה "נדחו")');rejected.addEventListener('change',()=>void refresh());
   const summary=node('p',{className:'minor','aria-live':'polite'});
   const tree=node('div',{className:'zip-tree',dir:'rtl'});
   const bigLabel=node('label',{className:'check-line'});const big=node('input',{type:'checkbox',id:'zip-big'});
   bigLabel.append(big,' ההורדה גדולה. להמשיך בכל זאת');bigLabel.hidden=true;
   body.append(choices,rejectedLabel,summary,tree,bigLabel);
   const go=button('הורדה','primary',()=>void start());
   const cancel=button('ביטול','quiet',()=>{if(controller){controller.abort();}else close();});
   foot.append(go,cancel);
   function chosen() {
    const i=Number((dialog.querySelector('input[name=zip-scope]:checked')||{}).value||0),s=scopes[i];
    const params={...s.params};if(s.withType)params.docTypeId=(dialog.querySelector('#zip-doc-type')||{}).value;
    return {scope:s,params};
   }
   async function refresh() {
    const ticketNow=++check;manifest=null;go.disabled=true;summary.textContent='בודקים אילו קבצים ייכללו…';tree.replaceChildren();bigLabel.hidden=true;
    const {params}=chosen();
    try {
     const r=await officeCall('zipFiles',{...params,actor:getActor(),includeRejected:rejected.checked,dryRun:true});
     if(ticketNow!==check||mine!==ticket)return;
     manifest=r;
     if(!r.count){summary.textContent='אין קבצים בבחירה הזו.';return;}
     if(r.overLimit){summary.textContent='יותר מ־'+Z.MAX_FILES+' קבצים. בחרו טווח קטן יותר, למשל לקוח אחד.';return;}
     if(r.totalBytes>Z.MAX_BYTES){summary.textContent='הבחירה גדולה מ־2,000 מגה־בייט. בחרו טווח קטן יותר.';return;}
     summary.textContent=r.count+' קבצים, כ־'+Z.sizeText(r.totalBytes)+'. הקבצים נאספים בדפדפן ונשמרים כקובץ אחד.';
     const paths=Z.uniquePaths(r.files);
     // Shown from the business folder down, so each line fits; the archive itself starts at "'+Z.ROOT+'".
     tree.textContent='בתוך התיקייה "'+Z.ROOT+'":\n'+paths.slice(0,6).map(p=>p.slice(Z.ROOT.length+1).split('/').join(' / ')).join('\n')+(paths.length>6?'\n… ועוד '+(paths.length-6):'');
     bigLabel.hidden=r.totalBytes<=Z.WARN_BYTES;big.checked=false;
     go.disabled=false;
    } catch(e){if(ticketNow===check&&mine===ticket){summary.textContent='';say(errorText(e.code),true);}}
   }
   async function start() {
    if(!manifest||!manifest.count)return;
    if(!bigLabel.hidden&&!big.checked){say('סמנו שההורדה גדולה כדי להמשיך.',true);big.focus();return;}
    const actor=actorOrStop();if(!actor)return;
    const {scope,params}=chosen(),name=Z.archiveName(scope.fileLabel||scope.label);
    // Chrome can write straight to disk; the picker must open while the click is still fresh.
    let fileSink=null,blobSink=null;
    if(typeof window.showSaveFilePicker==='function') {
     try{const handle=await window.showSaveFilePicker({suggestedName:name,types:[{description:'ZIP',accept:{'application/zip':['.zip']}}]});fileSink=await handle.createWritable();}
     catch(e){if(e?.name==='AbortError')return;fileSink=null;}
    }
    if(!fileSink)blobSink=Z.memorySink();
    controller=new AbortController();abortCurrent=()=>controller?.abort();go.disabled=true;for(const n of body.querySelectorAll('input,select'))n.disabled=true;cancel.textContent='עצירה';
    try {
     const r=await officeCall('zipFiles',{...params,actor,includeRejected:rejected.checked,dryRun:false});
     say('מורידים 0 מתוך '+r.files.length+'…');
     const result=await Z.exportFiles({files:r.files,officeCall,supabaseUrl,signal:controller.signal,sink:fileSink||blobSink,
      onProgress:(n,total)=>{if(mine===ticket)say('מורידים '+n+' מתוך '+total+'…');}});
     if(fileSink)await fileSink.close();
     else {
      const url=URL.createObjectURL(blobSink.blob());const a=doc.createElement('a');a.href=url;a.download=name;a.hidden=true;doc.body.append(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
     }
     if(mine!==ticket)return;
     say(result.failed.length?'הורדו '+result.added+' קבצים. '+result.failed.length+' לא הורדו, והרשימה שלהם בקובץ "קבצים-שלא-הורדו.txt" בתוך ה־ZIP.':
      'הורדו '+result.added+' קבצים לקובץ '+name+'. ההורדה נרשמה ביומן.',Boolean(result.failed.length));
    } catch(e) {
     if(fileSink){try{await fileSink.abort();}catch{/* nothing was kept */}}
     if(mine===ticket)say(controller?.signal.aborted?'ההורדה נעצרה. לא נשמר קובץ.':errorText(e.code),!controller?.signal.aborted);
    } finally {
     controller=null;abortCurrent=null;cancel.textContent='סגירה';go.disabled=false;for(const n of body.querySelectorAll('input,select'))n.disabled=false;
    }
   }
   focusFirst();void refresh();
  }

  async function approve(trigger) {
   const actor=actorOrStop();if(!actor||busy)return;
   busy=true;trigger.disabled=true;
   try {
    await officeCall('approve',{requestId:detail.request.request_id,actor});
    announce('הבקשה אושרה: בדקתי, תקין.');onChanged();
   } catch(e){announce(errorText(e.code),true);}
   finally{busy=false;trigger.disabled=false;}
  }

  function render(container,d) {
   detail=d;lastContainer=container;container.replaceChildren();
   const r=d.request||{},c=d.client||{},can=available(r.status);
   if(!getActor()) {
    // On a narrow screen the header is behind the modal drawer, so the choice is offered here too.
    const label=node('label',{className:'who-inline',for:'actor-drawer'},'מי עובד עכשיו');
    const select=node('select',{id:'actor-drawer'});select.append(new Option('בחרו',''));
    for(const s of staffList())select.append(new Option(s.name,s.staff_id));
    select.addEventListener('change',()=>{if(select.value){setActor(select.value);render(container,detail);}});
    label.append(select);container.append(label);
   }
   const facts=node('p',{className:'minor'});
   if(c.contact_name) {
    facts.append('איש קשר: '+c.contact_name);
    // Phone numbers and dates keep their own direction inside the Hebrew line (rules.md).
    if(c.phone){facts.append(', ');facts.append(node('bdi',{dir:'ltr'},c.phone));}
    facts.append('. ');
   }
   facts.append('תזכורות: '+Number(r.reminder_count||0));
   if(r.last_reminder_at){facts.append(', אחרונה ');facts.append(node('bdi',{dir:'ltr'},dateTime(r.last_reminder_at)));}
   facts.append('.');
   container.append(facts);
   if(r.status==='complete') {
    const who=staffName(r.completed_by);
    container.append(node('p',{className:'done-line'},'הושלם'+(who?' ע"י '+who:'')+(r.completion_note?': '+r.completion_note:'')+'.'));
   }
   const row1=node('div',{className:'action-row'});
   if(can.approve)row1.append(button('בדקתי, תקין','primary',e=>void approve(e.currentTarget)));
   if(can.manual)row1.append(button('הושלם ידני…','quiet',e=>manualDialog(e.currentTarget)));
   if(row1.children.length)container.append(row1);
   const reminders=node('div',{className:'action-row'});
   if(can.whatsapp)reminders.append(button('תזכורת בוואטסאפ','quiet',e=>void whatsappDialog(e.currentTarget)),
    button('שליחת תזכורת עכשיו','quiet',e=>void remindDialog(e.currentTarget)));
   reminders.append(button('העלאה בשם הלקוח','quiet',e=>uploadDialog(e.currentTarget)));
   reminders.append(button('הורדת ZIP…','quiet',e=>zipDialog(clientZipOptions(d),e.currentTarget)));
   container.append(reminders);
   const row2=node('div',{className:'action-row'});
   row2.append(button('יצירת קישור חדש…','link-button',e=>linkDialog(e.currentTarget)));
   container.append(row2);
   if(!c.hasLink)container.append(node('p',{className:'minor'},'ללקוח אין עדיין קישור שמור במערכת. עד שתיצרו קישור חדש, ההודעות יפנו לקישור שבמייל.'));
  }
  function clientZipOptions(d) {
   const r=d.request||{},c=d.client||{},name=c.business_name||c.client_id||'',period=periodLabel(r.period);
   const types=new Map((d.docTypes||[]).map(t=>[t.doc_type_id,t.name_he]));
   const withFiles=new Set((d.uploads||[]).filter(u=>u.ingest_status==='ready').map(u=>(d.items||[]).find(i=>i.item_id===u.item_id)?.doc_type_id).filter(Boolean));
   const docTypes=(d.items||[]).filter(i=>withFiles.has(i.doc_type_id)).map(i=>({id:i.doc_type_id,name:types.get(i.doc_type_id)||i.doc_type_id}));
   const scopes=[{label:name+', '+period,fileLabel:name+'_'+r.period,params:{scope:'request',requestId:r.request_id}}];
   if(docTypes.length)scopes.push({label:name+', '+period+', רק סוג מסמך:',fileLabel:name+'_'+r.period+'_סוג-מסמך',withType:true,params:{scope:'docType',requestId:r.request_id}});
   scopes.push({label:name+', כל המחזורים',fileLabel:name+'_כל-המחזורים',params:{scope:'client',clientId:c.client_id}});
   return {title:'הורדת ZIP: '+name,scopes,docTypes};
  }
  function cycleZip(cycleId,trigger) {
   zipDialog({title:'הורדת ZIP של המחזור',scopes:[{label:'כל הלקוחות, '+periodLabel(cycleId),fileLabel:'כל-הלקוחות_'+cycleId,params:{scope:'cycle',cycleId}}]},trigger);
  }
  let lastContainer=null;
  function rerender(){if(detail&&lastContainer)render(lastContainer,detail);}
  function fileButton(file,item,itemName) {
   if(!canReject(file,item))return null;
   return button('לא קריא…','danger',e=>rejectDialog(file,itemName,e.currentTarget));
  }
  function handleKey(e) {
   if(dialog.hidden)return false;
   if(e.key==='Escape'){e.preventDefault();close();return true;}
   if(e.key==='Tab') {
    const nodes=[...dialog.querySelectorAll('button:not([disabled]),a[href],input,select,textarea')].filter(n=>n.getClientRects().length>0);
    if(nodes.length) {
     const first=nodes[0],last=nodes[nodes.length-1];
     if(e.shiftKey&&doc.activeElement===first){e.preventDefault();last.focus();}
     else if(!e.shiftKey&&doc.activeElement===last){e.preventDefault();first.focus();}
    }
    return true;
   }
   return false;
  }
  return {render,rerender,fileButton,close,handleKey,cycleZip,isOpen:()=>!dialog.hidden,reset(){close();detail=null;lastContainer=null;}};
 }
 window.NelioOfficeActions=Object.freeze({create,dateTime,uploadType,uploadProblem,sha256Hex,periodLabel,fillTemplate,composeReason,whatsappUrl,canReject,available,errorText,REASONS});
})();
