import { describe, it, expect } from 'bun:test';
import { MainSheetAssessmentProjector } from '../../src/sheets/mainSheetAssessmentProjector';
import { AppGradingReader } from '../../src/assessment/appGradingReader';
import { StudentAssessmentLedgerEngine } from '../../src/assessment/studentAssessmentLedger';

describe('Google Sheets API v4 Row-Grouped Folding DB Blocks', () => {
  const SHEET_ID = 1754681846; // Main Sheet ("박경찬" Tab ID)

  it('generates valid addDimensionGroup and updateDimensionGroup operations with collapsed: true', () => {
    // Student 1 (Shin Ji-woo): Main Card at Row 9 (index 9)
    // History Block: Rows 10 to 14 (startIndex: 10, endIndex: 14)
    const ops = MainSheetAssessmentProjector.buildAddRowGroupRequest(SHEET_ID, 10, 14, true);

    expect(ops.length).toBe(2);

    // 1. addDimensionGroup
    const addOp = ops[0];
    expect(addOp.addDimensionGroup).toBeDefined();
    expect(addOp.addDimensionGroup!.range.sheetId).toBe(SHEET_ID);
    expect(addOp.addDimensionGroup!.range.dimension).toBe('ROWS');
    expect(addOp.addDimensionGroup!.range.startIndex).toBe(10);
    expect(addOp.addDimensionGroup!.range.endIndex).toBe(14);

    // 2. updateDimensionGroup (collapsed)
    const updateOp = ops[1];
    expect(updateOp.updateDimensionGroup).toBeDefined();
    expect(updateOp.updateDimensionGroup!.dimensionGroup.collapsed).toBe(true);
    expect(updateOp.updateDimensionGroup!.dimensionGroup.depth).toBe(1);
    expect(updateOp.updateDimensionGroup!.fields).toBe('collapsed');
  });

  it('builds indented updateCells rows for student longitudinal history under the main card', () => {
    const ledger = new StudentAssessmentLedgerEngine();
    const raw = AppGradingReader.createShinJiwooGradingPayload();
    const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

    const historyOp = MainSheetAssessmentProjector.buildRowGroupedHistoryCells(SHEET_ID, 10, [record]);

    expect(historyOp.updateCells).toBeDefined();
    expect(historyOp.updateCells!.range.startRowIndex).toBe(10);
    expect(historyOp.updateCells!.range.endRowIndex).toBe(11);
    expect(historyOp.updateCells!.rows.length).toBe(1);

    const values = historyOp.updateCells!.rows[0].values;
    // Check visual hierarchy indentation
    expect(values[0].userEnteredValue?.stringValue).toContain('↳ [이력]');
    expect(values[4].userEnteredValue?.stringValue).toBe('90점 (18/20)');
    expect(values[5].userEnteredValue?.stringValue).toBe('19번, 20번');
  });

  it('allows uncollapsed (expanded) state when requested by user or teacher', () => {
    const ops = MainSheetAssessmentProjector.buildAddRowGroupRequest(SHEET_ID, 15, 20, false);
    expect(ops[1].updateDimensionGroup!.dimensionGroup.collapsed).toBe(false);
  });
});
