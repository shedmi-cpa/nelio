/* Stage 6.3.1: office actions in the client drawer (D47, D48, D50).
 * The server checks the office account and every state change. This file only builds the controls,
 * shows previews and sends one request per action. Nothing here is stored in the browser. */
(() => {
 'use strict';
 const MONTHS=['ינואר','פברואר','מרץ','אפריל','מאי','יוני','יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
 const REASONS=['התמונה מטושטשת','חסרים עמודים','זה לא המסמך הנכון','החודש לא נכון','הקובץ חתוך'];
 const LINK_PLACEHOLDER='[הקישור האישי]';

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
 function errorText(code){return ERRORS[code]||'הפעולה לא הצליחה. בדקו את החיבור ונסו שוב.';}

 function create({officeCall,getActor,setActor,staffList,onActorMissing,onChanged,staffName,announce}) {
  const doc=document,el=id=>doc.getElementById(id);
  const dialog=el('action-dialog'),title=el('action-title'),body=el('action-body'),foot=el('action-foot'),note=el('action-message');
  let detail=null,returnFocus=null,busy=false,ticket=0;

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
   if(can.whatsapp)row1.append(button('תזכורת בוואטסאפ','quiet',e=>void whatsappDialog(e.currentTarget)));
   if(row1.children.length)container.append(row1);
   const row2=node('div',{className:'action-row'});
   row2.append(button('יצירת קישור חדש…','link-button',e=>linkDialog(e.currentTarget)));
   container.append(row2);
   if(!c.hasLink)container.append(node('p',{className:'minor'},'ללקוח אין עדיין קישור שמור במערכת. עד שתיצרו קישור חדש, ההודעות יפנו לקישור שבמייל.'));
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
  return {render,rerender,fileButton,close,handleKey,isOpen:()=>!dialog.hidden,reset(){close();detail=null;lastContainer=null;}};
 }
 window.NelioOfficeActions=Object.freeze({create,dateTime,periodLabel,fillTemplate,composeReason,whatsappUrl,canReject,available,errorText,REASONS});
})();
