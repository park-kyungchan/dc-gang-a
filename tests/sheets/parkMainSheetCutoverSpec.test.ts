import { describe, expect, it } from 'bun:test';
import { parkCutoverRoster, parkMainSheetCutoverSpec } from '../../src/sheets/parkMainSheetCutoverSpec';

describe('public Main Sheet layout examples', () => {
  it('contains only explicitly synthetic student identities and grade markers', () => {
    expect(parkMainSheetCutoverSpec.dataClassification).toBe('synthetic_student_layout_only');
    expect(parkCutoverRoster).toHaveLength(5);
    expect(new Set(parkCutoverRoster.map(student => student.studentId)).size).toBe(5);
    for (const [index, student] of parkCutoverRoster.entries()) {
      const ordinal = String(index + 1).padStart(2, '0');
      expect<string>(student.studentId).toBe(`synthetic-layout-student-${ordinal}`);
      expect<string>(student.name).toBe(`Synthetic Student ${ordinal}`);
      expect(student.grade).toMatch(/^SYNTHETIC-GRADE-[AB]$/);
    }
  });

  it('preserves legacy row placement and joins through the synthetic roster', () => {
    expect(parkCutoverRoster.map(student => student.row)).toEqual([9, 10, 18, 19, 20]);
    expect(parkMainSheetCutoverSpec.legacy.studentCells).toEqual(
      parkCutoverRoster.map(student => ({ range: `C${student.row}`, value: student.name, kind: 'literal' })),
    );
    expect(parkMainSheetCutoverSpec.legacy.studentIdentityKeys).toEqual(
      parkCutoverRoster.map(student => ({ row: student.row, studentId: student.studentId })),
    );
    expect(parkMainSheetCutoverSpec.legacy.gradeCells.map(cell => cell.value)).toEqual([
      'SYNTHETIC-GRADE-A', 'SYNTHETIC-GRADE-B', null,
    ]);
  });

  it('reuses synthetic identities across the preview sections without source-student facts', () => {
    const cells = parkMainSheetCutoverSpec.sections.flatMap(section => [...section.cells]);
    const valueAt = (range: string) => cells.find(cell => cell.range === range)?.value;
    for (const range of ['A51', 'A70', 'A87']) expect(valueAt(range)).toBe(parkCutoverRoster[2].name);
    for (const range of ['A52', 'A71', 'A88']) expect(valueAt(range)).toBe(parkCutoverRoster[4].name);
    expect(valueAt('B51')).toBe('SYNTHETIC-GRADE-B');
    expect(valueAt('B52')).toBe('SYNTHETIC-GRADE-B');
    expect(valueAt('C51')).toBe('SYNTHETIC-GROUP-A');
    expect(valueAt('C52')).toBe('SYNTHETIC-GROUP-B');
  });

  it('retains the reviewed production boundary and excludes synthetic examples from writes', () => {
    expect(parkMainSheetCutoverSpec.status).toBe('review_only_no_sheet_write');
    expect(parkMainSheetCutoverSpec.productionGate).toMatchObject({
      approvalRequired: true,
      beforeAfterRangesRequired: true,
      freshLocalRosterRequired: true,
      syntheticExamplesMayBeWritten: false,
      noLmsOrSenderEffect: true,
      noFunctionalWriterClaim: true,
    });
    expect(parkMainSheetCutoverSpec.oneTimeBatchSequence.join(' ')).toContain('fresh local canonical data');
    expect(parkMainSheetCutoverSpec.oneTimeBatchSequence.join(' ')).toContain('never write the synthetic examples');
    expect(parkMainSheetCutoverSpec.sections.map(section => section.range)).toEqual([
      'A48:R56', 'A58:R66', 'A68:R75', 'A77:R83', 'A85:R91', 'A93:R100', 'A101:R110',
    ]);
  });
});
