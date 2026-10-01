import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { canReviewInverseRollback, evaluateTopMigrationReadiness, migrationGateIds,
  parkMainTopMigrationAudit, shiftMainAddress48, type MigrationEvidence } from '../../src/sheets/parkMainTopMigrationAudit';

describe('read-only top migration invariants', () => {
  it('preserves the complete 160-row Main and changes only location', () => {
    expect(shiftMainAddress48('A1:P160')).toBe('A49:P208');
    expect(shiftMainAddress48('I5')).toBe('I53');
    expect(shiftMainAddress48('I8')).toBe('I56');
    expect(shiftMainAddress48('A75:P132')).toBe('A123:P180');
    expect(shiftMainAddress48('$I$8')).toBe('$I$56');
    for (let row = 1; row <= 160; row++) expect(shiftMainAddress48(`C${row}`)).toBe(`C${row + 48}`);
  });
  it('rejects formula substitution, cross-sheet guesses, and ranges outside reviewed bounds', () => {
    for (const address of ['=SUM(A1:A2)', 'Other!A1', 'Q1', 'A161', 'A3:A2', 'A0', 'A1:P208',
      'P1:A2', 'P5:A5', '$P$1:$A$2']) {
      expect(() => shiftMainAddress48(address)).toThrow();
    }
  });
  it('keeps real or synthetic student values out of the new production template', () => {
    expect(parkMainTopMigrationAudit.productionStudentValuesToWrite).toBe(0);
    expect(parkMainTopMigrationAudit.productionStudentCellsInTemplate).toBe('C4:R47');
    expect(parkMainTopMigrationAudit.nativeChartIdsToPreserve).toEqual([1728410094]);
    expect(parkMainTopMigrationAudit.preserveColumnWidths).toBe('A:P');
  });
  it('does not treat user approval or an XLSX export as native preservation evidence', () => {
    const evidence: MigrationEvidence = { exact_batch_approved: { status: 'verified',
      observedAt: '2026-10-01T02:00:00Z', source: 'synthetic-user-approval' } };
    const report = evaluateTopMigrationReadiness(evidence);
    expect(report.status).toBe('blocked');
    expect(report.blockers).toContain('native_protection_and_exceptions');
    expect(report.blockers).toContain('native_chart_and_image_inventory');
    expect(report.blockers).toContain('live_consumer_inventory_and_quiescence');
    expect(report.performsWrites).toBe(false);
  });
  it('requires sourced valid-date evidence for every independent gate', () => {
    const evidence: MigrationEvidence = Object.fromEntries(migrationGateIds.map(id => [id,
      { status: 'verified', observedAt: '2026-10-01T02:00:00Z', source: `synthetic:${id}` }]));
    expect(evaluateTopMigrationReadiness(evidence).status).toBe('ready_for_exact_batch_review');
    evidence.native_chart_and_image_inventory = { status: 'verified' };
    expect(evaluateTopMigrationReadiness(evidence).blockers).toEqual(['native_chart_and_image_inventory']);
  });
  it('rejects impossible or timezone-ambiguous timestamps rather than Date.parse normalization', () => {
    for (const observedAt of ['2026-02-30T02:00:00Z', '2025-02-29T02:00:00Z', '2026-04-31T02:00:00Z',
      '2026-00-01T02:00:00Z', '2026-13-01T02:00:00Z', '2026-10-00T02:00:00Z',
      '2026-10-01', '2026-10-01T02:00:00', '2026-10-01T02:00:00-00:00',
      '2026-10-01T24:00:00Z', '2026-10-01T02:60:00Z', '2026-10-01T02:00:60Z',
      '2026-10-01T02:00:00+24:00', '2026-10-01T02:00:00+09:60', '2026-10-01T02:00:00+0900']) {
      const report = evaluateTopMigrationReadiness({ exact_batch_approved: { status: 'verified',
        observedAt, source: 'synthetic:timestamp' } });
      expect(report.blockers).toContain('exact_batch_approved');
    }
  });
  it('accepts calendar-valid timestamps with explicit known Z or numeric offsets', () => {
    for (const observedAt of ['2024-02-29T02:00:00Z', '2000-02-29T02:00:00Z',
      '2026-10-01T11:00:00+09:00', '2026-09-30T19:00:00-07:00',
      '2026-10-01T02:00:00.123456789Z', '2026-10-01T02:00:00+00:00']) {
      const report = evaluateTopMigrationReadiness({ exact_batch_approved: { status: 'verified',
        observedAt, source: 'synthetic:timestamp' } });
      expect(report.blockers).not.toContain('exact_batch_approved');
    }
    expect(evaluateTopMigrationReadiness({ exact_batch_approved: { status: 'verified',
      observedAt: '1900-02-29T02:00:00Z', source: 'synthetic:century' } }).blockers).toContain('exact_batch_approved');
  });
  it('blocks inverse row deletion after any uncertain preservation, concurrency, or consumer resume', () => {
    const safe = { exactOriginalContentRecoveredBelow: true, originalObjectsAndProtectionsRecoverable: true,
      insertedBlockEqualsApprovedLabels: true, noConcurrentOrSubsequentEdits: true, noConsumerResumed: true };
    expect(canReviewInverseRollback(safe)).toBe(true);
    for (const key of Object.keys(safe)) expect(canReviewInverseRollback({ ...safe, [key]: false })).toBe(false);
  });
});

// Execute the imported functions in a sandbox with invented rows only. No Sheet, D1, or network calls.
const appsScript = readFileSync(new URL('../../spt/integrations/tracker/SPTBridge.gs', import.meta.url), 'utf8');
const snapshotFunction = appsScript.slice(appsScript.indexOf('function spbSnapshot_('), appsScript.indexOf('\nfunction spbCloseout_('));
const bridgeSource = readFileSync(new URL('../../spt/lib/sheet-bridge.ts', import.meta.url), 'utf8');
const mappingFunction = bridgeSource.slice(bridgeSource.indexOf('export function validateMappings('), bridgeSource.indexOf('\nexport async function sheetState('));
const compiledMapping = new Bun.Transpiler({ loader: 'ts' }).transformSync(mappingFunction.replace('export function', 'function'));
class SyntheticApiError extends Error { constructor(message: string, public status = 400) { super(message); } }
const validateMappings = runInNewContext(`${compiledMapping}; validateMappings`, { ApiError: SyntheticApiError }) as
  (snapshot: unknown, mappings: unknown) => Array<{ mainRow: number }>;

function syntheticSnapshot(values: string[][]) {
  const profile = { id: 'synthetic-student-01', name: 'Synthetic Student 01', status: '재원', sourceRow: 14 };
  const main = { getLastRow: () => values.length, getSheetId: () => 1754681846 };
  const context = {
    SPB_CONFIG: { main: 'Synthetic Main', profiles: 'Synthetic Profiles', spreadsheetId: 'synthetic-workbook', protocol: 'synthetic' },
    spbDate_: (date: string) => date, spbProfiles_: () => [profile], spbSheet_: () => main,
    spbRequire_: (pass: boolean) => { if (!pass) throw new Error('synthetic-requirement'); },
    spbGrid_: () => ({ values, formulas: values.map(row => row.map(() => '')), display: values }),
    spbCells_: () => [], pkHash_: () => 'synthetic-digest', spbState_: () => ({ raw: {}, events: [], eventRows: [] }),
    spbSchedule_: () => null, spbCatalog_: () => ({}), spbLatestReview_: () => null,
    spbStudentVersion_: () => 'synthetic-revision', spbFactsBasis_: () => 'synthetic-facts', spbAttendance_: () => [],
  };
  const fn = runInNewContext(`${snapshotFunction}; spbSnapshot_`, context) as
    (ss: unknown, payload: unknown) => { snapshot: { mainSource: { rows: Array<{ sourceRow: number; name: string }> } } };
  return fn({ getSpreadsheetTimeZone: () => 'Asia/Seoul' }, { date: '2026-10-01' }).snapshot;
}

describe('actual legacy bridge migration regression evidence', () => {
  it('proves the broad column-C scan also emits non-student text', () => {
    const rows = Array.from({ length: 160 }, () => Array<string>(18).fill(''));
    rows[8]![2] = 'Synthetic Student 01';
    rows[99]![2] = 'SYNTHETIC NON-STUDENT HEADER';
    expect(syntheticSnapshot(rows).mainSource.rows.map(row => row.name)).toEqual([
      'Synthetic Student 01', 'SYNTHETIC NON-STUDENT HEADER',
    ]);
  });
  it('proves +48 invalidates persisted absolute mainRow mappings and requires a fresh reviewed mapping', () => {
    const rows = Array.from({ length: 160 }, () => Array<string>(18).fill(''));
    rows[8]![2] = 'Synthetic Student 01';
    const before = syntheticSnapshot(rows);
    const prefix = Array.from({ length: 48 }, () => Array<string>(18).fill(''));
    prefix[1]![2] = '학생이름';
    const after = syntheticSnapshot([...prefix, ...rows]);
    const old = { studentId: 'synthetic-student-01', name: 'Synthetic Student 01', profileRow: 14, mainRow: 9 };
    expect(validateMappings(before, [old])[0]!.mainRow).toBe(9);
    expect(() => validateMappings(after, [old])).toThrow('학생 ID·이름·원본 행');
    expect(validateMappings(after, [{ ...old, mainRow: 57 }])[0]!.mainRow).toBe(57);
    expect(after.mainSource.rows.map(row => row.sourceRow)).toEqual([57]);
  });
});
