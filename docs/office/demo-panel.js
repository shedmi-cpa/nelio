/* Stage 7 for the video (D62, D63): the "מצב הדגמה" tab. It shows only while demo_mode is on.
 * "קפיצה" moves the demo clock forward and every step on the way goes out at its own time;
 * "אפס את הדמו" returns to Monday 9/11/2026, 19:30 (D59). The server checks the office account,
 * the staff member and every value. Nothing is stored in the browser. */
(() => {
 'use strict';
 const ERRORS={
  NOT_FORWARD:'אפשר לקפוץ רק קדימה בזמן. כדי לחזור אחורה, אפסו את הדמו.',
  NEED_RESET:'שעון ההדגמה עוד לא הופעל. לחצו קודם על "אפס את הדמו".',
  NOT_DEMO:'מצב הדגמה כבוי, ולכן הפעולה לא זמינה.',
  NO_SNAPSHOT:'צילום הפתיחה חסר במסד, ולכן אי אפשר לאפס.',
  BAD_CONFIRM:'כדי לאפס, כתבו בדיוק "איפוס".',
  BAD_ACTOR:'בחרו קודם מי עובד עכשיו.',
  BAD_REQUEST:'התאריך או השעה לא תקינים.',
  UNAUTHORIZED:'ההתחברות פגה. התחברו מחדש.'
 };
 const errorText=e=>ERRORS[e?.code]||'הפעולה לא הצליחה. נסו שוב בעוד רגע.';
 const fmt=new Intl.DateTimeFormat('he-IL',{weekday:'long',day:'numeric',month:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem'});
 const parts=new Intl.DateTimeFormat('en-CA',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem'});
 // "יום רביעי, 11.11.2026, 09:00" in the browser's Hebrew style.
 function longTime(value){if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':fmt.format(d);}
 function localParts(d){const o={};for(const p of parts.formatToParts(d))o[p.type]=p.value;return o;}
 // A local Israel date and time with the right offset (+02:00 in winter, +03:00 in summer).
 function israelTarget(date,time){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{2}:\d{2}$/.test(time))return null;
  for(const off of ['+02:00','+03:00']){
   const d=new Date(date+'T'+time+':00'+off),p=localParts(d);
   if(p.year+'-'+p.month+'-'+p.day===date&&p.hour+':'+p.minute===time)return date+'T'+time+':00'+off;
  }
  return null;
 }
 function since(value){
  if(!value)return 'עוד לא פנה';
  const s=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));
  if(s<90)return 'פנה לפני פחות מדקה וחצי';
  if(s<3600)return 'פנה לפני '+Math.round(s/60)+' דקות';
  return 'פנה לאחרונה: '+longTime(value);
 }
 function create({officeCall,getActor,onActorMissing,onChanged,el=id=>document.getElementById(id)}){
  let state=null,fetchedAt=0,busy=false,timer=null;
  const note=(text,error=false)=>{const n=el('demo-note');n.textContent=text;n.classList.toggle('error',error);};
  function nowText(){if(!state?.now)return '—';return longTime(new Date(new Date(state.now).getTime()+(Date.now()-fetchedAt)));}
  function tickClock(){el('demo-now').textContent=nowText();}
  function setBusy(v){busy=v;for(const b of document.querySelectorAll('#panel-demo button'))b.disabled=v;}
  function render(){
   el('tab-demo').hidden=!state?.demoMode;
   if(!state)return;
   tickClock();
   el('demo-cycle').textContent=state.cycle?('מחזור '+state.cycle.label+', תאריך יעד '+new Intl.DateTimeFormat('he-IL',{timeZone:'UTC'}).format(new Date(state.cycle.dueDate))+'. '+state.waiting+' לקוחות עדיין חסר להם משהו.'):'אין מחזור פתוח.';
   if(!state.clockSet)note('שעון ההדגמה כבוי, והמערכת עובדת בזמן האמיתי. "אפס את הדמו" מפעיל אותו מיום שני, 9/11/2026, 19:30.');
   const tbody=el('demo-plan');tbody.replaceChildren();
   const now=new Date(state.now).getTime()+(Date.now()-fetchedAt);
   for(const step of state.plan||[]){
    const tr=document.createElement('tr'),name=document.createElement('td'),when=document.createElement('td'),status=document.createElement('td'),act=document.createElement('td');
    name.textContent=step.step==='request'?'פתיחת המחזור והבקשה':step.name;
    when.textContent=longTime(step.sendAt)+(step.shifted?' (זז בגלל שבת, חג או שעות שקט)':'');
    if(step.sentAt){status.textContent='יצא';status.className='status complete';}
    else if(step.collides){status.textContent='ידולג';status.className='status rejected';}
    else{status.textContent='עוד לא';status.className='status';}
    if(!step.sentAt&&step.step!=='request'&&new Date(step.sendAt).getTime()>now&&state.clockSet){
     const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent='קפיצה לכאן';
     b.setAttribute('aria-label','קפיצה ל'+step.name+', '+longTime(step.sendAt));
     b.addEventListener('click',()=>void jump(step.sendAt));act.append(b);
    }
    tr.append(name,when,status,act);tbody.append(tr);
   }
   const real=el('demo-real');real.replaceChildren();
   for(const c of state.realClients||[]){
    const li=document.createElement('li');
    li.textContent=c.contactName+', '+c.businessName+' ('+c.clientId+'): '+(c.hasLink?'יש קישור אישי שמור.':'הקישור האישי ייווצר עם המייל הראשון.');
    real.append(li);
   }
   for(const name of state.owners||[]){const li=document.createElement('li');li.textContent=name+': הסיכום החודשי.';real.append(li);}
   if(!real.children.length){const li=document.createElement('li');li.textContent='אף אחד. כל ההודעות נרשמות בלבד.';real.append(li);}
   const r=state.relay||{},lines=[];
   if(!r.configured)lines.push('השליח עוד לא חובר: צרו סוד, והדביקו אותו ב־Apps Script.');
   else lines.push('שליח המיילים '+since(r.lastSeen)+'.');
   lines.push('בתור לשליחה: '+(r.queued??0)+'. נכשלו: '+(r.failed??0)+'.'+(r.failed&&r.lastError?' השגיאה האחרונה: '+r.lastError:''));
   if(state.linkKeyConfigured===false)lines.push('המפתח NELIO_LINK_KEY לא מוגדר ב־Supabase, ולכן במיילים לא יופיע קישור אישי.');
   el('demo-relay').textContent=lines.join(' ');
   el('demo-relay').classList.toggle('error',!r.configured||state.linkKeyConfigured===false||Boolean(r.failed));
   if(!el('demo-date').value&&state.now){const p=localParts(new Date(state.now));el('demo-date').value=p.year+'-'+p.month+'-'+p.day;}
  }
  async function load(){
   try{state=await officeCall('demoState');fetchedAt=Date.now();render();}
   catch(e){if(el('tab-demo').getAttribute('aria-selected')==='true')note(errorText(e),true);}
   if(!timer)timer=setInterval(()=>{if(!el('panel-demo').hidden)tickClock();},15000);
   return state;
  }
  function actor(){const a=getActor();if(!a){onActorMissing();note(ERRORS.BAD_ACTOR,true);}return a;}
  function showSteps(steps){
   const list=el('demo-result');list.replaceChildren();
   for(const s of steps||[]){const li=document.createElement('li');li.textContent=longTime(s.at)+': '+(s.details||s.name||s.step);list.append(li);}
   list.hidden=!list.children.length;
  }
  async function jump(target){
   const a=actor();if(!a||busy)return;
   setBusy(true);note('מקדמים את השעון…');
   try{
    const res=await officeCall('demoJump',{actor:a,target});
    showSteps(res.steps);
    note('השעה במערכת עכשיו: '+longTime(res.now)+'. '+(res.steps?.length?'הצעדים שבדרך יצאו, כל אחד בזמן שלו.':'לא היה צעד בדרך.'));
    await load();onChanged();
   }catch(e){note(errorText(e),true);}
   finally{setBusy(false);}
  }
  el('demo-jump').addEventListener('click',()=>{
   const target=israelTarget(el('demo-date').value,el('demo-time').value);
   if(!target){note(ERRORS.BAD_REQUEST,true);return;}
   void jump(target);
  });
  el('demo-reset').addEventListener('click',async()=>{
   const a=actor();if(!a||busy)return;
   if(el('demo-confirm').value.trim()!=='איפוס'){note(ERRORS.BAD_CONFIRM,true);el('demo-confirm').focus();return;}
   setBusy(true);note('מאפסים…');
   try{
    const res=await officeCall('demoReset',{actor:a,confirm:'איפוס'});
    el('demo-confirm').value='';showSteps([]);el('demo-date').value='';
    note('הדמו חזר ליום שני, 9/11/2026, 19:30.'+(res.outside?' '+res.outside+' קבצים שהועלו בהדגמה נשארו באחסון, מחוץ לצילום הפתיחה.':''));
    await load();onChanged();
   }catch(e){note(errorText(e),true);}
   finally{setBusy(false);}
  });
  el('demo-secret').addEventListener('click',async()=>{
   const a=actor();if(!a||busy)return;
   if(state?.relay?.configured&&!window.confirm('ליצור סוד חדש? השליח יפסיק לשלוח עד שתדביקו את הסוד החדש ב־Apps Script.'))return;
   setBusy(true);
   try{
    const res=await officeCall('relaySecret',{actor:a});
    el('demo-secret-value').value=res.secret;el('demo-secret-out').hidden=false;el('demo-secret-value').select();
    note('נוצר סוד חדש. הוא מוצג רק עכשיו.');
    await load();
   }catch(e){note(errorText(e),true);}
   finally{setBusy(false);}
  });
  el('demo-secret-copy').addEventListener('click',async()=>{
   try{await navigator.clipboard.writeText(el('demo-secret-value').value);note('הסוד הועתק.');}
   catch{el('demo-secret-value').select();note('סמנו את הסוד והעתיקו ידנית.');}
  });
  return {load,isDemo:()=>Boolean(state?.demoMode)};
 }
 window.NelioDemoPanel=Object.freeze({create,israelTarget,longTime,errorText});
})();
