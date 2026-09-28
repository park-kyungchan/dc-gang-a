import {z} from 'zod';
import {uuid, latest, validDate, type Entry, type Session} from './notebook';
import {isTest, signature, type ClassEvent, type Closeout} from './classroom';
import {readConversationDraft} from './conversation-drafts';
import {isCardKind} from './observation-cards';

export const reviewGroups = ['progress', 'homework', 'followup'] as const;
export type ReviewGroup = typeof reviewGroups[number];
const decision = z.enum(['accept', 'correct', 'reject']);
export const draftReviewSchema = z.object({
  draftId: z.string().refine(uuid),
  sessionId: z.string().refine(uuid),
  decisions: z.object({progress: decision, homework: decision, followup: decision}).strict(),
}).strict();
export type DraftReview = z.infer<typeof draftReviewSchema>;
export type ReviewEdits = {
  progress: string; homework: string; next: string; due: string; noHomework: boolean;
  selected: Record<ReviewGroup, boolean>;
};
export type CloseoutEvidence = {sessions: Session[]; events: Entry[]; ledger: ClassEvent[]};
export function isCloseoutEvidence(kind: string) {
  return ['transcript', 'transcript_edit', 'observation'].includes(kind) || isCardKind(kind);
}

/** Only relevant retained evidence and activities; not our own draft/save result. */
export function closeoutEvidenceBasis(studentId: string, date: string, data: CloseoutEvidence) {
  const sessions = new Set(data.sessions.filter(s => s.student_id === studentId && s.class_date === date && !isTest(s)).map(s => s.id));
  return signature(JSON.stringify([
    ...data.events.filter(e => sessions.has(e.session_id) && isCloseoutEvidence(e.kind)).map(e => [e.id, e.session_id, e.kind, e.body]),
    ...data.ledger.filter(e => e.student_id === studentId && e.kind === 'activity' && (e.class_date === date || JSON.parse(e.body).workDate === date)).map(e => [e.id, e.entity_id, e.kind, e.body]),
  ].sort((a, b) => a[0].localeCompare(b[0]))));
}
export function closeoutCurrent(closeout: Closeout, basis: string) {
  return closeout.confirmed && (!closeout.evidenceBasis || closeout.evidenceBasis === basis);
}
export function reviewProposal(entry: Entry, events: Entry[]) {
  const view = readConversationDraft(entry, events, entry.session_id);
  if (!view || view.state !== 'ready') throw new Error('최신 근거의 초안을 먼저 확인해 주세요.');
  const groups = Object.fromEntries(reviewGroups.map(kind => [kind, view.draft.candidates.filter(c => c.kind === kind)])) as Record<ReviewGroup, typeof view.draft.candidates>;
  const edits: ReviewEdits = {
    progress: groups.progress.map(c => c.text).join('\n'),
    homework: groups.homework.map(c => c.text).join('\n'),
    next: groups.followup.map(c => c.text).join('\n'),
    due: '', noHomework: false,
    selected: {progress: groups.progress.length > 0, homework: groups.homework.length > 0, followup: groups.followup.some(c => c.attribution === 'teacher_statement')},
  };
  return {groups, edits};
}
export function applyReviewedDraft(entry: Entry, events: Entry[], current: Closeout, edits: ReviewEdits, basis: string): Closeout {
  const original = reviewProposal(entry, events);
  if (current.draftReview?.draftId === entry.id) throw new Error('이미 반영한 초안입니다. 현재 진도·숙제에서 수정해 주세요.');
  if (!reviewGroups.some(g => edits.selected[g])) throw new Error('반영할 묶음이 없습니다. 제외한 후보는 원문에 보존됩니다.');
  const decisions = Object.fromEntries(reviewGroups.map(g => {
    const field = g === 'followup' ? 'next' : g;
    return [g, !edits.selected[g] ? 'reject' : edits[field] === original.edits[field] && !(g === 'homework' && edits.noHomework) ? 'accept' : 'correct'];
  })) as DraftReview['decisions'];
  return {...current,
    ...(edits.selected.progress ? {progress: edits.progress} : {}),
    ...(edits.selected.homework ? {homework: edits.noHomework ? '' : edits.homework, due: edits.noHomework ? '' : edits.due, noHomework: edits.noHomework,...(current.homeworkPlan?{homeworkPlan:undefined}:{})} : {}),
    ...(edits.selected.followup ? {next: edits.next} : {}),
    ...(edits.selected.progress||edits.selected.homework?{...(current.parentInput?{parentInput:undefined}:{}),...(current.diary?{diary:{...current.diary,...(edits.selected.progress?{progress:''}:{}),...(edits.selected.homework?{homework:''}:{})}}:{})}:{}),
    confirmed: false, evidenceBasis: basis,
    draftReview: {draftId: entry.id, sessionId: entry.session_id, decisions},
  };
}

/** Called by the real save API; model/HTTP identities cannot choose the subject. */
export function assertCloseoutReview(next: Closeout, previous: Closeout | undefined, studentId: string, date: string, data: CloseoutEvidence) {
  const basis = closeoutEvidenceBasis(studentId, date, data);
  if (previous?.evidenceBasis !== undefined && next.evidenceBasis === undefined) throw new Error('이 기록의 근거 연결을 제거할 수 없습니다. 최신 근거를 대조해 주세요.');
  const freshApplication = next.draftReview && next.draftReview.draftId !== previous?.draftReview?.draftId;
  if ((freshApplication || next.confirmed) && next.evidenceBasis !== basis) throw new Error('근거가 바뀌었습니다. 최신 원문을 대조하고 다시 확정해 주세요.');
  if (!freshApplication || !next.draftReview) return;
  if (next.confirmed) throw new Error('초안 반영과 최종 확정은 별도입니다.');
  const session = data.sessions.find(s => s.id === next.draftReview!.sessionId && s.student_id === studentId && s.class_date === date && !isTest(s));
  const entry = session && latest(data.events.filter(e => e.session_id === session.id), 'ai_draft');
  if (!entry || entry.id !== next.draftReview.draftId) throw new Error('초안의 학생·수업일·최신 버전을 확인해 주세요.');
  const proposal = reviewProposal(entry, data.events);
  if(next.draftReview.decisions.homework !== 'reject' && !next.noHomework && (!next.homework.trim() || !validDate(next.due))) throw new Error('숙제 범위와 정확한 기한 또는 숙제 없음을 확인해 주세요.');
  for (const g of reviewGroups) if (!proposal.groups[g].length && next.draftReview.decisions[g] !== 'reject') throw new Error('없는 후보를 반영할 수 없습니다.');
}
