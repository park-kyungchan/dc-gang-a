import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
// Execute production Notebook handlers with isolated hooks and controllable microphone/storage.
// No browser, real microphone, provider, or live data is used.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const h={slots:[],at:0};globalThis.__v9Hooks=h;
const runtime=`const h=globalThis.__v9Hooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(){};export function useLayoutEffect(fn){fn()}export function useSyncExternalStore(subscribe,getSnapshot,getServerSnapshot){return getServerSnapshot()}export function useId(){return 'isolated-id'};`;
let created=[],ended=[],captures=[],recorders=[],live=0,maxLive=0,unsafe=false,pendingStop=null,failPrepare=false;
const idle={phase:'idle',recording:false,seconds:0,transcribing:false,level:0,message:'',pending:0};
class Recorder{constructor(id,cb){this.id=id;this.cb=cb;this.running=false;recorders.push(this)}async prepare(){if(failPrepare)throw new Error('prepare failed');this.cb.status({...idle,phase:'preparing'})}async start(){this.running=true;live++;maxLive=Math.max(maxLive,live);this.cb.status({...idle,phase:'recording',recording:true})}async stop(){if(pendingStop)await pendingStop;if(unsafe)return {safe:false,message:'unpreserved B audio'};if(this.running){live--;this.running=false;this.cb.status({...idle,phase:'ended'})}return {safe:true,message:''}}async cancelSetup(){}async retryStorage(){unsafe=false}get isRecording(){return this.running}}
globalThis.__v9Recorder=Recorder;globalThis.__v9Idle=idle;
const childNames={'./classroom-board':['ClassroomBoard'],'./native-capture':['NativeCapture'],'./recorder-dock':['RecorderDock'],'./dataset-panel':['DatasetPanel'],'./sheet-panel':['SheetPanel'],'./observation-cards':['ObservationCards'],'./classroom-panels':['Activities','CloseoutPanel','Observation','Pick','ReviewPanel','Tick','formatTime']};
const bundled=await build({stdin:{contents:"export {default as Notebook} from './app/notebook';export {RecorderDock} from './app/recorder-dock';export {Activities} from './app/classroom-panels';export {StudentRoster} from './app/student-roster'",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime','lucide-react'],plugins:[syntheticRosterPlugin,{name:'v9-isolation',setup(b){
 b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));
 b.onResolve({filter:/components\/ui\//},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Dialog','DialogTrigger','DialogContent','DialogHeader','DialogTitle','DialogDescription','Tabs','TabsContent','TabsList','TabsTrigger','Checkbox','Select','SelectContent','SelectItem','SelectTrigger','SelectValue'].map(n=>`export const ${n}='${n}';`).join('\n')}));
 b.onResolve({filter:/^\.\//},a=>a.importer.replaceAll('\\','/').endsWith('/app/notebook.tsx')&&childNames[a.path]?{path:a.path,namespace:'child'}:undefined);b.onLoad({filter:/.*/,namespace:'child'},a=>({contents:childNames[a.path].map(n=>n==='formatTime'?`export const formatTime=v=>v;`:`export const ${n}='${n}';`).join('\n')}));
 b.onResolve({filter:/^@\/lib\/recorder$/},()=>({path:'recorder',namespace:'rec'}));b.onLoad({filter:/.*/,namespace:'rec'},()=>({contents:'export const ClassRecorder=globalThis.__v9Recorder,idleRecording=globalThis.__v9Idle;export const pcmWav=x=>x;'}));
}}]});writeFileSync('.sites-runtime/dock-notebook-test.mjs',bundled.outputFiles[0].text);const ui=await import('../.sites-runtime/dock-notebook-test.mjs');
const walk=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const c of [node.props?.children].flat(Infinity)){const found=walk(c,predicate);if(found)return found;}return null};
globalThis.requestAnimationFrame=()=>0;
const render=()=>{h.at=0;return ui.Notebook({ownerKey:'isolated'})};
const dock=()=>walk(render(),n=>n.type==='RecorderDock').props;
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate)};
let B,A,T,base;
function setup(testMode=false){h.slots=[];h.at=0;created=[];ended=[];captures=[];recorders=[];live=0;maxLive=0;unsafe=false;pendingStop=null;failPrepare=false;render();B=randomUUID();A=randomUUID();T=randomUUID();base={connected:false,events:[],captures:[],ledger:[],roster:[{id:'S004',name:'B',days:[3],part:'1부',time:'',firstDate:'2026-01-01',books:[]},{id:'S003',name:'A',days:[3],part:'1부',time:'',firstDate:'2026-01-01',books:[]}],sessions:[{id:B,student_id:'S004',class_date:'2026-09-09',title:'B lesson',purpose:'lesson',ended_at:null},{id:A,student_id:'S003',class_date:'2026-09-09',title:'A lesson',purpose:'lesson',ended_at:null},...(testMode?[{id:T,student_id:'S004',class_date:'2026-09-09',title:'test',purpose:'test',ended_at:null}]:[])]};
 // Hook setup only: production event handlers below own all transitions.
 h.slots[0]='2026-09-09';h.slots[1]='S004';h.slots[9]=base;h.slots[11]=true;h.slots[25]={studentId:'S004',date:'2026-09-09',sessionId:testMode?T:B,title:'',purpose:testMode?'test':'lesson'};
 h.slots[32].current={pending:[],cached(){},async enqueue(id,url,p){if(p.action==='create'){created.push(p);base.sessions.push({id:p.id,student_id:p.studentId,class_date:p.date,purpose:p.purpose,title:p.title,ended_at:null});}if(p.action==='end'){ended.push(p.id);const s=base.sessions.find(s=>s.id===p.id);if(s)s.ended_at='2026-09-09T11:00:00Z';}},async beginCapture(v){captures.push(v)},async revision(){},async flush(){}};
 render();}
function chooseScreen(id){const board=walk(render(),n=>n.type==='ClassroomBoard');assert.ok(board.props.students.some(s=>s.id===id),'student remains in the actual whole-class surface');board.props.onOpen(id,'class');render()}
async function chooseDock(id){dock().onChoose();const button=walk(render(),n=>n.type==='button'&&n.props.onClick&&n.props.children?.[0]?.type==='strong'&&n.props.children[0].props.children===(id==='S004'?'B':'A'));assert.ok(button);button.props.onClick();await settle();render()}
await test('A overview and return preserve the selected student workspace and pinned recording',async()=>{
 setup();let tree=render();assert.match(tree.props.className,/class-overview/);
 const work=()=>walk(render(),n=>n.props?.id==='student-work');
 assert.equal(work().props.hidden,true);assert.ok(walk(work(),n=>n.type==='Activities'),'workspace remains mounted in overview');
 dock().onTap();await settle();chooseScreen('S003');assert.equal(work().props.hidden,false);assert.match(render().props.className,/detail-focused/);
 h.slots[6]='past-session';h.slots[7]='작성 중 제목';h.slots[8]='test';render();
 const selected=h.slots[1],session=h.slots[6],identity=dock().identityKey;
 const back=walk(render(),n=>n.type==='button'&&n.props.className?.includes('field-return'));assert.ok(back);back.props.onClick();
 tree=render();assert.equal(work().props.hidden,true);assert.match(tree.props.className,/class-overview/);
 assert.equal(h.slots[1],selected);assert.equal(h.slots[6],session);assert.equal(dock().identityKey,identity);assert.equal(live,1);
 assert.ok(walk(work(),n=>n.type==='Activities'),'return hides rather than unmounts activities');
 chooseScreen('S003');assert.equal(work().props.hidden,false);assert.equal(h.slots[6],session);assert.equal(h.slots[7],'작성 중 제목');assert.equal(h.slots[8],'test');assert.equal(dock().name,'B');assert.equal(captures.length,1);
});
await test('an unselected recording dock opens the chooser instead of assigning a microphone target',async()=>{
 setup();h.slots[25]={studentId:'',date:'2026-09-09',sessionId:'',title:'',purpose:'lesson'};dock().onTap();await settle();assert.equal(captures.length,0);assert.equal(recorders.length,0);assert.equal(h.slots[26],true);
});
await test('v9 actual Notebook dock pauses/resumes B after screen A selection, using same session and one mic',async()=>{setup();dock().onTap();await settle();assert.equal(captures.at(-1).sessionId,B);chooseScreen('S003');dock().onTap();await settle();assert.equal(live,0);assert.equal(dock().name,'B');dock().onTap();await settle();assert.equal(captures.at(-1).studentId,'S004');assert.equal(captures.at(-1).sessionId,B);assert.equal(h.slots[1],'S003');assert.equal(maxLive,1);});
await test('v9 opening/cancelling picker keeps B, selecting A switches once without changing the screen',async()=>{setup();dock().onTap();await settle();dock().onChoose();assert.equal(live,1);h.slots[26]=false;assert.equal(live,1);await chooseDock('S003');assert.equal(captures.at(-1).sessionId,A);assert.equal(h.slots[1],'S004');assert.equal(maxLive,1);});
await test('v9 queued stop blocks double taps; unsafe stop preserves B and refuses A',async()=>{setup();dock().onTap();await settle();unsafe=true;await chooseDock('S003');assert.equal(captures.length,1);assert.equal(dock().name,'B');assert.match(h.slots[13],/unpreserved/);unsafe=false;let release;pendingStop=new Promise(r=>release=r);dock().onTap();dock().onTap();assert.equal(captures.length,1);release();pendingStop=null;await settle();assert.equal(live,0);});
await test('v9 paused selection does not start sound; date changes preserve pinned conversation date',async()=>{setup();await chooseDock('S003');assert.equal(captures.length,0);dock().onTap();await settle();dock().onTap();await settle();h.slots[0]='2026-09-12';render();dock().onTap();await settle();assert.equal(captures.at(-1).date,'2026-09-09');assert.equal(captures.at(-1).sessionId,A);});
await test('v9 ending a test conversation never falls through to an open lesson',async()=>{setup(true);dock().onTap();await settle();dock().onEnd();const button=walk(render(),n=>n.type==='button'&&n.props.children==='대화 마침');assert.ok(button);button.props.onClick();await settle();assert.deepEqual(ended,[T]);dock().onTap();await settle();assert.equal(created.at(-1).purpose,'test');assert.notEqual(captures.at(-1).sessionId,B);assert.notEqual(captures.at(-1).sessionId,T);});
await test('v9 setup failure restores old dock identity and leaves its conversation available',async()=>{setup();dock().onTap();await settle();failPrepare=true;await chooseDock('S003');assert.equal(dock().name,'B');assert.equal(base.sessions.find(s=>s.id===B).ended_at,null);assert.equal(maxLive,1);assert.equal(captures.length,1);});
await test('v9 same activity double tap is one assignment and never resets its timestamp',async()=>{h.slots=[];h.at=0;let records=[];const props={studentId:'S004',date:'2026-09-09',ledger:[],save:async(...args)=>{records.push(args)},fail:e=>{throw e}};const tree=ui.Activities(props);const button=walk(tree,n=>n.type==='button'&&n.props.children?.[1]==='마인드맵 작성');assert.ok(button);button.props.onClick();button.props.onClick();await settle();assert.equal(records.length,1);assert.ok(records[0][2].timing.assignedAt);});
await test('native recording button keeps its original subject and never creates a browser microphone',async()=>{
 setup(true);base.captureMode='voice_memos';render();chooseScreen('S003');dock().onTap();await settle();
 const panel=walk(render(),n=>n.type==='NativeCapture');assert.ok(panel);
 assert.equal(panel.props.target.studentId,'S004');assert.equal(panel.props.target.sessionId,T);assert.equal(panel.props.target.purpose,'test');
 assert.equal(await panel.props.ensureSession(panel.props.target),T);assert.equal(recorders.length,0);assert.equal(captures.length,0);
 assert.equal(dock().external,true);assert.equal(dock().canEnd,false);
});
await test('changing export scope never retargets the selected student review',()=>{
 setup();base.roster[1].part='2부';h.slots[3]='2부';const panel=walk(render(),n=>n.type==='ReviewPanel');assert.ok(panel);assert.equal(panel.props.studentId,h.slots[1]);
});
await test('actual review adapter preserves explicit event intent and the selected review subject',async()=>{
 setup();const writes=[];h.slots[32].current.revision=async(...args)=>{writes.push(args)};
 const panel=walk(render(),n=>n.type==='ReviewPanel');assert.ok(panel);
 await panel.props.save('report','report:S004:2026-09-09',{confirmed:false},'2026-09-09','base-id','event');
 assert.equal(writes[0][3],'event');assert.equal(writes[0][1].studentId,panel.props.studentId);
});
await test('collapsed dock moves on both axes without expanding or changing recording',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout,originalStorage=Object.getOwnPropertyDescriptor(globalThis,'localStorage');let timers=new Map(),counter=0;globalThis.setTimeout=fn=>{timers.set(++counter,fn);return counter};globalThis.clearTimeout=id=>timers.delete(id);
 try{for(const side of ['left','right']){
  h.slots=[];timers.clear();const stored=[];let actions=0;globalThis.localStorage={setItem:(key,value)=>stored.push({key,value:JSON.parse(value)}),getItem:()=>null};
  const p={ownerKey:'isolated',identityKey:'B',name:'B',state:'녹음 중',recording:true,disabled:false,canEnd:true,alert:'',onTap:()=>actions++,onChoose:()=>actions++,onEnd:()=>actions++,onRecover(){}};
  const draw=()=>{h.at=0;return ui.RecorderDock(p)},handle=()=>walk(draw(),n=>n.props?.className?.startsWith('touch-recorder-edge'));
  walk(draw(),n=>n.type==='button'&&n.props.children===(side==='left'?'왼쪽에 숨김':'오른쪽에 숨김')).props.onClick();let node=handle();assert.ok(node);
  const initial={...node.props.style},target={getBoundingClientRect:()=>({left:initial.left,top:initial.top,width:72,height:48}),setPointerCapture(){}};
  const event=(x,y)=>({button:0,isPrimary:true,pointerId:4,clientX:x,clientY:y,currentTarget:target,target});
  node.props.onPointerDown(event(initial.left+20,initial.top+20));for(const fn of [...timers.values()])fn();node.props.onPointerMove(event(180,320));node.props.onPointerUp(event(180,320));node.props.onClick({detail:1});node=handle();
  assert.ok(node,'drag must stay collapsed');assert.ok(node.props.style.left>0&&node.props.style.left<288,'collapsed x must not remain snapped to an edge');assert.equal(node.props.style.left,160);assert.equal(node.props.style.top,300);assert.equal(actions,0);
  assert.equal(walk(draw(),n=>n.props?.role==='group').props.hidden,true);assert.ok(stored.at(-1).value.x>0&&stored.at(-1).value.x<1);
  const base={...node.props.style};target.getBoundingClientRect=()=>({left:base.left,top:base.top,width:72,height:48});node.props.onPointerDown(event(base.left+20,base.top+20));for(const fn of [...timers.values()])fn();node.props.onPointerMove(event(250,480));node.props.onPointerCancel();node=handle();assert.deepEqual(node.props.style,base);assert.equal(actions,0);
 }}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;if(originalStorage)Object.defineProperty(globalThis,'localStorage',originalStorage);else delete globalThis.localStorage;}
});
await test('dock ignores descendant capture transfer but cancels genuine own capture loss',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let timers=new Map(),counter=0;globalThis.setTimeout=fn=>{timers.set(++counter,fn);return counter};globalThis.clearTimeout=id=>timers.delete(id);
 try{for(const collapsed of [false,true]){
  h.slots=[];timers.clear();let actions=0;const p={ownerKey:'isolated',identityKey:'B',name:'B',state:'녹음 중',recording:true,disabled:false,canEnd:true,alert:'',onTap:()=>actions++,onChoose:()=>actions++,onEnd:()=>actions++,onRecover(){}};
  const draw=()=>{h.at=0;return ui.RecorderDock(p)},surface=()=>walk(draw(),n=>collapsed?n.props?.className?.startsWith('touch-recorder-edge'):n.props?.role==='group');
  if(collapsed)walk(draw(),n=>n.type==='button'&&n.props.children==='왼쪽에 숨김').props.onClick();let node=surface();const initial={...node.props.style},target={getBoundingClientRect:()=>({left:initial.left,top:initial.top,width:collapsed?72:160,height:60}),setPointerCapture(){}},child={closest:()=>({getAttribute:()=> 'name'})};
  const event=(x,y)=>({button:0,isPrimary:true,pointerId:5,clientX:x,clientY:y,currentTarget:target,target:child});node.props.onPointerDown(event(initial.left+20,initial.top+20));node.props.onLostPointerCapture({...event(initial.left+20,initial.top+20),target:child});assert.equal(timers.size,1,'a bubbled descendant loss must not cancel the held gesture');for(const fn of [...timers.values()])fn();node.props.onPointerMove(event(180,350));node=surface();assert.notDeepEqual(node.props.style,initial);
  node.props.onLostPointerCapture({...event(180,350),target});assert.equal(timers.size,0);assert.equal(actions,0);assert.deepEqual(surface().props.style,initial);
 }}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
// Actual dock pointer handlers: timers fire under a deterministic clock.
await test('v9 actual dock release chooses or ends once; move, cancel and hidden handle never toggle recording',()=>{
 const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;let timers=new Map(),counter=0;globalThis.setTimeout=fn=>{timers.set(++counter,fn);return counter};globalThis.clearTimeout=id=>timers.delete(id);globalThis.requestAnimationFrame=()=>0;globalThis.localStorage={setItem(){},getItem(){return null}};
 try{for(const mode of ['choose','end','move','cancel','hide','flick']){h.slots=[];h.at=0;timers.clear();let taps=0,choices=0,ends=0;const props={ownerKey:'isolated',identityKey:'B',name:'B',state:'녹음 중',recording:true,disabled:false,canEnd:true,alert:'',onTap:()=>taps++,onChoose:()=>choices++,onEnd:()=>ends++,onRecover(){}};
 const draw=()=>{h.at=0;return ui.RecorderDock(props)},panel=()=>walk(draw(),n=>n.props?.role==='group'),target={getBoundingClientRect:()=>({left:100,top:200}),setPointerCapture(){}};
 const e=(x,y=220)=>({button:0,isPrimary:true,pointerId:1,clientX:x,clientY:y,currentTarget:target,target:{closest:()=>({getAttribute:()=>mode==='end'?'mic':'name'})}});
 let node=panel();node.props.onPointerDown(e(200));if(mode!=='hide')for(const fn of [...timers.values()])fn();if(mode==='move')node.props.onPointerMove(e(205,340));if(mode==='flick'){node.props.onPointerMove(e(200));node.props.onPointerMove(e(120));}if(mode==='cancel')node.props.onPointerCancel(e(200));node.props.onPointerUp(e(mode==='hide'||mode==='flick'?80:mode==='move'?205:200,mode==='move'?340:220));node.props.onClick({detail:1});assert.equal(taps,0);assert.equal(choices,mode==='choose'?1:0);assert.equal(ends,mode==='end'?1:0);
 if(mode==='hide'||mode==='flick'){const handle=walk(draw(),n=>n.props?.className?.startsWith('touch-recorder-edge'));assert.ok(handle);handle.props.onClick({detail:1});assert.equal(taps,0);}
 }}finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});
