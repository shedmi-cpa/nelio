/* Stage 6.3.4: ZIP export in the browser (D49). Our own code, no library and no compression:
 * images and PDF files are compressed already. Each file is fetched through openFile, which checks
 * the office account and the request on the server. Nothing is stored in the browser. */
(() => {
 'use strict';
 const ROOT='שדמי – מסמכי לקוחות';
 const MAX_FILES=1000,WARN_BYTES=500*1048576,MAX_BYTES=2000*1048576;
 const enc=new TextEncoder();

 const CRC_TABLE=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
 function crc32(bytes) {
  let c=0xFFFFFFFF;
  for(let i=0;i<bytes.length;i++)c=CRC_TABLE[(c^bytes[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
 }
 // rules.md (D31): no hidden or direction marks, " becomes ״, characters Windows refuses become -, no dot or space at the ends.
 function safeSegment(value,max=80) {
  let s=String(value??'').replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g,'')
   .replace(/"/g,'״').replace(/[\\/:*?<>|]/g,'-').replace(/\s+/g,' ').trim();
  s=s.slice(0,max).replace(/^[.\s]+|[.\s]+$/g,'');
  return s||'ללא-שם';
 }
 // Folder tree from office-ux-feedback.md: root / business (id) / period / [נדחו] / file.
 function zipPath(file) {
  const name=safeSegment(file.storedName||file.originalName||file.uploadId,120);
  return [ROOT,safeSegment(file.businessName,70)+' ('+safeSegment(file.clientId,20)+')',safeSegment(file.period,20),
   ...(file.rejected?['נדחו']:[]),name].join('/');
 }
 // Two files must never share a path in the archive: the second gets -2 before its extension.
 function uniquePaths(files) {
  const used=new Set();
  return files.map(f=>{
   let path=zipPath(f);
   if(used.has(path.toLowerCase())) {
    const dot=path.lastIndexOf('.'),slash=path.lastIndexOf('/');
    const stem=dot>slash?path.slice(0,dot):path,ext=dot>slash?path.slice(dot):'';
    let n=2;while(used.has((stem+'-'+n+ext).toLowerCase()))n++;
    path=stem+'-'+n+ext;
   }
   used.add(path.toLowerCase());return path;
  });
 }
 function dosTime(date) {
  const time=(date.getHours()<<11)|(date.getMinutes()<<5)|Math.floor(date.getSeconds()/2);
  const day=((date.getFullYear()-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate();
  return {time,day};
 }
 // A store-only ZIP writer. sink.write receives Uint8Array chunks in order.
 function zipWriter(sink,now=new Date()) {
  const central=[];let offset=0;const {time,day}=dosTime(now);
  async function put(chunk){await sink.write(chunk);offset+=chunk.length;}
  async function add(path,bytes) {
   const name=enc.encode(path),crc=crc32(bytes),size=bytes.length;
   if(offset+30+name.length+size>0xFFFFFFFF)throw Object.assign(Error('TOO_LARGE'),{code:'TOO_LARGE'});
   const h=new DataView(new ArrayBuffer(30));
   h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);
   h.setUint16(10,time,true);h.setUint16(12,day,true);h.setUint32(14,crc,true);h.setUint32(18,size,true);h.setUint32(22,size,true);
   h.setUint16(26,name.length,true);h.setUint16(28,0,true);
   const at=offset;
   await put(new Uint8Array(h.buffer));await put(name);await put(bytes);
   central.push({name,crc,size,at});
  }
  async function finish() {
   const start=offset;
   for(const e of central) {
    const c=new DataView(new ArrayBuffer(46));
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(10,0,true);
    c.setUint16(12,time,true);c.setUint16(14,day,true);c.setUint32(16,e.crc,true);c.setUint32(20,e.size,true);c.setUint32(24,e.size,true);
    c.setUint16(28,e.name.length,true);c.setUint16(30,0,true);c.setUint16(32,0,true);c.setUint16(34,0,true);c.setUint16(36,0,true);
    c.setUint32(38,0,true);c.setUint32(42,e.at,true);
    await put(new Uint8Array(c.buffer));await put(e.name);
   }
   const end=new DataView(new ArrayBuffer(22));
   end.setUint32(0,0x06054b50,true);end.setUint16(8,central.length,true);end.setUint16(10,central.length,true);
   end.setUint32(12,offset-start,true);end.setUint32(16,start,true);end.setUint16(20,0,true);
   await put(new Uint8Array(end.buffer));
  }
  return {add,finish,get count(){return central.length;}};
 }
 // In memory (every browser): the parts become one Blob at the end.
 function memorySink(){const parts=[];return {write(c){parts.push(c);},blob(){return new Blob(parts,{type:'application/zip'});}};}

 function validatedUrl(value,origin) {
  let a;try{a=new URL(value);}catch{throw Object.assign(Error('INVALID_URL'),{code:'INVALID_URL'});}
  if(!origin||a.origin!==origin||a.protocol!=='https:'||!a.pathname.startsWith('/storage/v1/object/sign/nelio-documents/'))
   throw Object.assign(Error('INVALID_URL'),{code:'INVALID_URL'});
  return a.href;
 }
 async function fetchFile(file,{officeCall,origin,signal,fetchImpl}) {
  const r=await officeCall('openFile',{requestId:file.requestId,uploadId:file.uploadId});
  if(r.driveBlob)return new Uint8Array(await r.driveBlob.arrayBuffer());
  const res=await fetchImpl(validatedUrl(r.url,origin),{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal});
  if(!res.ok)throw Object.assign(Error('HTTP_'+res.status),{code:'HTTP_ERROR'});
  return new Uint8Array(await res.arrayBuffer());
 }
 // Fetches up to three files at a time, writes them in order, retries a file once, and lists what failed.
 async function exportFiles({files,officeCall,supabaseUrl,sink,signal,onProgress=()=>{},fetchImpl=(...a)=>fetch(...a),now=new Date()}) {
  let origin='';try{origin=new URL(supabaseUrl).origin;}catch{/* every Storage URL is refused */}
  const paths=uniquePaths(files),zip=zipWriter(sink,now),failed=[];
  const get=async file=>{
   for(let attempt=0;;attempt++) {
    try{return await fetchFile(file,{officeCall,origin,signal,fetchImpl});}
    catch(e){if(signal?.aborted)throw e;if(attempt>=1)return {error:e};}
   }
  };
  const pending=[];let next=0,done=0;
  const launch=()=>{while(pending.length<3&&next<files.length){pending.push(get(files[next]));next++;}};
  launch();
  for(let i=0;i<files.length;i++) {
   if(signal?.aborted)throw Object.assign(Error('ABORTED'),{code:'ABORTED'});
   const bytes=await pending.shift();launch();
   if(bytes&&!bytes.error)await zip.add(paths[i],bytes);
   else failed.push(paths[i].slice(ROOT.length+1));
   onProgress(++done,files.length);
  }
  if(failed.length)await zip.add(ROOT+'/קבצים-שלא-הורדו.txt',enc.encode('הקבצים האלה לא הורדו. אפשר לנסות שוב או לפתוח אותם בתיק הלקוח:\r\n'+failed.join('\r\n')+'\r\n'));
  await zip.finish();
  return {added:zip.count-(failed.length?1:0),failed};
 }
 function archiveName(label){return safeSegment('שדמי-מסמכי-לקוחות_'+label,120).replace(/\s+/g,'-')+'.zip';}
 function sizeText(bytes) {
  const mb=bytes/1048576;
  return mb<1?'פחות ממגה־בייט':(mb<10?mb.toFixed(1):Math.round(mb))+' מגה־בייט';
 }
 window.NelioZip=Object.freeze({crc32,safeSegment,zipPath,uniquePaths,zipWriter,memorySink,exportFiles,archiveName,sizeText,validatedUrl,ROOT,MAX_FILES,WARN_BYTES,MAX_BYTES});
})();
