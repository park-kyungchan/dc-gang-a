// Synthetic in-memory Apps Script fixture. No network and no Google writes.
async function main() {
const fs = await import('node:fs');
const vm = await import('node:vm');
const {default:assert} = await import('node:assert/strict');
const crypto = await import('node:crypto');
const {test} = await import('node:test');
const directory = __dirname;
const sourceRoot = __dirname;
const KEY = 'SYNTHETIC_TEST_ONLY_NOT_A_REAL_SECRET_0123456789';
const ID = '1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg';
const day = '2026-09-09';
const actorKey = 'siwc-' + 'a'.repeat(64);
const copy = value => structuredClone(value);

function fixture(options = {}) {
  const writes = [];
  class Sheet {
    constructor(name, data = [], id = 1) { this.name = name; this.data = data; this.id = id; this.formulas = {}; this.formats = {}; this.max = Math.max(200, data.length); }
    getLastRow() { let last = this.data.length; while (last && !this.data[last-1].some(v => v !== '' && v !== null && v !== undefined)) last--; return last; }
    getSheetId() { return this.id; }
    getMaxRows() { return this.max; }
    insertRowsAfter(at, n) { this.max += n; writes.push({name:this.name, kind:'rows', at, n}); }
    getRange(row, column, height, width) {
      return {
        getValues: () => Array.from({length:height}, (_, y) => Array.from({length:width}, (_, x) => copy(this.data[row+y-1]?.[column+x-1] ?? ''))),
        getFormulas: () => Array.from({length:height}, (_, y) => Array.from({length:width}, (_, x) => this.formulas[(row+y)+','+(column+x)] || '')),
        getDisplayValues: () => Array.from({length:height}, (_, y) => Array.from({length:width}, (_, x) => String(this.data[row+y-1]?.[column+x-1] ?? ''))),
        isPartOfMerge: () => false,
        canEdit: () => true,
        isBlank: () => Array.from({length:height}, (_, y) => Array.from({length:width}, (_, x) => this.data[row+y-1]?.[column+x-1] ?? '')).flat().every(v => v === ''),
        setNumberFormat: format => {writes.push({name:this.name,row,column,height,width,format});for(let y=0;y<height;y++)for(let x=0;x<width;x++)this.formats[(row+y)+','+(column+x)]=format;},
        setValues: values => { writes.push({name:this.name,row,column,height,width}); for(let y=0;y<height;y++){this.data[row+y-1] ||= []; for(let x=0;x<width;x++){let v=values[y][x];if(options.autoCoerce&&typeof v==='string'&&this.formats[(row+y)+','+(column+x)]!=='@'){if(/^\d+$/.test(v))v=Number(v);else if(/^\d+-\d+$/.test(v))v=new Date('2026-04-02T00:00:00Z');}this.data[row+y-1][column+x-1]=copy(v);} } }
      };
    }
  }
  const names = ['박경찬','박경찬_02_학생진도','박경찬_DB_교재','박경찬_DB_단원','박경찬_DB_배정','박경찬_DB_트래커','박경찬_DB_출결'];
  const sheets = Object.fromEntries(names.map((name,i) => [name,new Sheet(name,[['SYNTHETIC HEADER']],i+1)]));
  sheets['박경찬'].data = [[],[],[],['LOCAL TEACHER','초3','LOCAL SYNTHETIC STUDENT',0,'','', '', '', '', '', '', '', 'LOCAL BOOK']];
  sheets['박경찬'].data[3][5] = 2; sheets['박경찬'].formulas['4,6'] = '=1+1';
  const profile=Array(21).fill(''); Object.assign(profile,{0:'S001',1:'재원',2:'LOCAL SYNTHETIC STUDENT',4:'초3',5:'월수반',6:'1부'});
  sheets['박경찬_02_학생진도'].data=Array.from({length:14},()=>[]);sheets['박경찬_02_학생진도'].data[13]=profile;
  const ss={getId:()=>ID,getSheetByName:name=>sheets[name],getSpreadsheetTimeZone:()=> 'Asia/Seoul'};
  const localDate = date => new Date(date.getTime()+9*3600000).toISOString().slice(0,10);
  const context = vm.createContext({Date,Number,Object,Array,String,Math,JSON,Error,RegExp,
    Utilities:{Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256'},computeDigest:(algorithm,value)=>Array.from(crypto.createHash('sha256').update(value).digest()),computeHmacSha256Signature:(value,key)=>Array.from(crypto.createHmac('sha256',key).update(value).digest()),formatDate:(date,tz,format)=>localDate(date)},
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>key==='SPB_SHARED_KEY'?KEY:null})},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock(){}}),getDocumentLock(){throw new Error('FORBIDDEN DOCUMENT LOCK');}},
    SpreadsheetApp:{openById:id=>{assert.equal(id,ID);return ss;},getActive(){throw new Error('FORBIDDEN ACTIVE SPREADSHEET');},flush(){}},
    ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    PT_CONFIG:{version:'SYNTHETIC'},
    pkHash_:value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
  });
  vm.runInContext(fs.readFileSync(sourceRoot+'/Tracker.gs','utf8').split('var PT_HTML =')[0],context);
  vm.runInContext(fs.readFileSync(directory+'/SPTBridge.gs','utf8'),context);
  if ('nativeOwnerKey' in options) context.SPB_CONFIG = Object.freeze({...context.SPB_CONFIG,nativeOwnerKey:options.nativeOwnerKey});
  const sign=(action,payload)=>{const envelope={protocol:'spt-sheet-bridge/1',sentAt:Date.now(),nonce:crypto.randomUUID(),action,payload:{actorKey,...payload}};return {...envelope,signature:crypto.createHmac('sha256',KEY).update(JSON.stringify(envelope)).digest('hex')};};
  const send=envelope=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(envelope)}}).text);
  const snapshot=()=>{const result=send(sign('snapshot',{date:day}));assert.equal(result.ok,true,JSON.stringify(result));return result.snapshot;};
  const closeout={progress:'LOCAL VERIFIED RANGE',homework:'LOCAL HOMEWORK',due:'2026-09-11',noHomework:false,next:'LOCAL NEXT',confirmed:true,departedAt:''};
  const request=(extra={})=>{const x=snapshot().tracker.students[0];return {requestId:'REQ-SPT-'+crypto.randomUUID(),studentId:'S001',date:day,sourceId:crypto.randomUUID(),sourceSignature:'SYNTHETIC_FINGERPRINT',closeout:copy(closeout),expectedRemoteId:x.latestReview?.id||'',expectedTrackerRevision:x.revision,...extra};};
  const commit=p=>send(sign('commitCloseout',p));
  const events=()=>sheets['박경찬_DB_트래커'].data.slice(1);
  function manualReview(parent='KEEP THIS PARENT DRAFT') {
    const x=snapshot().tracker.students[0],id='REQ-'+crypto.randomUUID();
    const data={...closeout,parent,reportChecked:true,transferredAt:'2026-09-09T08:00:00.000Z',sourceId:'',sourceSignature:'',evidenceBasis:x.factsBasis};
    sheets['박경찬_DB_트래커'].data.push([id,new Date(),'LOCAL MANUAL TEACHER','REVIEW','S001','',day,JSON.stringify(data),x.revision,1,'확인','LOCAL ONLY',context.pkHash_(data)]);
    return id;
  }
  return {context,sheets,ss,writes,sign,send,snapshot,request,commit,events,manualReview};
}

test('authenticated snapshot preserves source values/formulas and writes nothing',()=>{
  const f=fixture(),before=JSON.stringify(f.sheets),snapshot=f.snapshot();
  assert.equal(snapshot.profileSource.profiles[0].id,'S001');
  const cells=snapshot.mainSource.rows[0].cells;
  assert.equal(cells.find(c=>c.field==='lcad').raw.value,0);
  assert.equal(cells.find(c=>c.a1==='F4').formula,'=1+1');
  assert.equal(JSON.stringify(f.sheets),before); assert.equal(f.writes.length,0);
  const signed=f.sign('snapshot',{date:day});signed.payload.date='2026-09-10';
  assert.equal(f.send(signed).code,'AUTH');assert.equal(f.writes.length,0);
  assert.equal(f.send({...signed,sentAt:0}).code,'AUTH');
});

test('snapshot exposes the original catalog interpretation and assignments, not a second calculator',()=>{
 const f=fixture();
 f.sheets['박경찬_DB_교재'].data.push(['BOOK_A','Synthetic book','descriptor',1,90,'','',90,'synthetic','synthetic','1','preserved alias']);
 f.sheets['박경찬_DB_단원'].data.push(['UNIT_A','BOOK_A','',1,'CHAPTER','Synthetic chapter',1,'',1,'synthetic','Ⅲ']);
 f.sheets['박경찬_DB_배정'].data.push(['S001',1,'BOOK_A']);
 const got=f.snapshot().tracker.resolvedCatalog;
 assert.ok(got,'the existing snapshot must carry the original resolved catalog');
 assert.deepEqual(got.assignments.map(a=>a.bookId),['BOOK_A']);
 assert.equal(got.books[0].code,'descriptor');assert.equal(got.units[0].notation,'Ⅲ');assert.ok(got.revision);
 assert.equal(f.writes.length,0);
});

test('native catalog correction preserves IDs/history, rejects stale source and deduplicates the exact operation',()=>{
 const native='native-11111111-1111-4111-8111-111111111111',f=fixture({nativeOwnerKey:native});
 const before=['BOOK_A','Old alias','descriptor','','','','','','unregistered','old source',1,'preserve note'];
 f.sheets['박경찬_DB_교재'].data.push(before.slice());
 const after=before.slice();after[1]='Reviewed label';after[11]='preserve note; old alias: Old alias';
 const payload={actorKey:native,requestId:'REQ-CATALOG-'+crypto.randomUUID(),date:day,expectedBooks:[before],expectedUnits:[],books:[after],units:[['UNIT_A','BOOK_A','',1,'CHAPTER','Printed chapter',8,'',8,'Synthetic source','Ⅰ']]};
 const result=f.send(f.sign('catalogUpdate',payload));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.saved,true);
 assert.equal(f.sheets['박경찬_DB_교재'].data[1][0],'BOOK_A');assert.equal(f.sheets['박경찬_DB_교재'].data[1][2],'descriptor');assert.equal(f.events().length,1);assert.equal(f.events()[0][3],'CATALOG');
 const count=f.writes.length;assert.equal(f.send(f.sign('catalogUpdate',payload)).duplicate,true);assert.equal(f.writes.length,count);
 const stale={...payload,requestId:'REQ-CATALOG-'+crypto.randomUUID()};assert.equal(f.send(f.sign('catalogUpdate',stale)).code,'CONFLICT');assert.equal(f.writes.length,count);
 const forbidden={...payload,requestId:'REQ-CATALOG-'+crypto.randomUUID(),actorKey};assert.equal(f.send(f.sign('catalogUpdate',forbidden)).code,'AUTH');
});

test('plain-text source notation survives native numeric/date coercion without normalizing identifiers',()=>{
 const native='native-11111111-1111-4111-8111-111111111111',f=fixture({nativeOwnerKey:native,autoCoerce:true});
 const before=['BOOK_A','Source book','descriptor','','','','','','source','source',1,'alias'];f.sheets['박경찬_DB_교재'].data.push(before);
 const units=[['UNIT_A','BOOK_A','',1,'CHAPTER','Source chapter',8,'',8,'source','01'],['UNIT_B','BOOK_A','UNIT_A',2,'UNIT','Source unit',8,11,8,'source','4-2']];
 const result=f.send(f.sign('catalogUpdate',{actorKey:native,requestId:'REQ-CATALOG-'+crypto.randomUUID(),date:day,expectedBooks:[before],books:[before],expectedUnits:[],units}));
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(f.sheets['박경찬_DB_단원'].data[1][10],'01');assert.equal(f.sheets['박경찬_DB_단원'].data[2][10],'4-2');
});

test('only the explicitly bound native owner joins the unchanged SIWC path',()=>{
  const native='native-11111111-1111-4111-8111-111111111111',other='native-22222222-2222-4222-8222-222222222222';
  const f=fixture({nativeOwnerKey:native});
  assert.equal(f.send(f.sign('snapshot',{date:day,actorKey:native})).ok,true);
  assert.equal(f.snapshot().spreadsheetId,ID);
  for(const actor of [other,'native-'+ 'a'.repeat(64),'native-11111111-1111-4111-8111-111111111111 '])assert.equal(f.send(f.sign('snapshot',{date:day,actorKey:actor})).code,'AUTH');
  const unbound=fixture({nativeOwnerKey:''});assert.equal(unbound.send(unbound.sign('snapshot',{date:day,actorKey:native})).code,'AUTH');
  assert.equal(f.writes.length,0);assert.equal(unbound.writes.length,0);
});

test('bridge state and hashes match current Tracker normalization helpers',()=>{
  const f=fixture();f.manualReview();
  const source=fs.readFileSync(sourceRoot+'/Tracker.gs','utf8');
  const stateCode=source.slice(source.indexOf('function ptRaw_(){'),source.indexOf('function ptProfiles_()'));
  f.context.ptRows_=(name,width)=>f.context.spbRows_(f.ss,name,width);
  f.context.ptIso_=value=>f.context.spbIso_(value,'Asia/Seoul');
  f.context.PT_CONFIG={books:'박경찬_DB_교재',units:'박경찬_DB_단원',assignments:'박경찬_DB_배정',events:'박경찬_DB_트래커'};
  vm.runInContext(stateCode, f.context);
  const versionCode=source.match(/^function ptStudentVersion_.*$/m)[0]+'\n'+source.match(/^function ptFactsBasis_.*$/m)[0];
  vm.runInContext(versionCode,f.context);
  const expected=f.context.ptRaw_(),actual=f.context.spbState_(f.ss);
  assert.equal(JSON.stringify(actual),JSON.stringify(expected));
  assert.equal(f.context.spbStudentVersion_(actual,'S001'),f.context.ptStudentVersion_(expected,'S001'));
  assert.equal(f.context.spbFactsBasis_(actual,'S001',day),f.context.ptFactsBasis_(expected,'S001',day));
});

test('lost response retries once; a changed request cannot reuse its ID',()=>{
  const f=fixture(),p=f.request(),one=f.commit(p);assert.equal(one.ok,true,JSON.stringify(one));assert.equal(f.events().length,1);
  const two=f.commit(p);assert.equal(two.ok,true);assert.equal(two.duplicate,true);assert.equal(two.remoteId,one.remoteId);assert.equal(two.receipt.savedAt,one.receipt.savedAt);assert.equal(f.events().length,1);
  assert.equal(two.trackerRevision,one.trackerRevision);assert.equal(two.requiresFreshReview,false);
  assert.equal(f.commit({...p,closeout:{...p.closeout,progress:'DIFFERENT'}}).code,'CONFLICT');
  assert.equal(f.commit({...p,actorKey:'siwc-'+'b'.repeat(64)}).code,'CONFLICT');
  assert.equal(f.events().length,1);
  assert(f.writes.every(w=>w.name==='박경찬_DB_트래커' && w.column===1 && w.width===13));
});

test('manual review requires comparison; approved append preserves parent text and its historical sent evidence',()=>{
  const f=fixture(),before=f.request(),manualId=f.manualReview();
  assert.equal(f.commit(before).code,'CONFLICT');assert.equal(f.events().length,1);
  const p=f.request(),saved=f.commit(p);assert.equal(p.expectedRemoteId,manualId);assert.equal(saved.ok,true);
  const old=JSON.parse(f.events()[0][7]),latest=JSON.parse(f.events()[1][7]);
  assert.equal(latest.parent,old.parent);assert.equal(latest.reportChecked,false);assert.equal(latest.transferredAt,'');
  assert.equal(old.reportChecked,true);assert.equal(old.transferredAt,'2026-09-09T08:00:00.000Z');
});

test('explicit test record preserves provenance without changing academic revision or latest review',()=>{
  const f=fixture(),before=f.snapshot(),p=f.request();p.closeout.test=true;
  const first=f.commit(p);assert.equal(first.ok,true,JSON.stringify(first));assert.equal(f.events()[0][3],'REVIEW_TEST');assert.equal(JSON.parse(f.events()[0][7]).test,true);
  const after=f.snapshot();assert.equal(after.tracker.students[0].latestReview,null);assert.equal(after.tracker.students[0].latestTestReview.id,first.remoteId);assert.equal(after.tracker.students[0].revision,before.tracker.students[0].revision);assert.equal(after.tracker.students[0].factsBasis,before.tracker.students[0].factsBasis);assert.equal(after.tracker.events.length,0);assert.equal(after.tracker.testEvents.length,1);
  assert.equal(f.commit(p).duplicate,true);assert.equal(f.events().length,1);assert.equal(f.commit({...p,closeout:{...p.closeout,test:false}}).code,'CONFLICT');
  const bad={requestId:'REQ-test',studentId:'S001',bookId:'',date:day,type:'REVIEW_TEST',data:{...p.closeout,test:false}};assert.throws(()=>f.context.PTModel.validate(after.tracker.catalog,[],bad));
});

test('same-day absence and impossible input dates cannot produce a review',()=>{
  const f=fixture(),p=f.request();
  f.sheets['박경찬_DB_출결'].data.push(['ATT-LOCAL','SESSION-LOCAL',day,'S001','LOCAL SYNTHETIC STUDENT','결석']);
  assert.equal(f.commit(p).code,'CONFLICT');assert.equal(f.events().length,0);
  assert.equal(f.commit({...p,date:'2026-02-31'}).code,'INVALID');
  assert.equal(f.commit({...p,closeout:{...p.closeout,departedAt:'2026-09-09T24:00:00.000Z'}}).code,'INVALID');
  assert.equal(f.events().length,0);
});

test('a saved request stays idempotent after later edits without blessing their current CAS revision',()=>{
  const f=fixture(),p=f.request(),first=f.commit(p);assert.equal(first.ok,true);
  // An unrelated catalog change alters the same student's Tracker revision,
  // without changing the latest REVIEW ID.
  f.sheets['박경찬_DB_교재'].data.push(['LOCAL-BOOK','LOCAL BOOK','',1,12,'','','','','LOCAL SYNTHETIC','1']);
  const duplicate=f.commit(p);assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.currentRemoteId,first.remoteId);
  assert.equal(duplicate.trackerRevision,null);
  assert.equal(duplicate.requiresFreshReview,true);
  assert.notEqual(duplicate.currentTrackerRevision,first.trackerRevision);
  assert.equal(f.events().length,1);
});

test('later progress retains the original acknowledgement revision and separately reports the new revision',()=>{
  const f=fixture(),p=f.request(),first=f.commit(p);assert.equal(first.ok,true);
  const progress={status:'학습중',detail:'LOCAL LATER PROGRESS'};
  f.sheets['박경찬_DB_트래커'].data.push(['REQ-'+crypto.randomUUID(),new Date(),'LOCAL MANUAL TEACHER','PROGRESS','S001','LOCAL-BOOK',day,JSON.stringify(progress),first.trackerRevision,1,'확인','LOCAL ONLY',f.context.pkHash_(progress)]);
  const duplicate=f.commit(p);assert.equal(duplicate.ok,true);assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.trackerRevision,first.trackerRevision);
  assert.notEqual(duplicate.currentTrackerRevision,first.trackerRevision);
  assert.equal(duplicate.currentRemoteId,first.remoteId);assert.equal(duplicate.requiresFreshReview,true);
  assert.equal(f.events().length,2);
});
}
main().catch(error=>{console.error(error);process.exitCode=1;});
