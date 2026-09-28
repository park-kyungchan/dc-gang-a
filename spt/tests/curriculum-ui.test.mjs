// Real component callbacks; explicitly isolated hooks/transport, no source writes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,mkdirSync} from 'node:fs';
const h={slots:[],at:0};globalThis.__curriculumHooks=h;
const runtime=`const h=globalThis.__curriculumHooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(){}export function useLayoutEffect(fn){fn()}export function useId(){return useRef('ui-'+h.at).current}`;
const built=await build({stdin:{contents:"export {ClassroomBoard,StudentCycleCard} from './app/classroom-board';export {Activities,CloseoutPanel} from './app/classroom-panels';export {CurriculumAssignment} from './app/curriculum-picker';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime','lucide-react'],plugins:[{name:'hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));b.onResolve({filter:/components\/ui\//},a=>({path:a.path,namespace:'ui'}));b.onLoad({filter:/.*/,namespace:'ui'},()=>({contents:['Checkbox','Select','SelectContent','SelectItem','SelectTrigger','SelectValue','Dialog','DialogContent','DialogHeader','DialogTitle','DialogDescription'].map(n=>`export const ${n}='${n}';`).join('\n')}));}}]});
mkdirSync('.sites-runtime/curriculum-delivery-20260914',{recursive:true});
writeFileSync('.sites-runtime/curriculum-delivery-20260914/ui-test.mjs',built.outputFiles[0].text);
const ui=await import('../.sites-runtime/curriculum-delivery-20260914/ui-test.mjs');
const render=(fn,p)=>{h.at=0;return fn(p);};
const find=(n,f)=>{if(!n||typeof n!=='object')return null;if(f(n))return n;for(const child of [n.props?.children].flat(Infinity)){const found=find(child,f);if(found)return found;}return null;};
const catalog={revision:'QA_REV',books:[{id:'BOOK_A',name:'Synthetic book',code:'descriptor-not-publisher-code',source:'Synthetic source',version:'1',start:null,end:null,excluded:[]}],units:[],assignments:[{studentId:'QA_A',bookId:'BOOK_A',slot:1}]};
const scope={bookId:'BOOK_A',catalogRevision:'QA_REV',bookLabel:'Synthetic book',unitIds:[],unitLabels:[],notation:'~7',startKnowledge:'unknown',startPage:null,endPage:null,detail:''};
const students=['A','B'].map(id=>({id:'QA_'+id,name:'Synthetic '+id,books:[],days:[1],part:'1부',time:'15:00',firstDate:'2040-01-01'}));
const p={students,date:'2040-01-02',ledger:[],data:{ledger:[],sessions:[],events:[],captures:[],connected:true,sheet:{snapshot:{tracker:{resolvedCatalog:catalog}}}},selected:'QA_A',ready:true,view:'class',onOpen(){},onAudio(){},fail:e=>{throw e;}};
test('whole-class assignment reaches the shared source picker and pins the initiating student/date',async()=>{
 h.slots=[];const writes=[];const props={...p,save:async(...args)=>{writes.push(args);return {id:'SAVED'};}};
 let tree=render(ui.ClassroomBoard,props);find(tree,n=>n.type===ui.StudentCycleCard).props.onAssign();tree=render(ui.ClassroomBoard,props);
 const picker=find(tree,n=>n.type===ui.CurriculumAssignment);assert.ok(picker,'whole-class assignment must expose the actual source picker');
 assert.equal(picker.props.studentId,'QA_A');assert.equal(picker.props.date,'2040-01-02');
 props.selected='QA_B';await picker.props.assign('DT',scope,'caee1aa1-7561-429c-b21f-1b4994f791aa');assert.equal(writes[0][0],'QA_A');assert.equal(writes[0][4],'2040-01-02');assert.deepEqual(writes[0][3].scope,scope);assert.equal(writes[0][3].state,'assigned');
});
test('student detail also consumes the same picker rather than an incompatible second scope editor',()=>{
 h.slots=[];const tree=render(ui.Activities,{studentId:'QA_A',date:p.date,ledger:[],save:async()=>{},fail:p.fail,catalog});assert.ok(find(tree,n=>n.type===ui.CurriculumAssignment));
});
test('public diary editor is separate and starts a reviewable draft, not an external write',()=>{
 h.slots=[];const writes=[];const tree=render(ui.CloseoutPanel,{studentId:'QA_A',date:p.date,ledger:[],data:p.data,save:async(...args)=>writes.push(args),fail:p.fail,copy(){}});
 assert.ok(find(tree,n=>n.type==='button'&&n.props.children==='활동으로 200자 일지 초안'));assert.equal(writes.length,0);
});
test('public textarea edits preserve the supported CRLF producer representation',()=>{
 h.slots=[];const writes=[];const tree=render(ui.CloseoutPanel,{studentId:'QA_A',date:p.date,ledger:[],data:p.data,save:async(...args)=>writes.push(args),fail:p.fail,copy(){}});
 find(tree,n=>n.props?.label==='학원 공개 메모 (선택)').props.onChange('첫 줄\n둘째 줄');
 assert.equal(writes[0][2].diary.classMemo,'첫 줄\r\n둘째 줄');assert.equal(writes[0][2].confirmed,false);
});
test('whole-class post-assignment scope control targets an existing activity, never a new assignment',async()=>{
 h.slots=[];const event={id:'22111111-1111-4111-8111-111111111111',entity_id:'33111111-1111-4111-8111-111111111111',student_id:'QA_A',class_date:p.date,kind:'activity',body:JSON.stringify({title:'DT',lane:'student',state:'working',workDate:p.date,range:'',note:'',attempted:'',marked:'',corrected:'',unresolved:'',materials:[],inspectedAt:'',feedbackAt:'',prerequisite:'',relation:'independent',overrideReason:''})};
 const writes=[],props={...p,ledger:[event],data:{...p.data,ledger:[event]},save:async(...args)=>{writes.push(args);return {id:'SAVED'};}};
 let tree=render(ui.ClassroomBoard,props);const card=find(tree,n=>n.type===ui.StudentCycleCard);assert.equal(typeof card.props.onScope,'function','existing activities need a direct scope affordance');card.props.onScope(event);tree=render(ui.ClassroomBoard,props);
 const editor=find(tree,n=>n.props?.event?.entity_id===event.entity_id&&typeof n.props.onApply==='function');assert.ok(editor,'scope editor must receive the original event');assert.equal(editor.props.studentId,'QA_A');assert.equal(editor.props.date,p.date);assert.equal(writes.length,0);
 props.selected='QA_B';render(ui.ClassroomBoard,props);await editor.props.onApply({activityId:event.entity_id,baseRevisionId:event.id,scope},catalog);
 assert.equal(writes[0][0],'QA_A');assert.equal(writes[0][1],'activity');assert.equal(writes[0][2],event.entity_id);assert.equal(writes[0][4],event.class_date);assert.equal(writes[0][5],event.id);assert.equal(writes[0][6],'event');assert.equal(writes[0][3].state,'working');
 props.ledger=[{...event,id:'44111111-1111-4111-8111-111111111111'}];props.data={...props.data,ledger:props.ledger};render(ui.ClassroomBoard,props);await assert.rejects(editor.props.onApply({activityId:event.entity_id,baseRevisionId:event.id,scope},catalog),/다른 수정/);assert.equal(writes.length,1);
});
test('detail and QuickWork Activities reach the same original-event scope editor',async()=>{
 h.slots=[];const event={id:'55111111-1111-4111-8111-111111111111',entity_id:'66111111-1111-4111-8111-111111111111',student_id:'QA_A',class_date:'2039-12-31',kind:'activity',body:JSON.stringify({title:'DT',lane:'student',state:'working',workDate:p.date,range:'',cancelled:false})};
 const writes=[],props={studentId:'QA_A',date:p.date,ledger:[event],catalog,compact:true,save:async(...args)=>writes.push(args),fail:p.fail};
 let tree=render(ui.Activities,props);find(tree,n=>n.props?.event?.id===event.id&&typeof n.props.onScope==='function').props.onScope();tree=render(ui.Activities,props);
 const editor=find(tree,n=>n.props?.event?.id===event.id&&typeof n.props.onApply==='function');assert.ok(editor);await editor.props.onApply({activityId:event.entity_id,baseRevisionId:event.id,scope},catalog);assert.equal(writes[0][0],'activity');assert.equal(writes[0][1],event.entity_id);assert.equal(writes[0][3],event.class_date);assert.equal(writes[0][4],event.id);assert.equal(writes[0][5],'event');
});
