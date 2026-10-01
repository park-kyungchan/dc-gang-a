/** Six-field review presentation. Reuses the existing four-field HITL domain; no writer. */
import { assertDate, assertInstant, canonicalJson, digest, immutableCopy, requireText } from '../learning/model';
import { createLessonJournalDraft, REQUIRED_JOURNAL_REVIEW_FIELDS,
  type JournalDraft, type JournalScalar, type JournalTarget, type JournalTargetProof, type JournalValue,
} from './lessonJournalHitl';

export type AssessmentReviewField = 'previousHomeworkAssessment' | 'dailyTestAssessment';
export type JournalReviewGrouping = 'selected_fields' | 'student_lesson' | 'whole_lesson';
export interface JournalReviewRow {
  readonly field: typeof REQUIRED_JOURNAL_REVIEW_FIELDS[number];
  readonly target: JournalTarget | null;
  readonly before: JournalValue;
  readonly after: JournalScalar | null;
  readonly disposition: 'changed' | 'noop' | 'blocked' | 'not_proposed';
  readonly blockers: readonly string[];
}
export interface AssessmentReviewInput {
  readonly field: AssessmentReviewField;
  readonly target: JournalTarget;
  readonly proof: JournalTargetProof;
  readonly before: JournalValue;
  readonly after: JournalScalar;
  readonly observedAt: string;
  readonly readOrigin: 'independent_authoritative_read' | 'source_ui_echo';
  readonly readContractRef: string;
}

function scalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0));
}
function validateTarget(target: JournalTarget): void {
  if (Object.keys(target).sort().join(',') !== ['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate'].sort().join(',')) {
    throw new Error('invalid_assessment_target');
  }
  Object.values(target).forEach(value => requireText(value, 'target identity')); assertDate(target.lessonDate);
}

/** Grouping is a presentation choice, never a requirement to save all six fields. */
export function buildLessonJournalReviewBundle(
  draft: JournalDraft, assessments: readonly AssessmentReviewInput[], now: string,
  grouping: JournalReviewGrouping = 'selected_fields',
) {
  assertInstant(now);
  if (canonicalJson(draft) !== canonicalJson(createLessonJournalDraft(draft.input))) throw new Error('invalid_core_draft');
  if (!['selected_fields', 'student_lesson', 'whole_lesson'].includes(grouping)) throw new Error('invalid_review_grouping');
  if (assessments.length > 2 || new Set(assessments.map(item => item.field)).size !== assessments.length) throw new Error('duplicate_assessment_field');
  const current = draft.input.source.target;
  const coreAge = Date.parse(now) - Date.parse(draft.input.source.observedAt);
  const currentTimeBlockers: string[] = [];
  if (coreAge < 0 || coreAge > draft.input.policy.maxSourceAgeMs) currentTimeBlockers.push('stale_source');
  const currentProof = draft.input.source.proof;
  if (currentProof.state !== 'verified' || Date.parse(currentProof.verifiedAt) > Date.parse(now)
    || Date.parse(currentProof.validUntil) <= Date.parse(now)) currentTimeBlockers.push('unverified_target');
  const assessmentRows = assessments.map(item => {
    if (!['previousHomeworkAssessment', 'dailyTestAssessment'].includes(item.field)) throw new Error('invalid_assessment_field');
    validateTarget(item.target); assertInstant(item.observedAt); requireText(item.readContractRef, 'read contract');
    if (!scalar(item.after)) throw new Error('invalid_assessment_value');
    if (item.before.state === 'known') {
      if (!scalar(item.before.value) || !item.before.evidenceRefs.length) throw new Error('invalid_assessment_before');
      item.before.evidenceRefs.forEach(ref => requireText(ref, 'evidence reference'));
    } else if (item.before.state === 'unknown') requireText(item.before.reasonCode, 'unknown reason');
    else throw new Error('invalid_assessment_before');
    const blockers: string[] = ['assessment_write_adapter_not_verified'];
    if (item.field === 'dailyTestAssessment') {
      if (canonicalJson(item.target) !== canonicalJson(current)) blockers.push('current_assessment_target_mismatch');
    } else if (item.target.studentId !== current.studentId || item.target.cmId !== current.cmId
      || item.target.teacherId !== current.teacherId || item.target.recordId === current.recordId
      || item.target.occurrenceId === current.occurrenceId || item.target.lessonDate > current.lessonDate) {
      blockers.push('previous_assessment_requires_separate_record');
    }
    if (item.readOrigin !== 'independent_authoritative_read') blockers.push('source_ui_echo');
    if (item.before.state !== 'known') blockers.push('unknown_before');
    const age = Date.parse(now) - Date.parse(item.observedAt);
    if (age < 0 || age > draft.input.policy.maxSourceAgeMs) blockers.push('stale_assessment_source');
    const proof = item.proof;
    if (proof.state !== 'verified') blockers.push('unverified_assessment_target');
    else {
      assertInstant(proof.verifiedAt); assertInstant(proof.validUntil);
      if (proof.kind !== 'independent_teacher_and_occurrence'
        || canonicalJson(proof.target) !== canonicalJson(item.target)
        || !proof.teacherEvidenceRef?.trim() || !proof.occurrenceEvidenceRef?.trim()
        || Date.parse(proof.verifiedAt) > Date.parse(item.observedAt)
        || Date.parse(proof.validUntil) <= Date.parse(now)) blockers.push('unverified_assessment_target');
    }
    return { field: item.field, target: item.target, before: item.before, after: item.after,
      disposition: 'blocked' as const, blockers };
  });
  const fields: readonly JournalReviewRow[] = REQUIRED_JOURNAL_REVIEW_FIELDS.map(field => {
    if (field === 'previousHomeworkAssessment' || field === 'dailyTestAssessment') {
      return assessmentRows.find(row => row.field === field) ?? { field,
        target: field === 'dailyTestAssessment' ? current : null,
        before: { state: 'unknown' as const, reasonCode: 'assessment_not_read' }, after: null,
        disposition: 'blocked' as const, blockers: ['assessment_not_read', 'assessment_write_adapter_not_verified'] };
    }
    const core = draft.fields.find(row => row.field === field);
    if (core) {
      const blockers = [...new Set([...core.blockers, ...currentTimeBlockers])];
      return { ...core, field, target: current, blockers,
        disposition: blockers.length ? 'blocked' as const : core.disposition };
    }
    return { field, target: current,
      before: draft.input.source.fields[field] ?? { state: 'unknown' as const, reasonCode: 'field_not_read' },
      after: null, disposition: 'not_proposed' as const, blockers: [] as string[] };
  });
  const body = { kind: 'six_field_journal_review' as const, grouping,
    groupingPolicy: 'presentation_only_no_mandatory_batch' as const,
    execution: 'not_supported' as const, currentTarget: current, fields,
    separatePreviousTarget: fields.find(field => field.field === 'previousHomeworkAssessment')!.target,
    coreDraftDigest: draft.integrityDigest,
    requiredWriteBoundary: 'exact_selected_field_target_diff_approval_and_independent_readback' as const,
  };
  return immutableCopy({ ...body, integrityDigest: digest(body) });
}
