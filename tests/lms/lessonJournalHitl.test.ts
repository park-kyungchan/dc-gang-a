import { describe, expect, it } from 'bun:test';
import { digest } from '../../src/learning/model';
import {
  DEFAULT_JOURNAL_POLICY, JOURNAL_FIELDS, REQUIRED_JOURNAL_REVIEW_FIELDS, createLessonJournalDraft, reviseLessonJournalDraft,
  prepareLessonJournalReview, gateLessonJournalReview, recordLessonJournalOutcomes,
  verifyLessonJournalReadback, validateJournalAuditHistory,
  type JournalApprovalCheck, type JournalApprovalDecision, type JournalApprovalVerifierPort,
  type JournalDraftInput, type JournalField, type JournalFieldOutcome, type JournalGateRequest,
  type JournalPolicy, type JournalSourceSnapshot, type JournalTarget, type JournalValue,
} from '../../src/lms/lessonJournalHitl';

// Invented fixtures only. Attendance labels below deliberately do not claim site meanings.
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const clone = <T>(value: T): Mutable<T> => structuredClone(value) as Mutable<T>;
const at = (seconds: number) => `2026-10-01T05:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000Z`;
const known = (value: string | number | boolean): JournalValue => ({ state: 'known', value, evidenceRefs: ['synthetic-source-field'] });
const target: JournalTarget = {
  teacherId: 'teacher-synthetic', studentId: 'student-synthetic', courseId: 'course-synthetic',
  recordId: 'record-synthetic', cmId: 'cm-synthetic', occurrenceId: 'occurrence-synthetic', lessonDate: '2026-10-01',
};
const rules: JournalPolicy = {
  policyId: 'synthetic-policy', version: '1', scope: 'lesson_journal_only', otherAcademyOperations: 'read_only',
  maxSourceAgeMs: 300_000, maxApprovalAgeMs: 300_000,
  fieldRules: [
    { field: 'progress', validationRef: 'synthetic-text-rule', domain: { kind: 'text', maxCodePoints: 200 } },
    { field: 'homework', validationRef: 'synthetic-text-rule', domain: { kind: 'text', maxCodePoints: 200 } },
    { field: 'lessonMemo', validationRef: 'synthetic-text-rule', domain: { kind: 'text', maxCodePoints: 200 } },
    { field: 'attendance', validationRef: 'synthetic-enum-rule', domain: { kind: 'enumeration', values: ['A', 'P', 0, ''] } },
  ],
};
const source = (): JournalSourceSnapshot => ({
  kind: 'source_snapshot', target: clone(target),
  proof: { state: 'verified', kind: 'independent_teacher_and_occurrence', target: clone(target),
    teacherEvidenceRef: 'synthetic-teacher-proof', occurrenceEvidenceRef: 'synthetic-occurrence-proof',
    verifiedAt: '2026-10-01T04:59:59.000Z', validUntil: at(1800) },
  observationId: 'synthetic-before', observedAt: at(0), sourceVersion: 'synthetic-version-1',
  sourceContractVersion: 'synthetic-contract-1', readContractRef: 'synthetic-independent-read',
  readOrigin: 'independent_authoritative_read',
  fields: { progress: known('pages 1-2'), homework: known('pages 3-4'), lessonMemo: known(''), attendance: known('A') },
});
const input = (): Mutable<JournalDraftInput> => clone({
  draftId: 'synthetic-draft', revision: 1, previousDraftDigest: null, createdAt: at(1), source: source(), policy: rules,
  recoveryPlanRef: 'synthetic-recovery-plan',
  teacherPlan: {
    kind: 'teacher_plan', planId: 'synthetic-plan', revisionId: 'synthetic-plan-revision-1', teacherId: target.teacherId,
    target: clone(target), status: 'draft', basedOnSourceVersion: 'synthetic-version-1',
    proposed: { progress: 'pages 3-4', homework: 'pages 5-6', lessonMemo: '', attendance: 'P' },
    provenanceRefs: ['synthetic-classroom-evidence', 'synthetic-teacher-review'],
  },
} satisfies JournalDraftInput);

function fixture(selected: readonly JournalField[] = ['homework', 'progress']) {
  const draft = createLessonJournalDraft(input());
  const review = prepareLessonJournalReview(draft, selected, at(2));
  const fresh = clone(source()); fresh.observationId = 'synthetic-preflight'; fresh.observedAt = at(4);
  const request: JournalGateRequest = {
    attemptId: 'synthetic-attempt-1', receiptRef: 'synthetic-receipt-1', now: at(5),
    currentDraft: draft, review, freshSource: fresh, history: [],
  };
  const decision: Extract<JournalApprovalDecision, { status: 'verified' }> = {
    status: 'verified', receiptRef: request.receiptRef, attemptId: request.attemptId,
    reviewDigest: review.integrityDigest, draftDigest: draft.integrityDigest, target: clone(target),
    approverId: 'synthetic-authenticated-reviewer', approvedAt: at(3), expiresAt: at(100), checkedAt: at(5),
    scope: 'exact_lesson_journal_diff', useState: 'unused',
  };
  const calls: JournalApprovalCheck[] = [];
  const verifier: JournalApprovalVerifierPort = { verify: check => { calls.push(check); return decision; } };
  const gate = () => gateLessonJournalReview(request, verifier);
  return { draft, review, request: clone(request), decision: clone(decision), verifier, calls, gate };
}
const successOutcomes = (): JournalFieldOutcome[] => ['homework', 'progress'].map(field => ({
  field: field as JournalField, status: 'reported_success', finishedAt: at(6), evidenceRef: `synthetic-response-${field}`,
}));
function completedAttempt(outcomes = successOutcomes()) {
  const f = fixture(); const gated = f.gate();
  const report = recordLessonJournalOutcomes(gated.plan, outcomes, at(7), gated.history);
  const readback = clone(source()); readback.observationId = 'synthetic-readback'; readback.observedAt = at(8); readback.sourceVersion = 'synthetic-version-2';
  readback.fields.homework = clone(known('pages 5-6')); readback.fields.progress = clone(known('pages 3-4'));
  return { ...f, ...gated, reported: report, readback };
}

function rejectsCode(work: () => unknown, code: string) {
  expect(work).toThrow(`Lesson journal HITL rejected: ${code}`);
}

describe('lesson journal draft and explicit field policy', () => {
  it('supports drafts before the exact field interview, with no implicit field or live approval', () => {
    const value = input(); value.policy = clone(DEFAULT_JOURNAL_POLICY);
    const draft = createLessonJournalDraft(value);
    expect(draft.status).toBe('blocked');
    expect(draft.fields.every(field => field.blockers.includes('field_not_allowed'))).toBe(true);
    rejectsCode(() => prepareLessonJournalReview(draft, ['progress'], at(2)), 'selected_field_not_changeable');
    expect(DEFAULT_JOURNAL_POLICY.fieldRules).toEqual([]);
    expect(Object.isFrozen(DEFAULT_JOURNAL_POLICY)).toBe(true);
  });
  it('retains all six required business fields without inventing assessment adapters', () => {
    expect(REQUIRED_JOURNAL_REVIEW_FIELDS).toEqual(['attendance', 'progress', 'homework', 'lessonMemo', 'previousHomeworkAssessment', 'dailyTestAssessment']);
    const value = input();
    value.teacherPlan.proposed.previousHomeworkAssessment = 'teacher draft only';
    value.teacherPlan.proposed.dailyTestAssessment = 'teacher draft only';
    const draft = createLessonJournalDraft(value);
    for (const field of ['previousHomeworkAssessment', 'dailyTestAssessment']) {
      expect(draft.fields.find(diff => diff.field === field)?.blockers).toContain('unsupported_field');
      expect(() => prepareLessonJournalReview(draft, [field as JournalField], at(2))).toThrow();
    }
  });
  it('separates source, plan and immutable sorted diff; noop fields create no action', () => {
    const value = input(); const draft = createLessonJournalDraft(value);
    expect(draft.status).toBe('reviewable');
    expect(draft.fields.map(field => [field.field, field.disposition])).toEqual([
      ['attendance', 'changed'], ['homework', 'changed'], ['lessonMemo', 'noop'], ['progress', 'changed'],
    ]);
    value.teacherPlan.proposed.progress = 'later edited input';
    expect(draft.input.teacherPlan.proposed.progress).toBe('pages 3-4');
    expect(draft.input.source.fields.progress).toEqual(known('pages 1-2'));
    expect(Object.isFrozen(draft.input.source.fields)).toBe(true);
    rejectsCode(() => prepareLessonJournalReview(draft, ['lessonMemo'], at(2)), 'selected_field_not_changeable');
  });
  it('detects an entirely unchanged draft', () => {
    const value = input(); value.teacherPlan.proposed = { progress: 'pages 1-2' };
    expect(createLessonJournalDraft(value).status).toBe('noop');
  });
  it('does not copy the unselected or blocked fields into selected actions', () => {
    const value = input(); value.teacherPlan.proposed.studentPersistentMemo = 'not a journal field';
    value.policy.fieldRules = value.policy.fieldRules.filter(rule => rule.field === 'progress');
    const draft = createLessonJournalDraft(value);
    expect(draft.fields.find(field => field.field === 'studentPersistentMemo')?.blockers).toContain('unsupported_field');
    const review = prepareLessonJournalReview(draft, ['progress'], at(2));
    expect(review.actions.map(action => action.field)).toEqual(['progress']);
    expect(review.actions[0]).toMatchObject({ method: 'GET', effect: 'mutation', operation: 'journal_progress_candidate',
      selector: { key: 'reqCmd', value: 'udtPrg' }, valueParameter: 'prg_txt', sourceTrigger: 'onfocusout', contractEvidence: 'static_candidate_only' });
  });
  it.each(['studentPersistentMemo', 'dailyTest', 'homeworkRate', 'notification', 'parentSend'])('blocks unsupported proposed field %s', field => {
    const value = input(); value.teacherPlan.proposed = { [field]: 'synthetic' };
    const draft = createLessonJournalDraft(value);
    expect(draft.status).toBe('blocked'); expect(draft.fields[0].blockers).toContain('unsupported_field');
  });
  it('distinguishes explicit zero, numeric zero, blank, missing and unknown before values', () => {
    const value = input(); value.source.fields.attendance = clone(known(0)); value.teacherPlan.proposed = { attendance: '' };
    const blank = createLessonJournalDraft(value);
    expect(blank.fields[0]).toMatchObject({ before: { value: 0 }, after: '', disposition: 'changed' });
    value.teacherPlan.proposed.attendance = 0;
    expect(createLessonJournalDraft(value).fields[0].disposition).toBe('noop');
    value.teacherPlan.proposed.attendance = '0';
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('invalid_after');
    value.source.fields.attendance = { state: 'unknown', reasonCode: 'not_read' };
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('unknown_before');
    delete value.source.fields.attendance;
    expect(createLessonJournalDraft(value).fields[0].before).toEqual({ state: 'unknown', reasonCode: 'field_not_read' });
  });
  it('validates only explicit local value rules, never inferred source attendance or length semantics', () => {
    const value = input(); value.teacherPlan.proposed.progress = 'x'.repeat(201);
    expect(createLessonJournalDraft(value).fields.find(field => field.field === 'progress')?.blockers).toContain('invalid_after');
    value.teacherPlan.proposed.progress = '😀'.repeat(200);
    expect(createLessonJournalDraft(value).fields.find(field => field.field === 'progress')?.disposition).toBe('changed');
    value.policy.fieldRules.find(rule => rule.field === 'attendance')!.domain = { kind: 'text', maxCodePoints: 20 };
    rejectsCode(() => createLessonJournalDraft(value), 'invalid_field_domain');
  });
  it('rejects academy scope expansion and unsupported or duplicate policy fields', () => {
    const bad = input(); (bad.policy as unknown as { otherAcademyOperations: string }).otherAcademyOperations = 'writes_allowed';
    rejectsCode(() => createLessonJournalDraft(bad), 'academy_scope_expansion');
    const duplicate = input(); duplicate.policy.fieldRules.push(clone(duplicate.policy.fieldRules[0]));
    rejectsCode(() => createLessonJournalDraft(duplicate), 'duplicate_field_rule');
    const unsupported = input(); (unsupported.policy.fieldRules[0] as unknown as { field: string }).field = 'studentMemo';
    rejectsCode(() => createLessonJournalDraft(unsupported), 'unsupported_policy_field');
  });
  it.each(['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'] as const)('requires exact teacher-plan %s', key => {
    const value = input(); value.teacherPlan.target[key] = key === 'lessonDate' ? '2026-10-02' : 'different-synthetic';
    rejectsCode(() => createLessonJournalDraft(value), 'teacher_plan_target_mismatch');
  });
  it.each(['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'] as const)('requires independently proven %s', key => {
    const value = input(); if (value.source.proof.state !== 'verified') throw new Error('fixture');
    value.source.proof.target[key] = key === 'lessonDate' ? '2026-10-02' : 'different-synthetic';
    rejectsCode(() => createLessonJournalDraft(value), 'target_proof_mismatch');
  });
  it('keeps unknown teacher/occurrence proof blocked, even when a DOM row target is present', () => {
    const value = input(); value.source.proof = { state: 'unknown', reasonCode: 'row_tuple_only' };
    expect(createLessonJournalDraft(value).fields.every(field => field.blockers.includes('unverified_target'))).toBe(true);
  });
  it('blocks stale source, expired proof, source UI echo, and cancelled teacher plans', () => {
    const value = input(); value.createdAt = at(400);
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('stale_source');
    value.createdAt = at(1); value.source.readOrigin = 'source_ui_echo';
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('source_ui_echo');
    value.source.readOrigin = 'independent_authoritative_read'; value.teacherPlan.status = 'cancelled';
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('cancelled_plan');
    if (value.source.proof.state === 'verified') value.source.proof.validUntil = at(1);
    expect(createLessonJournalDraft(value).fields[0].blockers).toContain('unverified_target');
  });
  it('rejects impossible calendar dates and unknown attributes including authentication metadata', () => {
    const date = input(); date.source.target.lessonDate = '2026-02-30';
    rejectsCode(() => createLessonJournalDraft(date), 'invalid_lesson_date');
    const extra = { ...input(), cookie: 'synthetic-not-a-secret' };
    rejectsCode(() => createLessonJournalDraft(extra), 'invalid_shape');
    const bad = input(); (bad.source.fields.progress as unknown as { headers: object }).headers = {};
    rejectsCode(() => createLessonJournalDraft(bad), 'invalid_shape');
  });
  it.each([[], ['progress', 'progress'], ['lessonMemo'], ['notAField']].map(selected => ({ selected })))('rejects invalid selections %j', ({ selected }) => {
    const draft = createLessonJournalDraft(input());
    expect(() => prepareLessonJournalReview(draft, selected as JournalField[], at(2))).toThrow();
  });
  it('produces deterministic hashes across object keys, selections, policy and plan reference order', () => {
    const one = input(); const two = input();
    two.teacherPlan.proposed = Object.fromEntries(Object.entries(two.teacherPlan.proposed).reverse());
    two.source.fields = Object.fromEntries(Object.entries(two.source.fields).reverse());
    for (const value of [one, two]) value.source.fields.progress = { state: 'known', value: 'pages 1-2', evidenceRefs: ['synthetic-a', 'synthetic-b'] };
    if (two.source.fields.progress?.state === 'known') two.source.fields.progress.evidenceRefs.reverse();
    two.policy.fieldRules.reverse(); two.teacherPlan.provenanceRefs.reverse();
    const enumeration = two.policy.fieldRules.find(rule => rule.field === 'attendance')!.domain;
    if (enumeration.kind === 'enumeration') enumeration.values.reverse();
    const a = createLessonJournalDraft(one); const b = createLessonJournalDraft(two);
    expect(a.integrityDigest).toBe(b.integrityDigest);
    expect(prepareLessonJournalReview(a, ['progress', 'homework'], at(2))).toEqual(prepareLessonJournalReview(b, ['homework', 'progress'], at(2)));
  });
});

describe('approval-bound non-executing plans', () => {
  it('requires a verifier port and never accepts a teacher-plan approved status or caller boolean', () => {
    const f = fixture();
    rejectsCode(() => gateLessonJournalReview(f.request, undefined as unknown as JournalApprovalVerifierPort), 'approval_verifier_required');
    const value = input(); value.teacherPlan.status = 'approved'; const draft = createLessonJournalDraft(value);
    const request = { ...f.request, currentDraft: draft, review: prepareLessonJournalReview(draft, ['progress'], at(2)) };
    rejectsCode(() => gateLessonJournalReview(request, { verify: () => ({ status: 'rejected', reason: 'not_found' }) }), 'approval_not_found');
    rejectsCode(() => gateLessonJournalReview({ ...f.request, approved: true } as JournalGateRequest, f.verifier), 'invalid_shape');
  });
  it('returns a frozen non-executing plan and append-only metadata audit, without constructing a request URL', () => {
    const f = fixture(); const result = f.gate();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toMatchObject({ reviewDigest: f.review.integrityDigest, draftDigest: f.draft.integrityDigest, purpose: 'non_executing_plan' });
    expect(result.plan).toMatchObject({ execution: 'not_supported', automaticRetryAllowed: false, persistence: 'not_established' });
    expect(result.plan.review.actions).toHaveLength(2);
    expect(result.history[0]).toMatchObject({ event: 'plan_prepared', status: 'prepared_non_executing' });
    expect(Object.keys(result.history[0])).not.toContain('fields');
    expect(Object.isFrozen(result.plan.review.actions[0].destination)).toBe(true);
    expect(Object.keys(result.plan)).not.toContain('requestUrl');
  });
  it.each(['revoked', 'expired', 'replayed', 'not_found', 'mismatch'] as const)('honors verifier %s decision', reason => {
    const f = fixture(); rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => ({ status: 'rejected', reason }) }), `approval_${reason}`);
  });
  it('fails closed on verifier exceptions or malformed approved responses', () => {
    const f = fixture(); rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => { throw new Error('private provider detail'); } }), 'approval_verifier_failed');
    rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => ({ approved: true }) as unknown as JournalApprovalDecision }), 'approval_unverified');
  });
  it.each(['receiptRef', 'attemptId', 'reviewDigest', 'draftDigest', 'scope', 'useState'] as const)('rejects mismatched receipt %s', key => {
    const f = fixture(); (f.decision as unknown as Record<string, unknown>)[key] = 'changed';
    rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => f.decision }), 'approval_binding_mismatch');
  });
  it.each(['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'] as const)('rejects receipt for other %s', key => {
    const f = fixture(); f.decision.target[key] = key === 'lessonDate' ? '2026-10-02' : 'other-synthetic';
    rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => f.decision }), 'approval_binding_mismatch');
  });
  it.each([
    ['expiresAt', at(5)], ['approvedAt', at(1)], ['approvedAt', at(6)], ['checkedAt', at(4)],
  ] as const)('rejects stale or invalid approval timestamp %s=%s', (key, value) => {
    const f = fixture(); f.decision[key] = value;
    rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => f.decision }), 'approval_not_current');
  });
  it('enforces policy approval lifetime even when receipt expiry is longer', () => {
    const f = fixture(); f.request.now = at(400); f.request.freshSource.observedAt = at(399);
    f.decision.checkedAt = at(400); f.decision.expiresAt = at(500);
    rejectsCode(() => gateLessonJournalReview(f.request, { verify: () => f.decision }), 'approval_not_current');
  });
  it('requires a distinct independent read after approval', () => {
    const f = fixture(); f.request.freshSource.observationId = f.request.currentDraft.input.source.observationId;
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'independent_fresh_read_required');
    f.request.freshSource.observationId = 'different'; f.request.freshSource.observedAt = at(3);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'postapproval_fresh_read_required');
  });
  it.each(['sourceVersion', 'sourceContractVersion', 'readContractRef'] as const)('forces rereview when fresh %s changes after approval', key => {
    const f = fixture(); f.request.freshSource[key] = 'changed-version';
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'stale_source_requires_rereview');
    expect(f.calls).toHaveLength(0);
  });
  it('forces rereview after selected or unselected source edits, without inventing backend CAS', () => {
    for (const field of ['progress', 'attendance'] as const) {
      const f = fixture(); f.request.freshSource.fields[field] = clone(known('other edit'));
      rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'stale_source_requires_rereview');
    }
  });
  it('forces rereview after payload, policy, source contract or teacher-plan revision edits', () => {
    const f = fixture(); const next = clone(f.draft.input); next.teacherPlan.proposed.progress = 'edited'; next.createdAt = at(2);
    f.request.currentDraft = clone(reviseLessonJournalDraft(f.draft, next));
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'edited_draft_requires_rereview');
    expect(f.request.currentDraft.input.previousDraftDigest).toBe(f.draft.integrityDigest);
    const newlyReviewed = prepareLessonJournalReview(f.request.currentDraft, ['progress', 'homework'], at(2));
    f.request.review = clone(newlyReviewed);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'approval_binding_mismatch');
  });
  it.each(['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'] as const)('rejects fresh read for other %s', key => {
    const f = fixture(); const changed = key === 'lessonDate' ? '2026-10-02' : 'other-synthetic';
    f.request.freshSource.target[key] = changed;
    if (f.request.freshSource.proof.state === 'verified') f.request.freshSource.proof.target[key] = changed;
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'fresh_target_mismatch');
  });
  it.each(['method', 'operation', 'valueParameter', 'before', 'after', 'sourceVersion', 'sourceContractVersion'] as const)('hash binds action %s; rehashing cannot change the derived action', key => {
    const f = fixture(); (f.request.review.actions[0] as unknown as Record<string, unknown>)[key] = 'changed';
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'integrity_mismatch');
    const { integrityDigest: _old, ...body } = f.request.review; f.request.review.integrityDigest = digest(body);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'review_derivation_mismatch');
  });
  it('hash binds destination and current selected field list', () => {
    const f = fixture(); f.request.review.actions[0].destination.origin = 'https://other.invalid';
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'integrity_mismatch');
    const second = fixture(); second.request.review.selectedFields = ['progress'];
    rejectsCode(() => gateLessonJournalReview(second.request, second.verifier), 'integrity_mismatch');
  });
  it('rejects reused receipts and attempts from retained history, including a new attempt ID', () => {
    const f = fixture(); const first = f.gate(); f.request.history = clone(first.history);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'replayed_approval_or_attempt');
    f.request.attemptId = 'synthetic-attempt-2';
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'replayed_approval_or_attempt');
  });
  it('new attempt and receipt IDs cannot bypass an unreconciled prior target', () => {
    const f = fixture(); const first = f.gate();
    f.request.attemptId = 'synthetic-attempt-2'; f.request.receiptRef = 'synthetic-receipt-2'; f.request.history = clone(first.history);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'unreconciled_prior_attempt');
    const reported = recordLessonJournalOutcomes(first.plan, [], at(7), first.history);
    f.request.history = clone(reported.history);
    rejectsCode(() => gateLessonJournalReview(f.request, f.verifier), 'unreconciled_prior_attempt');
  });
  it('a reconciled partial effect requires a newly based draft and new exact approval', () => {
    const f = completedAttempt(); f.readback.fields.progress = clone(known('pages 1-2'));
    const reconciled = verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history);
    const request = clone(f.request); request.attemptId = 'synthetic-attempt-2'; request.receiptRef = 'synthetic-receipt-2'; request.history = clone(reconciled.history);
    rejectsCode(() => gateLessonJournalReview(request, f.verifier), 'prior_attempt_requires_fresh_draft');
    const next = input(); next.source = clone(f.readback); next.source.observationId = 'synthetic-new-before'; next.source.observedAt = at(10);
    next.createdAt = at(11); next.teacherPlan.basedOnSourceVersion = next.source.sourceVersion; next.teacherPlan.revisionId = 'synthetic-plan-revision-2';
    const draft = reviseLessonJournalDraft(f.draft, next); const review = prepareLessonJournalReview(draft, ['progress'], at(12));
    const fresh = clone(next.source); fresh.observationId = 'synthetic-new-preflight'; fresh.observedAt = at(14);
    const second = gateLessonJournalReview({ ...request, now: at(15), currentDraft: draft, review, freshSource: fresh }, { verify: () => ({ ...f.decision,
      receiptRef: request.receiptRef, attemptId: request.attemptId, draftDigest: draft.integrityDigest, reviewDigest: review.integrityDigest,
      approvedAt: at(13), checkedAt: at(15),
    }) });
    expect(second.plan.review.actions.map(action => action.field)).toEqual(['progress']);
    expect(second.plan.execution).toBe('not_supported');
  });
  it('isolates the plan and history from verifier side mutations of original caller inputs', () => {
    const f = fixture(); const originalAfter = f.request.review.actions[0].after;
    const result = gateLessonJournalReview(f.request, { verify: () => {
      f.request.review.actions[0].after = 'attempted late mutation';
      f.request.currentDraft.input.teacherPlan.proposed.homework = 'attempted late mutation';
      return f.decision;
    } });
    expect(result.plan.review.actions[0].after).toBe(originalAfter);
    expect(result.plan.draft.input.teacherPlan.proposed.homework).toBe('pages 5-6');
  });
});

describe('per-field outcomes, independent readback and recovery', () => {
  it('treats even all-success transport responses as awaiting independent readback', () => {
    const f = completedAttempt(); expect(f.reported.report.status).toBe('awaiting_readback');
    expect(f.reported.report.automaticRetryAllowed).toBe(false);
    const verified = verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history);
    expect(verified.result.status).toBe('persisted');
    expect(verified.result.attribution).toBe('current_values_observed_not_causal_proof');
    expect(verified.result.automaticRetryAllowed).toBe(false);
    expect(verified.history.map(entry => entry.event)).toEqual(['plan_prepared', 'outcomes_reported', 'readback_checked']);
    validateJournalAuditHistory(verified.history);
  });
  it.each(['unknown', 'reported_failure'] as const)('stops blind retry after mixed success and %s', status => {
    const outcomes = successOutcomes(); outcomes[1] = { ...outcomes[1], status };
    const f = completedAttempt(outcomes); expect(f.reported.report.status).toBe('reconciliation_required');
    rejectsCode(() => recordLessonJournalOutcomes(f.plan, outcomes, at(8), f.reported.history), 'outcomes_already_recorded');
    const request = { ...f.request, history: f.reported.history };
    rejectsCode(() => gateLessonJournalReview(request, f.verifier), 'replayed_approval_or_attempt');
    // A lost response can still be reconciled as persisted by independent same-target evidence.
    expect(verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history).result.status).toBe('persisted');
  });
  it('missing field outcomes, including no receipt, require reconciliation', () => {
    for (const outcomes of [[], successOutcomes().slice(0, 1)]) expect(completedAttempt(outcomes).reported.report.status).toBe('reconciliation_required');
  });
  it.each([
    ['partial_persistence', 'pages 1-2'], ['partial_persistence', 'unexpected value'],
  ] as const)('reports %s rather than retrying when one readback field is %s', (status, value) => {
    const f = completedAttempt(); f.readback.fields.progress = clone(known(value));
    const result = verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history).result;
    expect(result.status).toBe(status); expect(result.recovery).toBe('fresh_draft_and_exact_approval_required_for_any_new_change');
  });
  it('distinguishes unchanged, conflicting, missing, and unknown final values', () => {
    const f = completedAttempt(); f.readback.fields = clone(source().fields);
    expect(verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history).result.status).toBe('not_persisted');
    f.readback.fields.progress = clone(known('conflicting'));
    expect(verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history).result.status).toBe('unresolved');
    delete f.readback.fields.progress; f.readback.fields.homework = { state: 'unknown', reasonCode: 'field_read_failed' };
    expect(verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history).result.fields.every(field => field.persistence === 'unknown')).toBe(true);
  });
  it('allows later independent reads to resolve uncertainty, without retrying any write', () => {
    const f = completedAttempt(); f.readback.fields.progress = { state: 'unknown', reasonCode: 'read_incomplete' };
    const partial = verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history);
    expect(partial.result.status).toBe('partial_persistence');
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(10), partial.history), 'new_reconciliation_read_required');
    f.readback.observationId = 'synthetic-later-readback'; f.readback.observedAt = at(10); f.readback.fields.progress = clone(known('pages 3-4'));
    const resolved = verifyLessonJournalReadback(f.reported.report, f.readback, at(11), partial.history);
    expect(resolved.result.status).toBe('persisted');
    expect(resolved.result.readbackDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(resolved.history.filter(entry => entry.event === 'readback_checked')).toHaveLength(2);
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(12), resolved.history), 'readback_already_resolved');
  });
  it('does not accept source UI echo as independent readback', () => {
    const f = completedAttempt(); f.readback.readOrigin = 'source_ui_echo';
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history), 'readback_not_verified');
  });
  it.each(['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'] as const)('rejects wrong readback %s', key => {
    const f = completedAttempt(); const changed = key === 'lessonDate' ? '2026-10-02' : 'other-synthetic';
    f.readback.target[key] = changed; if (f.readback.proof.state === 'verified') f.readback.proof.target[key] = changed;
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history), 'readback_target_mismatch');
  });
  it('requires postattempt observation and rejects stale, reused or contract-changed reads', () => {
    const f = completedAttempt(); f.readback.observedAt = at(7);
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history), 'independent_postattempt_read_required');
    f.readback.observedAt = at(8); f.readback.observationId = f.plan.preflightSource.observationId;
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history), 'independent_postattempt_read_required');
    f.readback.observationId = 'new-read'; f.readback.sourceContractVersion = 'changed';
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.reported.history), 'readback_contract_changed');
    f.readback.sourceContractVersion = 'synthetic-contract-1';
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(400), f.reported.history), 'readback_not_verified');
  });
  it('rejects duplicate outcomes, nonselected fields and backwards outcome time', () => {
    const f = fixture().gate(); const outcomes = successOutcomes();
    rejectsCode(() => recordLessonJournalOutcomes(f.plan, [...outcomes, outcomes[0]], at(7), f.history), 'duplicate_field_outcome');
    rejectsCode(() => recordLessonJournalOutcomes(f.plan, [{ ...outcomes[0], field: 'attendance' }], at(7), f.history), 'invalid_field_outcome');
    rejectsCode(() => recordLessonJournalOutcomes(f.plan, [{ ...outcomes[0], finishedAt: at(4) }], at(7), f.history), 'invalid_outcome_time');
  });
  it('requires trusted complete prior history and validates its immutable chain', () => {
    const f = completedAttempt();
    rejectsCode(() => recordLessonJournalOutcomes(f.plan, successOutcomes(), at(7), []), 'plan_not_in_history');
    rejectsCode(() => verifyLessonJournalReadback(f.reported.report, f.readback, at(9), f.history), 'outcomes_not_in_history');
    const changed = clone(f.reported.history); changed[0].status = 'changed';
    rejectsCode(() => validateJournalAuditHistory(changed), 'integrity_mismatch');
    const reordered = [...f.reported.history].reverse();
    rejectsCode(() => validateJournalAuditHistory(reordered), 'broken_audit_chain');
  });
  it('orders outcome records deterministically', () => {
    const f = fixture().gate();
    expect(recordLessonJournalOutcomes(f.plan, successOutcomes(), at(7), f.history)).toEqual(
      recordLessonJournalOutcomes(f.plan, successOutcomes().reverse(), at(7), f.history));
  });
  it('source candidate mapping remains exactly the four inspected journal controls', () => {
    const draft = createLessonJournalDraft(input());
    const review = prepareLessonJournalReview(draft, ['attendance', 'homework', 'progress'], at(2));
    expect(JOURNAL_FIELDS).toEqual(['progress', 'homework', 'lessonMemo', 'attendance']);
    expect(review.actions.find(action => action.field === 'attendance')).toMatchObject({ selector: { key: 'reqCmd', value: 'udtAttn' }, valueParameter: 'attn_yn', sourceTrigger: 'onchange' });
    const value = input(); value.teacherPlan.proposed = { lessonMemo: 'synthetic lesson note' };
    expect(prepareLessonJournalReview(createLessonJournalDraft(value), ['lessonMemo'], at(2)).actions[0]).toMatchObject({ selector: { key: 'reqCmd', value: 'udtMemo' }, valueParameter: 'memo_txt' });
  });
});
