/* Stage 6.1. Authorization is enforced by the server, never this UI. */
(() => {
 'use strict';
 const c=window.NELIO_OFFICE_CONFIG,lib=window.supabase;
 const el=id=>document.getElementById(id),msg=el('message'),login=el('login'),dashboard=el('dashboard'),logout=el('logout'),button=el('login-button'),cycle=el('cycle-select'),tbody=el('rows');
 if(!c||!lib?.createClient){msg.textContent='רכיב ההתחברות לא נטען. בדקו את החיבור לאינטרנט ורעננו.';msg.classList.add('error');return;}
 const auth=lib.createClient(c.supabaseUrl,c.publishableKey,{auth:{flowType:'pkce',autoRefreshToken:true,detectSessionInUrl:true,persistSession:true}});
 let activeId=null,overview=null,currentRequest=null,sequence=0;
 function message(s,error=false){msg.hidden=false;msg.textContent=s;msg.classList.toggle('error',error);}
 function signedOut(s='כדי להיכנס ללוח, התחברו באמצעות חשבון המשרד.'){activeId=null;overview=null;currentRequest=null;el('client-detail').hidden=true;dashboard.hidden=true;login.hidden=false;logout.hidden=true;message(s);}
 const statusName={complete:'הושלם',partial:'הושלם חלקית',not_started:'לא התחיל',submitted:'ממתין לבדיקה'};
 const date=value=>value?new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'}).format(new Date(value)):'—';
 function cell(tr,value,cl=''){const td=document.createElement('td');td.textContent=String(value??'—');if(cl)td.className=cl;tr.append(td);}
 function render(d){
  overview=d;el('client-detail').hidden=true;currentRequest=null;
  const cycles=Array.isArray(d.cycles)?d.cycles:[],requests=Array.isArray(d.requests)?d.requests:[],clients=new Map((d.clients||[]).map(x=>[x.client_id,x])),staff=new Map((d.staff||[]).map(x=>[x.staff_id,x.name]));
  cycle.replaceChildren();
  for(const x of cycles){const op=document.createElement('option');op.value=x.cycle_id;op.textContent=x.cycle_id;op.selected=x.cycle_id===d.cycleId;cycle.append(op);}
  const chosen=cycles.find(x=>x.cycle_id===d.cycleId);
  el('cycle-details').textContent='תאריך יעד: '+date(chosen?.due_date)+' | '+(chosen?.status==='open'?'מחזור פתוח':'ארכיון');
  const counts={complete:0,partial:0,not_started:0,submitted:0};
  for(const r of requests){if(Object.hasOwn(counts,r.status))counts[r.status]++;else counts.submitted++;}
  el('count-complete').textContent=counts.complete;el('count-partial').textContent=counts.partial;el('count-not-started').textContent=counts.not_started;el('count-pending').textContent=counts.submitted;
  const sf=el('filter-staff'),old=sf.value;sf.replaceChildren(new Option('כולם',''));for(const [id,name] of staff)sf.add(new Option(name,id));sf.value=old;
  renderRows();
 } 
 function renderRows(){
  if(!overview)return;
  const d=overview,requests=Array.isArray(d.requests)?d.requests:[],clients=new Map((d.clients||[]).map(x=>[x.client_id,x])),staff=new Map((d.staff||[]).map(x=>[x.staff_id,x.name]));
  const q=el('client-search').value.trim().toLocaleLowerCase('he'),s=el('filter-staff').value,st=el('filter-status').value,fr=el('filter-frequency').value;
  const filtered=requests.filter(r=>{const c=clients.get(r.client_id);return (!q||((c?.business_name||'')+' '+r.client_id).toLocaleLowerCase('he').includes(q))&&(!s||c?.bookkeeper_id===s)&&(!st||r.status===st)&&(!fr||c?.frequency===fr);});
  el('table-count').textContent=filtered.length+' מתוך '+requests.length+' לקוחות';tbody.replaceChildren();
  for(const r of filtered){const client=clients.get(r.client_id),tr=document.createElement('tr'),td=document.createElement('td'),open=document.createElement('button');open.type='button';open.className='client-open';open.textContent=client?.business_name||r.client_id;open.addEventListener('click',()=>openClient(r.request_id));td.append(open);tr.append(td);cell(tr,staff.get(client?.bookkeeper_id)||'—');cell(tr,statusName[r.status]||'—','status '+r.status);cell(tr,r.last_activity||'—');tbody.append(tr);}
  if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='לא נמצאו לקוחות התואמים לסינון.';tr.append(td);tbody.append(tr);}
 }
 async function officeCall(action,payload={}){
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token)throw Object.assign(new Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});
  return call(action,session.access_token,payload);
 }
 async function openClient(requestId){
  const ticket=++sequence;currentRequest=requestId;const panel=el('client-detail'),container=el('detail-items');panel.hidden=false;container.replaceChildren();el('detail-message').textContent='טוענים תיק לקוח…';
  try{
   const d=await officeCall('clientDetail',{requestId});if(ticket!==sequence||currentRequest!==requestId)return;
   el('detail-title').textContent=d.client.business_name||'תיק לקוח';
   el('detail-meta').textContent='מזהה '+d.client.client_id+' | '+d.request.cycle_id+' | '+(d.client.frequency==='bimonthly'?'דיווח דו־חודשי':'דיווח חודשי')+' | '+(statusName[d.request.status]||'');
   el('detail-message').textContent=d.request.client_note?'הערת לקוח: '+d.request.client_note:'';
   const types=new Map((d.docTypes||[]).map(t=>[t.doc_type_id,t]));
   for(const item of d.items||[]){
    const part=document.createElement('article');part.className='document-item';
    const h=document.createElement('h3');h.textContent=types.get(item.doc_type_id)?.name_he||item.doc_type_id;part.append(h);
    const state=document.createElement('p');state.className=item.status==='received'?'received':item.status==='rejected'?'rejected':'missing';state.textContent=({received:'התקבל',missing:'חסר',rejected:'לא קריא',not_applicable:'לא היה החודש'})[item.status]||item.status;part.append(state);
    if(item.reject_reason||item.na_note){const note=document.createElement('p');note.textContent=item.reject_reason||item.na_note;part.append(note);}
    const files=(d.uploads||[]).filter(u=>u.item_id===item.item_id);
    for(const file of files){const line=document.createElement('div');line.className='document-file';const name=document.createElement('span');name.textContent=file.stored_name||file.original_name||'קובץ';line.append(name);
     if(file.ingest_status==='ready'){const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent='צפייה בקובץ';b.addEventListener('click',()=>openFile(requestId,file.upload_id,b));line.append(b);}
     else{const pending=document.createElement('span');pending.textContent='העלאה לא הושלמה';line.append(pending);}
     part.append(line);
    }container.append(part);
   }
  }catch(e){if(ticket!==sequence)return;el('detail-message').textContent='לא ניתן לפתוח את תיק הלקוח. נסו שוב.';}
 }
 async function openFile(requestId,uploadId,button){
  button.disabled=true;const details=el('detail-message');details.textContent='';
  try{const d=await officeCall('openFile',{requestId,uploadId});if(currentRequest!==requestId)return;const dest=new URL(d.url);if(dest.origin!==new URL(c.supabaseUrl).origin||!dest.pathname.startsWith('/storage/v1/object/sign/nelio-documents/'))throw Error('INVALID_URL');const a=document.createElement('a');a.href=dest.href;a.target='_blank';a.rel='noopener noreferrer';a.textContent='פתיחת הקובץ (הקישור תקף לדקה)';a.className='file-signed-link';details.replaceChildren(a);}
  catch(e){details.textContent=e.code==='DRIVE_NOT_CONFIGURED'?'מסמך ארכיון ב־Drive: נדרש חיבור פרטי של השרת לצפייה בו. אין גישה ציבורית.':'לא הצלחנו לפתוח את המסמך. נסו שוב.';}
  finally{button.disabled=false;}
 }
 }
 async function call(action,token,payload={}){
  const res=await fetch(c.officeApi,{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:c.publishableKey},body:JSON.stringify({action,...payload})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok){const e=new Error(data.code||String(res.status));e.code=data.code||String(res.status);throw e;}return data;
 }
 async function refresh(cycleId){
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token){signedOut();return;}
  activeId=session.user.id;message('טוענים את נתוני המשרד…');
  try{
   const result=await call('overview',session.access_token,cycleId?{cycleId}:{});
   if(activeId!==session.user.id)return;
   render(result);login.hidden=true;dashboard.hidden=false;logout.hidden=false;msg.hidden=true;
  }catch(e){
   dashboard.hidden=true;
   if(e.code==='FORBIDDEN'){signedOut('החשבון מחובר ל־Google אך אינו מורשה לגשת למשרד.');logout.hidden=false;}
   else if(e.code==='UNAUTHORIZED')signedOut('ההתחברות פגה. התחברו מחדש.');
   else {message('לא ניתן לטעון את לוח המשרד. בדקו שה־API והתחברות Google הוגדרו.',true);logout.hidden=false;}
  }
 }
 button.addEventListener('click',async()=>{
  button.disabled=true;message('פותחים את Google להתחברות מאובטחת…');
  const {error}=await auth.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('./',location.href).toString()}});
  if(error){message('ההתחברות לא נפתחה. בדקו את הגדרות Google ב־Supabase.',true);button.disabled=false;}
 });
 logout.addEventListener('click',async()=>{await auth.auth.signOut();signedOut('התנתקת מהמערכת.');});
 cycle.addEventListener('change',()=>{++sequence;refresh(cycle.value);});
 for(const id of ['client-search','filter-staff','filter-status','filter-frequency'])el(id).addEventListener(id==='client-search'?'input':'change',renderRows);
 el('close-detail').addEventListener('click',()=>{++sequence;currentRequest=null;el('client-detail').hidden=true;});
 auth.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')signedOut('התנתקת מהמערכת.');});
 auth.auth.getSession().then(({data:{session},error})=>{if(error||!session?.user)signedOut();else refresh();}).catch(()=>signedOut('לא הצלחנו לבדוק התחברות. רעננו את הדף.'));
})();
