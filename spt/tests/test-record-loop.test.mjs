// The record loop uses fabricated session, capture, and student identifiers.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

const bundled=await build({entryPoints:['lib/projection.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {projectData,emptyData}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const date='2026-10-06',otherDate='2026-10-07';
const item=(order,url,payload,type='job')=>({order,url,payload,type,key:`fake-${order}`});
const items=[
 item(1,'/api/notebook',{action:'create',id:'session-alpha',studentId:'FAKE-ALPHA',date,title:'Invented lesson',purpose:'lesson'}),
 item(2,'/api/capture',{action:'start',id:'capture-alpha',sessionId:'session-alpha'}),
 item(3,'/api/notebook',{action:'create',id:'session-beta',studentId:'FAKE-BETA',date,title:'Another invented lesson',purpose:'lesson'}),
 item(4,'/api/notebook',{action:'entry',id:'late-alpha',sessionId:'session-alpha',kind:'transcript',captureId:'capture-alpha',data:{text:'Invented delayed speech'}}),
 item(5,'/api/capture',{action:'end',id:'capture-alpha',interrupted:true}),
 item(6,'/api/notebook',{action:'end',id:'session-alpha'}),
];

test('switching viewed student does not reassign a delayed capture transcript',()=>{
 const result=projectData(emptyData,items,date);
 assert.deepEqual(result.sessions.map(s=>[s.id,s.student_id]),[['session-alpha','FAKE-ALPHA'],['session-beta','FAKE-BETA']]);
 assert.deepEqual(result.events.map(e=>[e.id,e.session_id,e.capture_id]),[['late-alpha','session-alpha','capture-alpha']]);
 assert.equal(result.captures[0].state,'interrupted');assert.equal(result.sessions[0].ended_at!==null,true);
 assert.equal(emptyData.sessions.length,0,'projection must not mutate server state');
});

test('duplicate local receipts and unknown sessions cannot fabricate extra evidence',()=>{
 const extra=[item(7,'/api/notebook',{action:'entry',id:'late-alpha',sessionId:'session-alpha',kind:'transcript',data:{text:'duplicate'}} ,'receipt'),item(8,'/api/notebook',{action:'entry',id:'orphan',sessionId:'missing-session',kind:'transcript',data:{text:'orphan'}}),item(9,'/api/notebook',{action:'create',id:'wrong-day',studentId:'FAKE-ALPHA',date:otherDate,title:'Wrong day'}),item(10,'/api/notebook',{action:'create',id:'ignored',studentId:'FAKE-ALPHA',date,title:'Ignored'},'audioDraft')];
 const result=projectData(emptyData,[...items,...extra],date);
 assert.deepEqual(result.events.map(e=>e.id),['late-alpha']);
 assert.deepEqual(result.sessions.map(s=>s.id),['session-alpha','session-beta']);
});
