/**
 * Unit Test Suite: DualSyncAdapter & 31-Day Attendance Grid
 * Testing against rubric DIM-02 requirements and adversarial failure cases.
 */

import { describe, expect, it } from 'bun:test';
import {
  DualSyncAdapter,
  VirtualAttendanceGrid,
  buildGoogleSheetsBatchUpdate,
  formatAttendanceHoverNote
} from '../../src/sheets/dualSyncAdapter';
import {
  AttendanceCellCode,
  calculate31DayGridColumn,
  validateAttendanceCellUpdate
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

describe('DualSyncAdapter & 31-Day Grid Engine', () => {
  describe('DIM-02: 31-Day Grid Mathematics (colIndex = 3 + d)', () => {
    it('accurately maps key calendar days to exact 0-indexed column and Excel letters', () => {
      const expectations: Array<{ day: number; expectedCol: number; expectedLetter: string }> = [
        { day: 1, expectedCol: 4, expectedLetter: 'E' },
        { day: 10, expectedCol: 13, expectedLetter: 'N' },
        { day: 21, expectedCol: 24, expectedLetter: 'Y' },
        { day: 22, expectedCol: 25, expectedLetter: 'Z' },
        { day: 23, expectedCol: 26, expectedLetter: 'AA' },
        { day: 25, expectedCol: 28, expectedLetter: 'AC' },
        { day: 28, expectedCol: 31, expectedLetter: 'AF' },
        { day: 31, expectedCol: 34, expectedLetter: 'AI' }
      ];

      for (const exp of expectations) {
        const coord = calculate31DayGridColumn(exp.day, 4);
        expect(coord.day).toBe(exp.day);
        expect(coord.colIndex).toBe(exp.expectedCol);
        expect(coord.colLetter).toBe(exp.expectedLetter);
        expect(coord.cellAddress).toBe(`${exp.expectedLetter}4`);
      }
    });

    it('rejects out-of-range days and non-integer inputs with RangeError', () => {
      expect(() => calculate31DayGridColumn(0)).toThrow(RangeError);
      expect(() => calculate31DayGridColumn(32)).toThrow(RangeError);
      expect(() => calculate31DayGridColumn(-5)).toThrow(RangeError);
      expect(() => calculate31DayGridColumn(15.5)).toThrow(RangeError);
    });
  });

  describe('DIM-02: Cell Value Whitelist Guard & Formula Integrity', () => {
    const validCodes: AttendanceCellCode[] = ['O', 'X', 'O(지각)', 'O(보강)', 'O(이동)', ''];

    it('accepts all official white-listed attendance codes with preserveFormatting: true', () => {
      for (const code of validCodes) {
        const res = validateAttendanceCellUpdate({
          row: 4,
          col: 31,
          cellAddress: 'AF4',
          cellValue: code,
          hoverNote: code ? `Status: ${code}` : null,
          preserveFormatting: true
        });
        expect(res.valid).toBe(true);
        expect(res.errors).toHaveLength(0);
      }
    });

    it('blocks freeform narrative descriptions in cellValue (BLOCKER-1 protection)', () => {
      const freeformProposals = [
        '15분 지각 (병원 진료)',
        '결석 (추석 연휴)',
        '지각 15분',
        '보강 예정 (10/17)',
        'O (지각 15분 도착)'
      ];

      for (const text of freeformProposals) {
        const res = validateAttendanceCellUpdate({
          row: 4,
          col: 31,
          cellAddress: 'AF4',
          cellValue: text as any,
          hoverNote: null,
          preserveFormatting: true
        });
        expect(res.valid).toBe(false);
        expect(res.errors.some(e => e.includes('Invalid cellValue'))).toBe(true);
      }
    });

    it('rejects payload when preserveFormatting is false', () => {
      const res = validateAttendanceCellUpdate({
        row: 4,
        col: 31,
        cellAddress: 'AF4',
        cellValue: 'O',
        hoverNote: null,
        preserveFormatting: false as any
      });
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('preserveFormatting'))).toBe(true);
    });
  });

  describe('DIM-02: Multiline Hover Note Formatter', () => {
    it('formats tardiness details into multiline hover note without flattening', () => {
      const note = formatAttendanceHoverNote({
        category: '지각',
        actualArrivalTime: '15:15',
        delayMinutes: 15,
        advanceNotificationReceived: true,
        contactChannel: 'sms',
        reason: '추석 연휴 직후 병원 대기 환자 과밀로 진료 지연',
        actionTaken: '등원 즉시 과제 실물 제출 및 15:35 대단원 총괄평가 정상 응시'
      });

      expect(note).toContain('[지각 사유]');
      expect(note).toContain('- 도착 시각: 15:15 (15분 지연)');
      expect(note).toContain('- 사전 접수: 사전 접수 완료 (SMS)');
      expect(note).toContain('- 사유: 추석 연휴 직후 병원 대기 환자 과밀로 진료 지연');
      expect(note).toContain('- 현장 조치: 등원 즉시 과제 실물 제출 및 15:35 대단원 총괄평가 정상 응시');
      // Preserves newlines
      expect(note.split('\n').length).toBeGreaterThanOrEqual(5);
    });

    it('formats unnotified absence note cleanly', () => {
      const note = formatAttendanceHoverNote({
        category: '결석',
        actualArrivalTime: null,
        advanceNotificationReceived: false,
        reason: '추석 연휴 친척 방문으로 불참'
      });

      expect(note).toContain('[결석 사유]');
      expect(note).toContain('- 도착 시각: 미도착 (결석)');
      expect(note).toContain('- 사전 접수: 사전 연락 없음 (무단)');
      expect(note).toContain('- 사유: 추석 연휴 친척 방문으로 불참');
    });
  });

  describe('DIM-02: Google Sheets API v4 batchUpdate Payload Builder', () => {
    it('generates updateCells request with fields: "userEnteredValue,note" protecting styles', () => {
      const payload = {
        row: 6,
        col: 31, // Day 28
        cellAddress: 'AF6',
        cellValue: 'O(지각)' as AttendanceCellCode,
        hoverNote: '[지각 사유]\n- 도착: 15:15',
        preserveFormatting: true as const
      };

      const batch = buildGoogleSheetsBatchUpdate(payload, { sheetId: 0 });
      expect(batch.requests).toHaveLength(1);

      const req = batch.requests[0];
      if (!('updateCells' in req)) {
        throw new Error('Expected updateCells request');
      }

      expect(req.updateCells.fields).toBe('userEnteredValue,note');
      expect(req.updateCells.range).toEqual({
        sheetId: 0,
        startRowIndex: 5,
        endRowIndex: 6,
        startColumnIndex: 31,
        endColumnIndex: 32
      });
      expect(req.updateCells.rows[0].values[0].userEnteredValue?.stringValue).toBe('O(지각)');
      expect(req.updateCells.rows[0].values[0].note).toBe('[지각 사유]\n- 도착: 15:15');
    });

    it('supports repeatCell mode when requested', () => {
      const payload = {
        row: 4,
        col: 26, // Day 23
        cellAddress: 'AA4',
        cellValue: 'X' as AttendanceCellCode,
        hoverNote: '[결석 사유]\n추석 연휴',
        preserveFormatting: true as const
      };

      const batch = buildGoogleSheetsBatchUpdate(payload, { sheetId: 12345, useRepeatCell: true });
      expect(batch.requests).toHaveLength(1);

      const req = batch.requests[0];
      if (!('repeatCell' in req)) {
        throw new Error('Expected repeatCell request');
      }

      expect(req.repeatCell.fields).toBe('userEnteredValue,note');
      expect(req.repeatCell.range.sheetId).toBe(12345);
      expect(req.repeatCell.cell.userEnteredValue?.stringValue).toBe('X');
    });

    it('supports noteOnly option generating fields: "note"', () => {
      const payload = {
        row: 5,
        col: 28,
        cellAddress: 'AC5',
        cellValue: 'O' as AttendanceCellCode,
        hoverNote: '참고 사항 추가',
        preserveFormatting: true as const
      };

      const batch = buildGoogleSheetsBatchUpdate(payload, { noteOnly: true });
      const req = batch.requests[0];
      if ('updateCells' in req) {
        expect(req.updateCells.fields).toBe('note');
      }
    });
  });

  describe('DIM-02: Offline Virtual Attendance Grid & Formula Simulation', () => {
    it('initializes 31-day grid with =COUNTIF formula and evaluates attendance count', () => {
      const grid = new VirtualAttendanceGrid([
        { studentId: '1293032', name: '신지우', school: '대치초', classGroup: '월수1부', rowIndex: 4 },
        { studentId: '1293067', name: '박세은', school: '도곡초', classGroup: '월금1부', rowIndex: 5 },
        { studentId: '1293138', name: '유지연', school: '대치초', classGroup: '월금1부', rowIndex: 6 }
      ]);

      // Set cell styles (e.g. background fill)
      grid.setCellStyle('AF6', { backgroundColor: '#FFEAEA' });

      // Shin Ji-woo attendance in September: Day 21 (O), Day 23 (X), Day 28 (O)
      grid.applyUpdate({
        row: 4,
        col: 24, // Day 21
        cellAddress: 'Y4',
        cellValue: 'O',
        hoverNote: null,
        preserveFormatting: true
      });

      grid.applyUpdate({
        row: 4,
        col: 26, // Day 23
        cellAddress: 'AA4',
        cellValue: 'X',
        hoverNote: '추석 연휴 결석',
        preserveFormatting: true
      });

      grid.applyUpdate({
        row: 4,
        col: 31, // Day 28
        cellAddress: 'AF4',
        cellValue: 'O',
        hoverNote: null,
        preserveFormatting: true
      });

      // Count for Shin Ji-woo should be 2 (Day 21 and Day 28; Day 23 'X' is not counted)
      const shinCount = grid.evaluateMonthlyAttendanceCount(4);
      expect(shinCount).toBe(2);

      // Yoo Ji-yeon Day 28 tardy: 'O(지각)'
      const yooResult = grid.applyUpdate({
        row: 6,
        col: 31,
        cellAddress: 'AF6',
        cellValue: 'O(지각)',
        hoverNote: '[지각 사유]\n도착: 15:15',
        preserveFormatting: true
      });

      expect(yooResult.applied).toBe(true);
      expect(yooResult.stylePreserved).toBe(true);
      expect(yooResult.monthlyAttendanceCount).toBe(1);

      // Verify custom style is completely preserved
      const yooCell = grid.getCell('AF6');
      expect(yooCell?.style.backgroundColor).toBe('#FFEAEA');
    });

    it('dry-run mode previews changes without modifying the grid', () => {
      const grid = new VirtualAttendanceGrid([
        { studentId: '1293067', name: '박세은', school: '도곡초', classGroup: '월금1부', rowIndex: 5 }
      ]);

      const dryRunResult = grid.applyUpdate(
        {
          row: 5,
          col: 31,
          cellAddress: 'AF5',
          cellValue: 'O',
          hoverNote: '정시 등원',
          preserveFormatting: true
        },
        { dryRun: true }
      );

      expect(dryRunResult.dryRun).toBe(true);
      expect(dryRunResult.applied).toBe(false);

      // Cell remains empty in grid
      const cell = grid.getCell('AF5');
      expect(cell?.value).toBe('');
      expect(cell?.note).toBeNull();
    });
  });

  describe('DualSyncAdapter High-Level Flow', () => {
    it('executes full end-to-end sync with batchUpdate generation and grid update', () => {
      const adapter = new DualSyncAdapter();
      adapter.getGrid().registerStudent({
        studentId: '1293138',
        name: '유지연',
        school: '대치초',
        classGroup: '월금1부',
        rowIndex: 6
      });

      const syncResult = adapter.sync({
        studentId: '1293138',
        day: 28,
        rowIndex: 6,
        cellCode: 'O(지각)',
        hoverNoteDetails: {
          category: '지각',
          actualArrivalTime: '15:15',
          delayMinutes: 15,
          advanceNotificationReceived: true,
          contactChannel: 'sms',
          reason: '병원 진료 지연',
          actionTaken: '15:35 평가 응시'
        }
      });

      expect(syncResult.payload.cellAddress).toBe('AF6');
      expect(syncResult.payload.cellValue).toBe('O(지각)');
      expect(syncResult.batchUpdateRequest.requests).toHaveLength(1);
      expect(syncResult.gridResult.applied).toBe(true);
      expect(syncResult.gridResult.monthlyAttendanceCount).toBe(1);
    });
  });
});
