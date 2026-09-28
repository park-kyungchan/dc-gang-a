import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {mkdirSync,writeFileSync} from 'node:fs';
mkdirSync('.sites-runtime/havruta-27b335',{recursive:true});
const built=await build({stdin:{contents:"export * from './lib/classroom';export * from './lib/havruta';export * from './lib/diary-draft';export * from './lib/classroom-view';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});writeFileSync('.sites-runtime/havruta-27b335/test-domain.mjs',built.outputFiles[0].text);const m=await import('../.sites-runtime/havruta-27b335/test-domain.mjs');
const day='2040-01-02',members=['QA_A','QA_B','QA_C'].map(studentId=>({studentId,activityId:randomUUID()})),h={version:1,groupId:randomUUID(),date:day,members,problem:{kind:'teacher_issued'},review:null};
test('new typed Havruta provenance survives the actual activity validator',()=>{const body={...m.task('하브루타',day),havruta:h};assert.deepEqual(m.validateClass('activity',body,day).havruta,h);});
const make=()=>({...m.task('하브루타',day),state:'student_done',havruta:structuredClone(h)});
test('changed displayed range cannot inherit a pass while an old structured scope remains',()=>{
 const t={...make(),range:'Book p.5~8',scope:{bookId:'QA',bookLabel:'Book',catalogRevision:'QA_C1',unitIds:[],unitLabels:[],notation:'',startKnowledge:'known',startPage:5,endPage:8,detail:''}};
 const p={...t,...m.havrutaStatePatch(t,'done')};assert.equal(m.havrutaPassed(p),true);assert.equal(m.havrutaPassed({...p,range:'a different assigned problem'}),false);
});
test('only explicit teacher review passes; stale work context is not currently passed',()=>{
 const waiting=make(),passed={...waiting,...m.havrutaStatePatch(waiting,'done','2040-01-02T01:00:00.000Z')};
 assert.equal(m.havrutaPassed(waiting),false);assert.equal(m.havrutaPassed(passed),true);assert.equal(m.havrutaState(passed),'done');
 assert.equal(m.havrutaState({...passed,range:'changed problem pages'}),'check');assert.equal(m.isOpen({...passed,range:'changed'}),true);assert.equal(m.havrutaPassed({...passed,note:'cosmetic note'}),true);
 assert.equal(m.havrutaPassed({...passed,...m.havrutaStatePatch(passed,'working')}),false);
 assert.equal(m.havrutaState({...m.task('하브루타',day),state:'done'}),'done','legacy title is not new group provenance');
});
test('API domain guard rejects subtype removal, foreign member, manifest mutation and unreviewed done',()=>{
 const a=make();m.assertHavrutaTransition(a,undefined,members[0].studentId,members[0].activityId,day);
 const passed={...a,...m.havrutaStatePatch(a,'done')};m.assertHavrutaTransition(passed,a,members[0].studentId,members[0].activityId,day);
 for(const [next,old,sid,id] of [[{...a,havruta:undefined},a,'QA_A',members[0].activityId],[a,undefined,'OTHER',members[0].activityId],[{...a,havruta:{...h,groupId:randomUUID()}},a,'QA_A',members[0].activityId],[{...a,state:'done'},a,'QA_A',members[0].activityId]])assert.throws(()=>m.assertHavrutaTransition(next,old,sid,id,day),{name:'Error'});
 m.assertHavrutaTransition({...passed,range:'scope correction'},passed,'QA_A',members[0].activityId,day);
 assert.throws(()=>m.assertHavrutaTransition({...a,havruta:h},{...a,havruta:undefined},'QA_A',members[0].activityId,day),/기존/);
});
test('group read model preserves expected missing members and individual decisions',()=>{
 const a=make(),b=make(),passed={...a,...m.havrutaStatePatch(a,'done')};const e=(i,t)=>({id:randomUUID(),entity_id:members[i].activityId,student_id:members[i].studentId,class_date:day,kind:'activity',body:JSON.stringify(t)});
 const groups=m.havrutaGroups([e(0,passed),e(1,b)],day);assert.equal(groups.length,1);assert.equal(groups[0].rows.length,3);assert.equal(groups[0].rows[2].event,undefined);assert.equal(m.havrutaPassed(groups[0].rows[1].task),false);
});
test('reviewed parent projection has issue context without peer identity or an invented page range',()=>{
 const a=make(),passed={...a,...m.havrutaStatePatch(a,'done')},e={id:randomUUID(),entity_id:members[0].activityId,student_id:'QA_A',class_date:day,kind:'activity',body:JSON.stringify(passed)};
 const input=m.parentInputFromClass('QA_A',day,[e],[e.id],{...m.blankCloseout,noHomework:true},'closeout:QA_A:'+day),v=m.previewParentDiary(input);assert.match(v.fields.progress,/교사 통과/);assert.match(v.fields.progress,/상세 범위 미기록/);assert.doesNotMatch(v.fields.progress,/QA_B|QA_C|p\.1|직접 설명|숙달/);assert.equal(v.ready,true);
});
