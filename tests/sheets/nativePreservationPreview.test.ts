import { describe, expect, test } from 'bun:test';
import { buildNativePreservationPreview, connectedUserEditorObservation } from '../../src/sheets/nativePreservationPreview';

const receiptHash = 'c641630c9967baed1e3152e60b519cf488cc855ddd089fae995221dda6a4f48c';
function fixture() {
  return { receipt: 'read_summary', verifiedAt: '2026-10-01T03:57:19.025Z',
    requestedMetadataSha256: '4e6131816114ee219c47aa9da5837ba9037a24cdfef9400cd77562c9f6b42a77',
    responseScopeGuardPassed: true, cellValuesRead: false, writesPerformed: false,
    target: { sheetId: 1754681846, title: 'synthetic-main' }, spreadsheetId: 'synthetic-book',
    grid: { details: { rowCount: 160, columnCount: 16, frozenRowCount: 2 } }, merges: { count: 48 },
    chart: { details: { chartId: 1728410094, chartType: { value: 'COMBO' }, series: { state: 'absent' }, domains: { count: 1 },
      sourceRanges: [{ sheetId: 1754681846, startRowIndex: 5, endRowIndex: 9, startColumnIndex: 0, endColumnIndex: 1 }],
      position: { overlayPosition: { anchorCell: { sheetId: 1754681846, rowIndex: 20, columnIndex: 6 },
        offsetXPixels: 20, offsetYPixels: 27, widthPixels: 818, heightPixels: 350 } } } },
    protection: { details: { protectedRangeId: 1054892822, range: { sheetId: 1754681846 }, enforced: true,
      ownerUserIsExplicitEditor: true, botIsExplicitEditor: true, requestingUserCanEdit: true,
      unprotectedCells: ['I8', 'I5'], editorUserCount: 3, editorGroupCount: 0, domainUsersCanEdit: false } } };
}
describe('native preservation preview', () => {
  test('checks 48-row coordinates without claiming native behavior', () => {
    const result = buildNativePreservationPreview(fixture(), receiptHash);
    expect(result.machineCheckedCoordinateExpectations.shifts.map(item => item.after)).toEqual(['G69', 'A54:A57', 'I53', 'I56']);
    expect(result.machineCheckedCoordinateExpectations.zeroBasedChartDomain.expectedAfter.endRowIndex).toBe(57);
    expect(result.authorization.nativeBehaviorVerified).toBe(false);
    expect(result.authorization.executableMutationBatchProduced).toBe(false);
  });
  test('does not convert missing chart series into a fabricated series', () => {
    const result = buildNativePreservationPreview(fixture(), receiptHash);
    expect(result.verifiedBefore.chart.series).toBe('absent');
    expect(result.verifiedBefore.chart.anchor).toBe('G21');
  });
  test('preserves whole-sheet semantics and leaves new inputs and freezing undecided', () => {
    const result = buildNativePreservationPreview(fixture(), receiptHash);
    expect(result.verifiedBefore.protection.scope).toBe('entire_sheet');
    expect(result.protectionDecision.nativeRelocationVerified).toBe(false);
    expect(result.freezeDecision.approvedAfterCount).toBeNull();
    expect(result.declaredCandidate.rowInsertionOnlyGrid.columns).toBe(16);
    expect(result.declaredCandidate.candidateFinalGrid.columns).toBe(18);
  });
  test('aliases identify connected user rather than spreadsheet owner', () => {
    expect(connectedUserEditorObservation({ ownerUserIsExplicitEditor: true })).toBe(true);
    expect(connectedUserEditorObservation({ connectedUserIsExplicitEditor: false })).toBe(false);
    expect(() => connectedUserEditorObservation({ ownerUserIsExplicitEditor: true, connectedUserIsExplicitEditor: false })).toThrow('connected_editor_alias_conflict');
    expect(buildNativePreservationPreview(fixture(), receiptHash).verifiedBefore.protection.spreadsheetOwnerVerified).toBe(false);
  });
  test('fails on mismatched receipt hash, coordinates, scope, or observed effects', () => {
    expect(() => buildNativePreservationPreview(fixture(), '0'.repeat(64))).toThrow('native_preview_source_mismatch');
    const altered = fixture(); altered.chart.details.position.overlayPosition.anchorCell.rowIndex = 21;
    expect(() => buildNativePreservationPreview(altered, receiptHash)).toThrow('native_preview_source_mismatch');
    const effect = fixture(); effect.writesPerformed = true;
    expect(() => buildNativePreservationPreview(effect, receiptHash)).toThrow('native_preview_source_mismatch');
  });
});
