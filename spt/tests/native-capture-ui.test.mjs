// Real NativeCapture callbacks with explicit hook/transport substitutes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
const h={slots:[],at:0,effects:[]};globalThis.__audioHooks=h;
const runtime=`const h=globalThis.__audioHooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(fn,deps){const i=h.at++;if(!(i in h.slots)){h.slots[i]=deps;h.effects.push(fn)}}export function useCallback(fn){return fn}`;
const built=await build({entryPoints:['app/native-capture.tsx'],bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime'],plugins:[{name:'explicit-ui-fixture',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));b.onResolve({filter:/components\/ui\/dialog/},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Dialog','DialogContent','DialogDescription','DialogHeader','DialogTitle'].map(n=>`export const ${n}='${n}';`).join('\n')}));}}]});
mkdirSync('.sites-runtime',{recursive:true});writeFileSync('.sites-runtime/native-capture-ui-test.mjs',built.outputFiles[0].text);const {NativeCapture}=await import('../.sites-runtime/native-capture-ui-test.mjs');
const find=(n,p)=>{if(!n||typeof n!=='object')return null;if(p(n))return n;for(const c of [n.props?.children].flat(Infinity)){const r=find(c,p);if(r)return r;}return null;};
const text=n=>n==null||typeof n==='boolean'?'':typeof n!=='object'?String(n):[n.props?.children].flat(Infinity).map(text).join(' ');
const wait=async p=>{const end=Date.now()+2500;while(!p()&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert.ok(p(),'bounded UI callback completion');};
const id='11111111-1111-4111-8111-111111111111',sessionId='22222222-2222-4222-8222-222222222222';
const base={id,session_id:sessionId,student_id:'QA_AUDIO_A',class_date:'2040-01-02',session_title:'합성 녹음',session_purpose:'test',status:'stored',filename:'합성.wav',mime:'audio/wav',size:4,duration:1,attempt_id:null,transcript_id:null,error:null,transcription:{state:'not_found',entryIds:[]}};
const caps={ready:true,transcribeAllowed:false,reason:'disabled'};
test('settings copy distinguishes native file processing from the separate browser realtime mode',()=>{
 const source=readFileSync('app/notebook.tsx','utf8');
 assert.ok(source.includes("nativeCaptureMode?'파일 전사':'실시간 전사'"));
 assert.ok(source.includes('원본 보관과 전사 요청은 별개'));
});
async function fixture(row){
 h.slots=[];h.at=0;h.effects=[];let current={...row};const posts=[];
 const p={target:{studentId:'QA_AUDIO_A',date:base.class_date,sessionId,title:'합성 녹음',purpose:'test'},name:'합성 A',names:{QA_AUDIO_A:'합성 A'},ensureSession:async()=>sessionId,onPrepared(){},onChanged(){},onClose(){}};
 globalThis.fetch=async(url,options)=>{
  if(options?.method==='POST'){
   if(String(url).includes('&part='))return Response.json({saved:true});
   const payload=JSON.parse(options.body);posts.push(payload);
   if(String(url)==='/api/audio-transfer/grant')return Response.json({protocol:'spt.audio-transfer.v1',importId:current.id,sessionId:current.session_id,studentId:current.student_id,classDate:current.class_date,token:'S'.repeat(43),expiresAt:Date.now()/1000+600,uploadURL:'https://spt.example/api/audio-transfer/upload',statusURL:'https://spt.example/api/audio-transfer/status',returnURL:'https://spt.example/?audioImport='+current.id});
   if(payload.action==='file')current={...current,filename:payload.filename,mime:payload.mime,size:payload.size,status:'uploading'};
   if(['process','finalize'].includes(payload.action))current={...current,status:'stored',duration:1};
   return Response.json(current);
  }
  return Response.json(String(url).includes('?date=')?{imports:[current],processor:caps}:{...current,parts:[]});
 };
 const render=()=>{h.at=0;return NativeCapture(p);};render();
 const oldSet=globalThis.setInterval,oldClear=globalThis.clearInterval;globalThis.setInterval=()=>0;globalThis.clearInterval=()=>{};
 const cleanup=h.effects.map(fn=>fn());globalThis.setInterval=oldSet;globalThis.clearInterval=oldClear;
 await wait(()=>h.slots.some(s=>Array.isArray(s)&&s[0]?.id===id));let tree=render();find(tree,n=>n.type==='button'&&n.props['aria-pressed']===false).props.onClick();tree=render();
 return {render,tree,posts,cleanup:()=>cleanup.forEach(fn=>fn?.())};
}
test('stored legacy row with a retained transcript does not announce transcription missing or offer another request',async()=>{
 const f=await fixture({...base,transcription:{state:'available',entryIds:['33333333-3333-4333-8333-333333333333']}});
 try{assert.ok(text(f.tree).includes('원본·전사 보관 완료'));assert.ok(!find(f.tree,n=>n.type==='button'&&text(n)==='전사 요청'));}finally{f.cleanup();}
});
test('retained transcript does not hide recovery of an unconfirmed original-processing outcome',async()=>{
 const f=await fixture({...base,status:'unknown',transcription:{state:'available',entryIds:['33333333-3333-4333-8333-333333333333']}});
 try{assert.ok(find(f.tree,n=>n.type==='button'&&text(n)==='처리 상태 확인 · 새 전사 없음'));assert.ok(!text(f.tree).includes('원본·전사 보관 완료'));}finally{f.cleanup();}
});
test('file upload ends in original-only finalization; a disabled allowance cannot be a missing-key instruction',async()=>{
 const f=await fixture({...base,status:'prepared',filename:null,size:null,duration:null});
 try{
  const file=new File([Uint8Array.from([1,2,3,4])],'합성.wav',{type:'audio/wav'});find(f.tree,n=>n.type==='input'&&n.props.type==='file').props.onChange({currentTarget:{files:[file],value:'selected'}});
  await wait(()=>f.posts.some(p=>['process','finalize','transcribe'].includes(p.action)));assert.equal(f.posts.at(-1).action,'finalize');assert.equal(f.posts.at(-1).id,id);assert.ok(!f.posts.some(p=>p.action==='transcribe'));
  await new Promise(r=>setTimeout(r,10));const tree=f.render();const button=find(tree,n=>n.type==='button'&&text(n)==='전사 요청');assert.ok(!button||button.props.disabled);assert.ok(!text(tree).includes('키 등록 후 아래에서'));
 }finally{f.cleanup();}
});
test('an explicit source-bound transfer grant prepares a Shortcut URL without starting recording or persisting a secret',async()=>{
 const previous=globalThis.window;globalThis.window={location:{origin:'https://spt.example'}};const f=await fixture({...base,status:'prepared',filename:null,size:null,duration:null});
 try{
  const button=find(f.tree,n=>n.type==='button'&&text(n)==='자동 전송 연결 준비');assert.ok(button,'real dialog needs the explicit automatic-transfer preparation control');button.props.onClick();
  await wait(()=>!!find(f.render(),n=>n.type==='a'&&text(n)==='녹음·자동 전송 시작'));
  const link=find(f.render(),n=>n.type==='a'&&text(n)==='녹음·자동 전송 시작'),url=new URL(link.props.href),input=JSON.parse(url.searchParams.get('text'));
  assert.equal(url.protocol,'shortcuts:');assert.equal(url.searchParams.get('input'),'text');assert.equal(input.importId,id);assert.equal(input.uploadURL,'https://spt.example/api/audio-transfer/upload');assert.ok(!f.posts.some(x=>['file','finalize','transcribe'].includes(x.action)));
 }finally{f.cleanup();globalThis.window=previous;}
});
