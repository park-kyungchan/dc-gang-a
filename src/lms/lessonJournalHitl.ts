/**
 * Post-class lesson-journal HITL domain model. No network, credentials, browser,
 * storage, Sheets, scheduler, sender, or executable request builder lives here.
 * Hashes detect changes; they are not signatures, permissions, or backend CAS.
 */
import {
  assertDate, assertExactKeys, assertInstant, canonicalJson, digest, immutableCopy,
} from '../learning/model';

export const JOURNAL_FIELDS = ['progress', 'homework', 'lessonMemo', 'attendance'] as const;
/** Confirmed business requirements, distinct from the four inspected write candidates. */
export const REQUIRED_JOURNAL_REVIEW_FIELDS = [
  'attendance', 'progress', 'homework', 'lessonMemo', 'previousHomeworkAssessment', 'dailyTestAssessment',
] as const;
export type JournalField = typeof JOURNAL_FIELDS[number];
export type JournalScalar = string | number | boolean;
export type JournalValue =
  | Readonly<{ state: 'known'; value: JournalScalar; evidenceRefs: readonly string[] }>
  | Readonly<{ state: 'unknown'; reasonCode: string }>;

export interface JournalTarget {
  readonly teacherId: string;
  readonly studentId: string;
  readonly courseId: string;
  readonly recordId: string;
  readonly cmId: string;
  readonly occurrenceId: string;
  readonly lessonDate: string;
}

export type JournalTargetProof =
  | Readonly<{ state: 'unknown'; reasonCode: string }>
  | Readonly<{
      state: 'verified';
      /** Must originate in a reviewed reader, never from UI view date/session defaults. */
      kind: 'independent_teacher_and_occurrence';
      target: JournalTarget;
      teacherEvidenceRef: string;
      occurrenceEvidenceRef: string;
      verifiedAt: string;
      validUntil: string;
    }>;

export interface JournalSourceSnapshot {
  readonly kind: 'source_snapshot';
  readonly target: JournalTarget;
  readonly proof: JournalTargetProof;
  readonly observationId: string;
  readonly observedAt: string;
  /** Content/version evidence, NOT a verified server conditional-write token. */
  readonly sourceVersion: string;
  readonly sourceContractVersion: string;
  readonly readContractRef: string;
  readonly readOrigin: 'independent_authoritative_read' | 'source_ui_echo';
  readonly fields: Readonly<Partial<Record<JournalField, JournalValue>>>;
}

export interface JournalTeacherPlan {
  readonly kind: 'teacher_plan';
  readonly planId: string;
  readonly revisionId: string;
  readonly teacherId: string;
  readonly target: JournalTarget;
  /** This learning-plan status can NEVER grant journal-write approval. */
  readonly status: 'draft' | 'approved' | 'cancelled';
  readonly basedOnSourceVersion: string;
  readonly proposed: Readonly<Record<string, JournalScalar>>;
  readonly provenanceRefs: readonly string[];
}

export interface JournalFieldRule {
  readonly field: JournalField;
  readonly validationRef: string;
  /** Local review policy only. This does not establish the site's wire/length rules. */
  readonly domain:
    | Readonly<{ kind: 'text'; maxCodePoints: number }>
    | Readonly<{ kind: 'enumeration'; values: readonly JournalScalar[] }>;
}

export interface JournalPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly scope: 'lesson_journal_only';
  readonly otherAcademyOperations: 'read_only';
  readonly fieldRules: readonly JournalFieldRule[];
  readonly maxSourceAgeMs: number;
  readonly maxApprovalAgeMs: number;
}

export const DEFAULT_JOURNAL_POLICY: JournalPolicy = immutableCopy({
  policyId: 'lesson-journal-default-deny', version: '1', scope: 'lesson_journal_only',
  otherAcademyOperations: 'read_only', fieldRules: [], maxSourceAgeMs: 300_000, maxApprovalAgeMs: 300_000,
});

const DESTINATION = immutableCopy({ origin: 'https://dc.gang-a.kr', path: '/servlet/controller.cct.tutor.DayRecordServlet' });
const CONTRACTS = immutableCopy({
  progress: { operation: 'journal_progress_candidate', selector: 'udtPrg', valueParameter: 'prg_txt', event: 'onfocusout' },
  homework: { operation: 'journal_homework_candidate', selector: 'udtHw', valueParameter: 'hw_txt', event: 'onfocusout' },
  lessonMemo: { operation: 'journal_memo_candidate', selector: 'udtMemo', valueParameter: 'memo_txt', event: 'onfocusout' },
  attendance: { operation: 'journal_attendance_candidate', selector: 'udtAttn', valueParameter: 'attn_yn', event: 'onchange' },
} as const);

export interface JournalDraftInput {
  readonly draftId: string;
  readonly revision: number;
  readonly previousDraftDigest: string | null;
  readonly createdAt: string;
  readonly source: JournalSourceSnapshot;
  readonly teacherPlan: JournalTeacherPlan;
  readonly policy: JournalPolicy;
  readonly recoveryPlanRef: string;
}
export type JournalBlocker = 'unsupported_field' | 'field_not_allowed' | 'unknown_before' | 'invalid_after' |
  'unverified_target' | 'stale_source' | 'source_ui_echo' | 'cancelled_plan';
export interface JournalDraftField {
  readonly field: string;
  readonly before: JournalValue;
  readonly after: JournalScalar;
  readonly disposition: 'changed' | 'noop' | 'blocked';
  readonly blockers: readonly JournalBlocker[];
}
export interface JournalDraft {
  readonly kind: 'lesson_journal_draft';
  readonly input: JournalDraftInput;
  readonly fields: readonly JournalDraftField[];
  readonly status: 'reviewable' | 'blocked' | 'noop';
  readonly integrityDigest: string;
}

export interface JournalFieldAction {
  readonly field: JournalField;
  readonly destination: typeof DESTINATION;
  readonly method: 'GET';
  readonly effect: 'mutation';
  readonly operation: string;
  readonly selector: Readonly<{ key: 'reqCmd'; value: string }>;
  readonly valueParameter: string;
  readonly sourceTrigger: 'onfocusout' | 'onchange';
  readonly target: JournalTarget;
  readonly before: JournalScalar;
  readonly after: JournalScalar;
  readonly sourceVersion: string;
  readonly sourceContractVersion: string;
  readonly contractEvidence: 'static_candidate_only';
}
export interface JournalReview {
  readonly kind: 'exact_journal_diff_review';
  readonly draftDigest: string;
  readonly preparedAt: string;
  readonly selectedFields: readonly JournalField[];
  readonly actions: readonly JournalFieldAction[];
  readonly recoveryPlanRef: string;
  readonly integrityDigest: string;
}

export interface JournalApprovalCheck {
  readonly receiptRef: string;
  readonly attemptId: string;
  readonly reviewDigest: string;
  readonly draftDigest: string;
  readonly target: JournalTarget;
  readonly now: string;
  readonly purpose: 'non_executing_plan';
}
export type JournalApprovalDecision =
  | Readonly<{ status: 'rejected'; reason: 'revoked' | 'expired' | 'replayed' | 'not_found' | 'mismatch' }>
  | Readonly<{
      status: 'verified';
      receiptRef: string;
      attemptId: string;
      reviewDigest: string;
      draftDigest: string;
      target: JournalTarget;
      approverId: string;
      approvedAt: string;
      expiresAt: string;
      checkedAt: string;
      scope: 'exact_lesson_journal_diff';
      useState: 'unused';
    }>;
/**
 * A TRUSTED integration must authenticate the reviewer and retrieve the actual
 * decision, exact digest, expiry, revocation and use state. No default verifier.
 * Caller booleans / teacherPlan.status are not receipts. This module cannot
 * authenticate an injected implementation or durably consume its receipts.
 */
export interface JournalApprovalVerifierPort {
  verify(check: JournalApprovalCheck): JournalApprovalDecision;
}

export interface JournalAuditEntry {
  readonly sequence: number;
  readonly previousDigest: string | null;
  readonly recordedAt: string;
  readonly event: 'plan_prepared' | 'outcomes_reported' | 'readback_checked';
  readonly targetDigest: string;
  readonly observationId: string | null;
  readonly evidenceObservedAt: string;
  readonly attemptId: string;
  readonly receiptRef: string;
  readonly draftDigest: string;
  readonly reviewDigest: string;
  readonly evidenceDigest: string;
  readonly status: string;
  readonly integrityDigest: string;
}
export interface PreparedJournalPlan {
  readonly kind: 'prepared_non_executing_journal_plan';
  readonly attemptId: string;
  readonly preparedAt: string;
  readonly draft: JournalDraft;
  readonly review: JournalReview;
  readonly approval: Extract<JournalApprovalDecision, { status: 'verified' }>;
  readonly preflightSource: JournalSourceSnapshot;
  readonly execution: 'not_supported';
  readonly automaticRetryAllowed: false;
  readonly persistence: 'not_established';
  readonly integrityDigest: string;
}
export interface JournalGateRequest {
  readonly attemptId: string;
  readonly receiptRef: string;
  readonly now: string;
  readonly currentDraft: JournalDraft;
  readonly review: JournalReview;
  readonly freshSource: JournalSourceSnapshot;
  /** Must be the complete, trusted append-only journal history, not an arbitrary subset. */
  readonly history: readonly JournalAuditEntry[];
}

export class JournalHitlRejected extends Error {
  constructor(public readonly code: string) {
    super(`Lesson journal HITL rejected: ${code}`);
    this.name = 'JournalHitlRejected';
  }
}
function reject(code: string): never { throw new JournalHitlRejected(code); }
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const supported = (name: string): name is JournalField => (JOURNAL_FIELDS as readonly string[]).includes(name);
const ref = (value: string) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:/#-]{0,255}$/.test(value)) reject('invalid_reference');
};
const exact = (value: object, keys: readonly string[]) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject('invalid_shape');
  try { assertExactKeys(value, keys); canonicalJson(value); } catch { reject('invalid_shape'); }
};
const instant = (value: string): number => {
  try { assertInstant(value); } catch { reject('invalid_timestamp'); }
  return Date.parse(value);
};
const refs = (values: readonly string[]) => {
  if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length) reject('invalid_references');
  values.forEach(ref);
};
const scalar = (value: unknown): value is JournalScalar =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0));
const hash = (value: string) => { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) reject('invalid_digest'); };
const sealed = <T extends object>(body: T): T & { readonly integrityDigest: string } =>
  immutableCopy({ ...body, integrityDigest: digest(body) });
function checkSeal(value: { readonly integrityDigest: string }): void {
  const { integrityDigest, ...body } = value;
  hash(integrityDigest);
  if (digest(body) !== integrityDigest) reject('integrity_mismatch');
}
function target(value: JournalTarget): void {
  exact(value, ['teacherId', 'studentId', 'courseId', 'recordId', 'cmId', 'occurrenceId', 'lessonDate']);
  [value.teacherId, value.studentId, value.courseId, value.recordId, value.cmId, value.occurrenceId].forEach(ref);
  try { assertDate(value.lessonDate); } catch { reject('invalid_lesson_date'); }
}
function proof(value: JournalTargetProof, expected: JournalTarget): void {
  if (value.state === 'unknown') { exact(value, ['state', 'reasonCode']); ref(value.reasonCode); return; }
  exact(value, ['state', 'kind', 'target', 'teacherEvidenceRef', 'occurrenceEvidenceRef', 'verifiedAt', 'validUntil']);
  if (value.state !== 'verified' || value.kind !== 'independent_teacher_and_occurrence') reject('invalid_target_proof');
  target(value.target);
  if (!same(value.target, expected)) reject('target_proof_mismatch');
  ref(value.teacherEvidenceRef); ref(value.occurrenceEvidenceRef);
  if (instant(value.validUntil) <= instant(value.verifiedAt)) reject('invalid_proof_period');
}
function knowledge(value: JournalValue): void {
  if (value.state === 'unknown') { exact(value, ['state', 'reasonCode']); ref(value.reasonCode); return; }
  exact(value, ['state', 'value', 'evidenceRefs']);
  if (value.state !== 'known' || !scalar(value.value)) reject('invalid_known_value');
  refs(value.evidenceRefs);
}
function snapshot(value: JournalSourceSnapshot): void {
  exact(value, ['kind', 'target', 'proof', 'observationId', 'observedAt', 'sourceVersion', 'sourceContractVersion', 'readContractRef', 'readOrigin', 'fields']);
  if (value.kind !== 'source_snapshot' || !['independent_authoritative_read', 'source_ui_echo'].includes(value.readOrigin)) reject('invalid_source_kind');
  target(value.target); proof(value.proof, value.target); instant(value.observedAt);
  [value.observationId, value.sourceVersion, value.sourceContractVersion, value.readContractRef].forEach(ref);
  exact(value.fields, Object.keys(value.fields));
  for (const [field, entry] of Object.entries(value.fields)) {
    if (!supported(field)) reject('unsupported_source_field');
    knowledge(entry);
  }
  if (value.proof.state === 'verified' && instant(value.proof.verifiedAt) > instant(value.observedAt)) reject('proof_after_observation');
}
function normalizedSnapshot(value: JournalSourceSnapshot): JournalSourceSnapshot {
  snapshot(value);
  return immutableCopy({ ...value, fields: Object.fromEntries(Object.entries(value.fields).map(([field, entry]) =>
    [field, entry.state === 'known' ? { ...entry, evidenceRefs: [...entry.evidenceRefs].sort() } : entry])) });
}
function policy(value: JournalPolicy): JournalPolicy {
  exact(value, ['policyId', 'version', 'scope', 'otherAcademyOperations', 'fieldRules', 'maxSourceAgeMs', 'maxApprovalAgeMs']);
  ref(value.policyId); ref(value.version);
  if (value.scope !== 'lesson_journal_only' || value.otherAcademyOperations !== 'read_only') reject('academy_scope_expansion');
  for (const period of [value.maxSourceAgeMs, value.maxApprovalAgeMs]) {
    if (!Number.isSafeInteger(period) || period <= 0) reject('invalid_freshness_policy');
  }
  if (!Array.isArray(value.fieldRules) || new Set(value.fieldRules.map(rule => rule.field)).size !== value.fieldRules.length) reject('duplicate_field_rule');
  const rules = value.fieldRules.map(rule => {
    exact(rule, ['field', 'validationRef', 'domain']); ref(rule.validationRef);
    if (!supported(rule.field)) reject('unsupported_policy_field');
    if (rule.domain.kind === 'text') {
      exact(rule.domain, ['kind', 'maxCodePoints']);
      if (rule.field === 'attendance' || !Number.isSafeInteger(rule.domain.maxCodePoints) || rule.domain.maxCodePoints <= 0) reject('invalid_field_domain');
      return rule;
    }
    exact(rule.domain, ['kind', 'values']);
    if (rule.domain.kind !== 'enumeration' || !Array.isArray(rule.domain.values) || !rule.domain.values.length || rule.domain.values.some((x: unknown) => !scalar(x))) reject('invalid_field_domain');
    if (new Set(rule.domain.values.map(canonicalJson)).size !== rule.domain.values.length) reject('duplicate_domain_value');
    return { ...rule, domain: { ...rule.domain, values: [...rule.domain.values].sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0) } };
  }).sort((a, b) => a.field < b.field ? -1 : a.field > b.field ? 1 : 0);
  return immutableCopy({ ...value, fieldRules: rules });
}
function sourceBlockers(source: JournalSourceSnapshot, at: string, rules: JournalPolicy): JournalBlocker[] {
  const now = instant(at);
  const blockers: JournalBlocker[] = [];
  if (source.readOrigin !== 'independent_authoritative_read') blockers.push('source_ui_echo');
  if (source.proof.state !== 'verified' || instant(source.proof.verifiedAt) > now || instant(source.proof.validUntil) <= now) blockers.push('unverified_target');
  if (instant(source.observedAt) > now || now - instant(source.observedAt) > rules.maxSourceAgeMs) blockers.push('stale_source');
  return blockers;
}
function valueAllowed(value: JournalScalar, rule: JournalFieldRule): boolean {
  return rule.domain.kind === 'text'
    ? typeof value === 'string' && [...value].length <= rule.domain.maxCodePoints
    : rule.domain.values.some(candidate => same(candidate, value));
}

/** Draft construction is possible without an approved field list; such fields remain blocked. */
export function createLessonJournalDraft(input: JournalDraftInput): JournalDraft {
  exact(input, ['draftId', 'revision', 'previousDraftDigest', 'createdAt', 'source', 'teacherPlan', 'policy', 'recoveryPlanRef']);
  ref(input.draftId); ref(input.recoveryPlanRef); instant(input.createdAt);
  input = { ...input, source: normalizedSnapshot(input.source) };
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || (input.revision === 1) !== (input.previousDraftDigest === null)) reject('invalid_draft_revision');
  if (input.previousDraftDigest !== null) hash(input.previousDraftDigest);
  const normalizedPolicy = policy(input.policy);
  const plan = input.teacherPlan;
  exact(plan, ['kind', 'planId', 'revisionId', 'teacherId', 'target', 'status', 'basedOnSourceVersion', 'proposed', 'provenanceRefs']);
  if (plan.kind !== 'teacher_plan' || !['draft', 'approved', 'cancelled'].includes(plan.status)) reject('invalid_teacher_plan');
  [plan.planId, plan.revisionId, plan.teacherId, plan.basedOnSourceVersion].forEach(ref); refs(plan.provenanceRefs); target(plan.target);
  if (plan.teacherId !== input.source.target.teacherId || !same(plan.target, input.source.target)) reject('teacher_plan_target_mismatch');
  if (plan.basedOnSourceVersion !== input.source.sourceVersion) reject('teacher_plan_source_mismatch');
  exact(plan.proposed, Object.keys(plan.proposed));
  const shared = sourceBlockers(input.source, input.createdAt, normalizedPolicy);
  if (plan.status === 'cancelled') shared.push('cancelled_plan');
  const fields: JournalDraftField[] = Object.entries(plan.proposed).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([field, after]) => {
    ref(field);
    if (!scalar(after)) reject('invalid_proposed_value');
    const before = supported(field) ? input.source.fields[field] ?? { state: 'unknown' as const, reasonCode: 'field_not_read' } : { state: 'unknown' as const, reasonCode: 'unsupported_field' };
    const blockers = [...shared];
    const rule = normalizedPolicy.fieldRules.find(candidate => candidate.field === field);
    if (!supported(field)) blockers.push('unsupported_field');
    else if (!rule) blockers.push('field_not_allowed');
    if (before.state !== 'known') blockers.push('unknown_before');
    if (rule && !valueAllowed(after, rule)) blockers.push('invalid_after');
    return { field, before, after, disposition: blockers.length ? 'blocked' : before.state === 'known' && same(before.value, after) ? 'noop' : 'changed', blockers };
  });
  return sealed({ kind: 'lesson_journal_draft' as const,
    input: { ...input, policy: normalizedPolicy, teacherPlan: { ...plan, provenanceRefs: [...plan.provenanceRefs].sort() } }, fields,
    status: fields.some(field => field.disposition === 'changed') ? 'reviewable' as const : fields.some(field => field.disposition === 'blocked') ? 'blocked' as const : 'noop' as const,
  });
}
function validateDraft(draft: JournalDraft): void {
  exact(draft, ['kind', 'input', 'fields', 'status', 'integrityDigest']); checkSeal(draft);
  if (!same(draft, createLessonJournalDraft(draft.input))) reject('draft_derivation_mismatch');
}
/** Editing creates a new immutable revision; no old approval carries over. */
export function reviseLessonJournalDraft(previous: JournalDraft, next: Omit<JournalDraftInput, 'draftId' | 'revision' | 'previousDraftDigest'>): JournalDraft {
  validateDraft(previous);
  return createLessonJournalDraft({ ...next, draftId: previous.input.draftId, revision: previous.input.revision + 1, previousDraftDigest: previous.integrityDigest });
}

export function prepareLessonJournalReview(draft: JournalDraft, selectedFields: readonly JournalField[], preparedAt: string): JournalReview {
  validateDraft(draft); instant(preparedAt);
  if (instant(preparedAt) < instant(draft.input.createdAt)) reject('review_before_draft');
  if (sourceBlockers(draft.input.source, preparedAt, draft.input.policy).length) reject('review_source_not_current');
  if (!Array.isArray(selectedFields) || !selectedFields.length || new Set(selectedFields).size !== selectedFields.length) reject('invalid_selection');
  const selected = [...selectedFields].sort();
  const actions = selected.map(field => {
    if (!supported(field)) reject('unsupported_selected_field');
    const diff = draft.fields.find(candidate => candidate.field === field);
    if (!diff || diff.disposition !== 'changed' || diff.before.state !== 'known') reject('selected_field_not_changeable');
    const contract = CONTRACTS[field];
    return {
      field, destination: DESTINATION, method: 'GET' as const, effect: 'mutation' as const,
      operation: contract.operation, selector: { key: 'reqCmd' as const, value: contract.selector },
      valueParameter: contract.valueParameter, sourceTrigger: contract.event,
      target: draft.input.source.target, before: diff.before.value, after: diff.after,
      sourceVersion: draft.input.source.sourceVersion, sourceContractVersion: draft.input.source.sourceContractVersion,
      contractEvidence: 'static_candidate_only' as const,
    };
  });
  return sealed({ kind: 'exact_journal_diff_review' as const, draftDigest: draft.integrityDigest, preparedAt,
    selectedFields: selected, actions, recoveryPlanRef: draft.input.recoveryPlanRef });
}
function validateReview(review: JournalReview, draft: JournalDraft): void {
  exact(review, ['kind', 'draftDigest', 'preparedAt', 'selectedFields', 'actions', 'recoveryPlanRef', 'integrityDigest']); checkSeal(review);
  if (review.draftDigest !== draft.integrityDigest) reject('edited_draft_requires_rereview');
  if (!same(review, prepareLessonJournalReview(draft, review.selectedFields, review.preparedAt))) reject('review_derivation_mismatch');
}

export function validateJournalAuditHistory(history: readonly JournalAuditEntry[]): void {
  if (!Array.isArray(history)) reject('invalid_history');
  const prepared = new Map<string, JournalAuditEntry>();
  const receipts = new Set<string>();
  const results = new Set<string>();
  const readbacks = new Map<string, JournalAuditEntry>();
  history.forEach((entry, index) => {
    exact(entry, ['sequence', 'previousDigest', 'recordedAt', 'event', 'targetDigest', 'observationId', 'evidenceObservedAt', 'attemptId', 'receiptRef', 'draftDigest', 'reviewDigest', 'evidenceDigest', 'status', 'integrityDigest']);
    checkSeal(entry); instant(entry.recordedAt); [entry.attemptId, entry.receiptRef, entry.status].forEach(ref);
    [entry.targetDigest, entry.draftDigest, entry.reviewDigest, entry.evidenceDigest].forEach(hash);
    if (instant(entry.evidenceObservedAt) > instant(entry.recordedAt)) reject('invalid_audit_evidence_time');
    if (entry.event === 'outcomes_reported') {
      if (entry.observationId !== null || !['awaiting_readback', 'reconciliation_required'].includes(entry.status)) reject('invalid_audit_transition');
    } else {
      if (entry.observationId === null) reject('missing_audit_observation');
      ref(entry.observationId);
    }
    if (entry.sequence !== index + 1 || entry.previousDigest !== (history[index - 1]?.integrityDigest ?? null) || (index > 0 && instant(entry.recordedAt) < instant(history[index - 1].recordedAt))) reject('broken_audit_chain');
    if (entry.event === 'plan_prepared') {
      if (entry.status !== 'prepared_non_executing') reject('invalid_audit_transition');
      if (prepared.has(entry.attemptId) || receipts.has(entry.receiptRef)) reject('replayed_approval_or_attempt');
      prepared.set(entry.attemptId, entry); receipts.add(entry.receiptRef);
    } else {
      const base = prepared.get(entry.attemptId);
      if (!base || entry.targetDigest !== base.targetDigest || entry.receiptRef !== base.receiptRef || entry.draftDigest !== base.draftDigest || entry.reviewDigest !== base.reviewDigest) reject('orphan_audit_event');
      if (entry.event === 'outcomes_reported' && !results.has(entry.attemptId) && !readbacks.has(entry.attemptId)) results.add(entry.attemptId);
      else if (entry.event === 'readback_checked' && results.has(entry.attemptId)) {
        const previous = readbacks.get(entry.attemptId);
        if (!['persisted', 'partial_persistence', 'not_persisted', 'unresolved'].includes(entry.status) ||
          previous && (['persisted', 'not_persisted'].includes(previous.status) || instant(entry.evidenceObservedAt) <= instant(previous.evidenceObservedAt)) ||
          history.slice(0, index).some(prior => prior.attemptId === entry.attemptId && prior.observationId === entry.observationId)) reject('invalid_audit_transition');
        readbacks.set(entry.attemptId, entry);
      }
      else reject('invalid_audit_transition');
    }
  });
}
function appendAudit(history: readonly JournalAuditEntry[], body: Omit<JournalAuditEntry, 'sequence' | 'previousDigest' | 'integrityDigest'>): readonly JournalAuditEntry[] {
  const next = [...history, sealed({ ...body, sequence: history.length + 1, previousDigest: history.at(-1)?.integrityDigest ?? null })];
  validateJournalAuditHistory(next);
  return immutableCopy(next);
}

/**
 * Verifies exact approval and a separate fresh before-read, then returns DATA only.
 * A fresh read narrows staleness; it cannot remove read/write races or supply CAS.
 */
export function gateLessonJournalReview(request: JournalGateRequest, verifier: JournalApprovalVerifierPort): {
  readonly plan: PreparedJournalPlan; readonly history: readonly JournalAuditEntry[];
} {
  exact(request, ['attemptId', 'receiptRef', 'now', 'currentDraft', 'review', 'freshSource', 'history']);
  ref(request.attemptId); ref(request.receiptRef); instant(request.now);
  const { currentDraft: draft, review, now, history } = request;
  const fresh = normalizedSnapshot(request.freshSource);
  validateDraft(draft); validateReview(review, draft); snapshot(fresh); validateJournalAuditHistory(history);
  if (history.some(entry => entry.attemptId === request.attemptId || entry.receiptRef === request.receiptRef)) reject('replayed_approval_or_attempt');
  const priorAttempts = new Map<string, JournalAuditEntry>();
  for (const entry of history) if (entry.targetDigest === digest(draft.input.source.target)) priorAttempts.set(entry.attemptId, entry);
  for (const entry of priorAttempts.values()) {
    if (entry.event !== 'readback_checked') reject('unreconciled_prior_attempt');
    if (entry.draftDigest === draft.integrityDigest || instant(draft.input.source.observedAt) <= instant(entry.recordedAt)) reject('prior_attempt_requires_fresh_draft');
  }
  if (!same(fresh.target, draft.input.source.target)) reject('fresh_target_mismatch');
  if (sourceBlockers(fresh, now, draft.input.policy).length) reject('fresh_source_not_verified');
  if (fresh.observationId === draft.input.source.observationId || instant(fresh.observedAt) <= instant(draft.input.source.observedAt)) reject('independent_fresh_read_required');
  if (fresh.sourceVersion !== draft.input.source.sourceVersion || fresh.sourceContractVersion !== draft.input.source.sourceContractVersion || fresh.readContractRef !== draft.input.source.readContractRef || !same(fresh.fields, draft.input.source.fields)) reject('stale_source_requires_rereview');
  if (!verifier || typeof verifier.verify !== 'function') reject('approval_verifier_required');
  // Isolate mutable caller inputs before invoking a port. Its decision cannot rewrite the bound payload.
  const frozen = immutableCopy({ draft, review, fresh, now, history, attemptId: request.attemptId, receiptRef: request.receiptRef });
  let decision: JournalApprovalDecision;
  try {
    decision = verifier.verify(immutableCopy({ receiptRef: frozen.receiptRef, attemptId: frozen.attemptId,
      reviewDigest: review.integrityDigest, draftDigest: draft.integrityDigest, target: draft.input.source.target, now, purpose: 'non_executing_plan' }));
  } catch { reject('approval_verifier_failed'); }
  if (!decision || decision.status !== 'verified') reject(`approval_${decision?.status === 'rejected' && ['revoked', 'expired', 'replayed', 'not_found', 'mismatch'].includes(decision.reason) ? decision.reason : 'unverified'}`);
  exact(decision, ['status', 'receiptRef', 'attemptId', 'reviewDigest', 'draftDigest', 'target', 'approverId', 'approvedAt', 'expiresAt', 'checkedAt', 'scope', 'useState']);
  ref(decision.approverId); target(decision.target);
  if (decision.receiptRef !== frozen.receiptRef || decision.attemptId !== frozen.attemptId || decision.reviewDigest !== frozen.review.integrityDigest || decision.draftDigest !== frozen.draft.integrityDigest || !same(decision.target, frozen.draft.input.source.target) || decision.scope !== 'exact_lesson_journal_diff' || decision.useState !== 'unused') reject('approval_binding_mismatch');
  if (instant(decision.checkedAt) !== instant(frozen.now) || instant(decision.approvedAt) < instant(frozen.review.preparedAt) || instant(decision.approvedAt) > instant(frozen.now) || instant(decision.expiresAt) <= instant(frozen.now) || instant(decision.expiresAt) <= instant(decision.approvedAt) || instant(frozen.now) - instant(decision.approvedAt) > frozen.draft.input.policy.maxApprovalAgeMs) reject('approval_not_current');
  if (instant(frozen.fresh.observedAt) <= instant(decision.approvedAt)) reject('postapproval_fresh_read_required');
  const plan = sealed({ kind: 'prepared_non_executing_journal_plan' as const, attemptId: frozen.attemptId, preparedAt: frozen.now,
    draft: frozen.draft, review: frozen.review, approval: decision, preflightSource: frozen.fresh,
    execution: 'not_supported' as const, automaticRetryAllowed: false as const, persistence: 'not_established' as const });
  return immutableCopy({ plan, history: appendAudit(frozen.history, { event: 'plan_prepared', recordedAt: frozen.now,
    targetDigest: digest(frozen.draft.input.source.target), observationId: frozen.fresh.observationId, evidenceObservedAt: frozen.fresh.observedAt,
    attemptId: frozen.attemptId, receiptRef: decision.receiptRef, draftDigest: frozen.draft.integrityDigest,
    reviewDigest: frozen.review.integrityDigest, evidenceDigest: plan.integrityDigest, status: 'prepared_non_executing' }) });
}

export interface JournalFieldOutcome {
  readonly field: JournalField;
  readonly status: 'reported_success' | 'reported_failure' | 'unknown';
  readonly finishedAt: string;
  readonly evidenceRef: string;
}
export interface JournalAttemptReport {
  readonly kind: 'journal_attempt_report';
  readonly plan: PreparedJournalPlan;
  readonly recordedAt: string;
  readonly outcomes: readonly JournalFieldOutcome[];
  readonly status: 'awaiting_readback' | 'reconciliation_required';
  readonly automaticRetryAllowed: false;
  readonly integrityDigest: string;
}
function validatePlan(plan: PreparedJournalPlan): void {
  exact(plan, ['kind', 'attemptId', 'preparedAt', 'draft', 'review', 'approval', 'preflightSource', 'execution', 'automaticRetryAllowed', 'persistence', 'integrityDigest']);
  checkSeal(plan); validateDraft(plan.draft); validateReview(plan.review, plan.draft); snapshot(plan.preflightSource);
  if (plan.kind !== 'prepared_non_executing_journal_plan' || plan.execution !== 'not_supported' || plan.automaticRetryAllowed !== false || plan.persistence !== 'not_established') reject('invalid_prepared_plan');
}
function requireHistoryPlan(plan: PreparedJournalPlan, history: readonly JournalAuditEntry[]): void {
  validatePlan(plan); validateJournalAuditHistory(history);
  const event = history.find(entry => entry.attemptId === plan.attemptId && entry.event === 'plan_prepared');
  if (!event || event.evidenceDigest !== plan.integrityDigest) reject('plan_not_in_history');
}
function outcomeReport(plan: PreparedJournalPlan, outcomes: readonly JournalFieldOutcome[], recordedAt: string): JournalAttemptReport {
  instant(recordedAt);
  if (!Array.isArray(outcomes) || new Set(outcomes.map(outcome => outcome.field)).size !== outcomes.length) reject('duplicate_field_outcome');
  for (const outcome of outcomes) {
    exact(outcome, ['field', 'status', 'finishedAt', 'evidenceRef']); ref(outcome.evidenceRef);
    if (!plan.review.selectedFields.includes(outcome.field) || !['reported_success', 'reported_failure', 'unknown'].includes(outcome.status)) reject('invalid_field_outcome');
    if (instant(outcome.finishedAt) < instant(plan.preparedAt) || instant(outcome.finishedAt) > instant(recordedAt)) reject('invalid_outcome_time');
  }
  if (instant(recordedAt) < instant(plan.preparedAt)) reject('invalid_outcome_time');
  return sealed({ kind: 'journal_attempt_report' as const, plan, recordedAt,
    outcomes: [...outcomes].sort((a, b) => a.field < b.field ? -1 : a.field > b.field ? 1 : 0),
    status: outcomes.length === plan.review.actions.length && outcomes.every(outcome => outcome.status === 'reported_success') ? 'awaiting_readback' as const : 'reconciliation_required' as const,
    automaticRetryAllowed: false as const });
}
/** Even all-success responses are unverified; missing/partial/unknown results stop blind retries. */
export function recordLessonJournalOutcomes(plan: PreparedJournalPlan, outcomes: readonly JournalFieldOutcome[], recordedAt: string, history: readonly JournalAuditEntry[]): {
  readonly report: JournalAttemptReport; readonly history: readonly JournalAuditEntry[];
} {
  requireHistoryPlan(plan, history);
  if (history.some(entry => entry.attemptId === plan.attemptId && entry.event !== 'plan_prepared')) reject('outcomes_already_recorded');
  const report = outcomeReport(plan, outcomes, recordedAt);
  return immutableCopy({ report, history: appendAudit(history, { event: 'outcomes_reported', recordedAt, attemptId: plan.attemptId,
    targetDigest: digest(plan.draft.input.source.target), observationId: null, evidenceObservedAt: recordedAt,
    receiptRef: plan.approval.receiptRef, draftDigest: plan.draft.integrityDigest, reviewDigest: plan.review.integrityDigest,
    evidenceDigest: report.integrityDigest, status: report.status }) });
}

export interface JournalReadbackResult {
  readonly kind: 'independent_journal_readback';
  readonly attemptId: string;
  readonly observedAt: string;
  readonly observationId: string;
  readonly sourceVersion: string;
  readonly sourceContractVersion: string;
  readonly readContractRef: string;
  readonly readbackDigest: string;
  readonly fields: readonly Readonly<{ field: JournalField; persistence: 'matches_after' | 'matches_before' | 'conflict' | 'unknown' }>[];
  readonly status: 'persisted' | 'partial_persistence' | 'not_persisted' | 'unresolved';
  readonly attribution: 'current_values_observed_not_causal_proof';
  readonly automaticRetryAllowed: false;
  readonly recovery: 'fresh_draft_and_exact_approval_required_for_any_new_change';
  readonly integrityDigest: string;
}
/** UI echo, dispatch, status 200, and callbacks are never persistence evidence. */
export function verifyLessonJournalReadback(report: JournalAttemptReport, readback: JournalSourceSnapshot, now: string, history: readonly JournalAuditEntry[]): {
  readonly result: JournalReadbackResult; readonly history: readonly JournalAuditEntry[];
} {
  exact(report, ['kind', 'plan', 'recordedAt', 'outcomes', 'status', 'automaticRetryAllowed', 'integrityDigest']); checkSeal(report);
  const plan = report.plan;
  requireHistoryPlan(plan, history);
  if (!same(report, outcomeReport(plan, report.outcomes, report.recordedAt))) reject('outcome_derivation_mismatch');
  if (!history.some(entry => entry.event === 'outcomes_reported' && entry.attemptId === plan.attemptId && entry.evidenceDigest === report.integrityDigest)) reject('outcomes_not_in_history');
  const lastReadback = history.filter(entry => entry.event === 'readback_checked' && entry.attemptId === plan.attemptId).at(-1);
  if (lastReadback && ['persisted', 'not_persisted'].includes(lastReadback.status)) reject('readback_already_resolved');
  snapshot(readback); instant(now);
  if (!same(readback.target, plan.draft.input.source.target)) reject('readback_target_mismatch');
  if (sourceBlockers(readback, now, plan.draft.input.policy).length) reject('readback_not_verified');
  if (lastReadback && (instant(readback.observedAt) <= instant(lastReadback.evidenceObservedAt) || history.some(entry => entry.attemptId === plan.attemptId && entry.observationId === readback.observationId))) reject('new_reconciliation_read_required');
  if (readback.observationId === plan.preflightSource.observationId || readback.observationId === plan.draft.input.source.observationId || instant(readback.observedAt) <= instant(report.recordedAt)) reject('independent_postattempt_read_required');
  if (readback.sourceContractVersion !== plan.preflightSource.sourceContractVersion || readback.readContractRef !== plan.preflightSource.readContractRef) reject('readback_contract_changed');
  const fields = plan.review.actions.map(action => {
    const observed = readback.fields[action.field];
    return { field: action.field, persistence: !observed || observed.state !== 'known' ? 'unknown' as const
      : same(observed.value, action.after) ? 'matches_after' as const
      : same(observed.value, action.before) ? 'matches_before' as const : 'conflict' as const };
  });
  const result = sealed({ kind: 'independent_journal_readback' as const, attemptId: plan.attemptId,
    observedAt: readback.observedAt, observationId: readback.observationId, sourceVersion: readback.sourceVersion,
    sourceContractVersion: readback.sourceContractVersion, readContractRef: readback.readContractRef, readbackDigest: digest(normalizedSnapshot(readback)), fields,
    status: fields.every(field => field.persistence === 'matches_after') ? 'persisted' as const
      : fields.some(field => field.persistence === 'matches_after') ? 'partial_persistence' as const
      : fields.every(field => field.persistence === 'matches_before') ? 'not_persisted' as const : 'unresolved' as const,
    attribution: 'current_values_observed_not_causal_proof' as const, automaticRetryAllowed: false as const,
    recovery: 'fresh_draft_and_exact_approval_required_for_any_new_change' as const });
  return immutableCopy({ result, history: appendAudit(history, { event: 'readback_checked', recordedAt: now,
    targetDigest: digest(plan.draft.input.source.target), observationId: readback.observationId, evidenceObservedAt: readback.observedAt,
    attemptId: plan.attemptId, receiptRef: plan.approval.receiptRef, draftDigest: plan.draft.integrityDigest,
    reviewDigest: plan.review.integrityDigest, evidenceDigest: result.integrityDigest, status: result.status }) });
}
