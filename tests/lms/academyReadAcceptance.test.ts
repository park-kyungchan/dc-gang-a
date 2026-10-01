import { describe, expect, it } from 'bun:test';
import {
  ACADEMY_JOURNAL_SOURCE_FIELDS, assessAcademyReadAcceptance,
  type AcademyReadAcceptanceInput, type AcademyReadScope, type AcademyReadBlocker,
} from '../../src/lms/academyReadAcceptance';
import { bindDayRecordDomRow, DAY_RECORD_HANDLER_SIGNATURES } from '../../src/lms/dayRecordDomBinding';

const scope: AcademyReadScope = { teacherId: 'SYN-TEACHER', date: '2099-01-02', groupId: 'SYN-GROUP',
  studentId: '12', courseId: '11', recordId: '13', membershipId: '14', occurrenceId: 'SYN-LESSON' };
const input = (): AcademyReadAcceptanceInput => ({
  expectedScope: { ...scope }, observedScope: { ...scope }, transport: 'structural_dom',
  transportAvailable: true, mode: 'manual', unattendedAuthAvailable: false,
  authentication: 'authenticated_fresh', observedAt: '2099-01-02T00:00:00Z',
  now: '2099-01-02T00:00:10Z', maxAgeMs: 30_000, freshResponseVerified: true,
  readEvidenceRef: 'SYN-DOM', rowBinding: bindDayRecordDomRow({
    sourceSignatures: Object.entries(DAY_RECORD_HANDLER_SIGNATURES).map(([handler, parameterNames]) => ({ handler: handler as keyof typeof DAY_RECORD_HANDLER_SIGNATURES, parameterNames })),
    attributes: [
      { event: 'onchange', source: "onAttn('0','11','12','13','14')", columnGroup: 'current_progress' },
      ...(['onFoPrg', 'onFoHw', 'onFoMm'] as const).map(handler => ({ event: 'onfocusout' as const,
        source: `${handler}('0','11','12','13','14')`, columnGroup: 'current_progress' as const })),
      { event: 'onclick', source: "openHomeWorkRate('10','14','0')", columnGroup: 'previous_progress' },
    ],
  }),
  ownership: { status: 'verified', scope: { ...scope }, evidenceRef: 'SYN-OWNER' },
  occurrence: { status: 'verified', scope: { ...scope }, evidenceRef: 'SYN-OCCURRENCE' },
  coverage: 'exact_requested_scope',
  fields: ACADEMY_JOURNAL_SOURCE_FIELDS.map(field => field === 'progress'
    ? { field, state: 'observed', evidenceRef: 'SYN-PROGRESS', recordId: scope.recordId,
      membershipId: scope.membershipId, occurrenceDate: scope.date, occurrence: 'current', occurrenceEvidenceRef: 'SYN-OCCURRENCE' }
    : { field, state: 'unknown', reason: 'not_observed' }),
});
const rejectCode = (row: AcademyReadAcceptanceInput, code: AcademyReadBlocker) => {
  const result = assessAcademyReadAcceptance(row);
  expect(result.status).not.toBe('accepted');
  if (result.status !== 'accepted') { expect(result.blockers).toContain(code); expect(result.acceptedRecordCount).toBe(0); }
};

describe('bounded academy read acceptance, entirely synthetic', () => {
  it('accepts one evidenced bounded manual row while preserving unknown fields and no write authority', () => {
    const row = input(); const result = assessAcademyReadAcceptance(row);
    expect(result.status).toBe('accepted'); expect(result.productionWriteAuthorized).toBe(false);
    if (result.status === 'accepted') {
      expect(result.fields.filter(x => x.state === 'unknown')).toHaveLength(5);
      row.expectedScope.recordId = '999';
      expect(result.scope.recordId).toBe('13');
    }
  });
  it('blocks an expired session even when retained DOM contains a complete row', () => rejectCode({ ...input(), authentication: 'expired' }, 'session_expired'));
  it('does not let DOM stand in for an unattended backend', () => rejectCode({ ...input(), mode: 'unattended', unattendedAuthAvailable: true }, 'unattended_auth_unavailable'));
  it('requires supported authenticated backend transport for unattended reads', () => {
    rejectCode({ ...input(), transport: 'authenticated_backend', mode: 'unattended' }, 'unattended_auth_unavailable');
    expect(assessAcademyReadAcceptance({ ...input(), transport: 'authenticated_backend', mode: 'unattended', unattendedAuthAvailable: true }).status).toBe('accepted');
    rejectCode({ ...input(), transportAvailable: false }, 'transport_unavailable');
  });
  it('rejects cached, stale, future and malformed timestamps', () => {
    rejectCode({ ...input(), freshResponseVerified: false }, 'not_fresh');
    rejectCode({ ...input(), now: '2099-01-02T00:01:00Z' }, 'not_fresh');
    rejectCode({ ...input(), observedAt: '2099-01-02T00:01:00Z' }, 'not_fresh');
    rejectCode({ ...input(), observedAt: '2099-02-30T00:00:00Z' }, 'invalid_receipt');
    rejectCode({ ...input(), maxAgeMs: Infinity }, 'invalid_receipt');
  });
  it('requires teacher ownership and independent occurrence evidence', () => {
    rejectCode({ ...input(), ownership: null }, 'scope_unverified');
    rejectCode({ ...input(), occurrence: null }, 'occurrence_unverified');
    const row = input(); row.occurrence!.evidenceRef = row.readEvidenceRef;
    rejectCode(row, 'occurrence_unverified');
    const other = input(); other.ownership!.evidenceRef = other.readEvidenceRef;
    rejectCode(other, 'scope_unverified');
  });
  it('rejects teacher/student/course/membership/record scope mismatches', () => {
    for (const key of Object.keys(scope) as (keyof AcademyReadScope)[]) {
      const row = input(); row.observedScope![key] = key === 'date' ? '2099-01-03' : 'wrong';
      rejectCode(row, 'scope_mismatch');
    }
    const row = input(); if (row.rowBinding?.status === 'resolved') row.rowBinding.identity.cm_seq = '999';
    rejectCode(row, 'scope_mismatch');
    rejectCode({ ...input(), rowBinding: null }, 'row_binding_unverified');
  });
  it('keeps incomplete or empty observation coverage partial with zero accepted records', () => {
    const row = input(); row.coverage = 'partial';
    expect(assessAcademyReadAcceptance(row).status).toBe('partial');
    rejectCode(row, 'coverage_incomplete');
    rejectCode({ ...input(), fields: [] }, 'field_lineage_unverified');
    rejectCode({ ...input(), fields: ACADEMY_JOURNAL_SOURCE_FIELDS.map(field => ({ field, state: 'unknown', reason: 'not_observed' })) }, 'field_lineage_unverified');
  });
  it('requires a separate dated prior occurrence for previous-homework assessment', () => {
    const row = input(); row.fields = row.fields.map(field => field.field === 'previousHomeworkAssessment'
      ? { field: field.field, state: 'observed', evidenceRef: 'SYN-PRIOR', recordId: '10', membershipId: '14', occurrenceDate: '2099-01-01', occurrence: 'previous', occurrenceEvidenceRef: 'SYN-PRIOR-DATE' } : field);
    expect(assessAcademyReadAcceptance(row).status).toBe('accepted');
    const wrong = structuredClone(row); const prior = wrong.fields.find(x => x.field === 'previousHomeworkAssessment');
    if (prior?.state === 'observed') prior.recordId = scope.recordId;
    rejectCode(wrong, 'field_lineage_unverified');
    const wrongDate = structuredClone(row); const dateField = wrongDate.fields.find(x => x.field === 'previousHomeworkAssessment');
    if (dateField?.state === 'observed') dateField.occurrenceDate = scope.date;
    rejectCode(wrongDate, 'field_lineage_unverified');
  });
  it('rejects parameterized URLs as evidence references and malformed scope', () => {
    rejectCode({ ...input(), readEvidenceRef: 'https://dc.gang-a.kr/?token=secret' }, 'invalid_receipt');
    const row = input(); row.expectedScope.date = '2099-02-30';
    rejectCode(row, 'invalid_receipt');
  });
});
