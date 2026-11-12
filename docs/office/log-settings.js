/* Stage 6.3.3: the activity log tab and the settings tab (brief.md: "יומן פעולות", "הגדרות").
 * The server checks the office account, every value and every change. Nothing is stored in the browser. */
(() => {
 'use strict';
 const SETTING_LABELS={
  due_day:'תאריך היעד (יום בחודש)',reminder1_days_before:'תזכורת ראשונה, ימים לפני היעד',reminder2_days_before:'תזכורת שנייה, ימים לפני היעד',
  last_day_days_before:'"מחר היום האחרון", ימים לפני היעד',summary_days_after:'סיכום לבעל המשרד, ימים אחרי היעד',
  send_time:'שעת שליחה',quiet_start:'תחילת שקט בלילה',quiet_end:'סוף שקט בבוקר',friday_cutoff:'שישי וערב חג, מהשעה'
 };
 const CYCLE_KEYS=['due_day','reminder1_days_before','reminder2_days_before','last_day_days_before','summary_days_after'];
 const TIME_KEYS=['send_time','quiet_start','quiet_end','friday_cutoff'];
 const MESSAGE_STATUS={simulated:'נרשמה (הדגמה, לא נשלחה)',queued:'בתור לשליחה',sent:'נשלחה',cancelled:'בוטלה',failed:'השליחה נכשלה'};
 const PLACEHOLDERS='[שם איש הקשר], [שם העסק], [חודש], [תאריך היעד], [מה שחסר], [רשימת המסמכים], [סוג המסמך], [סיבה], [קישור], [שם המשרד]';

 // Who did it: the client, a staff member (old log: staff:S2, new: office:S2) or the system.
 function who(actor,staffName) {
  const a=String(actor||'');
  if(a.startsWith('client:'))return 'הלקוח';
  const m=/^(?:office|staff):(S[0-9]+)$/.exec(a);
  if(m)return staffName(m[1])||m[1];
  return 'מערכת';
 }
 function category(row) {
  if(row.kind==='message')return 'message';
  const a=String(row.actor||'');
  if(a.startsWith('client:'))return 'client';
  if(/^(office|staff):/.test(a))return 'office';
  return 'system';
 }
 function settingText(details) {
  let out=String(details||'');
  for(const [k,label] of Object.entries(SETTING_LABELS))out=out.split(k+':').join(label+':');
  return out;
 }
 // One sentence per entry. Unknown events still show their details, never an empty line.
 function describe(row) {
  const d=String(row.details||''),with_=t=>d?t+': '+d:t;
  if(row.kind==='message')return 'הודעה "'+d+'" '+(MESSAGE_STATUS[row.status]||row.status||'');
  switch(row.event) {
   case 'upload':case 'finishUpload':return with_('העלה קובץ');
   case 'na':case 'markNa':return with_('סימן "לא היה לי"');
   case 'unmarkNa':return 'ביטל "לא היה לי"';
   case 'client_note':return with_('כתב הערה למשרד');
   case 'approve':case 'office_approve':return 'אישר: בדקתי, תקין';
   case 'reject':case 'office_reject':return with_('סימן "לא קריא"');
   case 'whatsapp':case 'office_whatsapp':return with_('תזכורת בוואטסאפ');
   case 'office_remind':return with_('תזכורת במייל');
   case 'upload_by_staff':case 'office_upload':return with_('העלה בשם הלקוח');
   case 'complete_manual':case 'office_complete_manual':return with_('סימן "הושלם" ידנית');
   case 'new_link':case 'office_new_link':return 'יצר קישור חדש. הקישור הקודם הפסיק לעבוד';
   case 'office_call':return with_('שיחת טלפון');
   case 'office_settings':return 'שינה הגדרות: '+settingText(d);
   case 'office_template':return with_('שינה נוסח הודעה');
   default:return d||String(row.event||'');
  }
 }
 function filterRows(rows,{query='',type=''}={}) {
  const q=String(query).trim().toLocaleLowerCase('he');
  return (rows||[]).filter(r=>(!type||category(r)===type)&&(!q||(String(r.businessName||'')+' '+String(r.clientId||'')).toLocaleLowerCase('he').includes(q)));
 }
 const ERRORS={BAD_VALUE:'הערך לא תקין.',BAD_ORDER:'סדר התזכורות לא תקין: הראשונה לפני השנייה, השנייה לפני "מחר היום האחרון", וכולן לפני תאריך היעד.',
  BAD_QUIET:'שעת השליחה חייבת להיות מחוץ לשעות השקט, ותחילת השקט אחרי סופו.',LINK_REQUIRED:'הנוסח הזה חייב לכלול [קישור], אחרת ללקוח אין לאן להעלות.',
  BAD_ACTOR:'בחרו מחדש בראש הלוח מי עובד עכשיו.',NOT_FOUND:'הנוסח לא נמצא. רעננו את הדף.',UNAUTHORIZED:'ההתחברות פגה. התחברו מחדש.',FORBIDDEN:'אין הרשאה.'};
 function errorText(e) {
  const base=ERRORS[e?.code]||'השמירה לא הצליחה. בדקו את החיבור ונסו שוב.';
  return e?.key&&SETTING_LABELS[e.key]?base+' ('+SETTING_LABELS[e.key]+')':base;
 }

 function create({officeCall,getActor,onActorMissing,staffName,dateTime}) {
  const el=id=>document.getElementById(id);
  let rows=[],logTicket=0,settings=null;

  function renderLog() {
   const body=el('log-rows');body.replaceChildren();
   const shown=filterRows(rows,{query:el('log-search').value,type:el('log-type').value});
   el('log-count').textContent=shown.length+' רשומות';
   for(const r of shown) {
    const tr=document.createElement('tr');
    const when=document.createElement('td');const b=document.createElement('bdi');b.dir='ltr';b.textContent=r.at?dateTime(r.at):'—';when.append(b);
    const by=document.createElement('td');by.textContent=r.kind==='message'?'מערכת':who(r.actor,staffName);
    const client=document.createElement('td');client.textContent=r.businessName||'—';
    const what=document.createElement('td');what.textContent=describe(r);
    tr.append(when,by,client,what);body.append(tr);
   }
   if(!shown.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='אין רשומות שמתאימות לסינון.';tr.append(td);body.append(tr);}
  }
  async function loadLog(cycleId) {
   const mine=++logTicket;el('log-note').textContent='טוענים את היומן…';
   try {
    const d=await officeCall('logList',cycleId?{cycleId}:{});
    if(mine!==logTicket)return;
    rows=d.rows||[];el('log-note').textContent='עד 500 הרשומות האחרונות של המחזור, כולל הודעות.';renderLog();
   } catch {
    if(mine!==logTicket)return;
    rows=[];renderLog();el('log-note').textContent='לא ניתן לטעון את היומן. נסו שוב.';
   }
  }

  function field(key,value) {
   const label=document.createElement('label');label.htmlFor='set-'+key;label.textContent=SETTING_LABELS[key];
   const input=document.createElement('input');input.id='set-'+key;input.dataset.key=key;input.value=value;input.dir='ltr';
   // A text field, not type=time: the browser would show AM/PM in some locales, and rules.md asks for 24 hours.
   if(TIME_KEYS.includes(key)){input.type='text';input.inputMode='numeric';input.maxLength=5;input.placeholder='09:00';input.pattern='([01][0-9]|2[0-3]):[0-5][0-9]';input.autocomplete='off';}
   else{input.type='number';input.min='1';input.max='28';input.inputMode='numeric';}
   label.append(input);return label;
  }
  function renderSettings() {
   const values=new Map((settings.settings||[]).map(s=>[s.key,s.value]));
   const cyc=el('settings-cycle'),quiet=el('settings-quiet');
   cyc.querySelectorAll('label').forEach(n=>n.remove());quiet.querySelectorAll('label').forEach(n=>n.remove());
   for(const k of CYCLE_KEYS)cyc.append(field(k,values.get(k)??''));
   for(const k of TIME_KEYS)quiet.append(field(k,values.get(k)??''));
   const select=el('template-select'),old=select.value;select.replaceChildren();
   for(const t of settings.templates||[])select.add(new Option(t.name||t.templateId,t.templateId));
   if((settings.templates||[]).some(t=>t.templateId===old))select.value=old;
   showTemplate();
   const list=el('holiday-list');list.replaceChildren();
   for(const h of settings.holidays||[]){const li=document.createElement('li');const b=document.createElement('bdi');b.dir='ltr';
    const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(h.date));b.textContent=m?m[3]+'/'+m[2]+'/'+m[1]:String(h.date);li.append(b,' '+(h.name||''));list.append(li);}
   if(!list.children.length){const li=document.createElement('li');li.textContent='אין חגים רשומים לתקופה הקרובה.';list.append(li);}
  }
  function showTemplate() {
   const t=(settings?.templates||[]).find(x=>x.templateId===el('template-select').value);
   el('template-subject').value=t?.subject||'';el('template-body').value=t?.body||'';
   el('template-subject').disabled=!t||t.templateId==='WHATSAPP';
   el('template-message').textContent='';
  }
  async function loadSettings() {
   el('settings-message').textContent='טוענים את ההגדרות…';el('settings-message').className='';
   try{settings=await officeCall('settingsGet');renderSettings();el('settings-message').textContent='';}
   catch(e){el('settings-message').textContent=errorText(e);el('settings-message').className='error';}
  }
  async function saveSettings(button) {
   const actor=getActor();if(!actor){onActorMissing();return;}
   const current=new Map((settings?.settings||[]).map(s=>[s.key,s.value])),values={};
   for(const input of document.querySelectorAll('#settings-form input[data-key]')) {
    const v=String(input.value).trim();
    if(v!==current.get(input.dataset.key))values[input.dataset.key]=v;
   }
   const msg=el('settings-message');
   if(!Object.keys(values).length){msg.textContent='לא שונה דבר.';msg.className='';return;}
   button.disabled=true;
   try{await officeCall('settingsSave',{actor,values});await loadSettings();msg.textContent='ההגדרות נשמרו ונרשמו ביומן.';msg.className='';}
   catch(e){msg.textContent=errorText(e);msg.className='error';}
   finally{button.disabled=false;}
  }
  async function saveTemplate(button) {
   const actor=getActor();if(!actor){onActorMissing();return;}
   const msg=el('template-message'),templateId=el('template-select').value;
   const body=el('template-body').value;
   if(!body.trim()){msg.textContent='הנוסח ריק.';msg.className='error';return;}
   button.disabled=true;
   try{
    const r=await officeCall('templateSave',{actor,templateId,subject:el('template-subject').value,body});
    await loadSettings();el('template-select').value=templateId;showTemplate();
    msg.textContent=r.changed===false?'לא שונה דבר.':'הנוסח נשמר ונרשם ביומן.';msg.className='';
   } catch(e){msg.textContent=errorText(e);msg.className='error';}
   finally{button.disabled=false;}
  }
  el('log-search').addEventListener('input',renderLog);
  el('log-type').addEventListener('change',renderLog);
  el('template-select').addEventListener('change',showTemplate);
  el('settings-save').addEventListener('click',e=>void saveSettings(e.currentTarget));
  el('template-save').addEventListener('click',e=>void saveTemplate(e.currentTarget));
  el('template-reset').addEventListener('click',showTemplate);
  el('template-help').textContent='שדות להחלפה: '+PLACEHOLDERS+'.';
  return {loadLog,loadSettings};
 }
 window.NelioLogSettings=Object.freeze({create,describe,who,category,filterRows,errorText,SETTING_LABELS});
})();
