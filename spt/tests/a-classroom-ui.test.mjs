// Real component callbacks with isolated hooks and an explicit fake transport.
// No live provider, microphone or original records.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
const hooks={slots:[],at:0};globalThis.__aClassroomHooks=hooks;
const runtime=`const h=globalThis.__aClassroomHooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(){}export function useLayoutEffect(fn){fn()}export function useId(){return useRef('a-ui-'+h.at).current}`;
const built=await build({stdin:{contents:"export {CloseoutPanel} from './app/classroom-panels';export {SheetPanel} from './app/sheet-panel';export {closeoutEvidenceBasis} from './lib/closeout-review';export {ClassroomBoard,StudentCycleCard} from './app/classroom-board';export {SwipeDeleteCard} from './app/swipe-delete-card';export {task} from './lib/classroom';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime','lucide-react'],plugins:[{name:'isolated-classroom-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));b.onResolve({filter:/components\/ui\//},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Checkbox','Select','SelectContent','SelectItem','SelectTrigger','SelectValue','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(n=>`export const ${n}='${n}';`).join('\n')}));}}]});
writeFileSync('.sites-runtime/a-classroom-ui-test.mjs',built.outputFiles[0].text);
const ui=await import('../.sites-runtime/a-classroom-ui-test.mjs');
const render=(fn,p)=>{hooks.at=0;return fn(p)};
const find=(n,match)=>{if(!n||typeof n!=='object')return null;if(match(n))return n;for(const c of [n.props?.children].flat(Infinity)){const f=find(c,match);if(f)return f}return null};
const tick=()=>new Promise(setImmediate);
const props={studentId:'QA_SPT_A',date:'2026-09-14',ledger:[],data:{sessions:[],events:[],ledger:[]},save:async()=>{},copy(){},fail:e=>{throw e}};
const originalFetch=globalThis.fetch;
await test('editing legacy detailed text preserves its already recorded departure fact',async()=>{
 hooks.slots=[];const writes=[],at='2026-09-14T08:10:00.000Z',event={id:'legacy-revision',entity_id:'closeout:QA_SPT_A:2026-09-14',kind:'closeout',student_id:props.studentId,class_date:props.date,body:JSON.stringify({progress:'before',homework:'',noHomework:true,due:'',next:'',confirmed:true,departedAt:at})};
 const tree=render(ui.CloseoutPanel,{...props,ledger:[event],save:async(...args)=>writes.push(args)});find(tree,n=>n.props?.label==='오늘 실제 진도').props.onChange('corrected detail');await tick();
 assert.equal(writes[0][2].departedAt,at);assert.equal(writes[0][2].confirmed,false);
});
await test('opening detailed closeout never starts analysis',async()=>{
 hooks.slots=[];const calls=[];globalThis.fetch=async(...args)=>{calls.push(args);return new Response(JSON.stringify({state:'ready',message:'synthetic result'}))};
 try{const tree=render(ui.CloseoutPanel,props),element={open:true};tree.props.onToggle?.({target:element,currentTarget:element});await tick();assert.equal(calls.length,0,'opening a disclosure is not permission to run analysis');}finally{globalThis.fetch=originalFetch}
});
await test('explicit after-class analysis uses the original student and date once',async()=>{
 hooks.slots=[];const calls=[];globalThis.fetch=async(...args)=>{calls.push(args);return new Response(JSON.stringify({state:'ready',message:'synthetic result'}))};
 try{const tree=render(ui.CloseoutPanel,{...props,allowAnalysis:true});const button=find(tree,n=>n.type==='button'&&n.props.children==='수업 후 근거 정리');assert.ok(button,'after-class analysis remains an explicit available action');button.props.onClick();button.props.onClick();await tick();assert.equal(calls.length,1);const body=JSON.parse(calls[0][1].body);assert.equal(body.studentId,props.studentId);assert.equal(body.date,props.date);assert.equal(calls[0][0],'/api/closeout-analysis');}finally{globalThis.fetch=originalFetch}
});
function boardFixture(){
 const students=['A','B','C'].map(id=>({id:'QA_'+id,name:'Synthetic '+id,days:[1],part:'1부',time:'15:00–17:30',firstDate:'2026-01-01',books:['Synthetic book']}));
 const ledger=[],writes=[],p={students,date:'2026-09-14',ledger,data:{ledger,sessions:[],events:[],captures:[],connected:false,roster:students},selected:students[0].id,ready:true,view:'class',onOpen(){},onAudio(){},fail:e=>{throw e}};
 p.save=async(studentId,kind,entityId,data,date,baseId,mode)=>{const mutation={id:randomUUID(),studentId,kind,entityId,data,date,baseId,mode};writes.push(mutation);const previous=ledger.findIndex(e=>e.entity_id===entityId);if(previous>=0)ledger.splice(previous,1);ledger.push({id:mutation.id,student_id:studentId,kind,entity_id:entityId,body:JSON.stringify(data),class_date:date,base_revision_id:baseId,created_at:new Date().toISOString()});return mutation;};
 return {p,writes};
}
function nodes(n,match,out=[]){if(!n||typeof n!=='object')return out;if(match(n))out.push(n);for(const c of [n.props?.children].flat(Infinity))nodes(c,match,out);return out}
await test('whole-class cards expose all three subjects without generating activity or final records',()=>{
 hooks.slots=[];const {p,writes}=boardFixture(),tree=render(ui.ClassroomBoard,p),cards=nodes(tree,n=>n.type===ui.StudentCycleCard);
 assert.deepEqual(cards.map(n=>n.props.student.id),p.students.map(s=>s.id));assert.equal(writes.length,0);
});
await test('phone action sheet overrides the default independent centering translations',()=>{
 hooks.slots=[];const {p}=boardFixture(),tree=render(ui.ClassroomBoard,p),dialog=find(tree,n=>n.type==='DialogContent');assert.ok(dialog);
 const classes=dialog.props.className.split(/\s+/);assert.ok(classes.includes('translate-x-0'));assert.ok(classes.includes('translate-y-0'));
});
await test('student completion and teacher follow-up stay distinct in a compact card',()=>{
 hooks.slots=[];const {p}=boardFixture(),s=p.students[0],first={id:randomUUID(),entity_id:randomUUID(),student_id:s.id,class_date:p.date,kind:'activity',body:JSON.stringify({...ui.task('Synthetic student work',p.date),state:'working'})},teacher={...first,id:randomUUID(),entity_id:randomUUID(),body:JSON.stringify({...ui.task('숙제 확인',p.date),state:'working'})},states=[];
 const card=render(ui.StudentCycleCard,{student:s,date:p.date,events:[first,teacher],ledger:[first,teacher],focusedId:teacher.entity_id,color:['#123456','#f0f0f0'],index:0,selected:true,ready:true,onMenu(){},onOpen(){},onAssign(){},onState:(e,state)=>states.push({id:e.entity_id,state}),onCancel:async()=>{},onHistory(){},onSelect(){}});
 const primary=find(card,n=>n.props?.className==='a-primary');assert.equal(primary.props.children,'학생 마침');primary.props.onClick();assert.deepEqual(states,[{id:first.entity_id,state:'student_done'}]);
 const swipe=find(card,n=>n.type===ui.SwipeDeleteCard);assert.ok(!find(swipe.props.heading,n=>n.type==='button'),'shared heading has no nested button');assert.equal(typeof swipe.props.onActivate,'function');
});
await test('whole-class departure writes the selected subject with no text or closeout gate',async()=>{
 hooks.slots=[];const {p,writes}=boardFixture();let tree=render(ui.ClassroomBoard,p);nodes(tree,n=>n.type===ui.StudentCycleCard)[1].props.onMenu();tree=render(ui.ClassroomBoard,p);
 find(tree,n=>n.type==='button'&&n.props.children==='귀가 사실 기록').props.onClick();await tick();assert.equal(writes.length,1);assert.equal(writes[0].studentId,'QA_B');assert.equal(writes[0].kind,'class_status');assert.equal(writes[0].mode,'event');assert.ok(writes[0].data.departedAt);assert.equal(writes[0].data.confirmed,undefined);assert.equal(writes[0].data.progress,undefined);
});
await test('cancelling an implicitly displayed activity retains its restore surface for both lanes',async()=>{
 for(const lane of ['student','teacher']){
  hooks.slots=[];const {p,writes}=boardFixture(),s=p.students[0];
  const old={id:randomUUID(),entity_id:randomUUID(),student_id:s.id,class_date:p.date,kind:'activity',body:JSON.stringify({...ui.task('Older work',p.date),lane:'student',state:'done'})};
  const target={...old,id:randomUUID(),entity_id:randomUUID(),body:JSON.stringify({...ui.task('Current work',p.date),lane,state:'working'})};p.ledger.push(old,target);
  let tree=render(ui.ClassroomBoard,p),card=nodes(tree,n=>n.type===ui.StudentCycleCard)[0];assert.equal(card.props.focusedId,undefined);
  await card.props.onCancel(target,true);tree=render(ui.ClassroomBoard,p);card=nodes(tree,n=>n.type===ui.StudentCycleCard)[0];
  assert.equal(card.props.focusedId,target.entity_id,'Deletion must not silently choose another activity before restore is available');
  const parent=hooks.slots;hooks.slots=[];const rendered=render(ui.StudentCycleCard,card.props);hooks.slots=parent;
  const surface=find(rendered,n=>n.type===ui.SwipeDeleteCard);assert.equal(surface.props.deleted,true);assert.ok(surface.props.label.includes('Current work'));
  await surface.props.onRestore();assert.equal(writes.length,2);assert.equal(writes[1].entityId,target.entity_id);assert.equal(writes[1].data.cancelled,false);assert.equal(p.ledger.find(e=>e.entity_id===old.entity_id).id,old.id);
 }
});
await test('late retention of A never closes a newer B menu',async()=>{
 hooks.slots=[];const {p}=boardFixture(),s=p.students[0],event={id:randomUUID(),entity_id:randomUUID(),student_id:s.id,class_date:p.date,kind:'activity',body:JSON.stringify({...ui.task('Synthetic work',p.date),state:'working'})};p.ledger.push(event);const save=p.save;let release;p.save=async(...args)=>{await new Promise(r=>release=r);return save(...args)};
 let tree=render(ui.ClassroomBoard,p);nodes(tree,n=>n.type===ui.StudentCycleCard)[0].props.onState(event,'student_done');nodes(tree,n=>n.type===ui.StudentCycleCard)[1].props.onMenu();release();await tick();tree=render(ui.ClassroomBoard,p);assert.equal(find(tree,n=>n.type==='Dialog').props.open,true);assert.ok(JSON.stringify(find(tree,n=>n.type==='DialogTitle').props.children).includes('Synthetic B'));
});
await test('undo appends a correction and refuses a newer revision rather than overwriting it',async()=>{
 for(const conflict of [false,true]){hooks.slots=[];const {p,writes}=boardFixture();let tree=render(ui.ClassroomBoard,p);nodes(tree,n=>n.type===ui.StudentCycleCard)[0].props.onMenu();tree=render(ui.ClassroomBoard,p);find(tree,n=>n.type==='button'&&n.props.children==='귀가 사실 기록').props.onClick();await tick();const first=writes[0];
  if(conflict)p.ledger[0]={...p.ledger[0],id:randomUUID()};tree=render(ui.ClassroomBoard,p);find(tree,n=>n.type==='button'&&[n.props.children].flat(Infinity).includes('되돌리기')).props.onClick();await tick();assert.equal(writes.length,conflict?1:2);if(!conflict){assert.equal(writes[1].baseId,first.id);assert.equal(writes[1].data.departedAt,'');assert.notEqual(writes[1].id,first.id);}
 }
});

const visibleText=n=>n==null||typeof n==='boolean'?'':typeof n==='string'||typeof n==='number'?String(n):Array.isArray(n)?n.map(visibleText).join(''):visibleText(n.props?.children);
await test('the first Sheet headline cannot bless an old receipt after evidence changes',()=>{
 hooks.slots=[];const {p}=boardFixture(),body={progress:'SYNTHETIC reviewed progress',homework:'',due:'',noHomework:true,next:'',confirmed:true,departedAt:'',evidenceBasis:'OLD-SYNTHETIC-BASIS'},e={id:randomUUID(),entity_id:'closeout:QA_A:'+p.date,student_id:'QA_A',class_date:p.date,kind:'closeout',body:JSON.stringify(body)};
 p.ledger.push(e,{id:randomUUID(),entity_id:randomUUID(),student_id:'QA_A',class_date:p.date,kind:'activity',body:JSON.stringify(ui.task('New source',p.date))});
 const props={date:p.date,studentId:'QA_A',roster:p.students,data:p.data,onConnected(){}};render(ui.SheetPanel,props);
 // Explicit fake GET response in the isolated-hook harness; not a real Sheet.
 hooks.slots[0]={configured:true,connected:true,rosterRevision:'SYNTHETIC',mappings:[{studentId:'QA_A',name:'Synthetic A',profileRow:14,mainRow:4,active:true,trackerRevision:'r1'}],closeouts:[e],receipts:[{student_id:'QA_A',class_date:p.date,entry_id:e.id,remote_id:'remote1',remote_revision:'r1'}],baselines:[{student_id:'QA_A',remote_revision:'r1'}],snapshot:{date:p.date,profileSource:{profiles:[]},mainSource:{rows:[]},tracker:{students:[{studentId:'QA_A',revision:'r1',latestReview:{id:'remote1',data:{...body,sourceId:e.id}}}]}}};
 const tree=render(ui.SheetPanel,props),summary=find(tree,n=>n.type==='summary');assert.match(visibleText(summary),/근거 변경/);assert.doesNotMatch(visibleText(summary),/이 마감 저장 확인/);
 hooks.slots[0].snapshot.tracker.students[0].latestReview.id='new-remote';render(ui.SheetPanel,props);hooks.slots[5]=true;
 const compared=render(ui.SheetPanel,props),apply=find(compared,n=>n.type==='button'&&visibleText(n)==='대조한 앱 마감으로 반영 요청');assert.ok(apply);assert.equal(apply.props.disabled,true,'A comparison checkbox does not re-confirm changed app evidence');
 const fresh={...e,id:randomUUID(),base_revision_id:e.id,body:JSON.stringify({...body,evidenceBasis:ui.closeoutEvidenceBasis('QA_A',p.date,p.data)})};p.ledger[0]=fresh;hooks.slots[0].closeouts=[fresh];render(ui.SheetPanel,props);hooks.slots[5]=true;
 const current=render(ui.SheetPanel,props);assert.equal(find(current,n=>n.type==='button'&&visibleText(n)==='대조한 앱 마감으로 반영 요청').props.disabled,false,'A freshly confirmed server revision remains usable after explicit comparison');
});
await test('after-class overview distinguishes changed confirmation from never reviewed',()=>{
 hooks.slots=[];const {p}=boardFixture();p.view='after';p.ledger.push({id:randomUUID(),entity_id:'closeout:QA_A:'+p.date,student_id:'QA_A',class_date:p.date,kind:'closeout',body:JSON.stringify({progress:'SYNTHETIC reviewed progress',homework:'',due:'',noHomework:true,next:'',confirmed:true,departedAt:'',evidenceBasis:'SYNTHETIC-OLD-BASIS'})});
 const tree=render(ui.ClassroomBoard,p),card=find(tree,n=>n.props?.className==='a-after-card'&&visibleText(n).includes('Synthetic A'));
 assert.ok(card);assert.match(visibleText(card),/근거 변경/,'An earlier confirmation with changed evidence must not be presented as a never-reviewed record');
});
await test('ordinary after-class evidence counts exclude explicit and legacy test sessions',()=>{
 hooks.slots=[];const {p}=boardFixture();p.view='after';p.data.sessions=[{id:randomUUID(),student_id:'QA_A',class_date:p.date,purpose:'lesson'}, {id:randomUUID(),student_id:'QA_A',class_date:p.date,purpose:'test'}, {id:'11111111-1111-4111-8111-111111111111',student_id:'QA_A',class_date:p.date,purpose:'lesson'}, {id:randomUUID(),student_id:'QA_B',class_date:p.date,purpose:'lesson'}];
 const tree=render(ui.ClassroomBoard,p),card=find(tree,n=>n.props?.className==='a-after-card'&&visibleText(n).includes('Synthetic A'));
 assert.match(visibleText(card),/대화 1(?:\D|$)/,'Test sources must not inflate the evidence available for this student/day');
});

