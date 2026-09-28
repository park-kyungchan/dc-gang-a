/**
 * DualSyncAdapter
 * Handles synchronization between Main Sheet v2 state and Google Sheets / Excel attendance grids.
 * 
 * Strict Domain Invariants:
 * 1. 31-Day Attendance Grid Mathematics: colIndex(d) = 3 + d (0-indexed).
 *    Col 0: 이름, Col 1: 학교, Col 2: 반, Col 3: 합계 (=COUNTIF(E4:AI4, "O*")), Col 4..34: Day 1..31 (E..AI).
 * 2. Whitelist AttendanceCellCode: ['O', 'X', 'O(지각)', 'O(보강)', 'O(이동)', ''].
 *    Freeform narrative text in cell values is strictly rejected to protect =COUNTIF totals.
 * 3. Multiline Hover Notes: Narrative details, delay minutes, advance notice, and reasons
 *    are strictly placed in hover notes / cell comments, preserving multiline structure.
 * 4. Format Preservation: Google Sheets API v4 batchUpdate uses `fields: "userEnteredValue,note"`
 *    or `fields: "note"` to NEVER strip borders, cell background fills, or conditional formatting.
 * 5. Offline Dry-Run Virtual Grid: Full in-memory grid simulation validating formula integrity.
 */

import {
  AttendanceCellCode,
  AttendanceGridCoordinate,
  AttendanceRecord,
  HoverNoteMetadata,
  SheetCellUpdatePayload,
  StudentId,
  calculate31DayGridColumn,
  validateAttendanceCellUpdate
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

// ============================================================================
// 1. Google Sheets API v4 Payload Types
// ============================================================================

export interface GoogleSheetsGridRange {
  sheetId: number;
  startRowIndex: number;
  endRowIndex: number;
  startColumnIndex: number;
  endColumnIndex: number;
}

export interface GoogleSheetsExtendedValue {
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  formulaValue?: string;
}

export interface GoogleSheetsCellData {
  userEnteredValue?: GoogleSheetsExtendedValue;
  note?: string;
}

export interface GoogleSheetsRowData {
  values: GoogleSheetsCellData[];
}

export interface GoogleSheetsUpdateCellsRequest {
  updateCells: {
    rows: GoogleSheetsRowData[];
    fields: string; // e.g. "userEnteredValue,note" or "note"
    range: GoogleSheetsGridRange;
  };
}

export interface GoogleSheetsRepeatCellRequest {
  repeatCell: {
    cell: GoogleSheetsCellData;
    fields: string;
    range: GoogleSheetsGridRange;
  };
}

export type GoogleSheetsBatchUpdateRequest = 
  | GoogleSheetsUpdateCellsRequest 
  | GoogleSheetsRepeatCellRequest;

export interface GoogleSheetsBatchUpdatePayload {
  requests: GoogleSheetsBatchUpdateRequest[];
}

// ============================================================================
// 2. Multiline Hover Note Formatter
// ============================================================================

export interface HoverNoteParams {
  category: '지각' | '결석' | '보강' | '이동' | '일반' | string;
  actualArrivalTime?: string | null;
  delayMinutes?: number;
  advanceNotificationReceived?: boolean;
  contactChannel?: 'sms' | 'phone_call' | 'kakao' | 'parent_in_person' | 'none' | string;
  reason?: string;
  actionTaken?: string;
  additionalNotes?: string[];
}

/**
 * Formats structured attendance details into an administrative multiline hover note.
 * Preserves newlines and visual structure.
 */
export function formatAttendanceHoverNote(params: HoverNoteParams): string {
  const lines: string[] = [];

  const categoryHeader = params.category.endsWith('사유') 
    ? `[${params.category}]` 
    : `[${params.category} 사유]`;
  lines.push(categoryHeader);

  if (params.actualArrivalTime !== undefined) {
    if (params.actualArrivalTime) {
      const delayText = params.delayMinutes && params.delayMinutes > 0 
        ? ` (${params.delayMinutes}분 지연)` 
        : '';
      lines.push(`- 도착 시각: ${params.actualArrivalTime}${delayText}`);
    } else {
      lines.push('- 도착 시각: 미도착 (결석)');
    }
  }

  if (params.advanceNotificationReceived !== undefined) {
    const channelMap: Record<string, string> = {
      sms: 'SMS',
      phone_call: '유선 전화',
      kakao: '카카오톡',
      parent_in_person: '학부모 대면',
      none: '없음'
    };
    const channel = channelMap[params.contactChannel || ''] || params.contactChannel || '';
    const statusText = params.advanceNotificationReceived 
      ? `사전 접수 완료${channel ? ` (${channel})` : ''}` 
      : '사전 연락 없음 (무단)';
    lines.push(`- 사전 접수: ${statusText}`);
  }

  if (params.reason) {
    lines.push(`- 사유: ${params.reason.trim()}`);
  }

  if (params.actionTaken) {
    lines.push(`- 현장 조치: ${params.actionTaken.trim()}`);
  }

  if (params.additionalNotes && params.additionalNotes.length > 0) {
    for (const note of params.additionalNotes) {
      if (note && note.trim()) {
        lines.push(`- 비고: ${note.trim()}`);
      }
    }
  }

  return lines.join('\n');
}

// ============================================================================
// 3. Google Sheets API v4 BatchUpdate Payload Builder
// ============================================================================

export interface BatchUpdateOptions {
  sheetId?: number;
  useRepeatCell?: boolean; // If true uses repeatCell, otherwise updateCells
  noteOnly?: boolean;      // If true, fields = "note" without changing value
}

/**
 * Builds Google Sheets API v4 batchUpdate requests for cell updates.
 * Invariant: fields is strictly restricted to "userEnteredValue,note" (or "note"),
 * ensuring that userEnteredFormat, borders, background colors, and number formats
 * are 100% PRESERVED.
 */
export function buildGoogleSheetsBatchUpdate(
  payloads: SheetCellUpdatePayload | SheetCellUpdatePayload[],
  options: BatchUpdateOptions = {}
): GoogleSheetsBatchUpdatePayload {
  const items = Array.isArray(payloads) ? payloads : [payloads];
  const sheetId = options.sheetId ?? 0;
  const requests: GoogleSheetsBatchUpdateRequest[] = [];

  for (const item of items) {
    // Validate payload whitelist
    const validation = validateAttendanceCellUpdate(item);
    if (!validation.valid) {
      throw new Error(`BatchUpdate validation error for cell ${item.cellAddress}: ${validation.errors.join('; ')}`);
    }

    // Google Sheets API range uses 0-indexed half-open intervals [start, end)
    const range: GoogleSheetsGridRange = {
      sheetId,
      startRowIndex: item.row - 1,
      endRowIndex: item.row,
      startColumnIndex: item.col,
      endColumnIndex: item.col + 1
    };

    const cellData: GoogleSheetsCellData = {};
    let fields = '';

    if (options.noteOnly) {
      cellData.note = item.hoverNote ?? '';
      fields = 'note';
    } else {
      cellData.userEnteredValue = { stringValue: item.cellValue };
      if (item.hoverNote !== null && item.hoverNote !== undefined) {
        cellData.note = item.hoverNote;
      }
      fields = item.hoverNote !== null && item.hoverNote !== undefined 
        ? 'userEnteredValue,note' 
        : 'userEnteredValue';
    }

    if (options.useRepeatCell) {
      requests.push({
        repeatCell: {
          cell: cellData,
          fields,
          range
        }
      });
    } else {
      requests.push({
        updateCells: {
          rows: [
            {
              values: [cellData]
            }
          ],
          fields,
          range
        }
      });
    }
  }

  return { requests };
}

// ============================================================================
// 4. In-Memory Virtual Attendance Grid (Offline Dry-Run Support)
// ============================================================================

export interface VirtualCellStyle {
  backgroundColor?: string;
  borders?: {
    top?: boolean;
    bottom?: boolean;
    left?: boolean;
    right?: boolean;
  };
  fontBold?: boolean;
}

export interface VirtualCell {
  row: number;         // 1-indexed row number (e.g. 4)
  col: number;         // 0-indexed column (0=A, 4=E, 31=AF)
  cellAddress: string; // e.g. "AF4"
  value: string;
  note: string | null;
  style: VirtualCellStyle;
}

export interface VirtualRosterStudent {
  studentId: StudentId;
  name: string;
  school: string;
  classGroup: string;
  rowIndex: number; // 1-indexed (e.g. 4 for Shin Ji-woo)
}

export interface VirtualUpdateResult {
  cellAddress: string;
  previousValue: string;
  newValue: string;
  previousNote: string | null;
  newNote: string | null;
  stylePreserved: boolean;
  monthlyAttendanceCount: number; // Evaluated =COUNTIF(E{row}:AI{row}, "O*")
  applied: boolean;
  dryRun: boolean;
}

export class VirtualAttendanceGrid {
  private grid: Map<string, VirtualCell> = new Map();
  private roster: Map<StudentId, VirtualRosterStudent> = new Map();

  constructor(students?: VirtualRosterStudent[]) {
    if (students) {
      for (const st of students) {
        this.registerStudent(st);
      }
    }
  }

  /**
   * Register a student row in the grid and initialize standard columns.
   */
  public registerStudent(student: VirtualRosterStudent): void {
    this.roster.set(student.studentId, student);
    const r = student.rowIndex;

    // Col 0 (A): 이름
    this.initCell(r, 0, student.name);
    // Col 1 (B): 학교
    this.initCell(r, 1, student.school);
    // Col 2 (C): 반
    this.initCell(r, 2, student.classGroup);
    // Col 3 (D): 합계 formula
    this.initCell(r, 3, `=COUNTIF(E${r}:AI${r}, "O*")`, null, { fontBold: true });

    // Col 4..34: Days 1..31
    for (let day = 1; day <= 31; day++) {
      const coord = calculate31DayGridColumn(day, r);
      this.initCell(r, coord.colIndex, '', null, {
        backgroundColor: '#FFFFFF',
        borders: { top: true, bottom: true, left: true, right: true }
      });
    }
  }

  private initCell(row: number, col: number, value: string, note: string | null = null, style: VirtualCellStyle = {}): void {
    const letter = calculate31DayGridColumn(1, row); // helper for conversion
    const address = this.getAddress(row, col);
    this.grid.set(address, {
      row,
      col,
      cellAddress: address,
      value,
      note,
      style: {
        backgroundColor: '#FFFFFF',
        borders: { top: true, bottom: true, left: true, right: true },
        ...style
      }
    });
  }

  public getAddress(row: number, col: number): string {
    let temp = col;
    let letter = '';
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return `${letter}${row}`;
  }

  public getCell(address: string): VirtualCell | undefined {
    return this.grid.get(address.toUpperCase());
  }

  public getCellByCoord(row: number, col: number): VirtualCell | undefined {
    return this.getCell(this.getAddress(row, col));
  }

  /**
   * Evaluates =COUNTIF(E{row}:AI{row}, "O*")
   * Counts how many day cells start with the prefix "O".
   */
  public evaluateMonthlyAttendanceCount(rowIndex: number): number {
    let count = 0;
    for (let day = 1; day <= 31; day++) {
      const coord = calculate31DayGridColumn(day, rowIndex);
      const cell = this.getCell(coord.cellAddress);
      if (cell && typeof cell.value === 'string' && cell.value.startsWith('O')) {
        count++;
      }
    }
    return count;
  }

  /**
   * Applies an attendance update payload to the virtual grid.
   * If dryRun is true, validates and previews without mutating state.
   */
  public applyUpdate(
    payload: SheetCellUpdatePayload,
    options: { dryRun?: boolean } = {}
  ): VirtualUpdateResult {
    // 1. Whitelist validation
    const validation = validateAttendanceCellUpdate(payload);
    if (!validation.valid) {
      throw new Error(`VirtualGrid update rejected: ${validation.errors.join('; ')}`);
    }

    const cell = this.getCell(payload.cellAddress);
    if (!cell) {
      throw new Error(`VirtualGrid cell not found at ${payload.cellAddress}`);
    }

    const prevValue = cell.value;
    const prevNote = cell.note;
    const prevStyle = { ...cell.style };

    const isDryRun = Boolean(options.dryRun);

    if (!isDryRun) {
      // Mutate value and note ONLY
      cell.value = payload.cellValue;
      cell.note = payload.hoverNote;
      // Invariant: cell.style remains completely intact!
    }

    const currentCount = this.evaluateMonthlyAttendanceCount(cell.row);

    // Verify style preservation
    const stylePreserved = JSON.stringify(cell.style) === JSON.stringify(prevStyle);

    return {
      cellAddress: payload.cellAddress,
      previousValue: prevValue,
      newValue: payload.cellValue,
      previousNote: prevNote,
      newNote: payload.hoverNote,
      stylePreserved,
      monthlyAttendanceCount: currentCount,
      applied: !isDryRun,
      dryRun: isDryRun
    };
  }

  /**
   * Sets custom style for a cell (e.g. conditional formatting color)
   * to test that updates do not erase custom styling.
   */
  public setCellStyle(address: string, style: Partial<VirtualCellStyle>): void {
    const cell = this.getCell(address);
    if (cell) {
      cell.style = { ...cell.style, ...style };
    }
  }

  public getRosterStudent(studentId: StudentId): VirtualRosterStudent | undefined {
    return this.roster.get(studentId);
  }
}

// ============================================================================
// 5. DualSyncAdapter High-Level Coordinator
// ============================================================================

export interface SyncAttendanceInput {
  studentId: StudentId;
  day: number;
  rowIndex: number;
  cellCode: AttendanceCellCode;
  hoverNoteDetails?: HoverNoteParams;
}

export class DualSyncAdapter {
  private virtualGrid: VirtualAttendanceGrid;

  constructor(virtualGrid?: VirtualAttendanceGrid) {
    this.virtualGrid = virtualGrid || new VirtualAttendanceGrid();
  }

  public getGrid(): VirtualAttendanceGrid {
    return this.virtualGrid;
  }

  /**
   * Prepares and validates a complete dual-write payload for a student's attendance.
   */
  public prepareUpdatePayload(input: SyncAttendanceInput): SheetCellUpdatePayload {
    const coord = calculate31DayGridColumn(input.day, input.rowIndex);

    let hoverNote: string | null = null;
    if (input.hoverNoteDetails) {
      hoverNote = formatAttendanceHoverNote(input.hoverNoteDetails);
    }

    const payload: SheetCellUpdatePayload = {
      row: input.rowIndex,
      col: coord.colIndex,
      cellAddress: coord.cellAddress,
      cellValue: input.cellCode,
      hoverNote,
      preserveFormatting: true
    };

    const validation = validateAttendanceCellUpdate(payload);
    if (!validation.valid) {
      throw new Error(`Failed to prepare valid attendance payload: ${validation.errors.join('; ')}`);
    }

    return payload;
  }

  /**
   * Dispatches attendance synchronization with dry-run support.
   */
  public sync(
    input: SyncAttendanceInput,
    options: { dryRun?: boolean; sheetId?: number; useRepeatCell?: boolean } = {}
  ): {
    payload: SheetCellUpdatePayload;
    batchUpdateRequest: GoogleSheetsBatchUpdatePayload;
    gridResult: VirtualUpdateResult;
  } {
    const payload = this.prepareUpdatePayload(input);
    const batchUpdateRequest = buildGoogleSheetsBatchUpdate(payload, {
      sheetId: options.sheetId,
      useRepeatCell: options.useRepeatCell
    });
    const gridResult = this.virtualGrid.applyUpdate(payload, { dryRun: options.dryRun });

    return {
      payload,
      batchUpdateRequest,
      gridResult
    };
  }
}
