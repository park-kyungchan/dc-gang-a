/**
 * I/O-free acceptance of a bounded academy read receipt, not a live reader.
 * A trusted collector supplies fresh evidence; caller assertions are not proof.
 * No credentials, transport implementation, LMS write or Sheet write exists here.
 */
import { isDeepStrictEqual } from 'node:util';
import type { DayRecordDomBindingResult } from './dayRecordDomBinding';

export const ACADEMY_JOURNAL_SOURCE_FIELDS = [
  'attendance', 'progress', 'homework', 'memo',
  'previousHomeworkAssessment', 'dailyTestAssessment',
] as const;
export type AcademyJournalSourceField = typeof ACADEMY_JOURNAL_SOURCE_FIELDS[number];

export interface AcademyReadScope {
  teacherId: string;
  date: string;
  groupId: string;
  studentId: string;
  courseId: string;
  recordId: string;
  membershipId: string;
  occurrenceId: string;
}

export type AcademyReadTransport = 'authenticated_backend' | 'structural_dom';
export type AcademyReadBlocker =
  | 'invalid_receipt' | 'transport_unavailable' | 'unattended_auth_unavailable'
  | 'session_expired' | 'authentication_unverified' | 'not_fresh'
  | 'scope_unverified' | 'scope_mismatch' | 'row_binding_unverified'
  | 'occurrence_unverified' | 'coverage_incomplete' | 'field_lineage_unverified';

/** References are opaque evidence IDs, never request URLs, credentials or raw bodies. */
export interface AcademySourceProof {
  status: 'verified' | 'unverified';
  scope: AcademyReadScope;
  evidenceRef: string;
}

export type AcademyFieldCoverage =
  | { field: AcademyJournalSourceField; state: 'unknown'; reason: string }
  | { field: AcademyJournalSourceField; state: 'observed'; evidenceRef: string;
      recordId: string; membershipId: string; occurrenceDate: string;
      /** Previous homework belongs to its own previous occurrence, never today's record. */
      occurrence: 'current' | 'previous'; occurrenceEvidenceRef: string };

export interface AcademyReadAcceptanceInput {
  expectedScope: AcademyReadScope;
  observedScope: AcademyReadScope | null;
  transport: AcademyReadTransport;
  transportAvailable: boolean;
  mode: 'manual' | 'unattended';
  /** A supported, already authorized session provider; a cached tab does not qualify. */
  unattendedAuthAvailable: boolean;
  authentication: 'authenticated_fresh' | 'expired' | 'unverified';
  observedAt: string;
  now: string;
  maxAgeMs: number;
  freshResponseVerified: boolean;
  readEvidenceRef: string;
  rowBinding: DayRecordDomBindingResult | null;
  /** This must be separately evidenced; same-page hidden-field equality is insufficient. */
  ownership: AcademySourceProof | null;
  /** View-date text alone is insufficient. */
  occurrence: AcademySourceProof | null;
  coverage: 'exact_requested_scope' | 'partial' | 'unknown';
  fields: readonly AcademyFieldCoverage[];
}

interface AcademyReadReceiptBase {
  transport: AcademyReadTransport;
  mode: 'manual' | 'unattended';
  observedAt: string;
  evidenceRefs: readonly string[];
  /** A read receipt cannot authorize a downstream write. */
  productionWriteAuthorized: false;
}

export interface AcceptedAcademyReadReceipt extends AcademyReadReceiptBase {
  status: 'accepted';
  scope: AcademyReadScope;
  fields: readonly AcademyFieldCoverage[];
  coverage: 'exact_requested_scope';
}

export type AcademyReadResult = AcceptedAcademyReadReceipt
  | (AcademyReadReceiptBase & { status: 'blocked'; blockers: readonly AcademyReadBlocker[];
      acceptedRecordCount: 0 })
  | (AcademyReadReceiptBase & { status: 'partial'; blockers: readonly AcademyReadBlocker[];
      acceptedRecordCount: 0; scope: AcademyReadScope });

const opaqueRef = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._/-]{0,191}$/.test(value);
const isoDate = (value: unknown): value is string => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const instant = (value: unknown): number => typeof value === 'string'
  && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
  && isoDate(value.slice(0, 10))
  ? Date.parse(value) : NaN;
const scopeKeys = ['teacherId', 'date', 'groupId', 'studentId', 'courseId', 'recordId', 'membershipId', 'occurrenceId'] as const;
function validScope(scope: unknown): scope is AcademyReadScope {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return false;
  const row = scope as Record<string, unknown>;
  return Object.keys(row).length === scopeKeys.length && scopeKeys.every(key => opaqueRef(row[key])) && isoDate(row.date);
}

/** Fail closed before downstream preview/projection. This does not fetch or attest evidence. */
export function assessAcademyReadAcceptance(input: AcademyReadAcceptanceInput): AcademyReadResult {
  if (!input || typeof input !== 'object' || !validScope(input.expectedScope)) return {
    status: 'blocked', transport: input?.transport ?? 'structural_dom', mode: input?.mode ?? 'manual',
    observedAt: '', evidenceRefs: [], productionWriteAuthorized: false,
    blockers: ['invalid_receipt'], acceptedRecordCount: 0,
  };
  const blockers = new Set<AcademyReadBlocker>();
  const observedMs = instant(input.observedAt), nowMs = instant(input.now);
  if (!validScope(input.expectedScope) || !['authenticated_backend', 'structural_dom'].includes(input.transport)
    || !['manual', 'unattended'].includes(input.mode) || !opaqueRef(input.readEvidenceRef)
    || !Number.isFinite(observedMs) || !Number.isFinite(nowMs)
    || !Number.isSafeInteger(input.maxAgeMs) || input.maxAgeMs < 0) blockers.add('invalid_receipt');
  if (input.transportAvailable !== true) blockers.add('transport_unavailable');
  if (input.mode === 'unattended' && (input.transport !== 'authenticated_backend'
    || input.unattendedAuthAvailable !== true)) blockers.add('unattended_auth_unavailable');
  if (input.authentication === 'expired') blockers.add('session_expired');
  else if (input.authentication !== 'authenticated_fresh') blockers.add('authentication_unverified');
  if (input.freshResponseVerified !== true || observedMs > nowMs || nowMs - observedMs > input.maxAgeMs) blockers.add('not_fresh');
  if (!validScope(input.observedScope)) blockers.add('scope_unverified');
  else if (!isDeepStrictEqual(input.expectedScope, input.observedScope)) blockers.add('scope_mismatch');

  const binding = input.rowBinding;
  if (!binding || binding.status !== 'resolved') blockers.add('row_binding_unverified');
  else if (binding.identity.stu_pri_no !== input.expectedScope.studentId
    || binding.identity.course_seq !== input.expectedScope.courseId
    || binding.identity.record_seq !== input.expectedScope.recordId
    || binding.identity.cm_seq !== input.expectedScope.membershipId) blockers.add('scope_mismatch');
  for (const [proof, code] of [[input.ownership, 'scope_unverified'], [input.occurrence, 'occurrence_unverified']] as const) {
    if (!proof || proof.status !== 'verified' || !opaqueRef(proof.evidenceRef)
      || !isDeepStrictEqual(proof.scope, input.expectedScope)) blockers.add(code);
  }
  if (input.occurrence?.evidenceRef === input.readEvidenceRef) blockers.add('occurrence_unverified');
  if (input.ownership?.evidenceRef === input.readEvidenceRef) blockers.add('scope_unverified');
  if (input.coverage !== 'exact_requested_scope') blockers.add('coverage_incomplete');

  const fieldRefs: string[] = [];
  if (!Array.isArray(input.fields) || input.fields.length !== ACADEMY_JOURNAL_SOURCE_FIELDS.length
    || input.fields.some(x => !x || typeof x !== 'object')
    || new Set(input.fields.map(x => x.field)).size !== ACADEMY_JOURNAL_SOURCE_FIELDS.length
    || !input.fields.some(x => x.state === 'observed')) blockers.add('field_lineage_unverified');
  else for (const field of input.fields) {
    if (!ACADEMY_JOURNAL_SOURCE_FIELDS.includes(field.field)) { blockers.add('field_lineage_unverified'); continue; }
    if (field.state === 'unknown') {
      if (!opaqueRef(field.reason)) blockers.add('field_lineage_unverified');
      continue;
    }
    if (field.state !== 'observed' || !opaqueRef(field.evidenceRef) || !opaqueRef(field.occurrenceEvidenceRef)
      || !isoDate(field.occurrenceDate) || field.membershipId !== input.expectedScope.membershipId) {
      blockers.add('field_lineage_unverified'); continue;
    }
    if (field.field === 'previousHomeworkAssessment') {
      const previous = binding?.status === 'resolved' ? binding.previousProgress : null;
      if (field.occurrence !== 'previous' || !previous || !previous.sameMembershipAsCurrent
        || previous.sameRecordAsCurrent || field.recordId !== previous.record_seq
        || field.occurrenceDate >= input.expectedScope.date
        || field.occurrenceEvidenceRef === input.readEvidenceRef) blockers.add('field_lineage_unverified');
    } else if (field.occurrence !== 'current' || field.recordId !== input.expectedScope.recordId
      || field.occurrenceDate !== input.expectedScope.date
      || field.occurrenceEvidenceRef !== input.occurrence?.evidenceRef) blockers.add('field_lineage_unverified');
    fieldRefs.push(field.evidenceRef, field.occurrenceEvidenceRef);
  }
  const base: AcademyReadReceiptBase = {
    transport: input.transport, mode: input.mode, observedAt: input.observedAt,
    evidenceRefs: [...new Set([input.readEvidenceRef, input.ownership?.evidenceRef, input.occurrence?.evidenceRef, ...fieldRefs].filter(opaqueRef))],
    productionWriteAuthorized: false,
  };
  if (blockers.size) {
    const onlyPartial = [...blockers].every(code => ['coverage_incomplete', 'field_lineage_unverified'].includes(code));
    return onlyPartial
      ? { ...base, status: 'partial', scope: structuredClone(input.expectedScope), blockers: [...blockers], acceptedRecordCount: 0 }
      : { ...base, status: 'blocked', blockers: [...blockers], acceptedRecordCount: 0 };
  }
  return { ...base, status: 'accepted', scope: structuredClone(input.expectedScope),
    fields: structuredClone(input.fields), coverage: 'exact_requested_scope' };
}
