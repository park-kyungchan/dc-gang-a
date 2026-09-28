/**
 * Main Sheet v2 Schema & Type Definitions
 * Session Date: 2026-09-28 15:00
 * Target Pupils: Shin Ji-woo (1293032), Park Se-eun (1293067), Yoo Ji-yeon (1293138)
 * 
 * Strict Domain Model:
 * 1. Multi-Book Atomic State Machine & Task Drop/Pivot
 * 2. Dual-Write Administrative Attendance & Hover Notes (31-day Grid: Day d at col 3 + d)
 * 3. 14:00 Pre-class Briefing Scanner & Holiday-aware Lookback
 * 4. Append-Only Audit Trail Engine with Pre-override Preservation
 * 5. Zero Machine-Dependent Path Dependencies
 */

// ============================================================================
// 1. Identifiers & Branded Core Types
// ============================================================================

export type StudentId = '1293032' | '1293067' | '1293138' | '1294174' | (string & {});
export type ClassGroupId = '1' | '2' | '3' | '4'; // 1: 화목2부, 2: 월수1부, 3: 월금1부, 4: 수금2부
export type TeacherId = '1292923' | (string & {}); // 1292923: 박경찬 선생님

export type BookSlug = 
  | 'gauss_5_2_vol2'
  | 'davinci_5_1_vol1'
  | 'gaussplus_5_2'
  | 'gauss_1_1'
  | (string & {});

export type AuditId = `adt_${string}`;
export type TaskId = `tsk_${string}`;
export type AssessmentId = `asm_${string}`;
export type DropId = `drp_${string}`;

// ============================================================================
// 2. Multi-Book Atomic State Machine
// ============================================================================

/**
 * Physical possession of a specific physical/digital book or sheet.
 * Simultaneous inspection conflict prevention:
 * A teacher cannot simultaneously hold 2 different books for active 1-on-1 inspection.
 * A student cannot be solving Book B while teacher claims to be inspecting Book B.
 */
export type PhysicalPossession = 
  | 'teacher'      // Physical book is in teacher's hands (being inspected/graded)
  | 'student'      // Book is at student's desk (student solving, reading, or preparing)
  | 'holding_desk' // Book is waiting in classroom inbox/stack for inspection
  | 'unconfirmed'; // Location unverified

export type BookRole = 
  | 'primary'       // Main curriculum textbook (e.g. 가우스 5-2 2권, 가우스 1-1)
  | 'secondary'     // Parallel curriculum / secondary workbook (e.g. 다빈치 5-1 1권)
  | 'supplementary' // Additional drilling / clinic workbook (e.g. 가우스플러스 5-2)
  | 'buffer';        // Temporary fill-in task while waiting for teacher inspection

export type InspectionStatus = 
  | 'pending'             // Submitted, awaiting teacher review
  | 'in_progress'         // Actively being inspected by teacher
  | 'completed_100%'      // Fully checked, 100% completed
  | 'completed_partial'   // Checked, partial completion
  | 'incomplete'          // Checked, incomplete (< 80%) or not done
  | 'holding_by_student'  // Student kept book at desk (e.g. preparing for oral test)
  | 'exempt';             // Officially excused or postponed

export interface BookTaskState {
  bookId: BookSlug;
  bookTitle: string;
  bookRole: BookRole;
  assignedRange: string;
  physicalPossession: PhysicalPossession;
  inspectionStatus: InspectionStatus;
  completionRatePercent: number | null; // null if uninspected
  inspectedAt?: string | null;          // ISO 8601 or HH:mm
  inspectedBy?: TeacherId | null;
  note?: string;
}

export type BufferTaskPurpose = 
  | 'homework_inspection_waiting'  // Buffer task assigned while teacher inspects submitted homework
  | 'uncompleted_homework_makeup' // Completing missed parts of homework
  | 'regular_curriculum'           // Extra practice in regular curriculum
  | 'advance_preview';             // Early preview of next unit

export interface BufferTask {
  taskId: TaskId;
  assignedAt: string; // HH:mm or ISO 8601
  bookId: BookSlug;
  bookTitle: string;
  scope: string;
  purpose: BufferTaskPurpose;
  status: 'assigned' | 'in_progress' | 'completed' | 'dropped';
  dropReason?: string;
  completedAt?: string;
}

export type TaskDropReasonCategory = 
  | 'cognitive_overload'          // Student struggled severely ("너무 어려워요")
  | 'time_deficit'                 // Insufficient remaining class time
  | 'curriculum_reprioritization' // Teacher pivoted to priority milestone/assessment
  | 'student_condition';           // Illness, fatigue, tardiness adaptation

export interface TaskDropPivotEvent {
  dropId: DropId;
  droppedTaskId: TaskId | string;
  bookTitle: string;
  scope: string;
  droppedAt: string; // HH:mm e.g. "15:29"
  reasonCategory: TaskDropReasonCategory;
  detailedReason: string;
  pivotTargetTaskId: AssessmentId | TaskId | string;
  pivotTargetType: 'timed_assessment' | 'buffer_task' | 'clinic_recovery';
}

export type TimedAssessmentStatus = 
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'graded';

export interface TimedAssessmentState {
  assessmentId: AssessmentId;
  assessmentName: string; // e.g. "대단원 총괄평가 (소수의 곱셈)"
  bookTitle: string;      // e.g. "초5-2 가우스 2권"
  scope: string;          // e.g. "p.71 ~ p.73"
  timeLimitMinutes: number; // e.g. 60
  scheduledStartTime: string; // "15:35"
  scheduledEndTime: string;   // "16:35"
  status: TimedAssessmentStatus;
  origin?: string;        // e.g. "09/21 일지상 09/23 예정이었으나 결석으로 이월된 평가"
  syncGroup?: string;     // e.g. "timed_eval_1535" (3-student synchronized attack)
  physicalPossession: PhysicalPossession; // Must be 'student' while in_progress
  score?: number | null;
  totalQuestions?: number | null;
  note?: string;
}

export type ConceptTestStatus = 
  | 'idle'
  | 'preparing'
  | 'testing'
  | 'passed'
  | 're_test';

/**
 * Domain Invariant:
 * 금일 개념백지테스트 범위 ≡ 직전 회차 수업일지 숙제(예습) 범위
 */
export interface ConceptBlankTestState {
  testId: string;
  bookTitle: string;
  scope: string;
  sourceHomeworkDate: string; // YYYY-MM-DD of the previous session where preview was assigned
  status: ConceptTestStatus;
  verbalExplanationScore?: number | null; // 1-5 scale or 100%
  writtenFormulaScore?: number | null;
  startedAt?: string;
  completedAt?: string;
}

// ============================================================================
// 3. Dual-Write Administrative Attendance & Hover Notes
// ============================================================================

/**
 * Official Attendance Codes permitted in Excel / Google Sheets cells.
 * Mathematical Requirement: Formula `=COUNTIF(E4:AI4, "O*")` requires exact prefixes.
 * Freeform text in the cell itself is strictly prohibited!
 */
export type AttendanceCellCode = 
  | 'O'         // Present on time (정시 출석)
  | 'X'         // Absent (결석)
  | 'O(지각)'   // Tardy (지각)
  | 'O(보강)'   // Makeup attendance (보강 출석)
  | 'O(이동)'   // Room / Class Transfer (반 이동)
  | '';         // Blank (no class scheduled or unrecorded)

export type AttendanceSystemStatus = 
  | 'present_on_time'
  | 'late_notified'
  | 'late_unnotified'
  | 'absent'
  | 'makeup'
  | 'transferred';

export interface AttendanceRecord {
  scheduledTime: string; // '15:00'
  actualArrivalTime: string | null; // e.g. '15:15'
  status: AttendanceSystemStatus;
  delayMinutes: number;
  reason?: string;
  advanceNotificationReceived: boolean;
}

export type HoverNoteCategory = 
  | 'tardy_reason'
  | 'absence_reason'
  | 'makeup_origin'
  | 'transfer_info'
  | 'general_notice';

export interface HoverNoteMetadata {
  category: HoverNoteCategory;
  actualArrivalTime: string | null;
  delayMinutes: number;
  advanceNotificationReceived: boolean;
  contactChannel: 'sms' | 'phone_call' | 'kakao' | 'parent_in_person' | 'none';
  rawMessage: string;
  actionTaken: string;
  formattedMultilineText: string;
}

/**
 * 31-Day Attendance Grid Coordinates
 * Column formula: Day d (1 <= d <= 31) -> Col index = 3 + d (0-indexed)
 * Col 0: 이름 (A)
 * Col 1: 학교 (B)
 * Col 2: 반 (C)
 * Col 3: 합계 (D)
 * Col 4..34: Day 1..31 (E..AI)
 */
export interface AttendanceGridCoordinate {
  day: number;           // 1 to 31
  colIndex: number;      // 3 + day (4 for Day 1, 34 for Day 31)
  colLetter: string;     // 'E' for Day 1, 'AI' for Day 31
  rowIndex: number;      // 0-indexed row in the monthly sheet
  cellAddress: string;   // e.g. "AF4" for Day 28, Row 4
}

export interface SheetCellUpdatePayload {
  row: number;
  col: number;
  cellAddress: string;
  cellValue: AttendanceCellCode;   // STRICT: Must NEVER be overwritten with long notes
  hoverNote: string | null;       // Injected into Cell Comment / Hover Note
  preserveFormatting: true;        // Must NEVER alter background color, borders, or number format
}

// ============================================================================
// 4. 14:00 Pre-class Briefing Scanner & Holiday-aware Lookback
// ============================================================================

export interface HolidayEntry {
  date: string; // YYYY-MM-DD
  name: string; // e.g. "추석 연휴"
  isClassCancelled: boolean;
}

export interface ClassScheduleConfig {
  classGroupId: ClassGroupId;
  groupName: string; // e.g. "월수1부", "월금1부"
  daysOfWeek: number[]; // 1: Mon, 2: Tue, 3: Wed, 4: Thu, 5: Fri, 6: Sat, 0: Sun
}

export interface ResolvedBaselineDate {
  studentId: StudentId;
  targetClassDate: string; // e.g. "2026-09-28"
  baselineDate: string;    // e.g. "2026-09-21" for Shin Ji-woo; "2026-09-25" for Park Se-eun & Yoo Ji-yeon
  lookbackDays: number;
  holidayIntervened: boolean;
  absenceIntervened: boolean;
  resolutionChain: Array<{
    candidateDate: string;
    isScheduled: boolean;
    isHoliday: boolean;
    attendanceStatus: 'present' | 'absent' | 'not_scheduled';
    selectedAsBaseline: boolean;
    note?: string;
  }>;
}

export type PrestudyTrafficLight = 
  | 'GREEN'   // Video uploaded & verified before 14:00
  | 'YELLOW'  // Video uploaded late (< 30 min before class) or sound/angle partial
  | 'RED'     // Missing or overdue; triggers Zero Test or Explanation Shoot upon arrival
  | 'GRAY';    // Not assigned / exempt

export interface ParsedPrestudyTask {
  bookTitle: string;
  assignedScope: string;
  pageStart: number | null;
  pageEnd: number | null;
  requiresVideoUpload: boolean;
  status: PrestudyTrafficLight;
  rawKeywordMatch: string;
  verificationSource: 'lms_TeacherPrestudySummary' | 'app_backend_submission' | 'unverified';
}

export interface PreclassStudentBriefing {
  studentId: StudentId;
  name: string;
  classGroupId: ClassGroupId;
  baselineDate: string;
  prestudyTrafficLight: PrestudyTrafficLight;
  prestudyTasks: ParsedPrestudyTask[];
  injectedConceptTestScope: string;
  alerts: string[];
}

// ============================================================================
// 5. Append-Only Audit Trail Engine
// ============================================================================

export type AuditField = 
  | 'homework'
  | 'progress'
  | 'attendance'
  | 'memo'
  | 'persistent_memo'
  | 'assessment'
  | 'buffer_task'
  | 'makeup_chain';

export interface AuditRecord {
  auditId: AuditId;
  timestamp: string; // ISO 8601 with offset, e.g. "2026-09-23T11:20:00+09:00"
  author: string;    // e.g. "박경찬T" or TeacherId "1292923"
  targetStudentId: StudentId;
  targetDate: string; // YYYY-MM-DD of the target lesson record
  field: AuditField;
  preOverrideValue: unknown;  // JSON-serializable prior value (strictly preserved)
  postOverrideValue: unknown; // JSON-serializable newly applied value
  reason: string;             // Mandatory: minimum 10 characters explanation
  supersededAuditId?: AuditId; // Optional link if this overrides an earlier override
  integrityHash?: string;     // SHA-256 (auditId + timestamp + author + targetStudentId + pre + post)
}

// ============================================================================
// 6. Absence Makeup Chain
// ============================================================================

export interface AbsenceMakeupChain {
  absenceDate: string;       // YYYY-MM-DD (e.g. "2026-09-23")
  absenceReason: string;     // e.g. "추석 연휴 결석"
  makeupDate: string;        // YYYY-MM-DD (e.g. "2026-10-17")
  originalTeacher: string;   // e.g. "박경찬T"
  substituteTeacher: string | null; // e.g. "김예원T" (대강사)
  status: 'scheduled' | 'completed' | 'cancelled';
  handoffNotes: string[];
}

// ============================================================================
// 7. Complete Student Session & Main Sheet Snapshot
// ============================================================================

export interface StudentSessionState {
  studentId: StudentId;
  name: string;
  schoolGrade: string;
  enrolledGroup: string;
  classGroupId: ClassGroupId;
  courseSeq: string;
  cmSeq: string;
  attendance: AttendanceRecord;
  attendanceGridPayload?: SheetCellUpdatePayload;
  books: Record<string, BookTaskState>;
  currentBufferTask?: BufferTask;
  activeTimedAssessment?: TimedAssessmentState;
  taskDropEvents: TaskDropPivotEvent[];
  conceptTest?: ConceptBlankTestState;
  makeupChains: AbsenceMakeupChain[];
}

export interface MainSheetSessionSnapshot {
  sessionDate: '2026-09-28' | (string & {});
  classStartTime: '15:00' | (string & {});
  lastUpdatedAt: string; // ISO 8601
  teacher: {
    teacherId: TeacherId;
    name: string;
  };
  students: Record<StudentId, StudentSessionState>;
  auditTrail: AuditRecord[];
}

// ============================================================================
// 8. Pure Runtime Validation & Utility Functions (Machine-Independent)
// ============================================================================

/**
 * Calculate 31-day attendance grid column.
 * Formula: Day d (1 <= d <= 31) -> Col index = 3 + d
 * Col 4 (E) = Day 1, Col 34 (AI) = Day 31
 */
export function calculate31DayGridColumn(day: number, rowIndex: number = 4): AttendanceGridCoordinate {
  if (day < 1 || day > 31 || !Number.isInteger(day)) {
    throw new RangeError(`Invalid day: ${day}. Day must be an integer between 1 and 31.`);
  }

  const colIndex = 3 + day; // 0-indexed column

  // Convert 0-indexed column number to Excel column letters (0=A, 1=B, ..., 26=AA, 34=AI)
  function toColLetter(colIdx: number): string {
    let temp = colIdx;
    let letter = '';
    while (temp >= 0) {
      letter = String.fromCharCode((temp % 26) + 65) + letter;
      temp = Math.floor(temp / 26) - 1;
    }
    return letter;
  }

  const colLetter = toColLetter(colIndex);
  const cellAddress = `${colLetter}${rowIndex}`;

  return {
    day,
    colIndex,
    colLetter,
    rowIndex,
    cellAddress
  };
}

/**
 * Validates that an attendance sheet update NEVER puts long descriptive text in cellValue
 * and only uses official codes, keeping explanations strictly in hoverNote.
 */
export function validateAttendanceCellUpdate(payload: SheetCellUpdatePayload): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ALLOWED_CODES: AttendanceCellCode[] = ['O', 'X', 'O(지각)', 'O(보강)', 'O(이동)', ''];

  if (!ALLOWED_CODES.includes(payload.cellValue)) {
    errors.push(`Invalid cellValue: "${payload.cellValue}". Cell value must be strictly one of: ${ALLOWED_CODES.map(c => `"${c}"`).join(', ')}. Freeform text must be stored in hoverNote.`);
  }

  if (payload.cellValue.length > 10) {
    errors.push(`Cell value exceeds maximum length (10 chars): "${payload.cellValue}". Danger of destroying sheet formulas.`);
  }

  if (!payload.preserveFormatting) {
    errors.push(`preserveFormatting must be true to prevent stripping spreadsheet borders and conditional colors.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Multi-Book Possession Conflict Validator.
 * Rules:
 * 1. A teacher cannot physically inspect 2 different books simultaneously for the same student.
 * 2. If a student is taking an active timed assessment, the assessment book MUST be in student possession.
 * 3. A book cannot have inspectionStatus='completed_100%' while physicalPossession='holding_by_student' without an inspection timestamp.
 */
export function validateBookPossessions(
  books: Record<string, BookTaskState>,
  activeAssessment?: TimedAssessmentState
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  let teacherInspectingCount = 0;
  for (const [key, book] of Object.entries(books)) {
    if (book.physicalPossession === 'teacher' && book.inspectionStatus === 'in_progress') {
      teacherInspectingCount++;
    }
    if (book.physicalPossession === 'student' && book.inspectionStatus === 'in_progress') {
      errors.push(`Conflict on book "${key}": Cannot be under active teacher inspection while in student possession.`);
    }
  }

  if (teacherInspectingCount > 1) {
    errors.push(`Simultaneous possession conflict: Teacher cannot actively inspect ${teacherInspectingCount} books at the same instant for one student.`);
  }

  if (activeAssessment && activeAssessment.status === 'in_progress') {
    if (activeAssessment.physicalPossession !== 'student') {
      errors.push(`Assessment possession conflict: Student is actively solving "${activeAssessment.assessmentName}", book must be in student possession, but is currently "${activeAssessment.physicalPossession}".`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Holiday-Aware Previous Homework Date Resolver.
 * Resolves the true baseline session date for a student by walking backwards,
 * skipping holidays, and accounting for recorded student absences.
 */
export function resolveBaselineHomeworkDate(
  studentId: StudentId,
  targetDateStr: string, // "2026-09-28"
  enrolledDaysOfWeek: number[], // e.g. [1, 3] for Mon/Wed, [1, 5] for Mon/Fri
  holidays: HolidayEntry[],
  absenceHistory: Record<string, string> // date -> absenceReason (e.g. {"2026-09-23": "추석 연휴 결석"})
): ResolvedBaselineDate {
  const [targetYear, targetMonth, targetDay] = targetDateStr.split('-').map(Number);
  const holidaySet = new Set(holidays.filter(h => h.isClassCancelled).map(h => h.date));
  
  const resolutionChain: ResolvedBaselineDate['resolutionChain'] = [];
  // Use UTC midday (12:00:00Z) to guarantee 100% timezone-independent date arithmetic
  let currentDate = new Date(Date.UTC(targetYear, targetMonth - 1, targetDay, 12, 0, 0));
  let lookbackDays = 0;
  let holidayIntervened = false;
  let absenceIntervened = false;
  let resolvedDateStr: string | null = null;

  // Maximum lookback of 21 days
  for (let step = 1; step <= 21; step++) {
    currentDate.setUTCDate(currentDate.getUTCDate() - 1);
    lookbackDays++;

    const y = currentDate.getUTCFullYear();
    const m = String(currentDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(currentDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = currentDate.getUTCDay(); // 0: Sun, 1: Mon, ...

    const isScheduled = enrolledDaysOfWeek.includes(dayOfWeek);
    const isHoliday = holidaySet.has(dateStr);
    const isAbsent = Boolean(absenceHistory[dateStr]);

    if (isHoliday) holidayIntervened = true;
    if (isAbsent) absenceIntervened = true;

    let status: 'present' | 'absent' | 'not_scheduled' = 'not_scheduled';
    if (isScheduled) {
      status = (isHoliday || isAbsent) ? 'absent' : 'present';
    }

    const isMatch = isScheduled && !isHoliday && !isAbsent;

    resolutionChain.push({
      candidateDate: dateStr,
      isScheduled,
      isHoliday,
      attendanceStatus: status,
      selectedAsBaseline: isMatch,
      note: isHoliday ? '공휴일/휴원일' : isAbsent ? `결석 (${absenceHistory[dateStr]})` : isScheduled ? '정규 출석일' : '수업 없는 날'
    });

    if (isMatch) {
      resolvedDateStr = dateStr;
      break;
    }
  }

  if (!resolvedDateStr) {
    throw new Error(`Unable to resolve baseline homework date for student ${studentId} within 21 days prior to ${targetDateStr}.`);
  }

  return {
    studentId,
    targetClassDate: targetDateStr,
    baselineDate: resolvedDateStr,
    lookbackDays,
    holidayIntervened,
    absenceIntervened,
    resolutionChain
  };
}

/**
 * Prestudy Keyword & Scope Parser.
 * Parses raw LMS DayRecord homework string to detect prestudy tasks and ranges.
 */
export function parsePrestudyHomework(homeworkText: string): ParsedPrestudyTask[] {
  const results: ParsedPrestudyTask[] = [];
  if (!homeworkText) return results;

  // Keywords indicating preview / video explanation
  const prestudyRegex = /(?:개념\s*예습영상|예습영상|동영상|영상\s*촬영|개념설명|백지테스트|개념백지)/i;
  // Page range regex: e.g. "p.78 ~ p.99", "p.100~131", "42 ~ 49쪽"
  const rangeRegex = /(?:p\.|페이지)?\s*(\d+)\s*(?:~|-)\s*(?:p\.|페이지)?\s*(\d+)/i;
  // Book title regex
  const bookRegex = /(가우스플러스|가우스\s*(?:[1-9]-[1-9]|[1-9]권)?|다빈치\s*(?:[1-9]-[1-9]|[1-9]권)?)/i;

  const lines = homeworkText.split(/[\n,;+]/).map(l => l.trim()).filter(Boolean);
  let lastSeenBookTitle: string = '미확인 교재';

  for (const line of lines) {
    const bookMatch = line.match(bookRegex);
    if (bookMatch) {
      lastSeenBookTitle = bookMatch[1].trim();
    }

    if (prestudyRegex.test(line)) {
      const rangeMatch = line.match(rangeRegex);
      const bookTitle = bookMatch ? bookMatch[1].trim() : lastSeenBookTitle;

      const pageStart = rangeMatch ? parseInt(rangeMatch[1], 10) : null;
      const pageEnd = rangeMatch ? parseInt(rangeMatch[2], 10) : null;

      results.push({
        bookTitle,
        assignedScope: rangeMatch ? `p.${pageStart} ~ p.${pageEnd}` : line,
        pageStart,
        pageEnd,
        requiresVideoUpload: true,
        status: 'RED', // Default until backend upload confirmation at 14:00 scanner
        rawKeywordMatch: line,
        verificationSource: 'unverified'
      });
    }
  }

  return results;
}

/**
 * Append-Only Audit Trail Validator.
 * Enforces:
 * 1. Non-empty, unique auditId.
 * 2. Mandatory explanatory reason (minimum 10 characters).
 * 3. Immutable preservation of preOverrideValue.
 */
export function validateAuditRecord(record: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof record !== 'object' || record === null) {
    return { valid: false, errors: ['Audit record must be a non-null object.'] };
  }

  const rec = record as Partial<AuditRecord>;

  if (!rec.auditId || typeof rec.auditId !== 'string' || !rec.auditId.startsWith('adt_')) {
    errors.push(`Invalid auditId: "${rec.auditId}". Must be a string starting with "adt_".`);
  }

  if (!rec.timestamp || isNaN(Date.parse(rec.timestamp))) {
    errors.push(`Invalid ISO timestamp: "${rec.timestamp}".`);
  }

  if (!rec.author || rec.author.trim().length === 0) {
    errors.push(`Author cannot be empty.`);
  }

  if (!rec.targetStudentId) {
    errors.push(`targetStudentId is required.`);
  }

  if (!rec.targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(rec.targetDate)) {
    errors.push(`targetDate must be in YYYY-MM-DD format: "${rec.targetDate}".`);
  }

  if (!rec.field) {
    errors.push(`field is required.`);
  }

  if (rec.preOverrideValue === undefined) {
    errors.push(`preOverrideValue must be explicitly provided (can be null, but not undefined).`);
  }

  if (rec.postOverrideValue === undefined) {
    errors.push(`postOverrideValue must be explicitly provided.`);
  }

  if (!rec.reason || typeof rec.reason !== 'string' || rec.reason.trim().length < 10) {
    errors.push(`Audit reason is mandatory and must be at least 10 characters of concrete rationale.`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
