import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {api,sql,sign,req,good} from './pilot-contract.mjs';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const compiled=await build({stdin:{contents:"export * from './app/api/audio-import/route';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'private-import-runtime',setup(b){
 b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},x=>({contents:x.path==='env'?'export const env=globalThis.__sptEnv':x.path==='headers'?'export async function headers(){return globalThis.__sptHeaders}':'export function redirect(){throw Error("redirect")}'}));
}}]});writeFileSync('.sites-runtime/audio-import-route-test.mjs',compiled.outputFiles[0].text);
const imports=await import('../.sites-runtime/audio-import-route-test.mjs');
const call=p=>imports.POST(req('/api/audio-import',p));
const part=(id,seq,bytes)=>imports.POST(new Request(`https://spt.example/api/audio-import?id=${id}&part=${seq}`,{method:'POST',headers:{origin:'https://spt.example'},body:bytes}));
const get=id=>imports.GET(new Request('https://spt.example/api/audio-import?id='+id));
let calls=0;const reply={status:'transcribed',operation:'transcribe',duration:1,text:'SYNTHETIC FILE STT',providerCallPerformed:true};
const capabilities={protocol:'spt.audio-import.v2',ready:true,transcribeAllowed:true,reason:'permitted'};
async function fixture(){const sessionId=randomUUID(),id=randomUUID();await good(await api.notebook.POST(req('/api/notebook',{action:'create',id:sessionId,studentId:'S001',date:'2026-10-18',title:'SYNTHETIC IMPORT'})));await good(await call({action:'prepare',id,sessionId}));return {sessionId,id};}

// First regression reaches the existing real audio handler. These bytes are a
// labeled transport fixture, not a decoded recording or provider response.
if(!sql.prepare("SELECT name FROM sqlite_master WHERE name='spt_audio_imports'").get())sql.exec(`CREATE TABLE spt_audio_imports(id TEXT PRIMARY KEY,owner TEXT,session_id TEXT,filename TEXT,mime TEXT,size INTEGER,status TEXT,created_at TEXT,updated_at TEXT,duration REAL,attempt_id TEXT,transcript_id TEXT,error TEXT);CREATE TABLE spt_audio_import_parts(id TEXT PRIMARY KEY,owner TEXT,import_id TEXT,seq INTEGER,size INTEGER,hash TEXT,object_key TEXT,UNIQUE(import_id,seq));`);

await test('an imported recording downloads the preserved original and honors a byte range',async()=>{
  sign();const owner=await api.server.owner(),sessionId=randomUUID(),id=randomUUID();
  await good(await api.notebook.POST(req('/api/notebook',{action:'create',id:sessionId,studentId:'S001',date:'2026-10-17',title:'SYNTHETIC FILE TRANSPORT',purpose:'test'})));
  sql.prepare('INSERT INTO spt_captures(id,owner,session_id,state,created_at) VALUES(?,?,?,?,?)').run(id,owner,sessionId,'ended','2026-10-17T00:00:00Z');
  sql.prepare('INSERT INTO spt_audio_imports(id,owner,session_id,filename,mime,size,status,created_at,updated_at,duration) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,owner,sessionId,'SYNTHETIC.m4a','audio/mp4',8,'stored','2026-10-17T00:00:00Z','2026-10-17T00:00:00Z',1);
  for(const [seq,bytes] of [[0,[1,2,3,4]],[1,[5,6,7,8]]]){
    const key=`SYNTHETIC-ORIGINAL-${id}-${seq}`;
    await globalThis.__sptEnv.BUCKET.put(key,Uint8Array.from(bytes),{customMetadata:{},onlyIf:{etagDoesNotMatch:'*'}});
    sql.prepare('INSERT INTO spt_audio_import_parts(id,owner,import_id,seq,size,hash,object_key) VALUES(?,?,?,?,?,?,?)').run(`${id}-${seq}`,owner,id,seq,4,await api.server.sha(Uint8Array.from(bytes).buffer),key);
  }
  const response=await api.audio.GET(new Request(`https://spt.example/api/audio?capture=${id}`));
  assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'audio/mp4');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())],[1,2,3,4,5,6,7,8]);
  const range=await api.audio.GET(new Request(`https://spt.example/api/audio?capture=${id}&play=1`,{headers:{Range:'bytes=2-5'}}));
  assert.equal(range.status,206);assert.equal(range.headers.get('Content-Range'),'bytes 2-5/8');
  assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[3,4,5,6]);
  assert.equal((await api.audio.POST(new Request(`https://spt.example/api/audio?capture=${id}&seq=0`,{method:'POST',headers:{origin:'https://spt.example'},body:Uint8Array.from([9,9])}))).status,409);
  sign('another-owner');assert.equal((await api.audio.GET(new Request(`https://spt.example/api/audio?capture=${id}`))).status,404);sign();
});

await test('preparation pins the original session; file retry cannot retarget or replace bytes',async()=>{
 sign();const a=await fixture(),b=await fixture();
 assert.equal((await call({action:'prepare',id:a.id,sessionId:b.sessionId})).status,409);
 const payload={action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:4};
 await good(await call(payload));await good(await call(payload));
 assert.equal((await call({...payload,filename:'different.wav'})).status,409);
 await good(await part(a.id,0,Uint8Array.from([1,2,3,4])));await good(await part(a.id,0,Uint8Array.from([1,2,3,4])));
 assert.equal((await part(a.id,0,Uint8Array.from([4,3,2,1]))).status,409);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_audio_import_parts WHERE import_id=?').get(a.id).n,1);
 const view=await good(await get(a.id));assert.equal(view.session_id,a.sessionId);assert.equal(view.parts.length,1);assert.ok(!JSON.stringify(view).includes('object_key'));
 sign('another-owner');assert.equal((await get(a.id)).status,404);sign();
});
for(const route of ['import','capture'])await test(`${route} original reader returns typed incomplete/range errors rather than rejecting outside the route`,async()=>{
 sign();const a=await fixture(),owner=await api.server.owner();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:4}));
 sql.prepare('INSERT INTO spt_captures(id,owner,session_id,state,created_at) VALUES(?,?,?,?,?)').run(a.id,owner,a.sessionId,'ended','2026-10-18T00:00:00Z');
 const read=options=>route==='import'?imports.GET(new Request(`https://spt.example/api/audio-import?id=${a.id}&original=1`,options)):api.audio.GET(new Request(`https://spt.example/api/audio?capture=${a.id}`,options));
 const missing=await read();assert.equal(missing.status,409);assert.ok((await missing.json()).error.includes('구간'));
 await good(await part(a.id,0,Uint8Array.from([1,2,3,4])));const invalid=await read({headers:{Range:'bytes=100-200'}});assert.equal(invalid.status,416);assert.ok((await invalid.json()).error);
 assert.deepEqual([...new Uint8Array(await (await read()).arrayBuffer())],[1,2,3,4]);
});
await test('incomplete original and absent processor cannot dispatch; one concurrent finish stores only its original subject',async()=>{
 const a=await fixture();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:4}));
 globalThis.fetch=()=>{throw new Error('UNEXPECTED_NETWORK')};
 assert.equal((await call({action:'process',id:a.id})).status,503);
 const owner=await api.server.owner();Object.assign(globalThis.__sptEnv,{SPT_AUDIO_IMPORT_OWNER_KEY:owner,SPT_AUDIO_IMPORT_URL:'http://127.0.0.1:4176/audio-import',SPT_AUDIO_IMPORT_TOKEN:'SYNTHETIC-IMPORT-TOKEN-'.repeat(2)});
 assert.equal((await call({action:'process',id:a.id})).status,409);assert.equal(calls,0);
 await good(await part(a.id,0,Uint8Array.from([9,8,7,6])));
 globalThis.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:4176/audio-import');assert.equal(options.headers['X-SPT-Owner'],owner);if(JSON.parse(options.body).action==='capabilities')return Response.json(capabilities);calls++;return Response.json(reply)};
 const result=await Promise.all([call({action:'transcribe',id:a.id}),call({action:'transcribe',id:a.id})]);assert.ok(result.some(r=>r.status===200));assert.equal(calls,1);
 const row=await good(await get(a.id));assert.equal(row.status,'transcribed');
 const entries=sql.prepare("SELECT * FROM spt_entries WHERE capture_id=? AND kind='transcript'").all(a.id);assert.equal(entries.length,1);assert.equal(entries[0].session_id,a.sessionId);
 assert.equal(JSON.parse(entries[0].body).originalAudioId,a.id);assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_class_events WHERE student_id=?').get('S001').n,0);
 await good(await call({action:'process',id:a.id}));assert.equal(calls,1);
});
await test('unknown processing is not a new request; explicit recovery uses the same attempt',async()=>{
 const a=await fixture();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:2}));await good(await part(a.id,0,Uint8Array.from([1,2])));
 let original;globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);if(p.action==='capabilities')return Response.json(capabilities);original=p;throw new TypeError('SYNTHETIC_DISCONNECT')};
 assert.equal((await good(await call({action:'process',id:a.id}))).status,'unknown');
 assert.equal((await call({action:'process',id:a.id})).status,409);
 globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);assert.equal(p.attemptId,original.attemptId);assert.equal(p.recover,true);return Response.json({status:'stored',duration:1,providerCallPerformed:false,error:'SYNTHETIC key missing'});};
 assert.equal((await good(await call({action:'recover',id:a.id}))).status,'stored');
 assert.equal(sql.prepare("SELECT COUNT(*) n FROM spt_entries WHERE capture_id=? AND kind='transcript'").get(a.id).n,0);
 });
 await test('private export preserves original-file references and excludes storage keys and test files',async()=>{
 const response=await api.dataset.GET(new Request('https://spt.example/api/dataset?from=2026-10-17&to=2026-10-18&view=history'));
 assert.equal(response.status,200);const text=await response.text(),rows=text.trim().split('\n').map(v=>JSON.parse(v));
 assert.equal(rows.at(-1).record_type,'export_complete');const originals=rows.filter(r=>r.record_type==='audio_import');
 assert.ok(originals.length>0);assert.ok(originals.every(r=>r.class_date==='2026-10-18'&&r.recorded_at===null&&r.audio_download_path.includes(r.id)));
 assert.ok(rows.some(r=>r.record_type==='audio_import_part'));assert.ok(!text.includes('object_key'));assert.ok(!text.includes('SYNTHETIC-IMPORT-TOKEN-'));
 });

async function retained(a,text='SYNTHETIC RETAINED TRANSCRIPT',extra={}){
 const owner=await api.server.owner(),entryId=randomUUID(),stamp='2026-10-18T00:00:00Z';
 sql.prepare('INSERT INTO spt_captures(id,owner,session_id,state,created_at,ended_at) VALUES(?,?,?,?,?,?)').run(a.id,owner,a.sessionId,'ended',stamp,stamp);
 sql.prepare("UPDATE spt_audio_imports SET status='stored',duration=1 WHERE id=?").run(a.id);
 sql.prepare('INSERT INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at,schema_version) VALUES(?,?,?,?,?,?,?,1)').run(entryId,owner,a.sessionId,'transcript',JSON.stringify({text,...extra}),a.id,stamp);
 return entryId;
}
await test('retained capture-bound transcript is visible and reused without a processor or new attempt',async()=>{
 sign();const a=await fixture(),entryId=await retained(a);const before=sql.prepare('SELECT * FROM spt_audio_imports WHERE id=?').get(a.id);
 let dispatched=0;globalThis.fetch=async()=>{dispatched++;throw new Error('FORBIDDEN_PROVIDER_OR_PROCESSOR')};
 const view=await good(await get(a.id));assert.deepEqual(view.transcription,{state:'available',entryIds:[entryId]});assert.equal(view.status,'stored');assert.equal(view.transcript_id,null);
 delete globalThis.__sptEnv.SPT_AUDIO_IMPORT_OWNER_KEY;
 const reuse=await good(await call({action:'transcribe',id:a.id}));assert.deepEqual(reuse.transcription,view.transcription);assert.equal(dispatched,0);assert.deepEqual(sql.prepare('SELECT * FROM spt_audio_imports WHERE id=?').get(a.id),before);
});
await test('a sibling file in the same session cannot borrow its transcript; contradictory source metadata stays review-only',async()=>{
 sign();const a=await fixture(),entryId=await retained(a),b={id:randomUUID(),sessionId:a.sessionId};await good(await call({action:'prepare',...b}));
 const empty=await good(await get(b.id));assert.deepEqual(empty.transcription,{state:'not_found',entryIds:[]});
 const secondId=await retained(b,'SYNTHETIC SECOND FILE');assert.deepEqual((await good(await get(a.id))).transcription.entryIds,[entryId]);assert.deepEqual((await good(await get(b.id))).transcription.entryIds,[secondId]);
 const c=await fixture();await retained(c,'SYNTHETIC CONFLICT',{originalAudioId:a.id});assert.equal((await good(await get(c.id))).transcription.state,'needs_review');assert.equal((await call({action:'transcribe',id:c.id})).status,409);
});
await test('single import read supplies the authoritative subject/day for a delegated return link',async()=>{
 sign();const a=await fixture(),row=await good(await get(a.id));assert.equal(row.student_id,'S001');assert.equal(row.class_date,'2026-10-18');assert.equal(row.session_purpose,'lesson');assert.equal(row.session_id,a.sessionId);
});
function configure(){Object.assign(globalThis.__sptEnv,{SPT_AUDIO_IMPORT_OWNER_KEY:undefined,SPT_AUDIO_IMPORT_URL:'http://127.0.0.1:4176/audio-import',SPT_AUDIO_IMPORT_TOKEN:'SYNTHETIC-IMPORT-TOKEN-'.repeat(2)});}
await test('explicit and legacy original finalization never request transcription even with an available allowance',async()=>{
 sign();configure();globalThis.__sptEnv.SPT_AUDIO_IMPORT_OWNER_KEY=await api.server.owner();const operations=[];
 globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);if(p.action==='capabilities')return Response.json(capabilities);operations.push(p.operation);return Response.json({status:'stored',operation:p.operation,duration:1,providerCallPerformed:false});};
 for(const action of ['finalize','process']){const a=await fixture();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:2}));await good(await part(a.id,0,Uint8Array.from([1,2])));const row=await good(await call({action,id:a.id}));assert.equal(row.status,'stored');assert.deepEqual(row.transcription,{state:'not_found',entryIds:[]});}
 assert.deepEqual(operations,['finalize','finalize']);
});
await test('an Entry arriving during capability lookup blocks the atomic transcription claim',async()=>{
 sign();configure();globalThis.__sptEnv.SPT_AUDIO_IMPORT_OWNER_KEY=await api.server.owner();const a=await fixture();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:2}));await good(await part(a.id,0,Uint8Array.from([1,2])));let entryId;
 globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);assert.equal(p.action,'capabilities','no processing dispatch after a retained transcript appears');entryId=await retained(a);return Response.json(capabilities);};
 const r=await good(await call({action:'transcribe',id:a.id}));assert.deepEqual(r.transcription,{state:'available',entryIds:[entryId]});assert.equal(r.attempt_id,null);
});
await test('recovering original validation stays possible when a separately retained transcript is already available',async()=>{
 sign();configure();globalThis.__sptEnv.SPT_AUDIO_IMPORT_OWNER_KEY=await api.server.owner();const a=await fixture(),entryId=await retained(a),attempt=randomUUID();sql.prepare("UPDATE spt_audio_imports SET status='unknown',attempt_id=? WHERE id=?").run(attempt,a.id);let recovered=0;
 globalThis.fetch=async(_url,options)=>{const p=JSON.parse(options.body);assert.equal(p.recover,true);assert.equal(p.attemptId,attempt);recovered++;return Response.json({status:'stored',operation:'finalize',duration:1,providerCallPerformed:false});};
 const r=await good(await call({action:'recover',id:a.id}));assert.equal(recovered,1);assert.equal(r.status,'stored');assert.deepEqual(r.transcription,{state:'available',entryIds:[entryId]});assert.equal(sql.prepare("SELECT COUNT(*) n FROM spt_entries WHERE capture_id=? AND kind='transcript'").get(a.id).n,1);
});
await test('disabled, stopped or unsupported processing cannot claim a new transcription attempt',async()=>{
 sign();configure();globalThis.__sptEnv.SPT_AUDIO_IMPORT_OWNER_KEY=await api.server.owner();const a=await fixture();await good(await call({action:'file',id:a.id,filename:'SYNTHETIC.wav',mime:'audio/wav',size:2}));await good(await part(a.id,0,Uint8Array.from([1,2])));
 for(const [value,expected] of [[{...capabilities,transcribeAllowed:false,reason:'disabled'},409],[{...capabilities,ready:false,transcribeAllowed:false,reason:'stopped'},503],[{...capabilities,protocol:'unverified-old-protocol'},503]]){
  globalThis.fetch=async(_url,options)=>{assert.equal(JSON.parse(options.body).action,'capabilities');return Response.json(value);};assert.equal((await call({action:'transcribe',id:a.id})).status,expected);assert.equal((await good(await get(a.id))).attempt_id,null);
 }
});
