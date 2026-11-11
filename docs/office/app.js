/* Stage 6.1. Authorization is enforced by the server, never this UI. */
(() => {
 'use strict';
 const c=window.NELIO_OFFICE_CONFIG,lib=window.supabase;
 const el=id=>document.getElementById(id),msg=el('message'),login=el('login'),dashboard=el('dashboard'),logout=el('logout'),button=el('login-button'),cycle=el('cycle-select'),tbody=el('rows');
 if(!c||!lib?.createClient){msg.textContent='רכיב ההתחברות לא נטען. בדקו את החיבור לאינטרנט ורעננו.';msg.classList.add('error');return;}
 const auth=lib.createClient(c.supabaseUrl,c.publishableKey,{auth:{flowType:'pkce',autoRefreshToken:true,detectSessionInUrl:true,persistSession:true}});
 let activeId=null,overview=null,currentRequest=null,sequence=0,returnFocus=null;
 if (!window.NelioDocumentPreview?.create) {
  msg.textContent='רכיב תצוגת המסמכים לא נטען. רעננו את הדף.';
  msg.classList.add('error');return;
 }
 const panel=el('client-detail'),scrim=el('drawer-scrim');
 const viewer=window.NelioDocumentPreview.create({officeCall,getCurrentRequest:()=>currentRequest,supabaseUrl:c.supabaseUrl});
 const isNarrow=()=>window.matchMedia('(max-width: 1150px)').matches;
 function setInert(value) {
  document.querySelector('main').inert=value;
  document.querySelector('header.top').inert=value;
  document.querySelector('footer').inert=value;
 }
 function syncDrawerMode() {
  if(panel.hidden)return;
  const narrow=isNarrow();
  scrim.hidden=!narrow;
  panel.setAttribute('role',narrow?'dialog':'region');
  if(narrow)panel.setAttribute('aria-modal','true');
  else panel.removeAttribute('aria-modal');
  document.body.classList.toggle('drawer-modal',narrow);
  setInert(narrow);
  if(narrow&&!panel.contains(document.activeElement)&&!viewer.isModalOpen())el('close-detail').focus();
 }
 function closeDrawer(restore=true) {
  ++sequence;currentRequest=null;viewer.reset();
  panel.hidden=true;scrim.hidden=true;
  document.body.classList.remove('drawer-open','drawer-modal');
  setInert(false);
  if(restore)(returnFocus?.isConnected?returnFocus:el('client-search')).focus();
  returnFocus=null;
 }
 function message(s,error=false){msg.hidden=false;msg.textContent=s;msg.classList.toggle('error',error);}
 function signedOut(s='כדי להיכנס ללוח, התחברו באמצעות חשבון המשרד.'){activeId=null;overview=null;closeDrawer(false);dashboard.hidden=true;login.hidden=false;logout.hidden=true;message(s);}
 const statusName={complete:'הושלם',partial:'הושלם חלקית',not_started:'לא התחיל',submitted:'ממתין לבדיקה'};
 const date=value=>value?new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'}).format(new Date(value)):'—';
 function cell(tr,value,cl=''){const td=document.createElement('td');td.textContent=String(value??'—');if(cl)td.className=cl;tr.append(td);}
 function render(d){
  overview=d;closeDrawer(false);
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
  for(const r of filtered){const client=clients.get(r.client_id),tr=document.createElement('tr'),td=document.createElement('td'),open=document.createElement('button');open.type='button';open.className='client-open';open.textContent=client?.business_name||r.client_id;open.addEventListener('click',()=>openClient(r.request_id,open.textContent,open));td.append(open);tr.append(td);cell(tr,staff.get(client?.bookkeeper_id)||'—');cell(tr,statusName[r.status]||'—','status '+r.status);cell(tr,r.last_activity||'—');tbody.append(tr);}
  if(!filtered.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='לא נמצאו לקוחות התואמים לסינון.';tr.append(td);tbody.append(tr);}
 }
 async function officeCall(action,payload={}){
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token)throw Object.assign(new Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});
  return call(action,session.access_token,payload);
 }
 async function openClient(requestId, name, trigger) {
  const ticket=++sequence;
  currentRequest=requestId;returnFocus=trigger||returnFocus;
  viewer.reset();
  const container=el('detail-items');
  container.replaceChildren();
  el('detail-title').textContent=name||'תיק לקוח';
  el('detail-meta').textContent='';
  el('detail-message').textContent='טוענים תיק לקוח…';
  panel.hidden=false;
  document.body.classList.add('drawer-open');
  syncDrawerMode();
  el('detail-title').focus();
  try {
   const d=await officeCall('clientDetail',{requestId});
   if(ticket!==sequence||currentRequest!==requestId)return;
   el('detail-title').textContent=d.client.business_name||'תיק לקוח';
   el('detail-meta').textContent='מזהה '+d.client.client_id+' | '+d.request.cycle_id+' | '+
    (d.client.frequency==='bimonthly'?'דיווח דו־חודשי':'דיווח חודשי')+' | '+(statusName[d.request.status]||'');
   el('detail-message').textContent=d.request.client_note?'הערת לקוח: '+d.request.client_note:'';
   const types=new Map((d.docTypes||[]).map(t=>[t.doc_type_id,t]));
   const available=[];
   for(const item of d.items||[]) {
    const part=document.createElement('article');part.className='document-item';
    const h=document.createElement('h3');h.textContent=types.get(item.doc_type_id)?.name_he||item.doc_type_id;part.append(h);
    const state=document.createElement('p');
    state.className=item.status==='received'?'received':item.status==='rejected'?'rejected':'missing';
    state.textContent=({received:'התקבל',missing:'חסר',rejected:'לא קריא',not_applicable:'לא היה החודש'})[item.status]||item.status;
    part.append(state);
    if(item.reject_reason||item.na_note) {
     const note=document.createElement('p');note.textContent=item.reject_reason||item.na_note;part.append(note);
    }
    const files=(d.uploads||[]).filter(u=>u.item_id===item.item_id);
    for(const file of files) {
     const line=document.createElement('div');line.className='document-file';
     const fileName=file.stored_name||file.original_name||'קובץ';
     const label=document.createElement('span');label.textContent=fileName;line.append(label);
     if(file.ingest_status==='ready') {
      const b=document.createElement('button');b.type='button';b.className='quiet';
      b.textContent='צפייה';b.setAttribute('aria-pressed','false');
      const index=available.push({requestId,uploadId:file.upload_id,name:fileName,mime_type:file.mime_type,button:b})-1;
      b.addEventListener('click',()=>void viewer.select(index,b));
      line.append(b);
     } else {
      const pending=document.createElement('span');pending.textContent='העלאה לא הושלמה';line.append(pending);
     }
     part.append(line);
    }
    container.append(part);
   }
   if(!container.children.length) {
    const empty=document.createElement('p');empty.textContent='לא נמצאו מסמכים בתיק זה.';container.append(empty);
   }
   viewer.setFiles(available);
  } catch(e) {
   if(ticket!==sequence)return;
   el('detail-message').textContent=e.code==='UNAUTHORIZED'?'ההתחברות פגה. התחברו מחדש.':
    e.code==='FORBIDDEN'?'אין הרשאה לפתוח תיק זה.':'לא ניתן לפתוח את תיק הלקוח. נסו שוב.';
   const retry=document.createElement('button');retry.type='button';retry.className='quiet';
   retry.textContent='ניסיון חוזר';retry.addEventListener('click',()=>void openClient(requestId,name,trigger));
   container.replaceChildren(retry);
  }
 }
 async function call(action,token,payload={}){
  const res=await fetch(c.officeApi,{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:c.publishableKey},body:JSON.stringify({action,...payload})});
  if(res.ok&&action==='openFile'&&!res.headers.get('Content-Type')?.includes('application/json'))return {ok:true,driveBlob:await res.blob()};
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
 cycle.addEventListener('change',()=>{closeDrawer(false);refresh(cycle.value);});
 for(const id of ['client-search','filter-staff','filter-status','filter-frequency'])el(id).addEventListener(id==='client-search'?'input':'change',renderRows);
 el('close-detail').addEventListener('click',()=>closeDrawer());
 scrim.addEventListener('click',()=>closeDrawer());
 window.addEventListener('resize',syncDrawerMode);
 document.addEventListener('keydown',e=>{
  if(panel.hidden||viewer.isModalOpen())return;
  if(e.key==='Escape'){e.preventDefault();closeDrawer();return;}
  if(e.key==='Tab'&&isNarrow()) {
   const nodes=[...panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')];
   if(!nodes.length)return;
   const first=nodes[0],last=nodes[nodes.length-1];
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
   else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  }
 });
 auth.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')signedOut('התנתקת מהמערכת.');});
 auth.auth.getSession().then(({data:{session},error})=>{if(error||!session?.user)signedOut();else refresh();}).catch(()=>signedOut('לא הצלחנו לבדוק התחברות. רעננו את הדף.'));
})();
