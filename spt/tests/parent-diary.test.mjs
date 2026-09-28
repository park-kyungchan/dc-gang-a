import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './lib/diary-draft';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const refs=['synthetic:teacher-reviewed'];
const input=()=>({version:'spt.parent-diary.v1',studentId:'QA_A',date:'2040-01-02',progress:[{bookId:'QA_BOOK',bookLabel:'연습 교재',items:[{scope:'p.46~62,65~69',actions:['유형 연습'],results:['일일테스트 1회 100점'],sourceRefs:refs}]}],homework:{none:false,due:'2040-01-04',books:[{bookId:'QA_BOOK',bookLabel:'연습 교재',none:false,items:[{scope:'p.46~69',actions:['개념 예습','예습영상 촬영'],exclusions:['p.63~64 실력쌓기'],sourceRefs:refs}]}]},memos:[{kind:'homework',text:'제외한 문제는 이번 숙제에 포함하지 않습니다.',sourceRefs:refs}]});

test('fixed parent form separates performed work, required homework and memo',()=>{
 const v=api.previewParentDiary(input());
 assert.equal(v.fields.progress,'[연습 교재]\n- p.46~62,65~69: 유형 연습\n- 일일테스트 1회 100점'.replaceAll('\n','\r\n'));
 assert.equal(v.fields.homework,'1/4(수)까지\n[연습 교재]\n- p.46~69: 개념 예습·예습영상 촬영\n- 제외: p.63~64 실력쌓기'.replaceAll('\n','\r\n'));
 assert.equal(v.fields.classMemo,'[숙제 참고] 제외한 문제는 이번 숙제에 포함하지 않습니다.');
 assert.equal(v.ready,true);assert.doesNotMatch(JSON.stringify(v.fields),/synthetic|QA_BOOK|QA_A/);
});
test('one book heading can retain different activity scopes without scope smearing',()=>{
 const v=input();v.progress[0].items.push({scope:'p.52',actions:['설명으로 이해도 점검'],results:[],sourceRefs:refs});
 const text=api.previewParentDiary(v).fields.progress;
 assert.equal(text.split('[연습 교재]').length,2);assert.match(text,/p\.52: 설명으로 이해도 점검/);
});
test('per-book no homework differs from no homework for the whole lesson',()=>{
 const v=input();v.homework.books.push({bookId:'QA_OTHER',bookLabel:'다른 연습 교재',none:true,items:[]});
 const text=api.previewParentDiary(v).fields.homework;
 assert.match(text,/\[다른 연습 교재\]\r\n- 숙제 없음/);
 const all=input();all.homework={none:true,due:null,books:[]};all.memos=[];
 assert.equal(api.previewParentDiary(all).fields.homework,'다음 수업 전 숙제 없음');
 assert.equal(api.previewParentDiary(all).fields.classMemo,'');
 assert.equal(api.previewParentDiary(all).emptyMemoEffect,'preserve');
});
test('missing action/date/source, invalid date and contradictory no-work states are rejected',()=>{
 for(const change of [v=>v.homework.due=null,v=>v.homework.due='2040-02-30',v=>v.progress[0].items[0].actions=[],v=>v.progress[0].items[0].sourceRefs=[],v=>v.homework.books[0].none=true,v=>v.homework.none=true]){
  const v=input();change(v);assert.throws(()=>api.previewParentDiary(v),{name:'ZodError'});
 }
});
test('field overflow retains the whole preview and blocks ready output, never truncates',()=>{
 const v=input();v.memos=[{kind:'message',text:'가'.repeat(201),sourceRefs:refs}];
 const p=api.previewParentDiary(v);assert.equal(p.ready,false);assert.ok(p.fields.classMemo.endsWith('가'.repeat(201)));assert.equal(p.limits.classMemo.valid,false);
 assert.throws(()=>api.renderParentDiary(v),/200/);
});
test('source arrays are not mutated and line-break injection is not treated as a new section',()=>{
 const v=input(),before=JSON.stringify(v);api.previewParentDiary(v);assert.equal(JSON.stringify(v),before);
 v.progress[0].items[0].scope='p.1\n[다른 학생]';assert.throws(()=>api.previewParentDiary(v),{name:'ZodError'});
});

test('academy output uses observed CRLF without weakening exact comparison',()=>{
 const v=input();v.memos.push({kind:'message',text:'추가 안내입니다.',sourceRefs:refs});
 const p=api.previewParentDiary(v);assert.equal(p.lineEnding,'CRLF');
 for(const text of Object.values(p.fields))assert.doesNotMatch(text,/(^|[^\r])\n/);
 assert.ok(p.fields.progress.includes('\r\n'));
});
