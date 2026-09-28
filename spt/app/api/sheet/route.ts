import {ApiError,body,db,failure,owner,result} from '@/lib/server';
import {readRoster} from '@/lib/roster-server';
import {mergeRoster} from '@/lib/roster';
import {validDate,uuid} from '@/lib/notebook';
import {signature,validateClass,type Closeout} from '@/lib/classroom';
import {clientRecordedAt} from '@/lib/provenance';
import {rehearsalId} from '@/lib/rehearsal';
import {bridgeConfigured,latestCloseouts,readSheet,sheetReceipts,sheetBaselines,sheetState,syncCloseouts,validateMappings,type SheetMapping} from '@/lib/sheet-bridge';

export const dynamic='force-dynamic';
export async function GET(request:Request){try{const user=await owner(),query=new URL(request.url).searchParams,date=query.get('date'),testMode=query.get('test')==='true';if(!validDate(date))throw new ApiError('수업일을 확인해 주세요.');const [settings,snapshot,closeouts,receipts,baselines]=await Promise.all([sheetState(user),db().prepare('SELECT body,content_hash,observed_at FROM spt_sheet_snapshots WHERE owner=? AND class_date=? ORDER BY rowid DESC LIMIT 1').bind(user,date).first<{body:string;content_hash:string;observed_at:string}>(),latestCloseouts(user,date,testMode),sheetReceipts(user,date,testMode),sheetBaselines(user,testMode)]);return result({rehearsalId:rehearsalId()||undefined,rosterRevision:settings?.roster_revision_id||'',configured:bridgeConfigured(user),connected:!!settings,mappings:settings?JSON.parse(settings.mappings):[],lastSyncAt:settings?.last_sync_at,lastError:settings?.last_error||'',snapshot:snapshot?JSON.parse(snapshot.body):null,hash:snapshot?.content_hash,observedAt:snapshot?.observed_at,closeouts,receipts,baselines:baselines.results});}catch(e){return failure(e)}}
export async function POST(request:Request){try{const user=await owner(request),p=await body(request,100000);if(!validDate(p.date))throw new ApiError('수업일을 확인해 주세요.');
 if(p.action==='preview')return result(await readSheet(user,p.date));
 if(p.action==='connect'){
  if(p.confirmed!==true||typeof p.snapshotHash!=='string')throw new ApiError('원본 학생 ID·이름·셀을 대조해 주세요.');
  const current=await readSheet(user,p.date);if(current.hash!==p.snapshotHash)throw new ApiError('대조 중 Sheet가 변경되었습니다. 최신 원본을 확인해 주세요.',409);
  const additions=validateMappings(current.snapshot,p.mappings),previous=await sheetState(user),catalog=await readRoster(user);
  if((p.rosterRevision||'')!==catalog.rosterRevision)throw new ApiError('다른 화면에서 학생 연결이 변경되었습니다. 최신 연결을 다시 대조해 주세요.',409);
  const merged=new Map((previous?JSON.parse(previous.mappings) as SheetMapping[]:[]).map(m=>[m.studentId,m]));for(const m of additions)merged.set(m.studentId,m);
  const mappings=[...merged.values()];if(new Set(mappings.map(m=>m.mainRow)).size!==mappings.length)throw new ApiError('이미 다른 학생 ID에 연결한 메인 행입니다. 연결을 다시 대조해 주세요.',409);
  const created=new Date().toISOString(),id=crypto.randomUUID(),roster=mergeRoster(catalog.roster,current.snapshot,additions,current.hash,created);
  const settings=db().prepare("INSERT INTO spt_sheet_settings(owner,mappings,confirmed_at,roster_revision_id) VALUES(?,?,?,?) ON CONFLICT(owner) DO UPDATE SET mappings=excluded.mappings,confirmed_at=excluded.confirmed_at,roster_revision_id=excluded.roster_revision_id,last_error='' WHERE spt_sheet_settings.lease_until<? AND spt_sheet_settings.roster_revision_id=?").bind(user,JSON.stringify(mappings),created,id,Date.now(),catalog.rosterRevision);
  const revision=db().prepare('INSERT INTO spt_roster_revisions(id,owner,body,source_hash,created_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM spt_sheet_settings WHERE owner=? AND roster_revision_id=?)').bind(id,user,JSON.stringify({students:roster,confirmedMappings:additions,previousRevision:catalog.rosterRevision}),current.hash,created,user,id);
  const committed=await db().batch([settings,revision]);if(committed[0].meta.changes!==1||committed[1].meta.changes!==1)throw new ApiError('동기화 또는 다른 화면의 연결 변경 중입니다. 다시 대조해 주세요.',409);return result({connected:true,rosterRevision:id});
 }
 if(p.action==='auto'){if(rehearsalId())return result({rehearsalId:rehearsalId(),requiresManual:true});if(!bridgeConfigured(user)||!await sheetState(user))return result({connected:false});return result(await syncCloseouts(user,p.date));}
 if(p.action==='sync')return result(await syncCloseouts(user,p.date));
 if(p.action==='sync-test'){if(p.confirmed!==true||!uuid(p.entryId)||typeof p.remoteId!=='string'||typeof p.trackerRevision!=='string')throw new ApiError('테스트 기록과 원본 대조를 확인해 주세요.');return result(await syncCloseouts(user,p.date,{entryId:p.entryId,remoteId:p.remoteId,trackerRevision:p.trackerRevision,test:true}));}
 if(p.action==='resolve'){
  if(p.confirmed!==true||!['site','sheet'].includes(p.choice)||!uuid(p.entryId)||typeof p.remoteId!=='string'||typeof p.trackerRevision!=='string')throw new ApiError('앱과 Tracker의 마감을 대조해 주세요.');
  const settings=await sheetState(user);if(!settings)throw new ApiError('학생 원본 셀을 먼저 대조해 주세요.',409);
  const leaseUntil=Date.now()+120000,lease=await db().prepare('UPDATE spt_sheet_settings SET lease_until=? WHERE owner=? AND lease_until<? AND roster_revision_id=?').bind(leaseUntil,user,Date.now(),settings.roster_revision_id).run();if(lease.meta.changes!==1)throw new ApiError('마감 동기화 중입니다. 잠시 후 대조 결과를 반영해 주세요.',409);
  try{
  const {snapshot,hash}=await readSheet(user,p.date),mappings=validateMappings(snapshot,(JSON.parse(settings.mappings) as SheetMapping[]).filter(m=>m.active!==false));
  const local=(await latestCloseouts(user,p.date)).find(e=>e.id===p.entryId);if(!local||!mappings.some(m=>m.studentId===local.student_id))throw new ApiError('대조한 앱 마감이 변경되었습니다. 다시 확인해 주세요.',409);
  const remote=snapshot.tracker.students.find(s=>s.studentId===local.student_id),latestRemote=rehearsalId()?remote?.latestTestReview:remote?.latestReview;if(!remote||(latestRemote?.id||'')!==p.remoteId||remote.revision!==p.trackerRevision)throw new ApiError('대조 중 Tracker가 변경되었습니다. 최신 내용을 확인해 주세요.',409);
  if(p.choice==='sheet'&&!latestRemote)throw new ApiError('Tracker에 가져올 마감이 없습니다.',409);
  let clean:Closeout,inputAt:string|null;try{const source=p.choice==='sheet'?{...latestRemote!.data,...(rehearsalId()?{test:false}:{})}:JSON.parse(local.body);clean=validateClass('closeout',source,p.date) as Closeout;inputAt=clientRecordedAt(p.recordedAtClient);}catch(e){throw new ApiError(e instanceof Error?e.message:'마감 내용을 확인해 주세요.');}
  if(!clean.confirmed||!clean.noHomework&&clean.due<p.date)throw new ApiError('실제 진도와 숙제를 다시 확정해 주세요.');
  if(clean.noHomework){clean.homework='';clean.due='';}
  const id=crypto.randomUUID(),created=new Date().toISOString(),data={...clean,resolution:{choice:p.choice,comparedRemoteId:p.remoteId,comparedTrackerRevision:p.trackerRevision,comparedLocalId:local.id,snapshotHash:hash}};
  const change=db().prepare("INSERT INTO spt_class_events(id,owner,entity_id,student_id,class_date,kind,body,created_at,recorded_at_client,base_revision_id,schema_version) SELECT ?,?,?,?,?,?,?,?,?,?,1 WHERE (SELECT id FROM spt_class_events WHERE owner=? AND entity_id=? ORDER BY rowid DESC LIMIT 1)=?").bind(id,user,local.entity_id,local.student_id,p.date,'closeout',JSON.stringify(data),created,inputAt,local.id,user,local.entity_id,local.id);
  if(p.choice==='sheet'){
   const receipt=db().prepare('INSERT INTO spt_sheet_receipts(id,owner,student_id,class_date,entry_id,remote_id,source_signature,remote_revision,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM spt_class_events WHERE id=? AND owner=?)').bind(user+':'+id,user,local.student_id,p.date,id,p.remoteId,signature(JSON.stringify(clean)),remote.revision,created,id,user);
   const committed=await db().batch([change,receipt]);if(committed[0].meta.changes!==1||committed[1].meta.changes!==1)throw new ApiError('대조 중 앱 마감이 변경되었습니다. 다시 확인해 주세요.',409);
   await db().prepare("UPDATE spt_sheet_settings SET last_error='' WHERE owner=?").bind(user).run();return result({saved:true,entryId:id,source:'sheet'});
  }
  const committed=await change.run();if(committed.meta.changes!==1)throw new ApiError('대조 중 앱 마감이 변경되었습니다. 다시 확인해 주세요.',409);
  return result({saved:true,entryId:id,pendingSheet:true});
  }finally{await db().prepare('UPDATE spt_sheet_settings SET lease_until=0 WHERE owner=? AND lease_until=?').bind(user,leaseUntil).run();}
 }
 throw new ApiError('Sheet 작업을 확인해 주세요.');
 }catch(e){return failure(e)}}
