import {ApiError,preparePayload,decodeFile,cleanText,readJson,MAX_BODY_BYTES} from '../functions/nelio-api/core.ts';
function assert(value:unknown){if(!value)throw new Error('Assertion failed');}
function rejects(fn:()=>unknown,code:string){try{fn();throw new Error('Expected rejection');}catch(e){assert(e instanceof ApiError&&e.code===code);}}
const token='A'.repeat(32);
Deno.test('Public payload rejects internal actions and strips injected IDs',()=>{
 for(const action of ['reserveUpload','finishUpload','admin']) rejects(()=>preparePayload({action,token}),'BAD_REQUEST');
 const p=preparePayload({action:'hello',token,storagePath:'other-client',uploadId:'stolen'});assert(!('storagePath' in p)&&!('uploadId' in p));
});
Deno.test('Tokens and notes are validated without accepting object coercion',()=>{
 rejects(()=>preparePayload({action:'hello',token:{}}),'BAD_TOKEN');rejects(()=>preparePayload([]),'BAD_REQUEST');
 assert(cleanText('  hello\n world\u202e ',500)==='hello world');assert(cleanText('אב'.repeat(300),500).length===500);
});
const pdf={fileName:'example.pdf',mimeType:'application/pdf',data:btoa('%PDF-1.4\nexample'),uploadKey:'test-upload-001'};
Deno.test('Files require a supported type, valid base64, magic bytes and retry key',()=>{
 assert(decodeFile(pdf).bytes.length>0);
 rejects(()=>decodeFile({...pdf,data:btoa('<html>not a pdf')}),'BAD_FILE');
 rejects(()=>decodeFile({...pdf,data:'%%%%'}),'BAD_FILE');
 rejects(()=>decodeFile({...pdf,mimeType:'text/html'}),'BAD_TYPE');
 rejects(()=>decodeFile({...pdf,uploadKey:''}),'BAD_REQUEST');
 rejects(()=>decodeFile({...pdf,data:'A'.repeat(13981020)}),'TOO_BIG');
 assert(decodeFile({...pdf,mimeType:'application/octet-stream'}).mime==='application/pdf');
});
Deno.test('JSON streaming enforces body limits even without Content-Length',async()=>{
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BODY_BYTES+1));c.close();}});
 try{await readJson(new Request('https://example.test',{method:'POST',body:stream}));throw Error('Expected rejection');}catch(e){assert(e instanceof ApiError&&e.code==='TOO_BIG');}
 try{await readJson(new Request('https://example.test',{method:'POST',body:'{'}));throw Error('Expected rejection');}catch(e){assert(e instanceof ApiError&&e.code==='BAD_REQUEST');}
});

Deno.test('A valid maximum-sized upload does not overflow the base64 validator',()=>{
 const bytes=new Uint8Array(10*1024*1024);bytes.set([137,80,78,71,13,10,26,10]);
 let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.slice(start,start+32768));
 const data=btoa(binary);
 assert(decodeFile({fileName:'demo.png',mimeType:'image/png',data,uploadKey:'test-upload-large'}).bytes.length===bytes.length);
});
