// Execute the original embedded Tracker renderer with synthetic source data.
// Google RPC/bootstrap is not run; server transactions have separate real mocks.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('integrations/tracker/Tracker.gs','utf8');
const at=source.indexOf('var PT_HTML=');assert.ok(at>0);
const html=JSON.parse(source.slice(at+'var PT_HTML='.length).trim().replace(/;$/,''));
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
assert.match(script,/\nload\(\);\s*$/);
function renderer(){
 const app={innerHTML:''},storage=new Map(),element={addEventListener(){},value:''};
 const context=vm.createContext({console,Date,Math,JSON,crypto:globalThis.crypto,setTimeout:()=>0,clearTimeout(){},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i],get length(){return storage.size}},document:{querySelector(selector){if(selector==='#app')return app;if(selector==='#student-select'||selector==='#class-date'||selector==='#part-filter'||selector==='#review-filter')return element;return null},addEventListener(){}},window:{addEventListener(){},confirm:()=>false},navigator:{},location:{}});
 vm.runInContext(script.replace(/\nload\(\);\s*$/,''),context);
 vm.runInContext(`const rawFixture={books:[{id:'QA_BOOK',name:'Synthetic book',code:'QA',start:1,end:10,excluded:[],basis:'SYNTHETIC',source:'SYNTHETIC',version:'1'}],units:[{id:'QA_UNIT',bookId:'QA_BOOK',parentId:'',level:1,kind:'학습',name:'Synthetic unit',start:1,end:10,order:1,source:'SYNTHETIC'}],assignments:[]};const ids=['QA_A','QA_B','QA_C'];rawFixture.assignments=ids.map(studentId=>({studentId,slot:1,bookId:'QA_BOOK',baseline:'미확인',focusUnitId:'',focusPage:null,focusDetail:'',focusDate:'',note:''}));data={version:'SYNTHETIC_A',draftOwner:'fixture',today:'2026-09-14',students:ids.map((id,i)=>({id,name:'Synthetic '+id,grade:'중1',school:'Synthetic',className:'월수반',part:'1부',days:'월,수',time:'15:00–17:30',firstDate:'2026-01-01',status:'재원',books:[Object.assign(PTModel.bookState(rawFixture,[],id,'QA_BOOK'),{revision:'book-fixture'})],reviewRevision:'student-fixture'})),catalog:PTModel.catalog(rawFixture,[]),reviews:[],facts:{},emptyFacts:Object.fromEntries(ids.map(id=>[id,'fixture'])),attendance:[],makeups:[],legacy:[]};studentId='QA_A';bookId='QA_BOOK';classDate='2026-09-14';view='dashboard';`,context);
 return {context,app,run:code=>vm.runInContext(code,context)};
}
await test('original Tracker uses the selected compact A shell and retains its real modules',()=>{
 new vm.Script(source);const {run,app}=renderer();run('render()');assert.match(app.innerHTML,/data-layout="compact-a"/);
 for(const view of ['dashboard','progress','review','calendar','settings','drafts']){run(`view=${JSON.stringify(view)};render()`);assert.ok(app.innerHTML.includes('id="student-select"'));assert.ok(app.innerHTML.includes('id="class-date"'));assert.ok(app.innerHTML.includes('data-action="nav"'));}
});
await test('stale original review is not displayed as a current confirmed student card',()=>{
 const {run}=renderer();run(`data.reviews=[{id:'QA_REVIEW',studentId:'QA_A',date:classDate,current:false,data:{confirmed:true,progress:'SYNTHETIC',noHomework:true,next:'SYNTHETIC FOLLOWUP'}}]`);
 const cards=run('studentCards()');assert.ok(cards.includes('근거 변경'));
});
await test('source transaction and draft recovery entrypoints remain available',()=>{
 for(const name of ['ptCommit','ptCheckRequest','ptSaveAttendance','ptSaveMakeup','ptSaveProfile'])assert.ok(source.includes('function '+name+'('),name);
 const {run}=renderer();for(const name of ['saveForm','checkRequest','persistDraft','onInput','allowNavigation','notebookLink'])assert.equal(run('typeof '+name),'function',name);
 assert.ok(source.includes('LockService.getScriptLock()'));assert.ok(script.includes('동일')||script.includes('같은'));
});
