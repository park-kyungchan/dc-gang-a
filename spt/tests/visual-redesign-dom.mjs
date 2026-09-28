// Real React/Radix components in an isolated DOM. No browser layout engine,
// production fetch, IndexedDB, microphone, Sheet, or parent delivery is used.
// SPT_TEST_DOM_MODULE may point to an already installed jsdom module.
import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdirSync} from 'node:fs';
import {build} from 'esbuild';
const {JSDOM}=await import(process.env.SPT_TEST_DOM_MODULE||'jsdom');
const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',{url:'https://isolated.invalid/',pretendToBeVisual:true});
for(const key of ['window','document','HTMLElement','HTMLInputElement','HTMLTextAreaElement','HTMLFormElement','HTMLSelectElement','DocumentFragment','Element','Node','NodeFilter','Event','MouseEvent','KeyboardEvent','FocusEvent','CustomEvent','MutationObserver'])Object.defineProperty(globalThis,key,{value:dom.window[key],configurable:true});
Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
globalThis.getComputedStyle=dom.window.getComputedStyle;
globalThis.requestAnimationFrame=cb=>setTimeout(cb,0);globalThis.cancelAnimationFrame=clearTimeout;
globalThis.ResizeObserver=class{observe(){}disconnect(){}};
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.fetch=()=>{throw new Error('Network forbidden in this synthetic test');};
let scrollY=420;Object.defineProperty(window,'scrollY',{get:()=>scrollY});window.scrollTo=({top})=>{scrollY=top};
window.HTMLElement.prototype.scrollTo=function(){};
window.HTMLElement.prototype.scrollIntoView=function(){};
window.HTMLElement.prototype.hasPointerCapture=()=>false;
window.HTMLElement.prototype.setPointerCapture=function(){};
window.HTMLElement.prototype.releasePointerCapture=function(){};
const React=await import('react');const {createRoot}=await import('react-dom/client');const {renderToStaticMarkup}=await import('react-dom/server');const {act}=React;
const bundle=await build({stdin:{contents:"export {QuickWork} from './app/quick-work';export {StudentRoster} from './app/student-roster';export {ReviewPanel} from './app/classroom-panels';export {task,blankReport,blankCloseout,entity} from './lib/classroom';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,packages:'external'});
mkdirSync('.sites-runtime',{recursive:true});writeFileSync('.sites-runtime/visual-redesign-dom.mjs',bundle.outputFiles[0].text);
const ui=await import('../.sites-runtime/visual-redesign-dom.mjs');
const baselineSource=execFileSync('git',['show','58467b2:app/notebook.tsx'],{encoding:'utf8'});
const start=baselineSource.indexOf('<div className="student-list">{roster.map'),end=baselineSource.indexOf('<p className="roster-foot">',start);
assert.ok(start>0&&end>start);
const baselineModule=`import React from 'react';import {ActivityClock} from '../app/activity-clock';import {classPart,classTime,values,blankCloseout,entity,isOpen,isTest,taskLabels} from '../lib/classroom';export function BaselineRoster({roster,date,ledger,selected,onChoose}){const students=roster,studentId=selected,choose=onChoose,data={ledger,sessions:[]},target=null,status={phase:'idle'},statusText={idle:'녹음 대기'};return ${baselineSource.slice(start,end)};}`;
const oldBundle=await build({stdin:{contents:baselineModule,resolveDir:process.cwd()+'/.sites-runtime',loader:'tsx'},bundle:true,platform:'node',format:'esm',packages:'external',write:false});
writeFileSync('.sites-runtime/baseline-roster.mjs',oldBundle.outputFiles[0].text);const {BaselineRoster}=await import('../.sites-runtime/baseline-roster.mjs');
const h=React.createElement,date='2026-09-09';
const names=['가상 가온','가상 나래','가상 다온','가상 라온','가상 마루','가상 바다','가상 새봄','가상 아람','가상 여울','가상 이든','가상 지음','가상 하늘'];
const roster=names.map((name,i)=>({id:'QA'+(i+1),name,part:i<6?'1부':'2부',days:[3],time:'18:30',firstDate:'2026-09-01',books:['가상 교재']}));
const ledger=roster.map((s,i)=>({id:'revision-'+i,entity_id:'activity-'+i,student_id:s.id,class_date:date,kind:'activity',created_at:'2026-09-09T09:00:00.000Z',body:JSON.stringify({...ui.task(i%2?'개념백지테스트':'유형 풀이',date),range:'가상 교재 '+(30+i)+'쪽 1–4번',state:i%3===0?'check':'working',timing:{assignedAt:'2026-09-09T09:00:00.000Z',stoppedAt:'',visitedAt:'',revisitAt:''}})}));
const root=createRoot(document.getElementById('root'));
const click=async el=>{assert.ok(el,'expected control exists');await act(async()=>{el.dispatchEvent(new MouseEvent('click',{bubbles:true}));await new Promise(r=>setTimeout(r,0));});};
const button=(text,scope=document)=>[...scope.querySelectorAll('button')].find(e=>e.textContent===text);
await test('6 and 12 synthetic students expose all names, activity ranges, elapsed and review signals in semantic output',()=>{
 const measures=[];for(const count of [6,12]){const text=renderToStaticMarkup(h(ui.StudentRoster,{students:roster.slice(0,count),date,ledger,selected:'QA1',onChoose(){}}));const parsed=new JSDOM(text).window.document;
  const baseline=renderToStaticMarkup(h(BaselineRoster,{roster:roster.slice(0,count),date,ledger,selected:'QA1',onChoose(){}}));const old=new JSDOM(baseline).window.document;
  measures.push({students:count,before:{names:old.querySelectorAll('.student-card strong').length,ranges:roster.slice(0,count).filter((_,i)=>baseline.includes('가상 교재 '+(30+i)+'쪽 1–4번')).length,elapsed:old.querySelectorAll('.activity-clock').length},after:{names:parsed.querySelectorAll('.student-card strong').length,ranges:parsed.querySelectorAll('.roster-range').length,elapsed:parsed.querySelectorAll('.activity-clock').length}});
  assert.equal(parsed.querySelectorAll('.student-card').length,count);assert.equal(parsed.querySelectorAll('.roster-range').length,count);assert.equal(parsed.querySelectorAll('.activity-clock').length,count);assert.equal(parsed.querySelectorAll('.student-card.selected').length,1);
  assert.equal(parsed.querySelectorAll('.status-tag.attention').length,Math.ceil(count/3));assert.ok(!text.includes('text-overflow'));for(const s of roster.slice(0,count))assert.ok(text.includes(s.name));
 }
 assert.deepEqual(measures.map(m=>[m.before.ranges,m.after.ranges]),[[0,6],[0,12]]);if(process.env.SPT_QA_EVIDENCE_DIR){mkdirSync(process.env.SPT_QA_EVIDENCE_DIR,{recursive:true});writeFileSync(process.env.SPT_QA_EVIDENCE_DIR+'/semantic-density.json',JSON.stringify({baseline:'58467b2',method:'Actual baseline roster JSX and current StudentRoster rendered with React in jsdom. No layout engine; NOT viewport measurements or screenshots.',measurements:measures,unmeasured:['first viewport count','scroll distance','rendered overlap','actual iPhone Safari']},null,2)+'\n');}
});
await test('quick assignment preserves mounted original text/detail, records only chosen student, retap undo, focus and return position',async()=>{
 for(const count of [6,12]){let records=[];function Work(){const [rows,setRows]=React.useState(ledger);return h('main',{},h('details',{id:'original-detail',open:true},h('summary',{},'원래 기록'),h('textarea',{id:'original-draft',defaultValue:'원래 학생에게 남기는 작성 중 글'})),h(ui.QuickWork,{current:roster[0],date,students:roster.slice(0,count),ledger:rows,ready:true,save:async(studentId,kind,id,value,origin,base)=>{records.push({studentId,kind,id,value,origin,base});setRows(old=>old.filter(x=>x.entity_id!==id).concat({id:'qa-rev-'+records.length,entity_id:id,student_id:studentId,class_date:origin||date,kind,body:JSON.stringify(value)}));}}));}
  await act(async()=>root.render(h(Work,{key:count})));const draft=document.getElementById('original-draft'),detail=document.getElementById('original-detail');scrollY=420;
  await click(button('다른 학생 잠깐'));let dialog=document.querySelector('[role=dialog]');assert.ok(dialog);assert.equal(dialog.querySelectorAll('.student-card').length,count-1);
  await click([...dialog.querySelectorAll('.student-card')].find(e=>e.textContent.includes('가상 나래')));
  await click(button('마인드맵 작성'));assert.equal(records.length,1);assert.equal(records[0].studentId,'QA2');assert.equal(records[0].origin,date);const originalTime=records[0].value.timing.assignedAt;
  await click(button('마인드맵 작성 · 배정 취소'));assert.equal(records.length,2);assert.equal(records[1].id,records[0].id);assert.equal(records[1].value.cancelled,true);assert.equal(records[1].value.timing.assignedAt,originalTime);
  scrollY=700;await click(button('가상 가온 기록으로 복귀'));await act(async()=>{await new Promise(r=>setTimeout(r,10));});
  assert.equal(document.getElementById('original-draft'),draft);assert.equal(draft.value,'원래 학생에게 남기는 작성 중 글');assert.equal(detail.open,true);assert.equal(scrollY,420);assert.equal(document.activeElement,button('다른 학생 잠깐'));assert.ok(records.every(x=>x.studentId==='QA2'));
 }
});
await test('review renders draft and teacher edit before source evidence; parent delivery remains a separate explicit action',()=>{
 const data={roster,ledger,sessions:[],events:[],captures:[],connected:false};const html=renderToStaticMarkup(h(ui.ReviewPanel,{studentId:'QA1',date,data,save:async()=>{},fail:e=>{throw e},copy(){},onSource(){}}));
 assert.ok(html.indexOf('AI 초안 확인·보완')<html.indexOf('수업 검토 근거'));
 assert.ok(html.includes('자동 분석은 아직 연결되지 않았습니다.'));
 const parsed=new JSDOM(html).window.document;assert.ok(parsed.querySelector('details.parent-message'));assert.ok(parsed.querySelector('.parent-message').textContent.includes('학원 사이트에서 전송을 마쳤음 (직접 표시)'));
});
after(async()=>{await act(async()=>root.unmount());dom.window.close();});
