// All identities and lesson details in this fixture are invented.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {resolve} from 'node:path';

const root=process.cwd();
const bundled=await build({entryPoints:['lib/handoff.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{
 name:'synthetic-roster',setup(build){build.onResolve({filter:/^\.\/initial-roster$/},args=>args.importer.replaceAll('\\','/').endsWith('/lib/notebook.ts')?{path:resolve(root,'tests/fixtures/initial-roster.ts')}:undefined);}
}]});
const {trackerHandoff,notebookDestination}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const date='2026-10-06',student={id:'FAKE-ALPHA',name:'Invented Learner Alpha',days:[],part:'',time:'',firstDate:date,books:[]};
const roster=[student],sourceId='11111111-1111-4111-8111-111111111111';
function event(close,kind='closeout',id=sourceId){return {id,entity_id:`${kind}:${student.id}:${date}`,student_id:student.id,class_date:date,kind,body:JSON.stringify(close),created_at:date+'T09:00:00Z'};}
const reviewed={progress:'Invented fractions review',homework:'',due:'',noHomework:true,next:'Invented next step',confirmed:true,departedAt:'',evidenceBasis:'PRIVATE-SYNTHETIC-BASIS',draftReview:{draftId:'PRIVATE-SYNTHETIC-DRAFT'},parentInput:{text:'PRIVATE-SYNTHETIC-PARENT'}};

test('handoff requires a matched, confirmed, complete source record',()=>{
 for(const ledger of [[],[event({...reviewed,confirmed:false})],[event({...reviewed,progress:'  '})],[event(reviewed,'activity')],[{...event(reviewed),student_id:'FAKE-BETA'}]])assert.throws(()=>trackerHandoff(student.id,date,ledger,roster));
 assert.throws(()=>trackerHandoff('FAKE-BETA',date,[event(reviewed)],roster));
 assert.throws(()=>trackerHandoff(student.id,'2026-02-30',[event(reviewed)],roster));
});

test('reviewed fields transfer without raw evidence, parent draft, or inferred homework',()=>{
 const transfer=JSON.parse(trackerHandoff(student.id,date,[event(reviewed)],roster));
 assert.equal(transfer.studentName,student.name);
 assert.equal(transfer.sourceId,sourceId);
 assert.deepEqual([transfer.closeout.homework,transfer.closeout.due,transfer.closeout.noHomework],['','',true]);
 assert.equal(transfer.closeout.confirmed,true);
 for(const marker of ['PRIVATE-SYNTHETIC-BASIS','PRIVATE-SYNTHETIC-DRAFT','PRIVATE-SYNTHETIC-PARENT','evidenceBasis','draftReview','parentInput'])assert.doesNotMatch(JSON.stringify(transfer),new RegExp(marker));
 assert.notEqual(JSON.parse(trackerHandoff(student.id,date,[event({...reviewed,progress:'Changed invented progress'})],roster)).sourceSignature,transfer.sourceSignature);
});

test('test and rehearsal transfers remain marked as tests; expired homework date is rejected',()=>{
 const assigned={...reviewed,noHomework:false,homework:'Invented pages 1-2',due:'2026-10-07'};
 assert.equal(JSON.parse(trackerHandoff(student.id,date,[event({...assigned,test:true},'closeout_test')],roster,true)).closeout.test,true);
 assert.equal(JSON.parse(trackerHandoff(student.id,date,[event(assigned)],roster,false,true)).test,true);
 assert.throws(()=>trackerHandoff(student.id,date,[event({...assigned,due:'2026-10-05'})],roster));
 assert.throws(()=>trackerHandoff(student.id,date,[event(assigned)],roster,true));
});

test('notebook deep link accepts only roster identity and a real date',()=>{
 assert.deepEqual(notebookDestination(`?student=${student.id}&date=${date}&view=review`,roster),{studentId:student.id,date,view:'review'});
 assert.equal(notebookDestination(`?student=FAKE-BETA&date=${date}`,roster),null);
 assert.equal(notebookDestination(`?student=${student.id}&date=2026-02-30`,roster),null);
 assert.equal(notebookDestination(`?student=${student.id}&date=${date}&view=unknown`,roster).view,'class');
});
