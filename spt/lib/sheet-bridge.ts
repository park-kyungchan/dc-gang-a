import {env} from 'cloudflare:workers';
import {ApiError,db,sha} from './server';
import {readRoster} from './roster-server';
import {trackerHandoff} from './handoff';
import type {ClassEvent,Closeout} from './classroom';
import {closeoutEvidenceBasis,closeoutCurrent} from './closeout-review';
import {loadCloseoutEvidence} from './closeout-analysis';
import {rehearsalId,rehearsalScope} from './rehearsal';

export type SourceCell={field:string;a1:string;raw:unknown;display:string;formula:string};
export type SheetProfile={id:string;name:string;status:string;sourceRow:number;revision:string;cells:SourceCell[];[key:string]:unknown};
export type SheetSnapshot={schema:number;spreadsheetId:string;date:string;readAt:string;profileSource:{sheetName:string;range:string;profiles:SheetProfile[]};mainSource:{sheetName:string;range:string;rows:{sourceRow:number;name:string;grade:string;cells:SourceCell[]}[]};tracker:{version:string;catalog:unknown;resolvedCatalog?:unknown;events:unknown[];testEvents?:unknown[];students:{studentId:string;revision:string;factsBasis:string;latestReview:{id:string;date:string;data:Partial<Closeout>&{sourceId?:string}}|null;latestTestReview?:{id:string;date:string;data:Partial<Closeout>&{sourceId?:string}}|null}[];attendance:unknown[]};[key:string]:unknown};
export type SheetMapping={studentId:string;name:string;profileRow:number;mainRow:number;trackerRevision?:string;active?:boolean};
export type SheetReceipt={student_id:string;class_date:string;entry_id:string;remote_id:string;remote_revision:string;created_at:string};
type BridgeReply={ok?:boolean;error?:string;code?:string;snapshot?:SheetSnapshot;saved?:boolean;sourceId?:string;remoteId?:string;receipt?:{sourceSignature?:string};trackerRevision?:string;requiresFreshReview?:boolean;currentRemoteId?:string;currentTrackerRevision?:string};
type SyncResult={studentId:string;entryId:string;conflict:boolean;saved?:boolean;remoteId?:string;trackerRevision?:string};
export const SHEET_ID='1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg';
function configuration(){const values=env as unknown as Record<string,string>;return {url:values.SPT_SHEET_BRIDGE_URL,key:values.SPT_SHEET_BRIDGE_KEY,owner:values.SPT_SHEET_BRIDGE_OWNER_KEY};}
function bridgeOwnerAllowed(bound:unknown,user:unknown){if(bound!==undefined)return typeof bound==='string'&&/^native-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bound)&&bound===user;return typeof user==='string'&&/^siwc-[a-f0-9]{64}$/.test(user);}
function nativeKeyValid(key:unknown){return typeof key==='string'&&key.length>=32&&key.length<=1024&&!/\s/.test(key);}
export function bridgeConfigured(user:string){const c=configuration();return !!c.url&&!!c.key&&bridgeOwnerAllowed(c.owner,user)&&(c.owner===undefined||nativeKeyValid(c.key));}
export async function bridgeCall(action:'snapshot'|'commitCloseout',payload:Record<string,unknown>){
 const scope=rehearsalScope();
 if(scope&&action==='commitCloseout'&&(!payload.closeout||typeof payload.closeout!=='object'||(payload.closeout as {test?:unknown}).test!==true||payload.date!==scope.date||typeof payload.studentId!=='string'||!scope.studentIds.includes(payload.studentId)))throw new ApiError('리허설에서는 원본 테스트 기록만 반영할 수 있습니다.',403);
 const {url,key,owner:bound}=configuration();if(!bridgeOwnerAllowed(bound,payload.actorKey))throw new ApiError('이 계정에는 Sheet 연결이 허용되지 않았습니다.',403);if(!url||!key||bound!==undefined&&!nativeKeyValid(key))throw new ApiError('Sheet 연결을 준비하고 있습니다.',503);
 if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url))throw new ApiError('Sheet 연결 주소를 확인해 주세요.',503);
 const request={protocol:'spt-sheet-bridge/1',sentAt:Date.now(),nonce:crypto.randomUUID(),action,payload};
 const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=[...new Uint8Array(await crypto.subtle.sign('HMAC',hmac,new TextEncoder().encode(JSON.stringify(request))))].map(n=>n.toString(16).padStart(2,'0')).join('');
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...request,signature}),signal:AbortSignal.timeout(25000),redirect:'follow'});
 if(!response.ok)throw new ApiError('Sheet 응답을 확인하지 못했습니다. 앱 기록은 보관되어 있습니다.',502);
 const answer=await response.json().catch(()=>null) as BridgeReply|null;if(!answer?.ok)throw new ApiError(answer?.error||'Sheet 연결을 확인해 주세요.',answer?.code==='CONFLICT'?409:answer?.code==='AUTH'?503:400);return answer;
}
export async function readSheet(user:string,date:string){
 const response=await bridgeCall('snapshot',{actorKey:user,date}),snapshot=response.snapshot as SheetSnapshot;
 if(!snapshot||snapshot.spreadsheetId!==SHEET_ID||snapshot.date!==date||!Array.isArray(snapshot.profileSource?.profiles)||!Array.isArray(snapshot.mainSource?.rows)||!Array.isArray(snapshot.tracker?.students))throw new ApiError('연결된 Sheet의 원본을 확인하지 못했습니다.',502);
 const {readAt,...content}=snapshot;const hash=await sha(new TextEncoder().encode(JSON.stringify(content)).buffer);
 const previous=await db().prepare('SELECT content_hash FROM spt_sheet_snapshots WHERE owner=? AND class_date=? ORDER BY rowid DESC LIMIT 1').bind(user,date).first<{content_hash:string}>();
 if(previous?.content_hash!==hash)await db().prepare('INSERT INTO spt_sheet_snapshots(id,owner,class_date,content_hash,body,observed_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),user,date,hash,JSON.stringify(snapshot),new Date().toISOString()).run();
 return {snapshot,hash};
}
export function validateMappings(snapshot:SheetSnapshot,input:unknown):SheetMapping[]{
 if(!Array.isArray(input)||!input.length||input.length>300)throw new ApiError('연결할 학생을 대조해 주세요.');
 const ids=new Set<string>(),rows=new Set<number>();return input.map(m=>{
  if(!m||typeof m.studentId!=="string"||!m.studentId||m.studentId.length>40)throw new ApiError("학생 ID를 확인해 주세요.");
  const profiles=snapshot.profileSource.profiles.filter(p=>p.id===m.studentId),main=snapshot.mainSource.rows.filter(r=>r.sourceRow===m.mainRow);
  if(profiles.length!==1||main.length!==1||profiles[0].sourceRow!==m.profileRow||profiles[0].name!==m.name||main[0].name!==m.name||ids.has(m.studentId)||rows.has(m.mainRow))throw new ApiError('학생 ID·이름·원본 행이 맞지 않습니다. 다시 대조해 주세요.',409);
  ids.add(m.studentId);rows.add(m.mainRow);return {studentId:m.studentId,name:profiles[0].name,profileRow:m.profileRow,mainRow:m.mainRow,active:profiles[0].status==='재원',trackerRevision:snapshot.tracker.students.find(s=>s.studentId===m.studentId)?.revision||''};
 });
}
export async function sheetState(user:string){return db().prepare('SELECT * FROM spt_sheet_settings WHERE owner=?').bind(user).first<{owner:string;mappings:string;confirmed_at:string;lease_until:number;last_sync_at:string|null;last_error:string;roster_revision_id:string}>();}
export async function latestCloseouts(user:string,date:string,testMode=false){const rows=await db().prepare("SELECT e.* FROM spt_class_events e WHERE e.owner=? AND e.kind=? AND e.class_date=? AND NOT EXISTS(SELECT 1 FROM spt_class_events n WHERE n.owner=e.owner AND n.entity_id=e.entity_id AND n.rowid>e.rowid) ORDER BY e.rowid").bind(user,testMode?'closeout_test':'closeout',date).all<ClassEvent>();return rows.results;}
export async function sheetReceipts(user:string,date:string,testMode=false){return (await db().prepare('SELECT r.student_id,r.class_date,r.entry_id,r.remote_id,r.remote_revision,r.created_at FROM spt_sheet_receipts r JOIN spt_class_events c ON c.id=r.entry_id AND c.owner=r.owner WHERE r.owner=? AND r.class_date=? AND c.kind=? ORDER BY r.rowid').bind(user,date,testMode?'closeout_test':'closeout').all<SheetReceipt>()).results;}
export async function sheetBaselines(user:string,testMode=false){const kind=testMode?'closeout_test':'closeout';return db().prepare('SELECT r.student_id,r.remote_revision FROM spt_sheet_receipts r JOIN spt_class_events c ON c.id=r.entry_id AND c.owner=r.owner WHERE r.owner=? AND c.kind=? AND NOT EXISTS(SELECT 1 FROM spt_sheet_receipts n JOIN spt_class_events nc ON nc.id=n.entry_id AND nc.owner=n.owner WHERE n.owner=r.owner AND n.student_id=r.student_id AND nc.kind=? AND n.rowid>r.rowid)').bind(user,kind,kind).all<{student_id:string;remote_revision:string}>();}
export function sameMappings(snapshot:SheetSnapshot,mappings:SheetMapping[]){try{const active=mappings.filter(m=>m.active!==false);if(!active.length)return true;return validateMappings(snapshot,active).every(m=>m.active===true);}catch{return false;}}
export async function syncCloseouts(user:string,date:string,manual?:{entryId:string;remoteId:string;trackerRevision:string;test?:boolean}){
 const testMode=manual?.test===true,rehearsal=!!rehearsalId(),transferTest=testMode||rehearsal;
 const settings=await sheetState(user);if(!settings)throw new ApiError('학생 ID와 원본 셀을 먼저 대조해 주세요.',409);
 const now=Date.now(),leaseUntil=now+120000;const lease=await db().prepare('UPDATE spt_sheet_settings SET lease_until=? WHERE owner=? AND lease_until<? AND roster_revision_id=?').bind(leaseUntil,user,now,settings.roster_revision_id).run();if(lease.meta.changes!==1)return {busy:true};
 try{
  const {snapshot}=await readSheet(user,date),mappings=JSON.parse(settings.mappings) as SheetMapping[];
  if(!sameMappings(snapshot,mappings))throw new ApiError('Sheet 학생 정보나 행 연결이 변경되었습니다. 최초 대조를 다시 확인해 주세요.',409);
  const closeouts=await latestCloseouts(user,date,testMode),receipts=await sheetReceipts(user,date,testMode),results:SyncResult[]=[];
  for(const entry of closeouts){
   if(!mappings.some(m=>m.studentId===entry.student_id&&m.active!==false)||!JSON.parse(entry.body).confirmed||receipts.some(r=>r.entry_id===entry.id))continue;
   const close=JSON.parse(entry.body);if(close.evidenceBasis&&!closeoutCurrent(close,closeoutEvidenceBasis(entry.student_id,date,await loadCloseoutEvidence(user,entry.student_id,date))))continue;
   if(manual&&manual.entryId!==entry.id)continue;
   const remote=snapshot.tracker.students.find(s=>s.studentId===entry.student_id);if(!remote)throw new ApiError('Tracker 학생을 찾을 수 없습니다.',409);
   const previous=receipts.filter(r=>r.student_id===entry.student_id).at(-1),latest=transferTest?remote.latestTestReview:remote.latestReview,remoteId=latest?.id||'';
   const baseline=(await sheetBaselines(user,testMode)).results.find(r=>r.student_id===entry.student_id);
   const decision=JSON.parse(entry.body).resolution,approvedResolution=decision?.choice==='site'&&decision.comparedRemoteId===remoteId&&decision.comparedTrackerRevision===remote.revision;
   const lostAcknowledgement=remoteId==='REQ-SPT-'+entry.id&&latest?.data.sourceId===entry.id;
   if(manual&&(manual.remoteId!==remoteId||manual.trackerRevision!==remote.revision))throw new ApiError('대조한 뒤 Tracker가 다시 변경되었습니다. 최신 내용을 확인해 주세요.',409);
   if(!manual&&!approvedResolution&&!lostAcknowledgement&&(remoteId!==(previous?.remote_id||'')||remote.revision!==(baseline?.remote_revision??mappings.find(m=>m.studentId===entry.student_id)?.trackerRevision??''))){results.push({studentId:entry.student_id,entryId:entry.id,conflict:true,remoteId,trackerRevision:remote.revision});continue;}
   // Read the current confirmed event ourselves. User-supplied progress, names,
   // or confirmed flags never become the signed transfer payload.
   const fresh=await latestCloseouts(user,date,testMode);if(fresh.find(e=>e.student_id===entry.student_id)?.id!==entry.id)throw new ApiError('앱 마감이 변경되었습니다. 다음 동기화에서 최신 내용을 확인합니다.',409);
   if(close.evidenceBasis&&!closeoutCurrent(close,closeoutEvidenceBasis(entry.student_id,date,await loadCloseoutEvidence(user,entry.student_id,date))))throw new ApiError('전달 전에 근거가 바뀌었습니다. 진도·숙제를 다시 확정해 주세요.',409);
   const transfer=JSON.parse(trackerHandoff(entry.student_id,date,[entry],(await readRoster(user)).roster,testMode,rehearsal));
   const reply=await bridgeCall('commitCloseout',{actorKey:user,requestId:'REQ-SPT-'+entry.id,studentId:entry.student_id,date,sourceId:entry.id,sourceSignature:transfer.sourceSignature,closeout:transfer.closeout,expectedRemoteId:remoteId,expectedTrackerRevision:remote.revision});
   if(reply.saved!==true||reply.sourceId!==entry.id||!reply.remoteId||reply.receipt?.sourceSignature!==transfer.sourceSignature)throw new ApiError('Sheet 저장 결과를 대조하지 못했습니다. 같은 요청으로 다시 확인합니다.',502);
   await db().prepare('INSERT OR IGNORE INTO spt_sheet_receipts(id,owner,student_id,class_date,entry_id,remote_id,source_signature,remote_revision,created_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(user+':'+entry.id,user,entry.student_id,date,entry.id,reply.remoteId,transfer.sourceSignature,reply.trackerRevision||'',new Date().toISOString()).run();
   results.push({studentId:entry.student_id,entryId:entry.id,saved:true,conflict:!!reply.requiresFreshReview||!!reply.currentRemoteId&&reply.currentRemoteId!==reply.remoteId||!!reply.currentTrackerRevision&&reply.currentTrackerRevision!==reply.trackerRevision});if(results.filter(r=>r.saved).length>=2)break;
  }
  if(manual&&!results.some(r=>r.entryId===manual.entryId)&&!receipts.some(r=>r.entry_id===manual.entryId))throw new ApiError('대조한 앱 마감이 변경되었습니다. 다시 확인해 주세요.',409);
  const conflict=results.some(r=>r.conflict);await db().prepare('UPDATE spt_sheet_settings SET last_sync_at=?,last_error=? WHERE owner=?').bind(new Date().toISOString(),conflict?'Tracker에서 수정한 마감이 있습니다. 두 내용을 대조해 주세요.':'',user).run();
  if(results.some(r=>r.saved))await readSheet(user,date);return {results};
 }catch(e){await db().prepare('UPDATE spt_sheet_settings SET last_error=? WHERE owner=?').bind(e instanceof Error?e.message:'Sheet 연결을 확인해 주세요.',user).run();throw e;}finally{await db().prepare('UPDATE spt_sheet_settings SET lease_until=0 WHERE owner=? AND lease_until=?').bind(user,leaseUntil).run();}
}
