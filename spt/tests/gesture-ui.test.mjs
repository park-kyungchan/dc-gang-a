// Actual shared React handlers, isolated hooks. No browser or operating data.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
const listeners=new Map();
globalThis.document={activeElement:null,addEventListener(k,fn){listeners.set(k,fn)},removeEventListener(k,fn){if(listeners.get(k)===fn)listeners.delete(k)}};
globalThis.window={scrollY:0,innerHeight:932,addEventListener(){},removeEventListener(){},scrollTo(){}};
const hook={slots:[],at:0,effects:[],layoutEffects:[]};globalThis.__sptGestureHooks=hook;
const runtime=`const h=globalThis.__sptGestureHooks;export function useLayoutEffect(fn,deps){const i=h.at++,old=h.slots[i];if(!old||!deps||deps.some((x,j)=>x!==old.deps[j]))h.layoutEffects.push(()=>{old?.clean?.();h.slots[i]={deps,clean:fn()}})}export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useId(){return useRef('gesture-'+h.at).current}export function useEffect(fn,deps){const i=h.at++,old=h.slots[i];if(!old||deps?.some((x,j)=>x!==old.deps[j])){h.effects.push(()=>{old?.clean?.();h.slots[i]={deps,clean:fn()}})}}`;
const bundle=await build({stdin:{contents:"export {SwipeDeleteCard} from './app/swipe-delete-card';export {SwipeObservation} from './app/observation-cards';export {TaskCard,PendingTaskCard,Activities} from './app/classroom-panels';export {QuickWork} from './app/quick-work';export {StudentRoster} from './app/student-roster';export {task} from './lib/classroom'",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime','lucide-react'],plugins:[{name:'isolated-hooks',setup(b){b.onResolve({filter:/components\/ui\//},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Checkbox','Select','SelectContent','SelectItem','SelectTrigger','SelectValue','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription','DialogTrigger'].map(n=>`export const ${n}='${n}';`).join('\n')}));b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));}}]});
writeFileSync('.sites-runtime/gesture-ui-bundle.mjs',bundle.outputFiles[0].text);const ui=await import('../.sites-runtime/gesture-ui-bundle.mjs');
const reset=()=>{for(const s of hook.slots)s?.clean?.();hook.slots=[];hook.effects=[];hook.layoutEffects=[];hook.at=0;listeners.clear()};
const render=(fn,props)=>{hook.at=0;const tree=fn(props);for(const e of hook.layoutEffects.splice(0))e();for(const e of hook.effects.splice(0))e();return tree};
const find=(n,match)=>{if(!n||typeof n!=='object')return null;if(match(n))return n;for(const c of [n.props?.children].flat(Infinity)){const x=find(c,match);if(x)return x}return null};
const byClass=(tree,name)=>find(tree,n=>n.props?.className?.split(' ').includes(name));
const target={clientWidth:340,setPointerCapture(){this.captured=true},hasPointerCapture(){return !!this.captured},captured:false};
const event=(x,y=20,tag='surface')=>({button:0,isPrimary:true,pointerId:1,clientX:x,clientY:y,currentTarget:target,target:{closest:s=>s.includes(tag)?{}:null}});
const base={label:'합성 활동',revision:'revision-A',heading:'합성 활동',onDelete(){}};
const tick=()=>new Promise(setImmediate);
await test('left swipe reveals trash; long release deletes once; vertical, short and cancelled gestures do not delete',async()=>{
 for(const kind of ['long','vertical','cancel','short','reverse']){reset();let deletes=0;const props={...base,onDelete:()=>{deletes++}};let face=byClass(render(ui.SwipeDeleteCard,props),'swipe-face');face.props.onPointerDown(event(330));
  if(kind==='vertical')face.props.onPointerMove(event(329,80));face.props.onPointerMove(event(kind==='short'?260:80,kind==='vertical'?82:20));if(kind==='cancel')face.props.onPointerCancel(event(80));if(kind==='reverse')face.props.onPointerMove(event(325));face.props.onPointerUp(event(kind==='short'?260:kind==='reverse'?325:80,kind==='vertical'?82:20));face.props.onPointerUp(event(80));assert.equal(deletes,kind==='long'?1:0);
  if(kind==='short'){const tree=render(ui.SwipeDeleteCard,props);assert.equal(byClass(tree,'swipe-delete').props.hidden,false);assert.equal(byClass(tree,'swipe-delete').props['aria-label'],'합성 활동 카드 삭제');assert.equal(byClass(tree,'swipe-handle').props['aria-expanded'],true)}await tick();
 }
});
await test('remote revision, local form change, disabled state and unmount invalidate a pending swipe',()=>{
 for(const scenario of ['revision','local','disabled','unmount']){reset();let count=0;const props={...base,onDelete:()=>count++};let face=byClass(render(ui.SwipeDeleteCard,props),'swipe-face');face.props.onPointerDown(event(330));face.props.onPointerMove(event(80));
  if(scenario==='unmount')reset();else face=byClass(render(ui.SwipeDeleteCard,{...props,revision:scenario==='revision'||scenario==='local'?props.revision+'changed':props.revision,disabled:scenario==='disabled'}),'swipe-face');face.props.onPointerUp(event(80));assert.equal(count,0);
 }
});
await test('implicit child capture transfer does not cancel the parent swipe',async()=>{
 for(const ownLoss of [false,true]){reset();let deletes=0;const props={...base,onDelete:()=>deletes++},face=byClass(render(ui.SwipeDeleteCard,props),'swipe-face');face.props.onPointerDown(event(330));face.props.onPointerMove(event(80));face.props.onLostPointerCapture({target:ownLoss?target:{},currentTarget:target});face.props.onPointerUp(event(80));await tick();assert.equal(deletes,ownLoss?0:1);}
});
await test('optional heading activation opens content without nesting controls or deleting',()=>{
 reset();let opens=0,deletes=0;const props={...base,onActivate:()=>opens++,activationLabel:'Open activity',onDelete:()=>deletes++};
 const tree=render(ui.SwipeDeleteCard,props),handle=byClass(tree,'swipe-handle');handle.props.onClick({detail:1});
 assert.equal(opens,1);assert.equal(deletes,0);assert.equal(byClass(render(ui.SwipeDeleteCard,props),'swipe-delete').props.hidden,true);
});
await test('input, text selection, state buttons, selects and details cannot begin deletion',()=>{
 for(const tag of ['input','textarea','select','summary','a','button','contenteditable=true']){reset();let count=0;const props={...base,onDelete:()=>count++};const face=byClass(render(ui.SwipeDeleteCard,props),'swipe-face');face.props.onPointerDown(event(330,20,tag));face.props.onPointerMove(event(80));face.props.onPointerUp(event(80));assert.equal(count,0,tag)}
});
await test('gesture release suppresses accidental click; keyboard reveal and Escape preserve accessible alternatives',async()=>{
 reset();let count=0;const props={...base,onDelete:()=>count++};let tree=render(ui.SwipeDeleteCard,props),face=byClass(tree,'swipe-face');face.props.onPointerDown(event(330));face.props.onPointerMove(event(260));face.props.onPointerUp(event(260));let prevented=0;face.props.onClickCapture({detail:1,preventDefault(){prevented++},stopPropagation(){}});assert.equal(prevented,1);assert.equal(count,0);
 tree=render(ui.SwipeDeleteCard,props);tree.props.onKeyDown({key:'Escape',preventDefault(){},stopPropagation(){}});tree=render(ui.SwipeDeleteCard,props);assert.equal(byClass(tree,'swipe-handle').props['aria-expanded'],false);
 byClass(tree,'swipe-handle').props.onKeyDown({key:'Delete',preventDefault(){}});tree=render(ui.SwipeDeleteCard,props);let focused=false;byClass(tree,'swipe-delete').props.ref.current={focus(){focused=true}};await new Promise(r=>setTimeout(r,1));assert.equal(focused,true);assert.equal(count,0);assert.equal(byClass(tree,'swipe-delete').props.tabIndex,0);
 listeners.get('pointerdown')?.({target:{}});tree=render(ui.SwipeDeleteCard,props);assert.equal(byClass(tree,'swipe-delete').props.hidden,true);
});
await test('scroll then first control tap works, and leaving with no capture cancels stale mouse coordinates',()=>{
 for(const mode of ['scroll','cancel','leave']){reset();target.captured=false;let count=0;const props={...base,onDelete:()=>count++};const face=byClass(render(ui.SwipeDeleteCard,props),'swipe-face');face.props.onPointerDown(event(330));if(mode==='leave')face.props.onPointerLeave(event(350));else{face.props.onPointerMove(event(329,90));if(mode==='cancel')face.props.onPointerCancel(event(329,90));else face.props.onPointerUp(event(329,90));}
  face.props.onPointerDown(event(250,90,'button'));face.props.onPointerUp(event(30,90,'button'));let prevented=0;face.props.onClickCapture({detail:1,target:{closest:()=>null},preventDefault(){prevented++},stopPropagation(){}});assert.equal(prevented,0,mode);assert.equal(count,0,mode);
 }
});
await test('delete/restore serialize clicks and expose recoverable content without removing its subtree',async()=>{
 reset();let release,count=0;const props={...base,children:{type:'details',props:{open:true,children:'unsaved note'}},onDelete:()=>{count++;return new Promise(r=>release=r)}};
 let tree=render(ui.SwipeDeleteCard,props);const action=byClass(tree,'swipe-delete');action.props.onClick();action.props.onClick();assert.equal(count,1);tree=render(ui.SwipeDeleteCard,props);assert.equal(tree.props['aria-busy'],true);release();await tick();tree=render(ui.SwipeDeleteCard,{...props,deleted:true,revision:'B'});assert.equal(byClass(tree,'swipe-face').props.hidden,true);assert.equal(find(tree,n=>n.type==='details').props.open,true);assert.equal(byClass(tree,'swipe-restore').props.hidden,false);
});
await test('student and teacher activity deletion/restoration preserve full content and failure rolls back',async()=>{
 for(const lane of ['student','teacher']){reset();const data={...ui.task('합성 활동','2026-09-09'),lane,state:'working',range:'32쪽 1–4번',note:'보존할 메모',timing:{assignedAt:'2026-09-09T10:00:00.000Z',stoppedAt:'',visitedAt:'2026-09-09T10:02:00.000Z',revisitAt:'2026-09-09T10:07:00.000Z'}},event={id:'A',entity_id:'activity-1',class_date:'2026-09-09',body:JSON.stringify(data)};const writes=[];const props={event,all:[event],save:async(...args)=>writes.push(args),fail:e=>{throw e}};
  let tree=render(ui.TaskCard,props);assert.equal(tree.type,ui.SwipeDeleteCard);await tree.props.onDelete();tree=render(ui.TaskCard,props);assert.equal(tree.props.deleted,true);assert.ok(find(tree,n=>n.type==='details'));assert.deepEqual(writes[0].slice(0,2),['activity','activity-1']);assert.deepEqual(writes[0][2],{...data,cancelled:true});assert.equal(writes[0][4],'A');await tree.props.onRestore();assert.deepEqual(writes[1][2],data);
  tree=render(ui.TaskCard,{...props,save:async()=>{throw new Error('quota')}});await assert.rejects(tree.props.onDelete(),/quota/);tree=render(ui.TaskCard,props);assert.equal(tree.props.deleted,false);
 }
});
await test('previous work keeps deleted rows available for restoration; observation uses the same primitive',async()=>{
 reset();const data={...ui.task('합성 이전 활동','2026-09-08'),cancelled:true},event={id:'A',entity_id:'past-1',student_id:'S004',kind:'activity',class_date:'2026-09-08',body:JSON.stringify(data)};const props={studentId:'S004',date:'2026-09-09',ledger:[event],save:async()=>{},fail:e=>{throw e}};const tree=render(ui.Activities,props);assert.ok(find(tree,n=>n.type===ui.PendingTaskCard));
 reset();const past=render(ui.PendingTaskCard,{event,date:props.date,save:props.save,fail:props.fail});assert.equal(past.type,ui.SwipeDeleteCard);assert.equal(past.props.deleted,true);
 const row={entry:{id:'obs-A'},card:{cardId:'c-A',category:'observed',text:'합성 관찰',scene:{activity:'합성',range:''},deleted:false}};assert.equal(ui.SwipeObservation({row,highlighted:false,disabled:false,remove(){}}).type,ui.SwipeDeleteCard);
});
await test('activity gestures declare discrete events while narrative edits remain drafts',async()=>{
 reset();const data=ui.task('SYNTHETIC EVENT MODE','2026-09-09'),event={id:'base-A',entity_id:'activity-A',student_id:'S004',class_date:'2026-09-09',body:JSON.stringify(data)},writes=[];
 const props={event,all:[event],save:async(...args)=>{writes.push(args)},fail:e=>{throw e}};let tree=render(ui.TaskCard,props);
 find(tree,n=>n.type==='button'&&[n.props.children].flat(Infinity).includes('진행')).props.onClick();await tick();assert.equal(writes.at(-1)[5],'event');assert.equal(writes.at(-1)[2].state,'working');
 tree=render(ui.TaskCard,props);find(tree,n=>n.props?.label==='활동 메모').props.onChange('synthetic draft text');await tick();assert.equal(writes.at(-1)[5],'draft');
 tree=render(ui.TaskCard,props);find(tree,n=>n.props?.onChange&&[n.props.children].flat(Infinity).includes('개념서')).props.onChange(true);await tick();assert.equal(writes.at(-1)[5],'event');
 tree=render(ui.TaskCard,props);await tree.props.onDelete();assert.equal(writes.at(-1)[5],'event');
 reset();const assigned=[];tree=render(ui.Activities,{studentId:'S004',date:'2026-09-09',ledger:[],save:async(...args)=>{assigned.push(args)},fail:e=>{throw e}});
 find(tree,n=>n.type==='button'&&[n.props.children].flat(Infinity).includes('DT')).props.onClick();await tick();assert.equal(assigned[0][5],'event');
});
await test('QuickWork forwards event intent without changing the target student',async()=>{
 reset();const roster=['A','B'].map(id=>({id:'QA_'+id,name:'Synthetic '+id,days:[1],part:'1부',time:'15:00–17:30',firstDate:'2026-09-01',books:[]})),writes=[];
 const props={current:roster[0],date:'2026-09-14',students:roster,ledger:[],ready:true,save:async(...args)=>{writes.push(args)}};
 let tree=render(ui.QuickWork,props);tree.props.onOpenChange(true);tree=render(ui.QuickWork,props);find(tree,n=>n.type===ui.StudentRoster).props.onChoose(roster[1].id);tree=render(ui.QuickWork,props);
 await find(tree,n=>n.type===ui.Activities).props.save('activity','synthetic-id',{state:'working'},props.date,'base-id','event');
 assert.equal(writes[0][0],roster[1].id);assert.equal(writes[0][6],'event');
});
reset();
