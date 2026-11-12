/* Stage 6.3.2: today's call list (brief.md). Clients of the cycle who still have something to do.
 * "Called" only records the call in the log; it changes no status. The server checks every request. */
(() => {
 'use strict';
 function timeOf(value) {
  if(!value)return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem'})
   .formatToParts(new Date(value)).map(p=>[p.type,p.value]));
  return parts.hour+':'+parts.minute;
 }
 function dateOf(value) {
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(value||''));
  return m?m[3]+'/'+m[2]+'/'+m[1]:'';
 }
 // Rows for one bookkeeper (or everyone), clients not yet called first.
 function visibleRows(rows,staffId) {
  return (rows||[]).filter(r=>!staffId||r.bookkeeperId===staffId)
   .sort((a,b)=>(a.calledAt?1:0)-(b.calledAt?1:0)||String(a.businessName).localeCompare(String(b.businessName),'he'));
 }
 function create({officeCall,getActor,onActorMissing,openClient,staffName,onCount}) {
  const el=id=>document.getElementById(id);
  const tbody=el('call-rows'),note=el('call-note'),filter=el('call-staff');
  let data=null,ticket=0,cycleId='';
  function cell(tr,content,cls) {
   const td=document.createElement('td');if(cls)td.className=cls;
   if(content instanceof Node)td.append(content);else td.textContent=String(content??'');
   tr.append(td);return td;
  }
  function render() {
   tbody.replaceChildren();
   if(!data)return;
   const rows=visibleRows(data.rows,filter.value);
   const due=dateOf(data.dueDate);
   note.textContent=data.fromDueDate?
    'תאריך היעד ('+due+') עבר. אלה הלקוחות שעוד חסר להם משהו: '+rows.length+'.':
    'תאריך היעד הוא '+due+'. עד אז הרשימה מוצגת לידיעה בלבד. כרגע עוד חסר משהו ל־'+rows.length+' לקוחות.';
   for(const r of rows) {
    const tr=document.createElement('tr');
    const open=document.createElement('button');open.type='button';open.className='client-open';open.textContent=r.businessName||r.clientId;
    open.addEventListener('click',()=>openClient(r.requestId,open.textContent,open));
    cell(tr,open);
    cell(tr,r.contactName||'—');
    const phone=document.createElement('bdi');phone.dir='ltr';phone.textContent=r.phone||'—';cell(tr,phone);
    cell(tr,r.missing||'—','missing-cell');
    cell(tr,r.reminderCount??0);
    if(r.calledAt) {
     cell(tr,'טופל '+timeOf(r.calledAt)+(r.calledBy?' ע"י '+(staffName(String(r.calledBy).replace(/^office:/,''))||''):''),'minor');
    } else {
     const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent='טופל';
     b.addEventListener('click',()=>void markCalled(r,b));cell(tr,b);
    }
    tbody.append(tr);
   }
   if(!rows.length){const tr=document.createElement('tr');const td=cell(tr,'אין לקוחות שחסר להם משהו.');td.colSpan=6;tbody.append(tr);}
  }
  async function markCalled(row,b) {
   const actor=getActor();if(!actor){onActorMissing();return;}
   b.disabled=true;
   try{await officeCall('callDone',{requestId:row.requestId,actor});await load(cycleId);}
   catch{note.textContent='הרישום לא הצליח. בדקו את החיבור ונסו שוב.';b.disabled=false;}
  }
  async function load(cycle) {
   cycleId=cycle||'';const mine=++ticket;
   try {
    const d=await officeCall('callList',cycleId?{cycleId}:{});
    if(mine!==ticket)return;
    data=d;onCount(d.fromDueDate?(d.rows||[]).length:null);render();
   } catch {
    if(mine!==ticket)return;
    data=null;tbody.replaceChildren();onCount(null);note.textContent='לא ניתן לטעון את רשימת הטלפונים. נסו שוב.';
   }
  }
  filter.addEventListener('change',render);
  return {load,render,setStaff(list,preferred){
   const old=filter.value;filter.replaceChildren(new Option('כולם',''));
   for(const s of list)filter.add(new Option(s.name,s.staff_id));
   filter.value=list.some(s=>s.staff_id===old)?old:(list.some(s=>s.staff_id===preferred)?preferred:'');
  }};
 }
 window.NelioCallList=Object.freeze({create,visibleRows,timeOf,dateOf});
})();
