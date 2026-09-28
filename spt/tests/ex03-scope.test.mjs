// EX-03: actual product components and domain callbacks, synthetic isolated hooks.
// No browser/layout, production fetch, external sync or provider calls are claimed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const hooks={slots:[],at:0};globalThis.__ex03Hooks=hooks;
globalThis.fetch=()=>{throw new Error('EX03_NETWORK_FORBIDDEN');};
const runtime=`const h=globalThis.__ex03Hooks;export function useRef(v){const i=h.at++;return h.slots[i]??(h.slots[i]={current:v})}export function useState(v){const i=h.at++;if(!(i in h.slots))h.slots[i]=typeof v==='function'?v():v;return [h.slots[i],v=>{h.slots[i]=typeof v==='function'?v(h.slots[i]):v}]}export function useEffect(){}export function useLayoutEffect(){}export function useId(){return useRef('ex03-'+h.at).current}`;
const built=await build({stdin:{contents:"export {ScopePicker} from './app/scope-picker';export {ActivityScopeEditor} from './app/activity-scope-editor';export {CurriculumAssignment} from './app/curriculum-picker';export * from './lib/curriculum';export * from './lib/activity-scope';export {validateClass,task} from './lib/classroom';export {homeworkDraftSchema,homeworkItemSchema} from './lib/homework';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,external:['react/jsx-runtime'],plugins:[{name:'isolated-hooks',setup(b){b.onResolve({filter:/^react$/},()=>({path:'react',namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},()=>({contents:runtime}));}}]});
mkdirSync('.sites-runtime/ex03-scope',{recursive:true});writeFileSync('.sites-runtime/ex03-scope/ui.mjs',built.outputFiles[0].text);
const ui=await import('../.sites-runtime/ex03-scope/ui.mjs');
const render=(fn,p)=>{hooks.at=0;return fn(p);};
const reset=()=>{hooks.slots=[];hooks.at=0;};
const children=n=>[n?.props?.children].flat(Infinity);
const find=(n,predicate)=>{if(!n||typeof n!=='object')return null;if(predicate(n))return n;for(const child of children(n)){const hit=find(child,predicate);if(hit)return hit;}return null;};
const text=n=>typeof n==='string'||typeof n==='number'?String(n):!n||typeof n!=='object'?'':children(n).map(text).join('');
const button=(tree,label)=>find(tree,n=>n.type==='button'&&text(n)===label);
const field=(tree,label)=>find(tree,n=>n.type==='input'&&n.props['aria-label']===label);
const date='2040-01-02',student='S001';
const catalog={revision:'EX03_SYNTHETIC_R1',books:[{id:'DAV',name:'다빈치',code:'D',source:'SYNTHETIC',version:'1',start:1,end:100,excluded:[]},{id:'GAUSS3',name:'가우스 3권',code:'G3',source:'SYNTHETIC',version:'1',start:1,end:100,excluded:[]}],units:[],assignments:[{studentId:student,bookId:'DAV',slot:1},{studentId:student,bookId:'GAUSS3',slot:2}]};
const inherited=()=>({...ui.makeScope(catalog,student,'DAV',[]),pageRanges:[{start:42,end:44}],excludedPages:[43]});
const conflict=()=>({...ui.makeScope(catalog,student,'GAUSS3',[]),pageRanges:[{start:50,end:59}],excludedPages:[43]});
const event=()=>({id:randomUUID(),entity_id:randomUUID(),student_id:student,class_date:'2039-12-31',kind:'activity',body:JSON.stringify({...ui.task('DT',date),scope:{...ui.makeScope(catalog,student,'DAV',[]),pageRanges:[{start:41,end:44}]},range:'다빈치 p.41~44',state:'working',attempted:'synthetic performed fact',timing:{assignedAt:'2040-01-02T01:00:00Z',stoppedAt:'',visitedAt:'',revisitAt:''}})});

// These are asserted against the pre-change candidate first, not against generated PASS flags.
test('book-only selection preserves numeric ranges and exclusions without applying',()=>{
 reset();let scope=inherited(),changes=0;
 const tree=render(ui.ScopePicker,{studentId:student,catalog,scope,onChange:next=>{scope=next;changes++;}});
 find(tree,n=>n.type==='select').props.onChange({target:{value:'GAUSS3'}});
 assert.equal(changes,1);assert.equal(scope.bookId,'GAUSS3');assert.equal(scope.bookLabel,'가우스 3권');
 assert.deepEqual(scope.pageRanges,[{start:42,end:44}]);assert.deepEqual(scope.excludedPages,[43]);
});
test('numeric-first endpoints retain exclusion43 through the exact 50–59 transition',()=>{
 reset();let scope={...inherited(),bookId:'GAUSS3',bookLabel:'가우스 3권'};
 const props=()=>({studentId:student,catalog,scope,onChange:next=>{scope=next;}});
 let tree=render(ui.ScopePicker,props());
 const primary=find(tree,n=>n.props?.className==='scope-numeric');assert.ok(primary,'primary numeric controls, not only a legacy detail disclosure');
 field(tree,'실제 시작 페이지').props.onChange({target:{value:'50'}});tree=render(ui.ScopePicker,props());field(tree,'실제 끝 페이지').props.onChange({target:{value:'59'}});
 assert.deepEqual(scope.excludedPages,[43]);assert.equal(scope.startPage,50);assert.equal(scope.endPage,59);
 tree=render(ui.ScopePicker,props());assert.match(text(tree),/가우스 3권의 쪽수/);assert.match(text(tree),/50–59쪽/);assert.match(text(tree),/43/);assert.match(text(tree),/범위 밖/);
});
test('invalid exclusion is retained as a draft but remains invalid as committed activity/homework',()=>{
 const e=event(),draft={activityId:e.entity_id,baseRevisionId:e.id,scope:conflict()};
 const other={activityId:randomUUID(),baseRevisionId:randomUUID(),scope:null};
 const value={titles:['DT'],activityScopeDrafts:[draft,other],scopeDraft:{scope:conflict(),activities:['DT']},homeworkDraft:{items:[],due:'',noHomework:false,scope:conflict(),actions:[]}};
 const retained=ui.validateClass('plan',value,date);assert.deepEqual(retained,value);
 assert.throws(()=>ui.scopeSchema.parse(conflict()),{name:'ZodError'});
 assert.throws(()=>ui.homeworkItemSchema.parse({id:randomUUID(),scope:conflict(),actions:['문제 풀이']}),{name:'ZodError'});
 assert.throws(()=>ui.applyActivityScope(e,draft,student,date,catalog),/43|제외/);
 assert.deepEqual(ui.mergeActivityScopeDraft({activityScopeDrafts:[other]},e.entity_id,draft).activityScopeDrafts,[other,draft]);
});
test('manual exclusion removal keeps other exclusions and clears the relevant conflict',()=>{
 reset();let scope={...conflict(),excludedPages:[43,52]};
 const props=()=>({studentId:student,catalog,scope,onChange:next=>{scope=next;}});
 let tree=render(ui.ScopePicker,props());const remove=find(tree,n=>n.type==='button'&&n.props['aria-label']==='제외 43쪽 지우기');assert.ok(remove,'out-of-range exclusion must remain directly correctable');remove.props.onClick();
 assert.deepEqual(scope.excludedPages,[52]);assert.equal(ui.scopeSchema.safeParse(scope).success,true);
 tree=render(ui.ScopePicker,props());assert.doesNotMatch(text(tree),/범위 밖/);
});
test('grid replacement also retains exclusions rather than silently filtering them',()=>{
 reset();let scope=inherited();const props=()=>({studentId:student,catalog,scope,onChange:next=>{scope=next;}});
 let tree=render(ui.ScopePicker,props());find(tree,n=>n.props?.['aria-label']==='50쪽').props.onClick();tree=render(ui.ScopePicker,props());find(tree,n=>n.props?.['aria-label']==='59쪽').props.onClick();
 assert.deepEqual(scope.pageRanges,[{start:50,end:59}]);assert.deepEqual(scope.excludedPages,[43]);
});
test('multi-range and explicit unknown-start scopes survive book changes',()=>{
 for(const input of [{...inherited(),pageRanges:[{start:42,end:44},{start:50,end:55}]},{...inherited(),pageRanges:undefined,excludedPages:[],startPage:null,endPage:59,startKnowledge:'unknown'}]){
  reset();let scope=input;const tree=render(ui.ScopePicker,{studentId:student,catalog,scope,onChange:next=>{scope=next;}});find(tree,n=>n.type==='select').props.onChange({target:{value:'GAUSS3'}});
  for(const key of ['pageRanges','excludedPages','startPage','endPage','startKnowledge'])assert.deepEqual(scope[key],input[key]);
 }
});
test('the accepted 50–55 heading/summary is explicit, without changing the existing apply label',()=>{
 reset();const scope={...ui.makeScope(catalog,student,'GAUSS3',[]),pageRanges:[{start:50,end:55}]};
 const tree=render(ui.ScopePicker,{studentId:student,catalog,scope,onChange(){}});assert.match(text(tree),/가우스 3권의 쪽수/);assert.match(text(tree),/가우스 3권 · 50–55쪽 · 적용 전/);
});
test('editor exposes the specific conflict; incomplete and valid-unapplied drafts are distinct',()=>{
 const e=event();
 for(const [scope,state] of [[null,'incomplete'],[conflict(),'invalid'],[{...conflict(),excludedPages:[]},'ready']]){
  reset();const tree=render(ui.ActivityScopeEditor,{event:e,studentId:student,date,catalog,draft:{activityId:e.entity_id,baseRevisionId:e.id,scope},retain:async()=>{},onApply:async()=>{},onDone(){},fail:error=>{throw error;}});
  const message=find(tree,n=>n.props?.['data-scope-state']===state);assert.ok(message,'explicit '+state+' feedback');
  const apply=button(tree,'이 활동에 범위 적용');assert.ok(apply);assert.equal(apply.props.disabled,state!=='ready');
  if(state==='invalid')assert.match(text(message),/43/);
 }
});
test('selection is retained but only separate apply changes the original activity once',async()=>{
 reset();const e=event(),before=JSON.parse(e.body),applied=[],retained=[];let done=0;
 const p={event:e,studentId:student,date,catalog,draft:{activityId:e.entity_id,baseRevisionId:e.id,scope:inherited()},retain:async d=>{if(d)ui.activityScopeDraftSchema.parse(d);retained.push(d);},onApply:async(d,c)=>{applied.push(ui.applyActivityScope(e,d,student,date,c));},onDone(){done++;},fail:error=>{throw error;}};
 let tree=render(ui.ActivityScopeEditor,p);find(tree,n=>n.type===ui.ScopePicker).props.onChange(conflict());await new Promise(r=>setImmediate(r));tree=render(ui.ActivityScopeEditor,p);
 assert.equal(applied.length,0);assert.equal(done,0);assert.deepEqual(retained.at(-1).scope.excludedPages,[43]);assert.deepEqual(JSON.parse(e.body),before);assert.equal(button(tree,'이 활동에 범위 적용').props.disabled,true);
 find(tree,n=>n.type===ui.ScopePicker).props.onChange({...conflict(),excludedPages:[]});await new Promise(r=>setImmediate(r));tree=render(ui.ActivityScopeEditor,p);assert.equal(applied.length,0);assert.equal(button(tree,'이 활동에 범위 적용').props.disabled,false);
 await button(tree,'이 활동에 범위 적용').props.onClick();await new Promise(r=>setImmediate(r));assert.equal(applied.length,1);assert.equal(done,1);assert.equal(retained.at(-1),null);assert.deepEqual(applied[0].timing,before.timing);assert.equal(applied[0].attempted,before.attempted);assert.equal(applied[0].state,'working');assert.equal(applied[0].scope.bookId,'GAUSS3');assert.deepEqual(JSON.parse(e.body),before);
});
test('adjacent assignment consumer rejects the shared invalid draft before dispatch',async()=>{
 reset();const writes=[],failures=[];const p={studentId:student,date,initialCatalog:catalog,draft:{scope:conflict(),activities:['DT']},retain:async()=>{},assign:async(...v)=>writes.push(v),fail:e=>failures.push(e)};
 const tree=render(ui.CurriculumAssignment,p),apply=button(tree,'공통 범위로 1개 활동 배정');assert.ok(apply);assert.equal(apply.props.disabled,true);
 await apply.props.onClick();await new Promise(r=>setImmediate(r));assert.equal(writes.length,0);
});
test('source-bound recent range assistance cannot switch books, reuse a stale catalog or drop exclusions',()=>{
 reset();let scope={...inherited(),pageRanges:[{start:50,end:59}]};
 const applied={...inherited(),pageRanges:[{start:41,end:44}],excludedPages:[]};
 const tree=render(ui.ScopePicker,{studentId:student,catalog,scope,recentScopes:[applied,{...applied,bookId:'GAUSS3',bookLabel:'가우스 3권'},{...applied,catalogRevision:'STALE'}],onChange:next=>{scope=next;}});
 const panel=find(tree,n=>n.props?.['aria-label']==='최근 적용 범위');assert.ok(panel);
 const choices=children(panel).filter(n=>n?.type==='button');assert.equal(choices.length,1);choices[0].props.onClick();
 assert.equal(scope.bookId,'DAV');assert.deepEqual(scope.pageRanges,[{start:41,end:44}]);assert.deepEqual(scope.excludedPages,[43]);assert.equal(ui.scopeDraftFeedback(scope).kind,'ready');
});
test('incomplete numeric input and explicit unknown-start remain different from a corrected valid scope',()=>{
 const base=ui.makeScope(catalog,student,'GAUSS3',[]);
 for(const value of [{...base,startPage:50,endPage:null},{...base,startPage:null,endPage:59}]){assert.equal(ui.scopeDraftFeedback(value).kind,'incomplete');assert.equal(ui.homeworkDraftSchema.safeParse({items:[],due:'',noHomework:false,scope:value,actions:[]}).success,true);}
 assert.equal(ui.scopeDraftFeedback({...base,startPage:null,endPage:59,startKnowledge:'unknown'}).kind,'ready');
 assert.equal(ui.scopeDraftFeedback({...base,startPage:50,endPage:50}).kind,'ready');
 assert.equal(ui.scopeDraftFeedback({...base,startPage:60,endPage:50}).kind,'invalid');
});
