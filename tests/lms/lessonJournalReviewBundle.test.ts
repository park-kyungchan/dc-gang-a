import { describe, expect, it } from 'bun:test';
import { createLessonJournalDraft, DEFAULT_JOURNAL_POLICY, type JournalTarget } from '../../src/lms/lessonJournalHitl';
import { buildLessonJournalReviewBundle, type AssessmentReviewInput } from '../../src/lms/lessonJournalReviewBundle';

const at = '2026-10-01T04:30:00Z';
const target: JournalTarget = { teacherId: 'synthetic-teacher', studentId: 'synthetic-student',
  courseId: 'synthetic-course', recordId: 'synthetic-current', cmId: 'synthetic-membership',
  occurrenceId: 'synthetic-current-occurrence', lessonDate: '2026-10-01' };
const known = (value: string) => ({ state: 'known' as const, value, evidenceRefs: ['synthetic-source'] });
const draft = () => createLessonJournalDraft({ draftId: 'synthetic-draft', revision: 1, previousDraftDigest: null,
  createdAt: at, policy: DEFAULT_JOURNAL_POLICY, recoveryPlanRef: 'synthetic-recovery',
  source: { kind: 'source_snapshot', target, proof: { state: 'unknown', reasonCode: 'not_verified' },
    observationId: 'synthetic-observation', observedAt: at, sourceVersion: 'synthetic-v1',
    sourceContractVersion: 'synthetic-v1', readContractRef: 'synthetic-contract',
    readOrigin: 'independent_authoritative_read', fields: { progress: known('before') } },
  teacherPlan: { kind: 'teacher_plan', planId: 'synthetic-plan', revisionId: 'synthetic-plan-v1',
    teacherId: target.teacherId, target, status: 'draft', basedOnSourceVersion: 'synthetic-v1',
    proposed: { progress: 'after' }, provenanceRefs: ['synthetic-teacher'] } });
function assessment(field: AssessmentReviewInput['field']): AssessmentReviewInput {
  const bound = field === 'previousHomeworkAssessment' ? { ...target, recordId: 'synthetic-prior',
    occurrenceId: 'synthetic-prior-occurrence', lessonDate: '2026-09-30' } : target;
  return { field, target: bound, proof: { state: 'verified', kind: 'independent_teacher_and_occurrence',
    target: bound, teacherEvidenceRef: 'synthetic-teacher-proof', occurrenceEvidenceRef: 'synthetic-occurrence-proof',
    verifiedAt: at, validUntil: '2026-10-01T04:40:00Z' },
    before: known('-1'), after: '1', observedAt: at, readOrigin: 'independent_authoritative_read', readContractRef: 'synthetic-read' };
}

describe('six-field lesson-journal review wiring', () => {
  it('always shows six fields with missing assessment evidence explicitly blocked', () => {
    const result = buildLessonJournalReviewBundle(draft(), [], at);
    expect(result.fields).toHaveLength(6); expect(result.execution).toBe('not_supported');
    expect(result.separatePreviousTarget).toBeNull();
    expect(result.fields.find(field => field.field === 'previousHomeworkAssessment')!.blockers).toContain('assessment_not_read');
    expect(result.grouping).toBe('selected_fields'); expect(result.groupingPolicy).toBe('presentation_only_no_mandatory_batch');
  });
  it('keeps prior homework on its own occurrence and daily test on the current occurrence', () => {
    const result = buildLessonJournalReviewBundle(draft(), [assessment('previousHomeworkAssessment'), assessment('dailyTestAssessment')], at, 'student_lesson');
    expect(result.separatePreviousTarget!.recordId).toBe('synthetic-prior');
    expect(result.fields.find(field => field.field === 'dailyTestAssessment')!.target!.recordId).toBe('synthetic-current');
    expect(result.fields.filter(field => field.field.endsWith('Assessment')).every(field => field.blockers.includes('assessment_write_adapter_not_verified'))).toBe(true);
  });
  it('current record cannot be reused for previous homework even with a matching membership', () => {
    const input = assessment('previousHomeworkAssessment');
    const result = buildLessonJournalReviewBundle(draft(), [{ ...input, target }], at);
    expect(result.fields.find(field => field.field === input.field)!.blockers).toContain('previous_assessment_requires_separate_record');
  });
  it('UI echoes, expired proof, stale source and missing values cannot become verified assessment before-state', () => {
    const input = assessment('dailyTestAssessment');
    const result = buildLessonJournalReviewBundle(draft(), [{ ...input, readOrigin: 'source_ui_echo',
      proof: { state: 'unknown', reasonCode: 'not_verified' }, before: { state: 'unknown', reasonCode: 'not_read' } }], '2026-10-01T04:36:00Z');
    expect(result.fields.find(field => field.field === input.field)!.blockers).toEqual([
      'assessment_write_adapter_not_verified', 'source_ui_echo', 'unknown_before', 'stale_assessment_source', 'unverified_assessment_target',
    ]);
  });
  it('whole-lesson review remains an optional presentation choice and never approval', () => {
    const result = buildLessonJournalReviewBundle(draft(), [], at, 'whole_lesson');
    expect(result.grouping).toBe('whole_lesson'); expect('approval' in result).toBe(false);
    expect(Object.isFrozen(result.fields)).toBe(true);
  });
  it('an old core draft cannot stay fresh just because its original digest is valid', () => {
    const result = buildLessonJournalReviewBundle(draft(), [], '2026-10-01T04:36:00Z');
    expect(result.fields.find(field => field.field === 'progress')!.blockers).toContain('stale_source');
  });
  it('detects tampered core drafts and duplicate assessment fields', () => {
    expect(() => buildLessonJournalReviewBundle({ ...draft(), status: 'reviewable' }, [], at)).toThrow('invalid_core_draft');
    const input = assessment('dailyTestAssessment');
    expect(() => buildLessonJournalReviewBundle(draft(), [input, input], at)).toThrow('duplicate_assessment_field');
  });
});
