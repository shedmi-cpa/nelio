import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

global.window = {};
const {kindFor, safeName} = await import('../../docs/office/document-preview.js').then(() => global.window.NelioDocumentPreview);
const previewSource = fs.readFileSync(new URL('../../docs/office/document-preview.js', import.meta.url), 'utf8');
const htmlSource = fs.readFileSync(new URL('../../docs/office/index.html', import.meta.url), 'utf8');

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
 click(){this.listeners.click?.({target:this});}
 remove(){this.isConnected=false;}
 querySelectorAll(){return [];}
}
const ids=['inline-preview','preview-modal','inline-preview-content','preview-modal-content',
 'preview-title','inline-preview-title','inline-prev','inline-next','modal-prev','modal-next',
 'inline-count','modal-count','preview-expand','preview-close','preview-download',
 'inline-download','client-detail'];
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
