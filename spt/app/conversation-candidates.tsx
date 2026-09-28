'use client';
import {latest, type Entry, type Session} from '@/lib/notebook';
import {isTest} from '@/lib/classroom';
import {readConversationDraft, transcriptText} from '@/lib/conversation-drafts';
import {CloseoutDraftReview, type ReviewActions} from './closeout-review';

const kindLabels = {activity: '활동 후보', progress: '진도 후보', homework: '숙제 후보', followup: '다음 확인'};
const attributionLabels = {teacher_statement: '강사 발언', student_report: '학생 자기보고', inference: 'AI 해석', uncertain: '발언 주체 미확인'};

/** Reuse saved results for this student/day; opening never starts another run. */
export function CloseoutCandidates({studentId, date, sessions, events, review}: {studentId: string; date: string; sessions: Session[]; events: Entry[]; review?: ReviewActions}) {
  const available = sessions.filter(s => s.student_id === studentId && s.class_date === date && !isTest(s)).filter(s => readConversationDraft(latest(events.filter(e => e.session_id === s.id), 'ai_draft'), events, s.id) !== null);
  return <section aria-label="마무리 정리 후보">
    <p className="hint">원문과 발언 주체를 대조하고 필요한 묶음만 수정·반영하세요. 반영 후에도 최종 확정은 교사가 따로 합니다.</p>
    {available.length ? available.map(s => {
      const entry = latest(events.filter(e => e.session_id === s.id), 'ai_draft')!;
      const view = readConversationDraft(entry, events, s.id);
      return <div key={s.id}><h4>{s.title}</h4><ConversationCandidates sessionId={s.id} events={events}/>{review && view?.state === 'ready' && <CloseoutDraftReview key={entry.id} entry={entry} events={events} actions={review}/>}</div>;
    }) : <p className="empty-small">저장된 구조화 초안이 없습니다. 분석이 완료된 상태가 아닙니다.</p>}
  </section>;
}

/** Read-only first slice: no apply/confirm/Sheet callback is accepted here. */
export function ConversationCandidates({sessionId, events}: {sessionId: string; events: Entry[]}) {
  const entry = latest(events.filter(e => e.session_id === sessionId), 'ai_draft');
  const view = readConversationDraft(entry, events, sessionId);
  if (!view) return null;
  if (view.state === 'invalid') return <section className="panel conversation-candidates" aria-label="대화 정리 후보">
    <h3>대화 정리 후보</h3>
    <p className="notice" role="status">{view.reason === 'evidence' ? '근거 연결 확인 필요' : '초안 형식 확인 필요'}</p>
    <p className="hint">후보로 표시하지 않았습니다. 원문과 초안은 원문·정정 이력에 보존되어 있습니다.</p>
  </section>;
  return <section className="panel conversation-candidates" aria-label="대화 정리 후보">
    <div className="section-title"><h3>대화 정리 후보</h3><span className="status-tag attention">교사 검토 전</span></div>
    <p className="hint">자동 보관된 초안입니다. 현재 활동·진도·숙제로 반영하거나 확정한 기록이 아닙니다.</p>
    {view.state === 'stale' && <p className="notice" role="status">새 근거 도착 · 다시 정리 필요</p>}
    {view.draft.candidates.map(candidate => <article key={candidate.id} className="transcript candidate-item" data-candidate-id={candidate.id}>
      <b>{kindLabels[candidate.kind]} · {attributionLabels[candidate.attribution]}</b>
      <p>{candidate.text}</p>
      {candidate.uncertainty && <p className="attention-text">미확인 · {candidate.uncertainty}</p>}
      <details><summary>근거 {candidate.evidenceIds.length}개 보기</summary>
        {candidate.evidenceIds.map(id => {
          const source = view.sources.get(id)!;
          return <div className="history" key={id}>
            <small>{source.kind === 'transcript' ? '전사 원문' : '전사 추가·정정'} · {source.created_at}</small>
            <p>{transcriptText(source)}</p>
            <small style={{overflowWrap: 'anywhere'}}>기록 ID · {id}</small>
          </div>;
        })}
      </details>
    </article>)}
  </section>;
}
