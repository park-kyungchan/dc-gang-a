import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {db, ApiError, sha} from './server';
import {latest, type Entry, type Session} from './notebook';
import type {ClassEvent} from './classroom';
import {isTest} from './classroom';
import {closeoutEvidenceBasis, isCloseoutEvidence, type CloseoutEvidence} from './closeout-review';
import {conversationDraftSchema, readConversationDraft, transcriptText} from './conversation-drafts';
import {rehearsalId} from './rehearsal';

/** Existing private tables only; no new queue, database or schema migration. */
export async function loadCloseoutEvidence(user: string, studentId: string, date: string): Promise<CloseoutEvidence> {
  const [sessions, events, ledger] = await Promise.all([
    db().prepare('SELECT id,student_id,class_date,title,created_at,purpose,ended_at FROM spt_sessions WHERE owner=? AND student_id=? AND class_date=? ORDER BY created_at,id').bind(user, studentId, date).all<Session>(),
    db().prepare('SELECT e.id,e.session_id,e.kind,e.body,e.capture_id,e.created_at,e.base_revision_id,e.schema_version FROM spt_entries e JOIN spt_sessions s ON e.session_id=s.id WHERE e.owner=? AND s.student_id=? AND s.class_date=? ORDER BY e.created_at,e.rowid').bind(user, studentId, date).all<Entry>(),
    db().prepare("SELECT e.id,e.entity_id,e.student_id,e.class_date,e.kind,e.body,e.created_at FROM spt_class_events e WHERE e.owner=? AND e.student_id=? AND e.kind='activity' AND NOT EXISTS(SELECT 1 FROM spt_class_events n WHERE n.owner=e.owner AND n.entity_id=e.entity_id AND n.rowid>e.rowid) ORDER BY e.rowid").bind(user, studentId).all<ClassEvent>(),
  ]);
  return {sessions: sessions.results, events: events.results, ledger: ledger.results};
}
export function retainedSourceEntries(data: CloseoutEvidence) {
  return data.events.filter(e => isCloseoutEvidence(e.kind));
}

const nativeOutput = z.object({drafts: z.array(z.object({sessionId: z.string(), draft: conversationDraftSchema}).strict()).min(1).max(8)}).strict();
async function stableId(value: string) {
  const hash = await sha(new TextEncoder().encode(value).buffer);
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
function decode(entry: Entry | undefined): Record<string, unknown> {
  try {return JSON.parse(transcriptText(entry!));} catch {return {};}
}
function configuration(user: string) {
  const settings = env as unknown as Record<string, unknown>;
  const expectedUrl=rehearsalId()?'http://127.0.0.1:4182/analyze':'http://127.0.0.1:4176/analyze';
  if (settings.SPT_NATIVE_ANALYSIS_OWNER_KEY !== user || settings.SPT_NATIVE_ANALYSIS_URL !== expectedUrl || typeof settings.SPT_NATIVE_ANALYSIS_TOKEN !== 'string' || settings.SPT_NATIVE_ANALYSIS_TOKEN.length < 32) {
    throw new ApiError('이 실행 환경의 Native Hermes 분석 연결이 준비되지 않았습니다. 기존 기록과 수동 진도·숙제 입력은 유지됩니다.', 503);
  }
  return {url: expectedUrl, token: settings.SPT_NATIVE_ANALYSIS_TOKEN};
}
function append(user: string, id: string, sessionId: string, kind: string, value: unknown) {
  return db().prepare('INSERT OR IGNORE INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at,recorded_at_client,base_revision_id,schema_version) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(id,user,sessionId,kind,JSON.stringify({text:JSON.stringify(value)}),'',new Date().toISOString(),null,null,1);
}

/** One native assignment per retained source basis. Requests/results are evidence
 * Entries, not a second native Task owner or a background execution queue.
 * A missing/uncertain result never authorizes an automatic replacement call.
 */
export async function analyzeCloseout(user: string, studentId: string, date: string, expectedBasis: string, reanalyseFrom = '') {
  const data = await loadCloseoutEvidence(user, studentId, date);
  const basis = closeoutEvidenceBasis(studentId, date, data);
  if (expectedBasis !== basis) throw new ApiError('아직 서버에 없는 근거 또는 새 수정이 있습니다. 저장 상태를 확인하고 마무리를 다시 열어 주세요.',409);
  const sessions = data.sessions.filter(s => !isTest(s)).map(s => ({sessionId:s.id, entries:data.events.filter(e => e.session_id===s.id && ['transcript','transcript_edit'].includes(e.kind) && transcriptText(e).trim()).map(e=>({id:e.id,kind:e.kind,text:transcriptText(e)}))})).filter(s=>s.entries.length>0);
  if (!sessions.length) return {state:'no_evidence',message:'분석할 저장 전사가 없습니다. 녹음·전사 보관 상태를 먼저 확인하세요.'};
  if (sessions.length>8 || JSON.stringify(sessions).length>48000) throw new ApiError('이번 제한된 분석 범위를 넘었습니다. 대화별 원문을 보존한 채 분석 범위를 검토해야 합니다.',413);
  const requestId = await stableId(JSON.stringify([user,studentId,date,basis,sessions]));
  const attempt = data.events.find(e=>e.id===requestId&&e.kind==='closeout_analysis');
  const prior = data.events.filter(e=>e.kind==='closeout_analysis').at(-1);
  const completion = data.events.find(e=>e.kind==='closeout_analysis_result'&&decode(e).requestId===requestId);
  const complete = sessions.every(s=>readConversationDraft(latest(data.events.filter(e=>e.session_id===s.sessionId),'ai_draft'),data.events,s.sessionId)?.state==='ready');
  if (complete) return {state:'cached',requestId:attempt?.id,native:decode(completion).native,message:'저장된 분석 결과를 재사용했습니다. 새 Native 호출은 없습니다.'};
  if (attempt) return {state:completion?'unusable':'unknown',requestId,message:'이 근거의 분석 요청 이력이 있습니다. 결과가 없거나 사용할 수 없어 자동 재호출하지 않습니다. 원문과 실패 이력은 보존합니다.'};
  if (prior && reanalyseFrom!==prior.id) return {state:'changed',requestId:prior.id,message:'분석 이후 근거가 바뀌었습니다. 기존 초안은 보존하며 새 분석은 교사의 명시적 재요청이 필요합니다.'};
  const config = configuration(user);
  const reserved = await append(user,requestId,sessions[0].sessionId,'closeout_analysis',{requestId,studentId,date,basis,sourceEntryIds:sessions.flatMap(s=>s.entries.map(e=>e.id)),route:'native-hermes-cli-agent'}).run();
  if (reserved.meta.changes!==1) return {state:'unknown',requestId,message:'동일한 분석 요청이 이미 보관되었습니다. 결과를 확인할 때까지 중복 실행하지 않습니다.'};
  let answer: {native?: Record<string,unknown>; output?: unknown; error?: string};
  try {
    const response = await fetch(config.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+config.token,'X-SPT-Owner':user},body:JSON.stringify({requestId,studentId,date,sessions}),signal:AbortSignal.timeout(225000)});
    answer = await response.json() as typeof answer;
    if (!response.ok) throw new Error('NATIVE_RESULT_UNKNOWN');
  } catch {
    await append(user,await stableId(requestId+':result'),sessions[0].sessionId,'closeout_analysis_result',{requestId,state:'unknown',message:'Native result unconfirmed; no automatic retry.'}).run();
    return {state:'unknown',requestId,message:'Native 실행 결과를 확인하지 못했습니다. 원문·요청 이력을 보존하고 자동 재시도하지 않습니다.'};
  }
  const parsed = nativeOutput.safeParse(answer.output);
  const valid = parsed.success && new Set(parsed.data.drafts.map(d=>d.sessionId)).size===sessions.length && parsed.data.drafts.length===sessions.length && parsed.data.drafts.every(d=>sessions.some(s=>s.sessionId===d.sessionId) && readConversationDraft({id:requestId,session_id:d.sessionId,kind:'ai_draft',body:JSON.stringify({text:JSON.stringify(d.draft)}),created_at:'',capture_id:''},data.events,d.sessionId)?.state==='ready');
  const resultId = await stableId(requestId+':result');
  if (!valid || !parsed.success) {
    await append(user,resultId,sessions[0].sessionId,'closeout_analysis_result',{requestId,state:'invalid',native:answer.native,output:answer.output}).run();
    return {state:'invalid',requestId,message:'Native 초안의 형식·근거 연결을 확인하지 못했습니다. 원본 출력은 보존하고 반영은 막았습니다.'};
  }
  const statements = [];
  const ids: string[] = [];
  for (const item of parsed.data.drafts) {
    const id = await stableId(requestId+':'+item.sessionId); ids.push(id);
    const baseId = latest(data.events.filter(e=>e.session_id===item.sessionId),'ai_draft')?.id||'';
    statements.push(db().prepare("INSERT OR IGNORE INTO spt_entries(id,owner,session_id,kind,body,capture_id,created_at,recorded_at_client,base_revision_id,schema_version) SELECT ?,?,?,?,?,?,?,?,?,? WHERE COALESCE((SELECT id FROM spt_entries WHERE owner=? AND session_id=? AND kind='ai_draft' ORDER BY rowid DESC LIMIT 1),'')=?").bind(id,user,item.sessionId,'ai_draft',JSON.stringify({text:JSON.stringify(item.draft)}),'',new Date().toISOString(),null,baseId,1,user,item.sessionId,baseId));
  }
  statements.push(append(user,resultId,sessions[0].sessionId,'closeout_analysis_result',{requestId,state:'returned',native:answer.native,output:answer.output,draftIds:ids}));
  await db().batch(statements);
  const after = await loadCloseoutEvidence(user,studentId,date);
  const saved = ids.every(id=>after.events.some(e=>e.id===id&&e.kind==='ai_draft'));
  const unchanged = closeoutEvidenceBasis(studentId,date,after)===basis;
  return {state:saved&&unchanged?'ready':'stale',requestId,native:answer.native,draftIds:ids,message:saved&&unchanged?'Native Hermes 분석을 보관했습니다. 후보를 교사가 검토·수정해 반영하세요.':'분석 중 근거·초안이 바뀌었습니다. 원본 출력은 보존하며 최신 근거의 검토가 필요합니다.'};
}
