import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

global.window = {};
const {kindFor, safeName} = await import('../../docs/office/document-preview.js').then(() => global.window.NelioDocumentPreview);
const previewSource = fs.readFileSync(new URL('../../docs/office/document-preview.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../../docs/office/index.html', import.meta.url), 'utf8');
await import('../../docs/office/request-summary.js');
const {itemLabel, requiredSummary} = global.window.NelioRequestSummary;

test('supported file types are explicit and unsupported formats are not embedded', () => {
 assert.equal(kindFor({mime_type:'application/pdf',name:'x'}),'pdf');
 assert.equal(kindFor({mime_type:'image/jpeg'}),'image');
 assert.equal(kindFor({mime_type:'image/png'}),'image');
 assert.equal(kindFor({mime_type:'image/webp'}),'image');
 assert.equal(kindFor({mime_type:'application/octet-stream',name:'דף בנק.pdf'}),'pdf');
 assert.equal(kindFor({mime_type:'image/heic',name:'scan.heic'}),null);
 assert.equal(kindFor({mime_type:'text/html',name:'danger.html'}),null);
 assert.equal(kindFor({mime_type:'application/zip',name:'archive.zip'}),null);
 assert.equal(safeName('test/secret:invoice.pdf'),'test-secret-invoice.pdf');
});

test('HTML keeps strict CSP with blob preview only, and no public bucket/Drive URLs', () => {
 assert.match(htmlSource,/frame-src blob:/);
 assert.match(htmlSource,/img-src 'self' blob:/);
 assert.match(htmlSource,/default-src 'none'/);
 assert.match(htmlSource,/id="client-detail"/);
 assert.match(htmlSource,/id="preview-modal"/);
 assert.match(htmlSource,/document-preview\.js/);
 assert.doesNotMatch(previewSource,/localStorage|service_role|serviceKey|private_key/);
});

class FakeElement {
 constructor(tag='div') {
  this.tagName=tag.toUpperCase();this.hidden=true;this.inert=false;this.disabled=false;
  this.children=[];this.listeners={};this.attributes={};this.isConnected=true;
  this.textContent='';this.src='';this.href='';
 }
 addEventListener(event,handler){this.listeners[event]=handler;}
 replaceChildren(...nodes){this.children=nodes;}
 append(...nodes){this.children.push(...nodes);}
 setAttribute(k,v){this.attributes[k]=v;}
 focus(){global.document.activeElement=this;}
 scrollIntoView(){this.scrolled=(this.scrolled||0)+1;}
 click(){this.listeners.click?.({target:this});}
 remove(){this.isConnected=false;}
 querySelectorAll(){return [];}
}
const ids=['inline-preview','preview-modal','inline-preview-content','preview-modal-content',
 'preview-title','inline-preview-title','inline-prev','inline-next','modal-prev','modal-next',
 'inline-count','modal-count','preview-expand','preview-close','preview-download',
 'inline-download','inline-close','client-detail'];
function setupDocument() {
 const elements=new Map(ids.map(id=>[id,new FakeElement()]));
 elements.get('preview-modal').hidden=true;elements.get('inline-preview').hidden=true;
 const main=new FakeElement(),header=new FakeElement(),footer=new FakeElement();
 const other=new Map([['main',main],['header.top',header],['footer',footer]]);
 global.document={
  activeElement:new FakeElement('button'),body:new FakeElement('body'),
  getElementById:id=>elements.get(id),
  querySelector:key=>other.get(key),
  createElement:tag=>new FakeElement(tag),
  addEventListener:()=>{}
 };
 return {el:id=>elements.get(id),main,header,footer};
}

test('documents are fetched only on selection, with cleanup when changing files or closing', async () => {
 const {el, main}=setupDocument();
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 const made=[],revoked=[],calls=[];
 URL.createObjectURL=b=>{made.push(b);return 'blob:preview-'+made.length;};
 URL.revokeObjectURL=u=>revoked.push(u);
 try {
  let currentRequest='R_A';
  const viewer=global.window.NelioDocumentPreview.create({
   officeCall:async(action,args)=>{
    calls.push({action,args});
    return {driveBlob:new Blob(['example'],{type:args.uploadId==='U2'?'application/pdf':'image/png'})};
   },
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  viewer.setFiles([{requestId:'R_A',uploadId:'U1',name:'a.png',mime_type:'image/png',button:new FakeElement('button')},
   {requestId:'R_A',uploadId:'U2',name:'b.pdf',mime_type:'application/pdf',button:new FakeElement('button')}]);
  assert.equal(calls.length,0,'no eager thumbnails or previews');
  await viewer.select(0);
  assert.equal(calls.length,1);
  assert.equal(made.length,1);
  assert.equal(el('inline-preview-content').children[0].tagName,'IMG');
  el('preview-expand').click();
  assert.equal(viewer.isModalOpen(),true);
  assert.equal(main.inert,true,'background disabled while enlarged');
  el('preview-close').click();
  assert.equal(main.inert,false,'background restored after closing enlarged view');
  assert.equal(el('inline-preview').hidden,false,'leaving the enlarged view returns to the side pane');
  assert.equal(global.document.activeElement,el('preview-expand'));
  await viewer.select(1);
  assert.equal(el('inline-preview-content').children[0].tagName,'IFRAME');
  assert.deepEqual(revoked,['blob:preview-1']);
  viewer.reset();
  assert.deepEqual(revoked,['blob:preview-1','blob:preview-2']);
  assert.equal(el('inline-preview').hidden,true);
  assert.equal(calls.filter(x=>x.action==='openFile').length,2);
 } finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
});

test('signed Supabase URL is fetched privately, rejects a foreign host, and stale requests cannot render', async () => {
 const {el}=setupDocument();
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL,oldFetch=global.fetch;
 const made=[],remote=[];
 URL.createObjectURL=b=>{made.push(b);return 'blob:secure-'+made.length;};
 URL.revokeObjectURL=()=>{};
 try {
  let currentRequest='R_A';
  global.fetch=async(url,init)=>{
   remote.push({url,init});
   return new Response(new Blob(['pdf'],{type:'application/pdf'}),{status:200});
  };
  const viewer=global.window.NelioDocumentPreview.create({
   officeCall:async()=>({ok:true,url:'https://sample.supabase.co/storage/v1/object/sign/nelio-documents/R_A/file.pdf?token=short'}),
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  viewer.setFiles([{requestId:'R_A',uploadId:'U3',name:'report.pdf',mime_type:'application/pdf'}]);
  await viewer.select(0);
  assert.equal(remote.length,1);
  assert.equal(remote[0].init.credentials,'omit');
  assert.equal(remote[0].init.cache,'no-store');
  assert.equal(made.length,1);
  viewer.reset();

  // An expired signed link can be reissued once by the already-authorized server action.
  let signing=0, downloads=0;
  global.fetch=async()=>{
   downloads++;
   return downloads===1 ? new Response('',{status:403}) :
    new Response(new Blob(['pdf'],{type:'application/pdf'}),{status:200});
  };
  const renewed=global.window.NelioDocumentPreview.create({
   officeCall:async()=>({ok:true,url:'https://sample.supabase.co/storage/v1/object/sign/nelio-documents/R_A/file.pdf?token='+ (++signing)}),
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  renewed.setFiles([{requestId:'R_A',uploadId:'U3',name:'report.pdf',mime_type:'application/pdf'}]);
  await renewed.select(0);
  assert.equal(signing,2,'one fresh signature after expiration');
  assert.equal(downloads,2);
  renewed.reset();

  const rejected=global.window.NelioDocumentPreview.create({
   officeCall:async()=>({ok:true,url:'https://example.evil/storage/v1/object/sign/nelio-documents/a.pdf'}),
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  rejected.setFiles([{requestId:'R_A',uploadId:'U4',name:'a.pdf',mime_type:'application/pdf'}]);
  await rejected.select(0);
  assert.equal(remote.length,1,'untrusted host not fetched');
  assert.match(el('inline-preview-content').children[0].textContent,/כתובת קובץ לא תקינה/);
  rejected.reset();

  const forbidden=global.window.NelioDocumentPreview.create({
   officeCall:async()=>{throw Object.assign(Error('FORBIDDEN'),{code:'FORBIDDEN'});},
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  forbidden.setFiles([{requestId:'R_A',uploadId:'U4',name:'a.pdf',mime_type:'application/pdf'}]);
  await forbidden.select(0);
  assert.match(el('inline-preview-content').children[0].textContent,/אין הרשאה/);
  forbidden.reset();

  let complete;
  const delayed=global.window.NelioDocumentPreview.create({
   officeCall:()=>new Promise(resolve=>{complete=resolve;}),
   getCurrentRequest:()=>currentRequest,supabaseUrl:'https://sample.supabase.co'
  });
  delayed.setFiles([{requestId:'R_A',uploadId:'U5',name:'a.png',mime_type:'image/png'}]);
  const beforeStale=made.length;
  const pending=delayed.select(0);
  delayed.reset();currentRequest='R_B';
  complete({driveBlob:new Blob(['image'],{type:'image/png'})});
  await pending;
  assert.equal(made.length,beforeStale,'late response ignored after leaving client');
 } finally {
  URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;global.fetch=oldFetch;
 }
});

function makeViewer(options={}) {
 const dom=setupDocument();
 const calls=[],changes=[];
 const buttons=[new FakeElement('button'),new FakeElement('button'),new FakeElement('button')];
 const viewer=global.window.NelioDocumentPreview.create({
  officeCall:async(action,args)=>{calls.push(args.uploadId);return {driveBlob:new Blob(['x'],{type:'image/png'})};},
  getCurrentRequest:()=>'R_A',supabaseUrl:'https://sample.supabase.co',onChange:()=>changes.push(1),...options
 });
 viewer.setFiles(buttons.map((button,i)=>({requestId:'R_A',uploadId:'U'+i,name:'f'+i+'.png',mime_type:'image/png',button})));
 return {...dom,viewer,calls,changes,buttons};
}
async function withObjectUrls(run) {
 const oldCreate=URL.createObjectURL,oldRevoke=URL.revokeObjectURL;
 const made=[],revoked=[];
 URL.createObjectURL=()=>{made.push(1);return 'blob:x-'+made.length;};
 URL.revokeObjectURL=u=>revoked.push(u);
 try { await run({made,revoked}); } finally {URL.createObjectURL=oldCreate;URL.revokeObjectURL=oldRevoke;}
}

test('the preview pane lives outside the client drawer and has its own close button', () => {
 const drawer=htmlSource.slice(htmlSource.indexOf('<aside id="client-detail"'),htmlSource.indexOf('</aside>'));
 assert.doesNotMatch(drawer,/inline-preview/,'preview is not inside the scrolling drawer');
 assert.match(htmlSource,/<section id="inline-preview" class="side-preview"[^>]*hidden>/);
 assert.match(htmlSource,/id="inline-close"[^>]*aria-label="סגירת תצוגת המסמך"/);
 assert.match(htmlSource,/id="preview-expand"/);
});

test('wide screen: side pane can be closed, releases the file, and follows selections made in the drawer', async () => {
 await withObjectUrls(async({revoked})=>{
  const {el,viewer,calls,buttons,main}=makeViewer({isNarrow:()=>false});
  await viewer.select(2,buttons[2]);
  assert.equal(viewer.isPaneOpen(),true);
  assert.equal(viewer.isModalOpen(),false,'no modal on a wide screen');
  assert.equal(main.inert,false,'the viewer itself never blocks the drawer');
  assert.equal(buttons[2].attributes['aria-pressed'],'true');
  await viewer.select(0,buttons[0]);
  assert.equal(viewer.isPaneOpen(),true,'pane stays open and updates');
  assert.equal(el('inline-preview-title').textContent,'f0.png');
  assert.equal(buttons[2].attributes['aria-pressed'],'false');
  el('inline-next').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(el('inline-preview-title').textContent,'f1.png');
  assert.equal(buttons[1].scrolled,1,'the drawer scrolls to the document shown after next/previous');
  el('inline-close').click();
  assert.equal(viewer.isPaneOpen(),false);
  assert.equal(revoked.length,3,'every object URL released');
  assert.equal(buttons[1].attributes['aria-pressed'],'false');
  assert.equal(global.document.activeElement,buttons[1],'focus returns to the document row');
  assert.equal(el('inline-count').textContent,'');
  assert.deepEqual(calls,['U2','U0','U1']);
  await viewer.select(1,buttons[1]);
  assert.equal(viewer.isPaneOpen(),true,'can be reopened after closing');
 });
});

test('narrow screen: the preview opens as a modal and closing it closes the preview', async () => {
 await withObjectUrls(async({revoked})=>{
  let narrow=true;
  const {el,viewer,buttons,main}=makeViewer({isNarrow:()=>narrow});
  main.inert=true; // the narrow drawer is already modal
  const loading=viewer.select(1,buttons[1]);
  assert.equal(viewer.isModalOpen(),true,'visible at once, wherever the drawer is scrolled');
  assert.equal(viewer.isPaneOpen(),false);
  assert.match(el('preview-modal-content').children[0].textContent,/טוענים/);
  await loading;
  assert.equal(el('preview-modal-content').children[0].tagName,'IMG');
  el('modal-next').click();await new Promise(r=>setTimeout(r,0));
  assert.equal(el('preview-title').textContent,'f2.png');
  el('preview-close').click();
  assert.equal(viewer.isModalOpen(),false);
  assert.equal(viewer.isPaneOpen(),false);
  assert.equal(main.inert,true,'drawer modality restored as it was');
  assert.equal(revoked.length,2);
  assert.equal(global.document.activeElement,buttons[2]);

  // Crossing the width boundary with a document open moves it between pane and modal.
  await viewer.select(0,buttons[0]);
  narrow=false;viewer.syncLayout();
  assert.equal(viewer.isModalOpen(),true,'an open modal is not pulled away from the user');
  el('preview-close').click();
  assert.equal(viewer.isPaneOpen(),true);
  narrow=true;viewer.syncLayout();
  assert.equal(viewer.isPaneOpen(),false);
  assert.equal(viewer.isModalOpen(),true);
  viewer.reset();
 });
});

test('optional "other" document is not shown as missing, and the drawer explains the request status', () => {
 const name=id=>({BANK_STATEMENT:'דף בנק',CREDIT_CARD:'פירוט אשראי',OTHER:'מסמך אחר'})[id]||id;
 const other={doc_type_id:'OTHER',required:false,status:'missing'};
 assert.deepEqual(itemLabel(other),{text:'רשות, לא הועלה',tone:'optional'});
 assert.equal(itemLabel({doc_type_id:'OTHER',required:false,status:'received'}).text,'התקבל');
 assert.deepEqual(itemLabel({doc_type_id:'BANK_STATEMENT',required:true,status:'missing'}),{text:'חסר',tone:'missing'});
 const done=[{doc_type_id:'BANK_STATEMENT',required:true,status:'received'},{doc_type_id:'CREDIT_CARD',required:true,status:'not_applicable'},other];
 assert.deepEqual(requiredSummary(done,name,'submitted'),{text:'מסמכי חובה: 2 מתוך 2 נסגרו.',mismatch:false});
 assert.equal(requiredSummary(done,name,'complete').mismatch,false);
 assert.equal(requiredSummary(done,name,'partial').mismatch,true,'a stored status that contradicts the items is flagged, not hidden');
 const open=[{doc_type_id:'BANK_STATEMENT',required:true,status:'rejected'},{doc_type_id:'CREDIT_CARD',required:true,status:'missing'},other];
 assert.deepEqual(requiredSummary(open,name,'partial'),{text:'מסמכי חובה: 0 מתוך 2 נסגרו. עדיין פתוח: דף בנק (לא קריא), פירוט אשראי.',mismatch:false});
 // Even a wrongly flagged required=true on OTHER must not count.
 assert.equal(requiredSummary([{doc_type_id:'OTHER',required:true,status:'missing'}],name,'partial').text,'');
});

// ---- Stage 6.3.1: office actions ----
await import('../../docs/office/office-actions.js');
const officeActions=global.window.NelioOfficeActions;
const actionsSource=fs.readFileSync(new URL('../../docs/office/office-actions.js', import.meta.url), 'utf8');
test('period labels and template filling match the server rules', () => {
 assert.equal(officeActions.periodLabel('2026-10'),'אוקטובר 2026');
 assert.equal(officeActions.periodLabel('2026-09_10'),'ספטמבר–אוקטובר 2026');
 assert.equal(officeActions.fillTemplate('שלום [שם], [שם] ו[סיבה]',{'[שם]':'אורנה','[סיבה]':'מטושטש'}),'שלום אורנה, אורנה ומטושטש');
 assert.equal(officeActions.composeReason('התמונה מטושטשת','  לא רואים\nסכומים '),'התמונה מטושטשת. לא רואים סכומים');
 assert.equal(officeActions.composeReason('','רק פירוט'),'רק פירוט');
 assert.equal(officeActions.composeReason('','  '),'');
});
test('WhatsApp link has no phone number and encodes the whole text', () => {
 const url=officeActions.whatsappUrl('עוד חסר: דף בנק & אשראי https://x.test/#t=abc');
 assert.ok(url.startsWith('https://wa.me/?text='));
 assert.equal(decodeURIComponent(url.split('text=')[1]),'עוד חסר: דף בנק & אשראי https://x.test/#t=abc');
});
test('buttons follow the request state and only received, active files can be rejected', () => {
 assert.deepEqual(officeActions.available('submitted'),{approve:true,manual:true,whatsapp:false});
 assert.deepEqual(officeActions.available('partial'),{approve:false,manual:true,whatsapp:true});
 assert.deepEqual(officeActions.available('complete'),{approve:false,manual:false,whatsapp:false});
 const item={status:'received'};
 assert.equal(officeActions.canReject({ingest_status:'ready',status:'active'},item),true);
 assert.equal(officeActions.canReject({ingest_status:'pending',status:'active'},item),false);
 assert.equal(officeActions.canReject({ingest_status:'ready',status:'rejected'},item),false);
 assert.equal(officeActions.canReject({ingest_status:'ready',status:'active'},{status:'missing'}),false);
});
test('errors are Hebrew sentences and the page keeps no documents or secrets', () => {
 for(const code of ['NOT_ALLOWED','LINK_KEY_MISSING','TEMPLATE_MISSING','SOMETHING_NEW'])assert.match(officeActions.errorText(code),/[א-ת]/);
 assert.doesNotMatch(actionsSource,/localStorage|service_role|serviceKey|NELIO_LINK_KEY|token_enc/);
 assert.match(htmlSource,/id="action-dialog"/);assert.match(htmlSource,/id="actor"/);assert.match(htmlSource,/office-actions\.js/);
});
test('reminder time uses the Israeli 24-hour format in Asia/Jerusalem', () => {
 assert.equal(officeActions.dateTime('2026-11-09T07:00:00Z'),'09/11/2026 09:00');
 assert.equal(officeActions.dateTime('2026-08-01T21:30:00Z'),'02/08/2026 00:30');
});

// ---- Stage 6.3.2 ----
await import('../../docs/office/call-list.js');
const callList=global.window.NelioCallList;
test('upload checks match the server: types, HEIC by name, 10 MiB', () => {
 assert.equal(officeActions.uploadType({type:'application/pdf',name:'a.pdf'}),'application/pdf');
 assert.equal(officeActions.uploadType({type:'',name:'IMG_1.HEIC'}),'image/heic');
 assert.equal(officeActions.uploadType({type:'text/html',name:'x.html'}),'');
 assert.equal(officeActions.uploadProblem({type:'image/jpeg',name:'a.jpg',size:10*1048576}),'');
 assert.match(officeActions.uploadProblem({type:'image/jpeg',name:'a.jpg',size:10*1048576+1}),/10/);
 assert.match(officeActions.uploadProblem({type:'application/zip',name:'a.zip',size:5}),/לא נתמך/);
 assert.match(officeActions.uploadProblem(null),/בחרו/);
});
test('file hash is SHA-256 in hex, as the server expects', async () => {
 assert.equal(await officeActions.sha256Hex(new TextEncoder().encode('abc')),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
test('call list shows one bookkeeper, uncalled clients first, Israeli formats', () => {
 const rows=[{businessName:'ב',bookkeeperId:'S2',calledAt:'2026-11-12T08:05:00Z'},{businessName:'א',bookkeeperId:'S3'},{businessName:'ג',bookkeeperId:'S2'}];
 assert.deepEqual(callList.visibleRows(rows,'S2').map(r=>r.businessName),['ג','ב']);
 assert.equal(callList.visibleRows(rows,'').length,3);
 assert.equal(callList.timeOf('2026-11-12T08:05:00Z'),'10:05');
 assert.equal(callList.dateOf('2026-11-12'),'12/11/2026');
 assert.match(htmlSource,/role="tablist"/);assert.match(htmlSource,/id="call-rows"/);assert.match(htmlSource,/call-list\.js/);
});

// ---- Stage 6.3.3 ----
await import('../../docs/office/log-settings.js');
const logSettings=global.window.NelioLogSettings;
test('log entries read as Hebrew sentences for old and new event names', () => {
 const names=id=>({S2:'מירב סלעי'})[id]||'';
 assert.equal(logSettings.who('staff:S2',names),'מירב סלעי');
 assert.equal(logSettings.who('office:S2',names),'מירב סלעי');
 assert.equal(logSettings.who('client:C07',names),'הלקוח');
 assert.equal(logSettings.who('system',names),'מערכת');
 assert.equal(logSettings.describe({event:'reject',details:'דף בנק: מטושטש'}),'סימן "לא קריא": דף בנק: מטושטש');
 assert.equal(logSettings.describe({event:'office_approve'}),'אישר: בדקתי, תקין');
 assert.equal(logSettings.describe({kind:'message',details:'אישור',status:'simulated'}),'הודעה "אישור" נרשמה (הדגמה, לא נשלחה)');
 assert.match(logSettings.describe({event:'office_settings',details:'due_day: 12 → 14'}),/תאריך היעד \(יום בחודש\): 12 → 14/);
 assert.equal(logSettings.describe({event:'cycle_open',details:'נפתח מחזור'}),'נפתח מחזור');
 assert.equal(logSettings.describe({event:'something_new'}),'something_new');
});
test('log filters by type and by client', () => {
 const rows=[{actor:'client:C07',businessName:'מאפיית השקד',clientId:'C07'},{actor:'office:S2',businessName:'קפה הגפן',clientId:'C10'},{kind:'message',businessName:'מאפיית השקד'},{actor:'system'}];
 assert.equal(logSettings.filterRows(rows,{type:'office'}).length,1);
 assert.equal(logSettings.filterRows(rows,{type:'message'}).length,1);
 assert.equal(logSettings.filterRows(rows,{type:'system'}).length,1);
 assert.equal(logSettings.filterRows(rows,{query:'שקד'}).length,2);
 assert.equal(logSettings.filterRows(rows,{query:'c10'}).length,1);
});
test('settings errors name the field in Hebrew', () => {
 assert.match(logSettings.errorText({code:'BAD_VALUE',key:'due_day'}),/תאריך היעד/);
 assert.match(logSettings.errorText({code:'LINK_REQUIRED'}),/\[קישור\]/);
 assert.match(logSettings.errorText({code:'???'}),/לא הצליחה/);
 assert.match(htmlSource,/id="panel-log"/);assert.match(htmlSource,/id="panel-settings"/);assert.match(htmlSource,/log-settings\.js/);
});

// ---- Stage 6.3.4: ZIP ----
await import('../../docs/office/zip-export.js');
const Z=global.window.NelioZip;
const {execFileSync}=await import('node:child_process');
const os=await import('node:os');const path=await import('node:path');
test('CRC-32 matches the standard value', () => {
 assert.equal(Z.crc32(new TextEncoder().encode('123456789')),0xCBF43926);
});
test('folder names follow D31 and two files never share a path', () => {
 const f={businessName:'ג\'ו שיפוצים "בע״מ"/צפון',clientId:'C12',period:'2026-09_10',storedName:'ג-ו_2026-09_10_דף-בנק_01.pdf'};
 assert.equal(Z.zipPath(f),'שדמי – מסמכי לקוחות/ג\'ו שיפוצים ״בע״מ״-צפון (C12)/2026-09_10/ג-ו_2026-09_10_דף-בנק_01.pdf');
 assert.equal(Z.zipPath({...f,rejected:true}).split('/').slice(-2)[0],'נדחו');
 assert.deepEqual(Z.uniquePaths([f,f,f]).map(p=>p.split('/').pop()),['ג-ו_2026-09_10_דף-בנק_01.pdf','ג-ו_2026-09_10_דף-בנק_01-2.pdf','ג-ו_2026-09_10_דף-בנק_01-3.pdf']);
 assert.equal(Z.safeSegment(' .שם\u202e:*? '),'שם---');
 assert.equal(Z.archiveName('מאפיית השקד_2026-10'),'שדמי-מסמכי-לקוחות_מאפיית-השקד_2026-10.zip');
});
test('export builds a valid ZIP with Hebrew names, keeps order, and lists a failed file', async () => {
 const files=[
  {requestId:'R',uploadId:'U1',clientId:'C07',businessName:'מאפיית השקד',period:'2026-10',storedName:'מאפיית-השקד_2026-10_דף-בנק_01.jpg'},
  {requestId:'R',uploadId:'U2',clientId:'C07',businessName:'מאפיית השקד',period:'2026-10',storedName:'מאפיית-השקד_2026-10_דף-בנק_02.pdf',rejected:true},
  {requestId:'R',uploadId:'U3',clientId:'C07',businessName:'מאפיית השקד',period:'2026-10',storedName:'missing.pdf'},
 ];
 const calls=[];
 const officeCall=async(action,p)=>{calls.push(p.uploadId);
  if(p.uploadId==='U1')return {ok:true,driveBlob:new Blob([new TextEncoder().encode('drive bytes')])};
  if(p.uploadId==='U2')return {ok:true,url:'https://proj.supabase.co/storage/v1/object/sign/nelio-documents/x?token=1'};
  throw Object.assign(Error('NOT_FOUND'),{code:'NOT_FOUND'});};
 const fetchImpl=async url=>{assert.ok(url.startsWith('https://proj.supabase.co/storage/v1/object/sign/'));return new Response('%PDF-1.4 bytes');};
 const sink=Z.memorySink();
 const r=await Z.exportFiles({files,officeCall,supabaseUrl:'https://proj.supabase.co',sink,fetchImpl,now:new Date(2026,10,12,10,5)});
 assert.equal(r.added,2);assert.equal(r.failed.length,1);
 assert.equal(calls.filter(x=>x==='U3').length,2,'a failed file is retried once');
 const file=path.join(os.tmpdir(),'nelio-zip-test-'+process.pid+'.zip');
 fs.writeFileSync(file,Buffer.from(await sink.blob().arrayBuffer()));
 const out=execFileSync('python3',['-c','import sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nfor i in z.infolist(): print(i.filename+"|"+str(i.file_size)+"|"+z.read(i).decode("utf-8","replace")[:12])',file],{encoding:'utf8'});
 fs.unlinkSync(file);
 const lines=out.trim().split('\n');
 assert.equal(lines[0],'שדמי – מסמכי לקוחות/מאפיית השקד (C07)/2026-10/מאפיית-השקד_2026-10_דף-בנק_01.jpg|11|drive bytes');
 assert.equal(lines[1],'שדמי – מסמכי לקוחות/מאפיית השקד (C07)/2026-10/נדחו/מאפיית-השקד_2026-10_דף-בנק_02.pdf|14|%PDF-1.4 byt');
 assert.match(lines[2],/^שדמי – מסמכי לקוחות\/קבצים-שלא-הורדו\.txt\|/);
});
test('a signed URL for another host or path is refused', () => {
 assert.throws(()=>Z.validatedUrl('https://evil.test/storage/v1/object/sign/nelio-documents/x','https://proj.supabase.co'));
 assert.throws(()=>Z.validatedUrl('https://proj.supabase.co/storage/v1/object/public/nelio-documents/x','https://proj.supabase.co'));
 assert.ok(Z.validatedUrl('https://proj.supabase.co/storage/v1/object/sign/nelio-documents/x?token=1','https://proj.supabase.co'));
});
