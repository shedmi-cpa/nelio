/* Stage 6.1. Authorization is enforced by the server, never this UI. */
(() => {
 'use strict';
 const c=window.NELIO_OFFICE_CONFIG,lib=window.supabase;
 const el=id=>document.getElementById(id),msg=el('message'),login=el('login'),dashboard=el('dashboard'),logout=el('logout'),button=el('login-button'),cycle=el('cycle-select'),tbody=el('rows');
 if(!c||!lib?.createClient){msg.textContent='רכיב ההתחברות לא נטען. בדקו את החיבור לאינטרנט ורעננו.';msg.classList.add('error');return;}
 const auth=lib.createClient(c.supabaseUrl,c.publishableKey,{auth:{flowType:'pkce',autoRefreshToken:true,detectSessionInUrl:true,persistSession:true}});
 let activeId=null;
 function message(s,error=false){msg.hidden=false;msg.textContent=s;msg.classList.toggle('error',error);}
 function signedOut(s='כדי להיכנס ללוח, התחברו באמצעות חשבון המשרד.'){activeId=null;dashboard.hidden=true;login.hidden=false;logout.hidden=true;message(s);}
 const statusName={complete:'הושלם',partial:'הושלם חלקית',not_started:'לא התחיל',submitted:'ממתין לבדיקה'};
 const date=value=>value?new Intl.DateTimeFormat('he-IL',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'Asia/Jerusalem'}).format(new Date(value)):'—';
 function cell(tr,value,cl=''){const td=document.createElement('td');td.textContent=String(value??'—');if(cl)td.className=cl;tr.append(td);}
 function render(d){
  const cycles=Array.isArray(d.cycles)?d.cycles:[],requests=Array.isArray(d.requests)?d.requests:[],clients=new Map((d.clients||[]).map(x=>[x.client_id,x])),staff=new Map((d.staff||[]).map(x=>[x.staff_id,x.name]));
  cycle.replaceChildren();
  for(const x of cycles){const op=document.createElement('option');op.value=x.cycle_id;op.textContent=x.cycle_id;op.selected=x.cycle_id===d.cycleId;cycle.append(op);}
  const chosen=cycles.find(x=>x.cycle_id===d.cycleId);
  el('cycle-details').textContent='תאריך יעד: '+date(chosen?.due_date)+' | '+(chosen?.status==='open'?'מחזור פתוח':'ארכיון');
  const counts={complete:0,partial:0,not_started:0,submitted:0};
  for(const r of requests){if(Object.hasOwn(counts,r.status))counts[r.status]++;else counts.submitted++;}
  el('count-complete').textContent=counts.complete;el('count-partial').textContent=counts.partial;el('count-not-started').textContent=counts.not_started;el('count-pending').textContent=counts.submitted;
  el('table-count').textContent=requests.length+' לקוחות במחזור';tbody.replaceChildren();
  for(const r of requests){const client=clients.get(r.client_id),tr=document.createElement('tr');cell(tr,client?.business_name||r.client_id);cell(tr,staff.get(client?.bookkeeper_id)||'—');cell(tr,statusName[r.status]||'—','status '+r.status);cell(tr,r.last_activity||'—');tbody.append(tr);}
  if(!requests.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=4;td.textContent='אין בקשות במחזור הזה.';tr.append(td);tbody.append(tr);}
 }
 async function call(action,token,cycleId){
  const res=await fetch(c.officeApi,{method:'POST',mode:'cors',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,apikey:c.publishableKey},body:JSON.stringify(cycleId?{action,cycleId}:{action})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok||!data.ok){const e=new Error(data.code||String(res.status));e.code=data.code||String(res.status);throw e;}return data;
 }
 async function refresh(cycleId){
  const {data:{session}}=await auth.auth.getSession();
  if(!session?.access_token){signedOut();return;}
  activeId=session.user.id;message('טוענים את נתוני המשרד…');
  try{
   const result=await call('overview',session.access_token,cycleId);
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
 cycle.addEventListener('change',()=>refresh(cycle.value));
 auth.auth.onAuthStateChange((event)=>{if(event==='SIGNED_OUT')signedOut('התנתקת מהמערכת.');});
 auth.auth.getSession().then(({data:{session},error})=>{if(error||!session?.user)signedOut();else refresh();}).catch(()=>signedOut('לא הצלחנו לבדוק התחברות. רעננו את הדף.'));
})();
