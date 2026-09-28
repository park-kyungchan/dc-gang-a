import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundled=await build({stdin:{contents:"export {StudentRoster} from './app/student-roster';export {ReviewPanel} from './app/classroom-panels';export * from './lib/closeout-review';export {blankCloseout} from './lib/classroom';export {trackerHandoff} from './lib/handoff';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,banner:{js:"import {createRequire} from 'node:module';const require=createRequire(import.meta.url);"},external:['react','react/jsx-runtime','react-dom','react-dom/server']});
writeFileSync('.sites-runtime/closeout-review-test.mjs',bundled.outputFiles[0].text);
const {StudentRoster,ReviewPanel,closeoutEvidenceBasis,blankCloseout,trackerHandoff}=await import('../.sites-runtime/closeout-review-test.mjs');
const student={id:'SYNTHETIC_A',name:'SYNTHETIC A',days:[],part:'',time:'',firstDate:'2026-01-01',books:[]};
const date='2026-10-01',sid=randomUUID();
const source={id:randomUUID(),session_id:sid,kind:'transcript',body:JSON.stringify({text:'SYNTHETIC PRIVATE TRANSCRIPT'}),capture_id:'',created_at:'2026-10-01T01:00:00Z'};
const data={sessions:[{id:sid,student_id:student.id,class_date:date,title:'SYNTHETIC',created_at:source.created_at}],events:[source],ledger:[],captures:[],connected:false,roster:[student]};
const close={...blankCloseout,progress:'REVIEWED PROGRESS',noHomework:true,confirmed:true,departedAt:'2026-10-01T02:00:00Z',evidenceBasis:closeoutEvidenceBasis(student.id,date,data),draftReview:{draftId:randomUUID(),sessionId:sid,decisions:{progress:'correct',homework:'reject',followup:'reject'}}};
const event={id:randomUUID(),entity_id:`closeout:${student.id}:${date}`,student_id:student.id,class_date:date,kind:'closeout',body:JSON.stringify(close),created_at:close.departedAt};data.ledger=[event];
const stale={...data,events:[...data.events,{...source,id:randomUUID(),body:JSON.stringify({text:'LATE PRIVATE SOURCE'})}]};
const noop=()=>{};
await test('departure fact survives changed detail evidence while final confirmation becomes stale',()=>{
  for(const presentation of ['field','list']){
    const base={students:[student],date,ledger:data.ledger,selected:'',onChoose:noop,presentation};
    const current=renderToStaticMarkup(React.createElement(StudentRoster,{...base,evidence:data}));
    const changed=renderToStaticMarkup(React.createElement(StudentRoster,{...base,evidence:stale}));
    assert.ok(current.includes('귀가'));
    assert.ok(changed.includes('근거 재확인'));assert.ok(changed.includes('귀가'));
    const unknown=renderToStaticMarkup(React.createElement(StudentRoster,base));assert.ok(unknown.includes('근거 재확인'));
  }
});
await test('PC reflection blocks confirmation and handoff when closeout evidence changed',()=>{
  const html=renderToStaticMarkup(React.createElement(ReviewPanel,{studentId:student.id,date,data:stale,save:async()=>{},fail:noop,copy:noop,onSource:noop}));
  assert.ok(html.includes('상세 기록 전달 전 진도·숙제를 먼저 확정'));
  assert.match(html,/<button[^>]*disabled=""[^>]*>Tracker 전달 내용 복사/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>[^<]*문안 시작/);
});
await test('shared Tracker payload contains only reviewed fields, not lineage or raw evidence',()=>{
  const payload=JSON.parse(trackerHandoff(student.id,date,data.ledger,[student]));
  assert.equal(payload.closeout.progress,'REVIEWED PROGRESS');
  const text=JSON.stringify(payload);
  for(const privateValue of [source.id,sid,close.draftReview.draftId,'PRIVATE TRANSCRIPT','evidenceBasis','draftReview'])assert.ok(!text.includes(privateValue),privateValue);
});
