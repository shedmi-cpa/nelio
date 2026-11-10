/* Stage 6.2: office dashboard. The Edge Function enforces all permissions. */
(() => {
 'use strict';
 const config=window.NELIO_OFFICE_CONFIG,lib=window.supabase;
 const el=id=>document.getElementById(id);
 const msg=el('message'),login=el('login'),dashboard=el('dashboard'),logout=el('logout');
 const loginButton=el('login-button'),cycle=el('cycle-select'),tbody=el('rows'),detailPanel=el('client-detail');
 if(!config||!lib?.createClient){
  msg.textContent='רכיב ההתחברות לא נטען. בדקו את החיבור לאינטרנט ורעננו.';
  msg.classList.add('error');return;
 }
 const auth=lib.createClient(config.supabaseUrl,config.publishableKey,{auth:{flowType:'pkce',autoRefreshToken:true,detectSessionInUrl:true,persistSession:true}});
 const statuses={complete:'הושלם',partial:'השלים חלק',not_started:'לא התחיל',submitted:'ממתין לבדיקה'};
 const itemStatuses={missing:'חסר',received:'התקבל',rejected:'לא קריא',not_applicable:'לא היה החודש'};
 const frequencyName={monthly:'חודשי',bimonthly:'דו־חודשי'};
 let overview=null,activeId=null,requestSeq=0,detailSeq=0;

 function node(tag,cls,text){
  const x=document.createElement(tag);
  if(cls)x.className=cls;
  if(text!==undefined)x.textContent=String(text??'');
  return x;
 }
 function message(value,error=false){msg.hidden=false;msg.textContent=value;msg.classList.toggle('error',error);}
 function closeDetail(){
  detailSeq++;detailPanel.hidden=true;el('detail-docs').replaceChildren();
  el('detail-message').hidden=true;
 }
 function signedOut(value='כדי להיכנס ללוח, התחברו באמצעות חשבון המשרד.'){
  requestSeq++;activeId=null;overview=null;dashboard.hidden=true;
  closeDetail();login.hidden=false;logout.hidden=true;message(value);
 }
 function date(value){
  if(!value)return '—';
  const d=new Date(value);return Number.isNaN(d.getTime())?'—':
   new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'}).format(d);
 }
 function time(value){
  if(!value)return '—';
  const d=new Date(value);return Number.isNaN(d.getTime())?'—':
   new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Jerusalem'}).format(d);
 }
 async function call(payload,token){
  const response=await fetch(config.officeApi,{method:'POST',mode:'cors',cache:'no-store',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:config.publishableKey},
   body:JSON.stringify(payload)});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.ok){
   const error=new Error(data.code||String(response.status));error.code=data.code||String(response.status);throw error;
  }
  return data;
 }
 async function token(){
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token||!session.user||session.user.id!==activeId)throw Object.assign(new Error('UNAUTHORIZED'),{code:'UNAUTHORIZED'});
  return session.access_token;
 }
 function selectOptions(select,options,placeholder,previous){
  select.replaceChildren();
  const all=node('option','',placeholder);all.value='';select.append(all);
  for(const x of options){
   const op=node('option','',x.name);op.value=x.id;select.append(op);
  }
  select.value=options.some(x=>x.id===previous)?previous:'';
 }
 function renderTable(){
  if(!overview)return;
  const {requests,clientMap,staffMap}=overview;
  const search=el('search-clients').value.trim().toLocaleLowerCase('he-IL');
  const byStaff=el('filter-bookkeeper').value,byStatus=el('filter-status').value,byFrequency=el('filter-frequency').value;
  const filtered=requests.filter(r=>{
   const c=clientMap.get(r.client_id);
   return (!search||String(c?.business_name||'').toLocaleLowerCase('he-IL').includes(search)||String(r.client_id).toLowerCase().includes(search))
    &&(!byStaff||c?.bookkeeper_id===byStaff)&&(!byStatus||r.status===byStatus)&&(!byFrequency||c?.frequency===byFrequency);
  }).sort((a,b)=>String(clientMap.get(a.client_id)?.business_name||'').localeCompare(String(clientMap.get(b.client_id)?.business_name||''),'he'));
  el('table-count').textContent=filtered.length+' מתוך '+requests.length+' לקוחות';
  tbody.replaceChildren();
  for(const r of filtered){
   const c=clientMap.get(r.client_id),tr=node('tr');
   const name=node('td','name-cell',c?.business_name||r.client_id);
   tr.append(name);
   tr.append(node('td','',staffMap.get(c?.bookkeeper_id)||'—'));
   tr.append(node('td','',frequencyName[c?.frequency]||'—'));
   tr.append(node('td','status '+(Object.hasOwn(statuses,r.status)?r.status:''),statuses[r.status]||'—'));
   tr.append(node('td','',r.last_activity||'—'));
   tr.append(node('td','number',r.reminder_count??0));
   const action=node('td');
   const open=node('button','text-button','פתח תיק');
   open.type='button';open.addEventListener('click',()=>openDetail(r.request_id));
   action.append(open);tr.append(action);tbody.append(tr);
  }
  if(!filtered.length){
   const tr=node('tr'),td=node('td','empty','אין לקוחות התואמים לסינון.');
   td.colSpan=7;tr.append(td);tbody.append(tr);
  }
 }
 function renderOverview(data){
  const cycles=Array.isArray(data.cycles)?data.cycles:[];
  const requests=Array.isArray(data.requests)?data.requests:[];
  const clients=Array.isArray(data.clients)?data.clients:[];
  const staff=Array.isArray(data.staff)?data.staff:[];
  const clientMap=new Map(clients.map(x=>[x.client_id,x])),staffMap=new Map(staff.map(x=>[x.staff_id,x.name]));
  overview={requests,clientMap,staffMap,cycleId:data.cycleId};
  cycle.replaceChildren();
  for(const x of cycles){const option=node('option','',x.cycle_id);option.value=x.cycle_id;option.selected=x.cycle_id===data.cycleId;cycle.append(option);}
  const chosen=cycles.find(x=>x.cycle_id===data.cycleId);
  el('cycle-details').textContent='תאריך יעד: '+date(chosen?.due_date)+' | '+(chosen?.status==='open'?'מחזור פתוח':'ארכיון');
  const counts={complete:0,partial:0,not_started:0,submitted:0};
  for(const r of requests){if(Object.hasOwn(counts,r.status))counts[r.status]++;}
  el('count-complete').textContent=counts.complete;el('count-partial').textContent=counts.partial;
  el('count-not-started').textContent=counts.not_started;el('count-pending').textContent=counts.submitted;
  const previous=el('filter-bookkeeper').value;
  selectOptions(el('filter-bookkeeper'),staff.map(x=>({id:x.staff_id,name:x.name})),'כל מנהלי החשבונות',previous);
  renderTable();
 }
 function detailMessage(text,isError=false){
  const box=el('detail-message');box.hidden=false;box.textContent=text;box.classList.toggle('error',isError);
 }
 function renderDetail(data){
  const r=data.request,c=data.client,items=Array.isArray(data.items)?data.items:[],uploads=Array.isArray(data.uploads)?data.uploads:[],types=new Map((data.docTypes||[]).map(x=>[x.doc_type_id,x]));
  el('detail-title').textContent=c.business_name||c.client_id;
  el('detail-meta').textContent='לקוח '+c.client_id+' | '+(frequencyName[c.frequency]||'—')+' | מחזור '+r.cycle_id+' | '+(statuses[r.status]||r.status);
  el('detail-note').textContent=r.client_note?'הערת הלקוח: '+r.client_note:'לא נרשמה הערה מהלקוח.';
  el('detail-activity').textContent='פעולה אחרונה: '+(r.last_activity||'—')+' ('+time(r.last_activity_at)+')';
  const container=el('detail-docs');container.replaceChildren();
  items.sort((a,b)=>(Number(types.get(a.doc_type_id)?.sort_order)||0)-(Number(types.get(b.doc_type_id)?.sort_order)||0));
  for(const item of items){
   const type=types.get(item.doc_type_id);
   const group=node('article','doc-item'),heading=node('div','doc-heading');
   heading.append(node('h4','',type?.name_he||item.doc_type_id));
   heading.append(node('span','doc-status '+(Object.hasOwn(itemStatuses,item.status)?item.status:''),itemStatuses[item.status]||'—'));
   group.append(heading);
   if(type?.description_he)group.append(node('p','minor',type.description_he));
   const hints=[];
   if(item.reject_reason)hints.push('סיבת דחייה: '+item.reject_reason);
   if(item.na_note)hints.push('הערת "לא היה": '+item.na_note);
   if(hints.length)group.append(node('p','doc-note',hints.join(' | ')));
   const files=uploads.filter(x=>x.item_id===item.item_id);
   if(!files.length)group.append(node('p','minor','אין קבצים בפריט זה.'));
   for(const file of files){
    const fileRow=node('div','file-row');
    const details=node('div','file-info');
    details.append(node('strong','',file.stored_name||file.original_name||'מסמך'));
    const size=Number(file.size_bytes),sizeLabel=Number.isFinite(size)?(size/1048576).toFixed(1)+' MB':'—';
    details.append(node('span','minor',time(file.uploaded_at)+' | '+sizeLabel+' | '+(file.storage_provider==='drive'?'ארכיון Drive':'אחסון Supabase')+(file.status==='rejected'?' | נדחה':'')));
    fileRow.append(details);
    const actions=node('div','file-actions');
    if(file.ingest_status==='ready'){
     const btn=node('button','text-button','קישור לצפייה');
     btn.type='button';btn.addEventListener('click',()=>prepareFileLink(file.upload_id,btn,actions));
     actions.append(btn);
    }else actions.append(node('span','minor','ממתין לשמירת הקובץ'));
    fileRow.append(actions);group.append(fileRow);
   }
   container.append(group);
  }
  if(!items.length)container.append(node('p','minor','לא נמצאו פריטים בתיק.'));
  detailPanel.hidden=false;
  detailPanel.scrollIntoView({behavior:'smooth',block:'start'});
 }
 async function prepareFileLink(uploadId,button,actions){
  button.disabled=true;button.textContent='מכינים קישור…';
  const previous=actions.querySelector('a');if(previous)previous.remove();
  try{
   const key=await token(),result=await call({action:'fileLink',uploadId},key);
   const url=new URL(result.url);
   if(!((result.provider==='drive'&&url.origin==='https://drive.google.com')||
     (result.provider==='supabase'&&url.origin===new URL(config.supabaseUrl).origin)))throw Error('BAD_LINK');
   const a=node('a','doc-link',result.provider==='drive'?'פתח ב־Google Drive':'פתח קובץ (דקה)');
   a.href=url.toString();a.target='_blank';a.rel='noopener noreferrer';a.referrerPolicy='no-referrer';
   actions.append(a);button.textContent='חדש קישור';
  }catch(e){button.textContent='נסו שוב';detailMessage(e.code==='UNAUTHORIZED'?'ההתחברות פגה. התחברו מחדש.':'אי אפשר לפתוח את המסמך כרגע. נסו שוב.',true);}
  finally{button.disabled=false;}
 }
 async function openDetail(requestId){
  const seq=++detailSeq,gen=requestSeq;
  detailPanel.hidden=false;el('detail-title').textContent='טוענים תיק לקוח…';
  el('detail-meta').textContent='';el('detail-docs').replaceChildren();el('detail-message').hidden=true;
  try{
   const key=await token(),result=await call({action:'requestDetail',requestId},key);
   if(seq!==detailSeq||gen!==requestSeq)return;
   renderDetail(result);
  }catch(e){
   if(seq!==detailSeq||gen!==requestSeq)return;
   detailMessage(e.code==='NOT_FOUND'?'תיק הלקוח אינו זמין.':'לא ניתן לטעון את תיק הלקוח. נסו שוב.',true);
  }
 }
 async function refresh(cycleId){
  const seq=++requestSeq;closeDetail();
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token||!session.user){signedOut();return;}
  activeId=session.user.id;message('טוענים את נתוני המשרד…');
  try{
   const result=await call(cycleId?{action:'overview',cycleId}:{action:'overview'},session.access_token);
   if(seq!==requestSeq||activeId!==session.user.id)return;
   renderOverview(result);login.hidden=true;dashboard.hidden=false;logout.hidden=false;msg.hidden=true;
  }catch(e){
   if(seq!==requestSeq)return;
   dashboard.hidden=true;
   if(e.code==='FORBIDDEN'){signedOut('החשבון מחובר ל־Google אך אינו מורשה לגשת למשרד.');logout.hidden=false;}
   else if(e.code==='UNAUTHORIZED')signedOut('ההתחברות פגה. התחברו מחדש.');
   else {message('לא ניתן לטעון את לוח המשרד. בדקו את החיבור ונסו שוב.',true);logout.hidden=false;}
  }
 }
 loginButton.addEventListener('click',async()=>{
  loginButton.disabled=true;message('פותחים את Google להתחברות מאובטחת…');
  const {error}=await auth.auth.signInWithOAuth({provider:'google',options:{redirectTo:new URL('./',location.href).toString()}});
  if(error){message('ההתחברות לא נפתחה. בדקו את הגדרות Google ב־Supabase.',true);loginButton.disabled=false;}
 });
 logout.addEventListener('click',async()=>{await auth.auth.signOut();signedOut('התנתקת מהמערכת.');});
 cycle.addEventListener('change',()=>refresh(cycle.value));
 for(const id of ['search-clients','filter-bookkeeper','filter-status','filter-frequency']){
  el(id).addEventListener(id==='search-clients'?'input':'change',renderTable);
 }
 el('detail-close').addEventListener('click',closeDetail);
 auth.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')signedOut('התנתקת מהמערכת.');});
 auth.auth.getSession().then(({data:{session},error})=>{
  if(error||!session?.user)signedOut();else refresh();
 }).catch(()=>signedOut('לא הצלחנו לבדוק התחברות. רעננו את הדף.'));
})();