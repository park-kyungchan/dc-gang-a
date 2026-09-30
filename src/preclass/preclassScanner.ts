/**
 * PreclassScanner
 * 14:00 Pre-class Briefing Scanner & Holiday-Aware Lookback Engine.
 * 
 * Strict Domain Invariants:
 * 1. Student-specific lookback follows the configured schedule, closures, and recorded absences.
 * 2. Post-Absence Override Integration:
 *    - Merges retroactive teacher assignments (e.g. Davinci p.42~p.49 added on 09/23 for 09/21).
 * 3. Scope Parsing & Context Inheritance:
 *    - Differentiates drilling homework (p.100~131) from prestudy video range (p.78~99).
 *    - Inherits book context across clauses ("+" or newline delimited).
 * 4. Concept Blank Test Invariant:
 *    - 금일 개념백지테스트 평가 범위 ≡ 직전 회차 수업일지 숙제(예습) 범위.
 * 5. Evidence Status:
 *    - GREEN: Source- and occurrence-verified upload before the briefing time.
 *    - YELLOW: Source- and occurrence-verified upload after briefing or verified quality issue.
 *    - UNKNOWN: Submission, source, occurrence, timestamp, or quality evidence is unresolved.
 *    - GRAY: No prestudy video is assigned.
 */

import {
  ClassGroupId,
  HolidayEntry,
  ParsedPrestudyTask,
  PreclassStudentBriefing,
  PrestudyTrafficLight,
  ResolvedBaselineDate,
  StudentId,
  parsePrestudyHomework,
  resolveBaselineHomeworkDate
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

// ============================================================================
// 1. Domain Constants & Schedule Config
// ============================================================================

export const STANDARD_CLASS_SCHEDULES: Record<ClassGroupId, { groupName: string; daysOfWeek: number[] }> = {
  '1': { groupName: '화목2부', daysOfWeek: [2, 4] },
  '2': { groupName: '월수1부', daysOfWeek: [1, 3] },
  '3': { groupName: '월금1부', daysOfWeek: [1, 5] },
  '4': { groupName: '수금2부', daysOfWeek: [3, 5] }
};

export const DEFAULT_ACADEMY_HOLIDAYS_2026: HolidayEntry[] = [
  { date: '2026-09-22', name: '추석 연휴 전일', isClassCancelled: true },
  { date: '2026-09-23', name: '추석 당일', isClassCancelled: true },
  { date: '2026-09-24', name: '추석 연휴 익일', isClassCancelled: true }
];

// ============================================================================
// 2. Types & Input Models
// ============================================================================

export interface VideoSubmissionRecord {
  uploadedAt: string | null; // Local ISO datetime on the target date
  studentId?: StudentId;
  occurrenceId?: string; // Opaque ID supplied by an authoritative occurrence join
  verificationSource?: ParsedPrestudyTask['verificationSource'];
  verifiedExactReadJoin?: boolean;
  fileSizeMb?: number;
  durationSeconds?: number;
  qualityApproved?: boolean;
  notes?: string;
}

export interface StudentScanInput {
  studentId: StudentId;
  name: string;
  classGroupId: ClassGroupId;
  enrolledDaysOfWeek?: number[];
  absenceHistory?: Record<string, string>; // date -> reason
  baselineHomeworkOverride?: string; // Teacher post-absence override text
  homeworkLogs?: Record<string, string>; // date -> raw homework string
  prestudyOccurrenceIds?: Array<string | null>; // Opaque IDs aligned with parsed prestudy task order
  videoSubmissions?: Record<string, VideoSubmissionRecord>; // Opaque occurrence ID -> submission
  specialAlerts?: string[];
}

export interface PreclassCohortBriefingReport {
  briefingDate: string;
  briefingTime: string; // e.g. "14:00"
  totalStudents: number;
  trafficLightSummary: {
    green: number;
    yellow: number;
    gray: number;
    unknown: number;
  };
  studentBriefings: Record<StudentId, PreclassStudentBriefing>;
}

// ============================================================================
// 3. Traffic Light Generator
// ============================================================================

export interface TrafficLightEvaluationParams {
  requiresVideoUpload: boolean;
  submission?: VideoSubmissionRecord | null;
  expectedStudentId?: StudentId | null;
  expectedOccurrenceId?: string | null;
  targetDateStr: string;
  briefingTimeStr?: string; // Default: "14:00"
}

/**
 * Evaluates only source- and occurrence-verified submission evidence.
 * Absence of a matching record is unresolved evidence, not proof of non-submission.
 */
export function evaluatePrestudyTrafficLight(params: TrafficLightEvaluationParams): PrestudyTrafficLight {
  if (!params.requiresVideoUpload) {
    return 'GRAY';
  }

  const submission = params.submission;
  if (
    !params.expectedStudentId ||
    !params.expectedOccurrenceId ||
    !isValidISODate(params.targetDateStr) ||
    !submission ||
    submission.studentId !== params.expectedStudentId ||
    submission.occurrenceId !== params.expectedOccurrenceId ||
    !hasVerifiedExactReadJoin(submission, params.expectedStudentId) ||
    !submission.uploadedAt
  ) {
    return 'UNKNOWN';
  }

  if (submission.qualityApproved === undefined) {
    return 'UNKNOWN';
  }

  const briefingTimeStr = params.briefingTimeStr || '14:00';
  const uploadMinutes = parseComparableUploadTime(submission.uploadedAt, params.targetDateStr);
  const briefingMinutes = parseClockTime(briefingTimeStr);
  if (uploadMinutes === undefined || briefingMinutes === undefined) {
    return 'UNKNOWN';
  }

  if (submission.qualityApproved === false || uploadMinutes > briefingMinutes) {
    return 'YELLOW';
  }

  return 'GREEN';
}

/**
 * Finds a submission only when its caller-supplied opaque occurrence ID and exact-read join are verified.
 */
export function findVideoSubmission(
  expectedStudentId: StudentId | null | undefined,
  expectedOccurrenceId: string | null | undefined,
  submissions?: Record<string, VideoSubmissionRecord>
): VideoSubmissionRecord | undefined {
  if (!expectedStudentId || !expectedOccurrenceId || !submissions) return undefined;
  const submission = submissions[expectedOccurrenceId];
  if (
    !submission ||
    submission.studentId !== expectedStudentId ||
    submission.occurrenceId !== expectedOccurrenceId ||
    !hasVerifiedExactReadJoin(submission, expectedStudentId)
  ) return undefined;
  return submission;
}

function hasVerifiedExactReadJoin(submission: VideoSubmissionRecord, expectedStudentId: StudentId): boolean {
  return submission.studentId === expectedStudentId &&
    submission.verificationSource === 'app_backend_submission' &&
    submission.verifiedExactReadJoin === true;
}

function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function requireISODate(value: string, parameterName: string): string {
  if (!isValidISODate(value)) {
    throw new RangeError(`${parameterName} must be an explicit valid YYYY-MM-DD date.`);
  }
  return value;
}

function parseClockTime(value: string): number | undefined {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;
  return hours * 60 + minutes;
}

function parseComparableUploadTime(value: string, targetDate: string): number | undefined {
  // A time without a date or a zoned instant cannot be compared to the local briefing clock safely.
  const localTimestamp = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (!localTimestamp || !isValidISODate(targetDate) || localTimestamp[1] !== targetDate) return undefined;
  return parseClockTime(localTimestamp[2]);
}

// ============================================================================
// 4. Preclass Scanner Engine
// ============================================================================

export class PreclassScanner {
  private holidays: HolidayEntry[];

  constructor(customHolidays?: HolidayEntry[]) {
    this.holidays = customHolidays || [...DEFAULT_ACADEMY_HOLIDAYS_2026];
  }

  /**
   * Resolves baseline homework date for a student, dynamically walking back
   * past cancelled holidays and student-specific absences.
   */
  public resolveStudentBaseline(
    studentId: StudentId,
    classGroupId: ClassGroupId,
    targetDateStr: string,
    absenceHistory: Record<string, string> = {},
    customEnrolledDays?: number[]
  ): ResolvedBaselineDate {
    requireISODate(targetDateStr, 'targetDateStr');
    const enrolledDays = customEnrolledDays || STANDARD_CLASS_SCHEDULES[classGroupId]?.daysOfWeek;
    if (!enrolledDays || enrolledDays.length === 0) {
      throw new Error(`Invalid or unregistered class group ID: ${classGroupId}`);
    }

    return resolveBaselineHomeworkDate(
      studentId,
      targetDateStr,
      enrolledDays,
      this.holidays,
      absenceHistory
    );
  }

  /**
   * Enhanced parser that splits multi-clause homework, separates general drilling
   * from prestudy videos, and preserves book context.
   */
  public parseBaselineHomework(rawHomeworkText: string): {
    prestudyTasks: ParsedPrestudyTask[];
    allClauses: string[];
    drillingScopes: string[];
  } {
    const prestudyTasks = parsePrestudyHomework(rawHomeworkText);
    const clauses = rawHomeworkText.split(/[\n,;+]/).map(c => c.trim()).filter(Boolean);

    const prestudyRegex = /(?:개념\s*예습영상|예습영상|동영상|영상\s*촬영|개념설명|백지테스트|개념백지)/i;
    const drillingScopes = clauses.filter(c => !prestudyRegex.test(c));

    return {
      prestudyTasks,
      allClauses: clauses,
      drillingScopes
    };
  }

  /**
   * Domain Invariant:
   * 금일 개념백지테스트 평가 범위 ≡ 직전 회차 수업일지 숙제(예습) 범위
   */
  public injectConceptTestScope(
    baselineHomework: string,
    fallbackScope: string = '기본 개념 백지 테스트'
  ): { scope: string; bookTitle: string } {
    const { prestudyTasks } = this.parseBaselineHomework(baselineHomework);

    if (prestudyTasks.length > 0) {
      const primaryPrestudy = prestudyTasks[0];
      return {
        scope: primaryPrestudy.assignedScope,
        bookTitle: primaryPrestudy.bookTitle
      };
    }

    return {
      scope: fallbackScope,
      bookTitle: '미지정'
    };
  }

  /** Scans a single student's assigned prestudy evidence at the briefing time. */
  public scanStudent(input: StudentScanInput, targetDateStr: string, briefingTimeStr: string = '14:00'): PreclassStudentBriefing {
    const targetDate = requireISODate(targetDateStr, 'targetDateStr');
    const absenceHistory = input.absenceHistory || {};

    // 1. Holiday-aware lookback resolution
    const baseline = this.resolveStudentBaseline(
      input.studentId,
      input.classGroupId,
      targetDate,
      absenceHistory,
      input.enrolledDaysOfWeek
    );

    // 2. Fetch baseline homework text, applying teacher post-absence overrides if present
    let rawHomework = input.baselineHomeworkOverride || '';
    if (!rawHomework && input.homeworkLogs) {
      rawHomework = input.homeworkLogs[baseline.baselineDate] || '';
    }

    // 3. Parse prestudy tasks
    const { prestudyTasks } = this.parseBaselineHomework(rawHomework);

    // 4. Evaluate traffic-light status for each prestudy task
    const evaluatedTasks: ParsedPrestudyTask[] = [];

    for (const [taskIndex, task] of prestudyTasks.entries()) {
      const occurrenceId = input.prestudyOccurrenceIds?.[taskIndex];
      const submission = findVideoSubmission(input.studentId, occurrenceId, input.videoSubmissions);
      const status = evaluatePrestudyTrafficLight({
        requiresVideoUpload: task.requiresVideoUpload,
        submission,
        expectedStudentId: input.studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: targetDate,
        briefingTimeStr
      });

      evaluatedTasks.push({
        ...task,
        status,
        verificationSource: submission?.verificationSource ?? 'unverified'
      });
    }

    // Keep any unresolved occurrence visible in the aggregate instead of implying readiness.
    const statuses = evaluatedTasks.map(task => task.status);
    const aggregatedLight: PrestudyTrafficLight = statuses.length === 0
      ? 'GRAY'
      : statuses.includes('UNKNOWN')
        ? 'UNKNOWN'
        : statuses.includes('YELLOW')
          ? 'YELLOW'
          : 'GREEN';

    // 5. Invariant: Concept Blank Test scope injection from baseline prestudy
    const conceptTest = this.injectConceptTestScope(rawHomework);

    // 6. Build contextual classroom alerts
    const alerts: string[] = [];
    if (baseline.absenceIntervened) {
      alerts.push(`[학습공백 보완] 결석 기록을 반영해 ${baseline.baselineDate} 수업 기준으로 과제를 추적합니다.`);
    }

    if (aggregatedLight === 'UNKNOWN') {
      alerts.push('[예습영상 상태 미확인] 출처·발생 회차·제출 시각·품질 정보 중 확인되지 않은 항목이 있습니다.');
    } else if (aggregatedLight === 'YELLOW') {
      alerts.push('[예습영상 확인 필요] 확인된 제출 시각 또는 품질 정보에서 교사 검토가 필요합니다.');
    }

    if (input.specialAlerts) {
      alerts.push(...input.specialAlerts);
    }

    return {
      studentId: input.studentId,
      name: input.name,
      classGroupId: input.classGroupId,
      baselineDate: baseline.baselineDate,
      prestudyTrafficLight: aggregatedLight,
      prestudyTasks: evaluatedTasks,
      injectedConceptTestScope: conceptTest.scope,
      alerts
    };
  }

  /**
   * Scans an entire cohort without inferring ZT eligibility or assessment schedules.
   */
  public scanCohort(
    cohort: StudentScanInput[],
    targetDateStr: string,
    briefingTime: string = '14:00'
  ): PreclassCohortBriefingReport {
    const targetDate = requireISODate(targetDateStr, 'targetDateStr');
    const studentBriefings: Record<StudentId, PreclassStudentBriefing> = {} as any;
    let greenCount = 0;
    let yellowCount = 0;
    let grayCount = 0;
    let unknownCount = 0;

    for (const student of cohort) {
      const briefing = this.scanStudent(student, targetDate, briefingTime);
      studentBriefings[student.studentId] = briefing;

      switch (briefing.prestudyTrafficLight) {
        case 'GREEN':
          greenCount++;
          break;
        case 'YELLOW':
          yellowCount++;
          break;
        case 'GRAY':
          grayCount++;
          break;
        case 'UNKNOWN':
          unknownCount++;
          break;
      }
    }

    return {
      briefingDate: targetDate,
      briefingTime,
      totalStudents: cohort.length,
      trafficLightSummary: {
        green: greenCount,
        yellow: yellowCount,
        gray: grayCount,
        unknown: unknownCount
      },
      studentBriefings
    };
  }
}
