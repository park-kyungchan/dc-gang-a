'use client';
import {useRef, useState} from 'react';
import {latest, parse, validDate, type Entry} from '@/lib/notebook';
import {type Closeout} from '@/lib/classroom';
import {applyReviewedDraft, reviewGroups, reviewProposal, type ReviewEdits} from '@/lib/closeout-review';

export type ReviewActions = {
  current: Closeout; basis: string;
  apply: (next: Closeout) => Promise<void>;
  retain: (sessionId: string, text: string) => Promise<void>;
};
const labels = {progress: '진도 후보 반영', homework: '숙제 후보 반영', followup: '다음 확인 후보 반영'};
export function CloseoutDraftReview({entry, events, actions}: {entry: Entry; events: Entry[]; actions: ReviewActions}) {
  const proposal = reviewProposal(entry, events);
  const [open, setOpen] = useState(false), [checked, setChecked] = useState(false);
  const [edits, setEdits] = useState<ReviewEdits>(() => {
    try {
      const saved = JSON.parse(parse(latest(events.filter(e => e.session_id === entry.session_id), 'review_draft')).text || '{}');
      if (saved.protocol === 'spt.closeout-review.v1' && saved.draftId === entry.id && saved.basis === actions.basis) {
        const v = saved.edits;
        if (['progress', 'homework', 'next', 'due'].every(k => typeof v?.[k] === 'string') && typeof v.noHomework === 'boolean' && reviewGroups.every(g => typeof v.selected?.[g] === 'boolean')) return v;
      }
    } catch { /* A legacy scratch draft remains in the raw history. */ }
    return proposal.edits;
  });
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false);
  const saving = useRef(false), retained = useRef<Promise<void>>(Promise.resolve());
  const [basisAtEdit] = useState(actions.basis), current = useRef(edits);
  const stale = basisAtEdit !== actions.basis;
  const alreadyApplied = actions.current.draftReview?.draftId === entry.id;
  function change(patch: Partial<ReviewEdits>) {
    const next = {...current.current, ...patch}; current.current = next; setEdits(next); setChecked(false);
    const text = JSON.stringify({protocol: 'spt.closeout-review.v1', draftId: entry.id, basis: basisAtEdit, edits: next});
    // Reuse the real device outbox/revision owner. A failed local write blocks apply.
    retained.current = retained.current.catch(() => {}).then(() => actions.retain(entry.session_id, text));
    void retained.current.then(() => setMessage('수정 초안 기기 보관됨 · 서버 동기화 상태는 상단에서 확인'), error => setMessage(error instanceof Error ? error.message : '수정 초안을 보관하지 못했습니다. 화면을 닫지 마세요.'));
  }
  async function apply() {
    if (saving.current || stale || alreadyApplied || !checked) return;
    saving.current = true; setBusy(true);
    try {
      await retained.current;
      await actions.apply(applyReviewedDraft(entry, events, actions.current, edits, actions.basis));
      setMessage('반영 내용 기기 보관됨 · 서버 확인은 상단 동기화 상태를 확인하세요.');
    } catch (error) {setMessage(error instanceof Error ? error.message : '반영하지 못했습니다. 수정 내용을 유지합니다.');}
    finally {saving.current = false; setBusy(false);}
  }
  const valid = (!edits.selected.progress || !!edits.progress.trim()) && (!edits.selected.homework || edits.noHomework || !!edits.homework.trim() && validDate(edits.due)) && reviewGroups.some(g => edits.selected[g]);
  return <section data-review-draft={entry.id} aria-label="후보 묶음 검토">
    {alreadyApplied ? <p className="hint">반영한 초안 · 추가 수정은 아래 진도·숙제에서 하세요.</p> : <>
      <button onClick={() => setOpen(!open)} aria-expanded={open}>후보 검토·수정</button>
      {open && <div className="detail-fields">
        <p className="hint">근거·발언 주체를 대조하고 필요한 묶음만 반영하세요. 활동 배정·이해 완료·귀가를 자동 처리하지 않습니다.</p>
        {reviewGroups.map(g => proposal.groups[g].length > 0 && <label className="checkbox-label" key={g}><input type="checkbox" checked={edits.selected[g]} onChange={e => change({selected: {...edits.selected, [g]: e.target.checked}})}/><span>{labels[g]}</span></label>)}
        {edits.selected.progress && <label className="field"><span>반영할 실제 진도</span><textarea value={edits.progress} onChange={e => change({progress: e.target.value})} maxLength={12000}/></label>}
        {edits.selected.homework && <>
          <label className="checkbox-label"><input type="checkbox" checked={edits.noHomework} onChange={e => change({noHomework: e.target.checked})}/>숙제 없음으로 수정</label>
          {!edits.noHomework && <><label className="field"><span>반영할 숙제 범위</span><textarea value={edits.homework} onChange={e => change({homework: e.target.value})} maxLength={12000}/></label><label className="field"><span>반영할 숙제 기한</span><input type="date" value={edits.due} onChange={e => change({due: e.target.value})}/></label><p className="hint">기한은 교사가 정확한 날짜로 선택합니다. ‘다음 시간’에서 날짜를 추정하지 않습니다.</p></>}
        </>}
        {edits.selected.followup && <label className="field"><span>반영할 다음 확인</span><textarea value={edits.next} onChange={e => change({next: e.target.value})} maxLength={12000}/></label>}
        <label className="checkbox-label"><input type="checkbox" checked={checked} disabled={stale} onChange={e => setChecked(e.target.checked)}/>근거와 실제 진도·숙제를 대조했습니다.</label>
        {stale && <p role="alert" className="notice">검토 중 근거가 바뀌었습니다. 수정 초안은 보관하며 기존 초안 반영을 중지합니다.</p>}
        <button className="primary" disabled={busy || stale || !checked || !valid} onClick={() => void apply()}>{busy ? '보관 중…' : '검토한 내용 반영·저장'}</button>
        <p className="hint">반영은 최종 확정이 아닙니다. 아래에서 진도·숙제를 확정한 뒤 귀가를 확인하세요.</p>
      </div>}
    </>}
    {message && <p role="status" className="hint">{message}</p>}
  </section>;
}
