// Synthetic board interaction only: no provider, persisted record, or microphone.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';

const hooks={slots:[],at:0};
globalThis.__phoneBoardHooks=hooks;
const runtime=`const h=globalThis.__phoneBoardHooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(){}export function useLayoutEffect(fn){fn()}export function useId(){return useRef('phone-'+h.at).current}`;
const built=await build({stdin:{contents:"export {ClassroomBoard,StudentCycleCard} from './app/classroom-board';export {task,entity} from './lib/classroom';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime','lucide-react'],plugins:[{name:'isolated-phone-board-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));b.onResolve({filter:/components\/ui\//},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Checkbox','Select','SelectContent','SelectItem','SelectTrigger','SelectValue','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(n=>`export const ${n}='${n}';`).join('\n')}));}}]});
writeFileSync('.sites-runtime/phone-board-jump-test.mjs',built.outputFiles[0].text);
const ui=await import('../.sites-runtime/phone-board-jump-test.mjs');
const render=(fn,props)=>{hooks.at=0;return fn(props)};
function nodes(node,match,out=[]){if(!node||typeof node!=='object')return out;if(match(node))out.push(node);for(const child of [node.props?.children].flat(Infinity))nodes(child,match,out);return out}
function fixture(count){
 const students=Array.from({length:count},(_,i)=>({id:`QA_S${String(i+1).padStart(2,'0')}`,name:`Synthetic ${i+1}`,days:[1],part:'1부',time:'15:00–17:30',firstDate:'2026-01-01',books:['Synthetic book']}));
 const ledger=[],writes=[],opens=[];
 const props={students,date:'2026-09-14',ledger,data:{ledger,sessions:[],events:[],captures:[],connected:false,roster:students},selected:students[0]?.id||'',ready:true,view:'class',save:async(...args)=>{writes.push(args);throw new Error('Jumping must not save');},onOpen:(...args)=>opens.push(args),onAudio(){},fail:e=>{throw e}};
 return {props,ledger,writes,opens};
}
const jumpButtons=tree=>nodes(tree,n=>n.type==='button'&&n.props?.['aria-controls']?.startsWith('classroom-student-'));

await test('six and twelve student boards keep card order and expose explicit jump targets with live cues',()=>{
 for(const count of [6,12]){
  hooks.slots=[];const {props,ledger,writes,opens}=fixture(count);
  ledger.push({id:'activity-rev',entity_id:'synthetic-activity',kind:'activity',student_id:props.students[1].id,class_date:props.date,body:JSON.stringify({...ui.task('Synthetic work',props.date),state:'student_done'})});
  ledger.push({id:'status-rev',entity_id:ui.entity('class_status',props.students[2].id,props.date),kind:'class_status',student_id:props.students[2].id,class_date:props.date,body:JSON.stringify({instructionAt:'',departedAt:'2026-09-14T08:00:00.000Z'})});
  const tree=render(ui.ClassroomBoard,props),rail=nodes(tree,n=>n.type==='nav'&&n.props?.['aria-label']==='학생 카드로 이동')[0],buttons=jumpButtons(tree),cards=nodes(tree,n=>n.type===ui.StudentCycleCard);
  assert.ok(rail,'A six-plus class has a named jump landmark');
  const markup=renderToStaticMarkup(rail);
  assert.match(markup,/aria-label="학생 카드로 이동"/);
  assert.equal((markup.match(/aria-controls="classroom-student-/g)||[]).length,count,'Every jump control has an explicit DOM target');
  assert.deepEqual(buttons.map(b=>b.props['aria-controls']),props.students.map(s=>'classroom-student-'+s.id));
  assert.deepEqual(cards.map(c=>c.props.student.id),props.students.map(s=>s.id),'The existing card order stays stable');
  assert.match(buttons[1].props['aria-label'],/Synthetic 2 학생 카드로 이동.*확인할 일 1건/);
  assert.match(buttons[1].props.className,/has-needs/);
  assert.match(buttons[2].props['aria-label'],/귀가 기록/);
  hooks.slots=[];const card=render(ui.StudentCycleCard,cards.at(-1).props);
  assert.equal(card.type,'article');assert.equal(card.props.id,buttons.at(-1).props['aria-controls']);assert.equal(card.props.tabIndex,-1);
  assert.equal(writes.length,0);assert.equal(opens.length,0);
 }
});

await test('jump scrolls and focuses the chosen card, with reduced motion respected and no writes',()=>{
 hooks.slots=[];const {props,writes,opens}=fixture(12),tree=render(ui.ClassroomBoard,props),buttons=jumpButtons(tree),actions=[];
 const originalDocument=globalThis.document,originalWindow=globalThis.window,originalFetch=globalThis.fetch;
 globalThis.document={getElementById:id=>({scrollIntoView:options=>actions.push({id,options}),focus:options=>actions.push({id,focus:options})})};
 globalThis.window={matchMedia:()=>({matches:false})};
 globalThis.fetch=()=>{throw new Error('Jumping must not fetch')};
 try{
  buttons[11].props.onClick();
  assert.deepEqual(actions,[{id:'classroom-student-QA_S12',options:{behavior:'smooth',block:'start'}},{id:'classroom-student-QA_S12',focus:{preventScroll:true}}]);
  actions.length=0;globalThis.window.matchMedia=()=>({matches:true});buttons[5].props.onClick();
  assert.deepEqual(actions[0],{id:'classroom-student-QA_S06',options:{behavior:'auto',block:'start'}});
  assert.equal(writes.length,0);assert.equal(opens.length,0);
 }finally{globalThis.document=originalDocument;globalThis.window=originalWindow;globalThis.fetch=originalFetch}
});

await test('small and after-class boards omit the phone jump rail',()=>{
 for(const [count,view] of [[5,'class'],[12,'after']]){
  hooks.slots=[];const {props}=fixture(count);props.view=view;
  assert.equal(jumpButtons(render(ui.ClassroomBoard,props)).length,0);
 }
});
