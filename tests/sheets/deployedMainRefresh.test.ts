import { describe, expect, it } from 'bun:test';
import { ACADEMY_JOURNAL_SOURCE_FIELDS, type AcademyFieldCoverage } from '../../src/lms/academyReadAcceptance';
import { DEPLOYED_MAIN, decideRefreshDispatch, prepareDeployedRowRefresh, prepareAcceptedDeployedRowRefresh,
  type DeployedRowSnapshot, type SourceCellProjection,
} from '../../src/sheets/deployedMainRefresh';

const now = '2026-10-01T04:30:00Z';
const lesson = { date: '2026-10-01', teacherId: 'synthetic-teacher', groupId: 'synthetic-group',
  studentId: 'synthetic-student', courseId: 'synthetic-course', recordId: 'synthetic-record',
  curriculumId: 'synthetic-cm', occurrenceId: 'synthetic-occurrence' };
const known = (value: string | null) => ({ kind: 'known' as const, value });
function snapshot(): DeployedRowSnapshot {
  return { target: { spreadsheetId: DEPLOYED_MAIN.spreadsheetId, sheetId: DEPLOYED_MAIN.sheetId,
    title: DEPLOYED_MAIN.title, layoutVersion: DEPLOYED_MAIN.layoutVersion },
    grid: { rows: 133, columns: 18, frozenRows: 3 }, observedAt: now,
    structureFingerprint: 'synthetic-structure', ownershipEvidenceRef: 'synthetic-explicit-cell-map',
    bindingEvidenceRef: 'synthetic-exact-occurrence-binding', row: 4, lesson,
    cells: Array.from({ length: 16 }, (_, i) => ({ cell: `${String.fromCharCode(67 + i)}4`,
      owner: i === 0 ? 'source' as const : 'teacher' as const,
      value: known(i === 1 ? 'teacher future plan' : null), formula: null, note: null })) };
}
const projected = (): SourceCellProjection[] => [{ cell: 'C4', value: known('synthetic source label'),
  lesson, sourceEvidenceRef: 'synthetic-read', sourceFieldContractRef: 'synthetic-column-contract' }];

describe('deployed Main refresh wiring', () => {
  it('preserves every non-source value and returns no executable request or approval', () => {
    const before = snapshot(), source = projected(); const result = prepareDeployedRowRefresh(before, source, now, 60000);
    expect(result.scope.rangeA1).toBe('C4:R4'); expect(result.displayedFields).toHaveLength(16);
    expect(result.changes.map(cell => cell.cell)).toEqual(['C4']);
    expect(result.proposed.D4).toEqual(known('teacher future plan'));
    expect(result.preservedCells).toHaveLength(15); expect(result.executable).toBe(false);
    expect('approval' in result).toBe(false); expect('requests' in result).toBe(false);
    expect(before.cells[0]!.value).toEqual(known(null)); expect(Object.isFrozen(result.proposed)).toBe(true);
  });
  it('does not treat the legacy block or blank Q:R columns as auto-owned', () => {
    expect(() => prepareDeployedRowRefresh({ ...snapshot(), row: 48 }, projected(), now, 60000)).toThrow('outside_student_slots');
    for (const cell of ['Q48', 'A1', 'I5', 'C48']) {
      expect(() => prepareDeployedRowRefresh(snapshot(), [{ ...projected()[0]!, cell }], now, 60000)).toThrow('projection_not_source_owned');
    }
  });
  it('fails closed on obsolete layouts, wrong targets, incomplete inventory and missing evidence', () => {
    expect(() => prepareDeployedRowRefresh({ ...snapshot(), grid: { rows: 160, columns: 16, frozenRows: 2 } }, projected(), now, 60000)).toThrow('deployed_target_or_layout_mismatch');
    expect(() => prepareDeployedRowRefresh({ ...snapshot(), cells: snapshot().cells.slice(1) }, projected(), now, 60000)).toThrow('incomplete_row_inventory');
    expect(() => prepareDeployedRowRefresh({ ...snapshot(), bindingEvidenceRef: '' }, projected(), now, 60000)).toThrow();
  });
  it('rejects teacher values, formula cells, annotations and a different occurrence', () => {
    expect(() => prepareDeployedRowRefresh(snapshot(), [{ ...projected()[0]!, cell: 'D4' }], now, 60000)).toThrow('projection_not_source_owned');
    for (const metadata of [{ formula: '=1', note: null }, { formula: null, note: 'manual annotation' }]) {
      const value = snapshot(); const cells = value.cells.map((cell, i) => i === 0 ? { ...cell, ...metadata } : cell);
      expect(() => prepareDeployedRowRefresh({ ...value, cells }, projected(), now, 60000)).toThrow('annotated_cell_requires_review');
    }
    expect(() => prepareDeployedRowRefresh(snapshot(), [{ ...projected()[0]!, lesson: { ...lesson, recordId: 'other' } }], now, 60000)).toThrow('source_occurrence_mismatch');
  });
  it('preserves unknown as unknown and formula-like strings as literal display values', () => {
    const result = prepareDeployedRowRefresh(snapshot(), [{ ...projected()[0]!, value: { kind: 'unknown', reason: 'not_read' } }], now, 60000);
    expect(result.proposed.C4).toEqual({ kind: 'unknown', reason: 'not_read' });
    expect(prepareDeployedRowRefresh(snapshot(), [{ ...projected()[0]!, value: known('=NOT_A_FORMULA') }], now, 60000).proposed.C4).toEqual(known('=NOT_A_FORMULA'));
  });
  it('blocks stale and future Sheet snapshots', () => {
    expect(() => prepareDeployedRowRefresh(snapshot(), projected(), '2026-10-01T04:29:59Z', 60000)).toThrow('stale_sheet_snapshot');
    expect(() => prepareDeployedRowRefresh(snapshot(), projected(), '2026-10-01T04:32:00Z', 60000)).toThrow('stale_sheet_snapshot');
  });
  it('never overwrites expected end-date plans even when a supplied ownership map is wrong', () => {
    const value = snapshot();
    for (const column of ['O', 'R']) {
      const cells = value.cells.map(cell => cell.cell === `${column}4` ? { ...cell, owner: 'source' as const } : cell);
      expect(() => prepareDeployedRowRefresh({ ...value, cells }, [{ ...projected()[0]!, cell: `${column}4` }], now, 60000)).toThrow('expected_end_date_is_teacher_plan');
    }
  });
  it('entry gate blocks an expired source session before looking at Sheet values', () => {
    const result = prepareAcceptedDeployedRowRefresh({ status: 'blocked', transport: 'structural_dom', mode: 'manual',
      observedAt: now, evidenceRefs: ['synthetic-read'], productionWriteAuthorized: false,
      blockers: ['session_expired'], acceptedRecordCount: 0 }, snapshot(), projected(), 'manual', now, 60000);
    expect(result).toEqual({ status: 'blocked', reason: 'source_read_not_accepted', sourceStatus: 'blocked' });
  });
  it('an accepted manual source receipt cannot be reused as unattended runtime proof', () => {
    const scope = { teacherId: lesson.teacherId, date: lesson.date, groupId: lesson.groupId,
      studentId: lesson.studentId, courseId: lesson.courseId, recordId: lesson.recordId,
      membershipId: lesson.curriculumId, occurrenceId: lesson.occurrenceId };
    const receipt = { status: 'accepted' as const, transport: 'structural_dom' as const, mode: 'manual' as const,
      observedAt: now, evidenceRefs: ['synthetic-read'], productionWriteAuthorized: false as const,
      scope, fields: ACADEMY_JOURNAL_SOURCE_FIELDS.map((field): AcademyFieldCoverage => field === 'progress'
        ? { field, state: 'observed', evidenceRef: 'synthetic-read', recordId: scope.recordId,
            membershipId: scope.membershipId, occurrenceDate: scope.date,
            occurrence: 'current', occurrenceEvidenceRef: 'synthetic-occurrence' }
        : { field, state: 'unknown', reason: 'not_read' }), coverage: 'exact_requested_scope' as const };
    expect(prepareAcceptedDeployedRowRefresh(receipt, snapshot(), projected(), 'daily_1330', now, 60000))
      .toMatchObject({ status: 'blocked', reason: 'unattended_source_read_not_verified' });
    expect(prepareAcceptedDeployedRowRefresh(receipt, snapshot(), projected(), 'manual', now, 60000))
      .toMatchObject({ status: 'review_ready', productionWriteAuthorized: false });
    expect(prepareAcceptedDeployedRowRefresh({ ...receipt, scope: { ...scope, recordId: 'other' } }, snapshot(), projected(), 'manual', now, 60000))
      .toMatchObject({ status: 'blocked', reason: 'source_receipt_scope_or_evidence_mismatch' });
  });
});

describe('manual and 13:30 Asia/Seoul dispatch share an explicit read-only entry point', () => {
  const intent = { trigger: 'daily_1330' as const, scheduledLessonDate: '2026-10-01' };
  it('honors the accepted 13:15–13:45 window and is due at 04:30 UTC', () => {
    expect(decideRefreshDispatch(intent, '2026-10-01T04:14:59Z', [], 'scope')).toEqual({ status: 'not_due' });
    expect(decideRefreshDispatch(intent, '2026-10-01T04:15:00Z', [], 'scope').status).toBe('prepare_refresh');
    expect(decideRefreshDispatch(intent, now, [], 'scope')).toMatchObject({ status: 'prepare_refresh', lessonDate: '2026-10-01', effect: 'read_and_prepare_only', timing: 'within_requested_window' });
  });
  it('keeps delayed same-day ticks due and never replays an old date the next Seoul day', () => {
    expect(decideRefreshDispatch(intent, '2026-10-01T14:59:59Z', [], 'scope')).toMatchObject({ status: 'prepare_refresh', timing: 'late' });
    expect(decideRefreshDispatch(intent, '2026-10-01T15:00:00Z', [], 'scope').status).toBe('expired_schedule_date');
  });
  it('deduplicates pending/uncertain claims and binds both scope and date', () => {
    const first = decideRefreshDispatch(intent, now, [], 'scope');
    if (first.status !== 'prepare_refresh') throw new Error('fixture');
    expect(decideRefreshDispatch(intent, now, [first.claimKey], 'scope').status).toBe('already_claimed');
    expect(decideRefreshDispatch(intent, now, [first.claimKey], 'other-scope').status).toBe('prepare_refresh');
  });
  it('manual refresh preserves explicitly selected historical date and repeat-click identity', () => {
    const request = { trigger: 'manual' as const, requestId: 'synthetic-click', lessonDate: '2026-09-30' };
    const first = decideRefreshDispatch(request, now, [], 'scope');
    expect(first).toMatchObject({ status: 'prepare_refresh', lessonDate: '2026-09-30' });
    if (first.status !== 'prepare_refresh') throw new Error('fixture');
    expect(decideRefreshDispatch(request, now, [first.claimKey], 'scope').status).toBe('already_claimed');
  });
});
