import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync,mkdirSync} from 'node:fs';
const built=await build({stdin:{contents:"export * from './lib/classroom';export * from './lib/curriculum';export * from './lib/diary-draft';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
mkdirSync('.sites-runtime/curriculum-delivery-20260914',{recursive:true});
writeFileSync('.sites-runtime/curriculum-delivery-20260914/domain-test.mjs',built.outputFiles[0].text);
const domain=await import('../.sites-runtime/curriculum-delivery-20260914/domain-test.mjs');
const scope={bookId:'BOOK_QA',catalogRevision:'SYNTHETIC_REV',bookLabel:'초5-2 · 가우스 · 본교재 · 2권',unitIds:['U2','U4'],unitLabels:['4. 소수의 곱셈 / 4-2. 범위 A','4. 소수의 곱셈 / 4-4. 범위 B'],notation:'4-2, 4-4',startKnowledge:'known',startPage:null,endPage:null,detail:''};
test('activity validation retains source-bound disjoint scope without filling omitted units',()=>{
 const got=domain.validateClass('activity',{...domain.task('DT','2040-01-01'),scope,range:'4-2, 4-4'},'2040-01-01');
 assert.deepEqual(got.scope,scope);assert.equal(got.state,'assigned');
});
test('public diary is retained separately from private follow-up and legacy measured assessment',()=>{
 const diary={progress:'개념백지·Clinic·DT: 4-2, 4-4',homework:'없음',classMemo:''};
 const got=domain.validateClass('closeout',{...domain.blankCloseout,progress:'Internal full scope',noHomework:true,next:'PRIVATE must not be copied',diary},'2040-01-01');
 assert.deepEqual(got.diary,diary);assert.equal(got.next,'PRIVATE must not be copied');
});
test('overlength public output blocks confirmation instead of silent truncation',()=>{
 assert.throws(()=>domain.validateClass('closeout',{...domain.blankCloseout,progress:'Reviewed internal',noHomework:true,confirmed:true,diary:{progress:'가'.repeat(201),homework:'없음',classMemo:''}},'2040-01-01'),/200/);
});

test('same printed topic number retains its chapter context in the public range',()=>{
 const v={...scope,bookLabel:'중1-1 · 가우스 · 본교재 · 2권',unitIds:['III-6','III-7'],unitLabels:['Ⅲ. 방정식 / 02. 일차방정식의 풀이 / 6. 일차방정식의 풀이','Ⅲ. 방정식 / 02. 일차방정식의 풀이 / 7. 해의 응용'],notation:'6, 7'};
 assert.match(domain.scopeText(v),/Ⅲ\. 방정식/);
});
test('grouped draft retains disjoint scope and separate activity states without private memo leakage',()=>{
 const ledger=['개념백지테스트','클리닉','DT'].map((title,i)=>({id:'source-'+i,student_id:'QA_A',class_date:'2040-01-01',kind:'activity',body:JSON.stringify({...domain.task(title,'2040-01-01'),scope,range:'초5-2 가우스 2권 4-2, 4-4',state:i===0?'done':i===1?'working':'assigned',note:'PRIVATE OBSERVATION'})}));
 const got=domain.makeDiaryDraft('QA_A','2040-01-01',ledger);assert.equal(got.blocks.length,1);assert.equal(got.text.split('4-2, 4-4').length,2);assert.doesNotMatch(got.text,/4-3|PRIVATE|숙달/);assert.match(got.text,/교사 확인/);assert.match(got.text,/진행/);assert.match(got.text,/배정/);assert.equal(got.needsTeacherReview,true);
});
test('narrower pages and explicitly unknown starts survive formatting and validation',()=>{
 const v={...scope,notation:'약수와 배수 (1)',startPage:42,endPage:47};assert.match(domain.scopeText(v),/42~47/);assert.doesNotMatch(domain.scopeText(v),/49/);
 const unknown={...scope,unitIds:[],unitLabels:[],notation:'~7',startKnowledge:'unknown'};assert.match(domain.scopeText(domain.scopeSchema.parse(unknown)),/~7/);assert.match(domain.scopeText(unknown),/시작 미확정/);
 assert.throws(()=>domain.scopeSchema.parse({...v,startPage:48,endPage:42}));
});
test('catalog selection uses actual assignments and source IDs, and does not derive page completion',()=>{
 const c={revision:'QA_CATALOG',books:[{id:'QA_BOOK',name:'Source label',code:'descriptor',source:'source',version:'1',start:null,end:null,excluded:[]}],units:[{id:'C',bookId:'QA_BOOK',parentId:'',level:1,kind:'CHAPTER',name:'방정식',notation:'Ⅲ',start:null,end:null,order:1,source:'source'},{id:'U',bookId:'QA_BOOK',parentId:'C',level:2,kind:'UNIT',name:'일차방정식',notation:'7',start:42,end:49,order:2,source:'source'}],assignments:[{studentId:'QA_A',bookId:'QA_BOOK',slot:1}]};
 const parsed=domain.catalogFromSnapshot({tracker:{resolvedCatalog:c}});assert.ok(parsed);const v=domain.makeScope(parsed,'QA_A','QA_BOOK',['U']);assert.equal(v.startPage,null);assert.equal(v.endPage,null);assert.deepEqual(v.unitIds,['U']);
 assert.throws(()=>domain.makeScope(parsed,'QA_B','QA_BOOK',['U']));assert.throws(()=>domain.assertScopeCurrent({...v,catalogRevision:'OLD'},parsed,'QA_A'));assert.throws(()=>domain.assertScopeCurrent({...v,unitLabels:['invented source']},parsed,'QA_A'));
 assert.equal(domain.catalogFromSnapshot({tracker:{resolvedCatalog:{...c,units:[{...c.units[0],parentId:'C'}]}}}),null);
});
