// Display-only regression for the production record list. No browser/provider or external writes.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const out='.sites-runtime/record-discovery-tests';mkdirSync(out,{recursive:true});
const bundle=await build({entryPoints:['app/conversation-list.tsx'],bundle:true,platform:'node',format:'esm',write:false,external:['react','react/jsx-runtime']});
writeFileSync(out+'/list.mjs',bundle.outputFiles[0].text);
const {ConversationList}=await import('../'+out+'/list.mjs');
const day='2026-09-11';
const session=(id,extra={})=>({id,student_id:'S001',class_date:day,title:'같은 제목',created_at:'2026-09-11T01:00:00Z',purpose:'lesson',ended_at:null,...extra});
const props=(extra={})=>({data:{sessions:[session('lesson'),session('test',{purpose:'test',created_at:'2026-09-11T02:00:00Z'}),session('foreign',{student_id:'S002'}),session('old-day',{class_date:'2026-09-10'})],events:[{id:'transcript',session_id:'test',kind:'transcript',body:'PRIVATE RAW TEXT'}],captures:[{id:'capture',session_id:'test'}],ledger:[],connected:false},studentId:'S001',date:day,name:'Synthetic Student',selectedId:'',tests:false,serverSessionIds:['lesson','test'],state:'ready',onSelect(){},onTests(){},onRefresh(){},...extra});
const html=p=>renderToStaticMarkup(createElement(ConversationList,p));
function walk(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const n of [node.props?.children].flat(Infinity)){const found=walk(n,predicate);if(found)return found;}return null;}
await test('visible list is scoped to exact student/day and exposes hidden test count',()=>{
 const s=html(props());assert.match(s,/aria-label="보관한 대화"/);assert.match(s,/data-session-id="lesson"/);assert.doesNotMatch(s,/data-session-id="(?:test|foreign|old-day)"/);assert.match(s,/테스트 1건 보기/);assert.match(s,/아직 대화를 선택하지 않았습니다/);assert.doesNotMatch(s,/PRIVATE RAW TEXT/);
});
await test('enabling tests exposes every test and capture/transcript lineage counts without selecting one',()=>{
 const s=html(props({tests:true}));assert.match(s,/data-session-id="test"/);assert.match(s,/녹음 연결 1건 · 전사 1구간/);assert.ok(s.indexOf('data-session-id="test"')<s.indexOf('data-session-id="lesson"'));assert.doesNotMatch(s,/aria-pressed="true"/);
});
await test('same-title selection returns the full exact ID and cannot mutate recording state',()=>{
 const picked=[];const p=props({tests:true,onSelect:id=>picked.push(id)});const tree=ConversationList(p);walk(tree,n=>n.props?.['data-session-id']==='test').props.onClick();assert.deepEqual(picked,['test']);assert.equal(p.selectedId,'');assert.equal(p.data.sessions.length,4);
});
await test('hidden/stale/foreign selection is explicit, never presented as the selected conversation',()=>{
 for(const selectedId of ['test','foreign','old-day','missing']){const s=html(props({selectedId}));assert.match(s,/현재 학생·날짜·필터에 없습니다/);assert.doesNotMatch(s,/aria-pressed="true"/);}
});
await test('loading, failed fetch and offline cache do not assert server-empty or fresh retention',()=>{
 for(const state of ['loading','error','offline']){const s=html(props({state}));assert.match(s,/이전 서버 확인 · 재확인 필요/);assert.doesNotMatch(s,/서버 확인됨/);const empty=html(props({state,data:{sessions:[],events:[],captures:[],ledger:[],connected:false}}));assert.match(empty,/서버 기록은 아직 확인되지 않았습니다/);assert.doesNotMatch(empty,/이 수업일에 보관한 대화가 없습니다/);}
 assert.match(html(props({state:'error'})),/role="alert"/);
});
await test('unacknowledged local records are distinct from server-confirmed data; new and retry stay explicit',()=>{
 let selected=null,retries=0;const p=props({serverSessionIds:[],state:'error',onSelect:id=>{selected=id;},onRefresh:()=>retries++});assert.match(html(p),/기기 보관 · 서버 확인 전/);const tree=ConversationList(p);walk(tree,n=>n.type==='button'&&n.props.children==='새 대화').props.onClick();walk(tree,n=>n.type==='button'&&n.props.children==='기록 다시 확인').props.onClick();assert.equal(selected,'');assert.equal(retries,1);
});
await test('titles are escaped; malformed times do not invent a timestamp',()=>{
 const p=props();p.data.sessions=[session('safe',{title:'<script>alert(1)</script>',created_at:'not-a-date'})];const s=html(p);assert.match(s,/&lt;script&gt;/);assert.doesNotMatch(s,/<script>/);assert.match(s,/시각 미확인/);
});
