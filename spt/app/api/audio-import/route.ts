import {owner,ownedSession,db,body,result,failure,ApiError} from '@/lib/server';
import {validDate} from '@/lib/notebook';
import {ownedImport,importView,importProcessor,importParts,originalAudio,prepareImport,bindImportFile,putImportPart,processImport} from '@/lib/audio-import';
import type {AudioImport} from '@/lib/audio-import-model';
export const dynamic='force-dynamic';
export async function GET(request:Request){try{
 const user=await owner(),url=new URL(request.url),id=url.searchParams.get('id');
 if(id){const row=await ownedImport(id,user);if(url.searchParams.get('original')==='1')return await originalAudio(request,row);const safe=await importView(row),session=await ownedSession(row.session_id,user);const parts=await importParts(id,user);return result({...safe,student_id:session.student_id,class_date:session.class_date,session_title:session.title,session_purpose:session.purpose,receivedParts:parts.map(p=>p.seq),parts:parts.map(p=>({seq:p.seq,size:p.size,hash:p.hash}))});}
 const date=url.searchParams.get('date');if(!validDate(date))throw new ApiError('수업일을 확인해 주세요.');
 const rows=await db().prepare('SELECT i.id,i.session_id,i.filename,i.mime,i.size,i.status,i.created_at,i.updated_at,i.duration,i.attempt_id,i.transcript_id,i.error,s.student_id,s.class_date,s.title session_title,s.purpose session_purpose FROM spt_audio_imports i JOIN spt_sessions s ON i.session_id=s.id WHERE i.owner=? AND s.class_date=? ORDER BY i.created_at DESC').bind(user,date).all<AudioImport>();
 const [imports,processor]=await Promise.all([Promise.all(rows.results.map(row=>importView({...row,owner:user}))),importProcessor(user)]);
 return result({imports,processor});
}catch(e){return failure(e)}}
export async function POST(request:Request){try{
 const user=await owner(request),url=new URL(request.url),part=url.searchParams.get('part');
 if(part!==null){if(!/^(0|[1-9]\d*)$/.test(part))throw new ApiError('원본 구간 번호를 확인해 주세요.');const id=url.searchParams.get('id')||'';if(Number(request.headers.get('Content-Length'))>1048576)throw new ApiError('원본 구간이 너무 큽니다.',413);await putImportPart(user,id,Number(part),await request.arrayBuffer());return result({saved:true,part:Number(part)});}
 const p=await body(request,6000);
 if(p.action==='prepare')return result(await prepareImport(user,p.id,p.sessionId));
 if(p.action==='file')return result(await bindImportFile(user,p.id,p.filename,p.mime,p.size));
 if(p.action==='process'||p.action==='finalize'||p.action==='recover'||p.action==='transcribe')return result(await processImport(user,p.id,p.action==='process'?'finalize':p.action));
 throw new ApiError('녹음 파일 요청을 확인해 주세요.');
}catch(e){return failure(e)}}
