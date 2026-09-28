/**
 * PreclassScanner
 * 14:00 Pre-class Briefing Scanner & Holiday-Aware Lookback Engine.
 * 
 * Strict Domain Invariants:
 * 1. Heterogeneous Student Lookback:
 *    - Group 2 (월수1부): Shin Ji-woo skips 2026-09-23 Chuseok absence -> resolves to 2026-09-21.
 *    - Group 3 (월금1부): Park Se-eun & Yoo Ji-yeon -> resolves to 2026-09-25.
 * 2. Post-Absence Override Integration:
 *    - Merges retroactive teacher assignments (e.g. Davinci p.42~p.49 added on 09/23 for 09/21).
 * 3. Scope Parsing & Context Inheritance:
 *    - Differentiates drilling homework (p.100~131) from prestudy video range (p.78~99).
 *    - Inherits book context across clauses ("+" or newline delimited).
 * 4. Concept Blank Test Invariant:
 *    - 금일 개념백지테스트 평가 범위 ≡ 직전 회차 수업일지 숙제(예습) 범위.
 * 5. Traffic-Light Engine:
 *    - 🟢 GREEN: Uploaded and verified before 14:00.
 *    - 🟡 YELLOW: Submitted late (< 30 min before class) or partial quality.
 *    - 🔴 RED: Missing / overdue -> Queues Zero Test (ZT) or explanation shoot on arrival.
 *    - ⚪ GRAY: No prestudy assigned for unit.
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
  '2': { groupName: '월수1부', daysOfWeek: [1, 3] }, // Shin Ji-woo
  '3': { groupName: '월금1부', daysOfWeek: [1, 5] }, // Park Se-eun, Yoo Ji-yeon
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
  uploadedAt: string | null; // ISO 8601 or HH:mm e.g. "13:42" or "14:45"
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
  targetDate?: string; // defaults to '2026-09-28'
  absenceHistory?: Record<string, string>; // date -> reason
  baselineHomeworkOverride?: string; // Teacher post-absence override text
  homeworkLogs?: Record<string, string>; // date -> raw homework string
  videoSubmissions?: Record<string, VideoSubmissionRecord>; // book/task -> submission
  specialAlerts?: string[];
}

export interface PreclassCohortBriefingReport {
  briefingDate: string;
  briefingTime: string; // e.g. "14:00"
  targetSessionStartTime: string; // e.g. "15:00"
  totalStudents: number;
  trafficLightSummary: {
    green: number;
    yellow: number;
    red: number;
    gray: number;
  };
  zeroTestQueue: Array<{
    studentId: StudentId;
    name: string;
    bookTitle: string;
    missingScope: string;
    actionRequired: string;
  }>;
  synchronizedEvaluations: Array<{
    syncGroupName: string;
    scheduledStartTime: string;
    timeLimitMinutes: number;
    participants: StudentId[];
  }>;
  studentBriefings: Record<StudentId, PreclassStudentBriefing>;
}

// ============================================================================
// 3. Traffic Light Generator
// ============================================================================

export interface TrafficLightEvaluationParams {
  requiresVideoUpload: boolean;
  submission?: VideoSubmissionRecord | null;
  targetDateStr: string;
  briefingTimeStr?: string; // Default: "14:00"
  classStartTimeStr?: string; // Default: "15:00"
}

/**
 * Evaluates traffic light status based on LMS video submission timestamps.
 */
export function evaluatePrestudyTrafficLight(params: TrafficLightEvaluationParams): PrestudyTrafficLight {
  if (!params.requiresVideoUpload) {
    return 'GRAY';
  }

  if (!params.submission || !params.submission.uploadedAt) {
    return 'RED'; // Missing video -> Triggers Zero Test or in-class shoot
  }

  if (params.submission.qualityApproved === false) {
    return 'YELLOW'; // Partial audio or cut off
  }

  const briefingTimeStr = params.briefingTimeStr || '14:00';
  const classStartTimeStr = params.classStartTimeStr || '15:00';

  // Parse time into minutes of day
  const toMinutes = (timeStr: string): number => {
    if (timeStr.includes('T')) {
      const d = new Date(timeStr);
      return d.getHours() * 60 + d.getMinutes();
    }
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const uploadMinutes = toMinutes(params.submission.uploadedAt);
  const briefingMinutes = toMinutes(briefingTimeStr);
  const classStartMinutes = toMinutes(classStartTimeStr);

  // If uploaded before briefing (14:00) -> GREEN
  if (uploadMinutes <= briefingMinutes) {
    return 'GREEN';
  }

  // If uploaded after briefing but >= 30 min before class -> GREEN or YELLOW depending on cutoff
  // If uploaded < 30 min before class start (e.g. >= 14:30 for 15:00 class) -> YELLOW
  if (uploadMinutes > classStartMinutes - 30) {
    return 'YELLOW';
  }

  // Uploaded between 14:00 and 14:30
  return 'YELLOW';
}

/**
 * Finds a matching video submission record by exact match, normalized substring,
 * single-entry fallback, or default key.
 */
export function findVideoSubmission(
  bookTitle: string,
  submissions?: Record<string, VideoSubmissionRecord>
): VideoSubmissionRecord | undefined {
  if (!submissions) return undefined;
  if (submissions[bookTitle]) return submissions[bookTitle];
  if (submissions['default']) return submissions['default'];

  const normTitle = bookTitle.replace(/\s+/g, '').toLowerCase();
  for (const [key, sub] of Object.entries(submissions)) {
    const normKey = key.replace(/\s+/g, '').toLowerCase();
    if (normKey.includes(normTitle) || normTitle.includes(normKey)) {
      return sub;
    }
  }

  // Fallback to single submission if student has exactly 1 video upload
  const entries = Object.values(submissions);
  if (entries.length === 1) {
    return entries[0];
  }

  return undefined;
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
    targetDateStr: string = '2026-09-28',
    absenceHistory: Record<string, string> = {},
    customEnrolledDays?: number[]
  ): ResolvedBaselineDate {
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

  /**
   * Scans a single student at the 14:00 pre-class briefing milestone.
   */
  public scanStudent(input: StudentScanInput): PreclassStudentBriefing {
    const targetDate = input.targetDate || '2026-09-28';
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
    let aggregatedLight: PrestudyTrafficLight = prestudyTasks.length > 0 ? 'GREEN' : 'GRAY';
    const evaluatedTasks: ParsedPrestudyTask[] = [];

    for (const task of prestudyTasks) {
      const submission = findVideoSubmission(task.bookTitle, input.videoSubmissions);
      const status = evaluatePrestudyTrafficLight({
        requiresVideoUpload: task.requiresVideoUpload,
        submission,
        targetDateStr: targetDate,
        briefingTimeStr: '14:00',
        classStartTimeStr: '15:00'
      });

      evaluatedTasks.push({
        ...task,
        status,
        verificationSource: submission ? 'lms_TeacherPrestudySummary' : 'unverified'
      });

      // Aggregate: RED takes highest priority, then YELLOW, then GREEN, then GRAY
      if (status === 'RED') {
        aggregatedLight = 'RED';
      } else if (status === 'YELLOW' && aggregatedLight !== 'RED') {
        aggregatedLight = 'YELLOW';
      }
    }

    // 5. Invariant: Concept Blank Test scope injection from baseline prestudy
    const conceptTest = this.injectConceptTestScope(rawHomework);

    // 6. Build contextual classroom alerts
    const alerts: string[] = [];
    if (baseline.absenceIntervened) {
      alerts.push(`[학습공백 보완] 직전 예정일(${absenceHistory['2026-09-23'] ? '09/23 결석' : '이전 결석'})로 인해 ${baseline.baselineDate} 수업 기준으로 과제 추적.`);
    }

    if (aggregatedLight === 'RED') {
      alerts.push(`[Zero Test 대기] 예습영상 미제출 -> 등원 즉시 개념설명 영상 촬영 및 ZT 응시 큐 배정.`);
    } else if (aggregatedLight === 'YELLOW') {
      alerts.push(`[지연 제출 주의] 예습영상이 브리핑(14:00) 이후 제출되었거나 음질 점검 필요.`);
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
   * Scans an entire cohort of students and generates the master 14:00 classroom briefing report.
   */
  public scanCohort(
    cohort: StudentScanInput[],
    targetDate: string = '2026-09-28',
    briefingTime: string = '14:00'
  ): PreclassCohortBriefingReport {
    const studentBriefings: Record<StudentId, PreclassStudentBriefing> = {} as any;
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;
    let grayCount = 0;

    const zeroTestQueue: PreclassCohortBriefingReport['zeroTestQueue'] = [];

    for (const student of cohort) {
      const briefing = this.scanStudent({ ...student, targetDate });
      studentBriefings[student.studentId] = briefing;

      switch (briefing.prestudyTrafficLight) {
        case 'GREEN':
          greenCount++;
          break;
        case 'YELLOW':
          yellowCount++;
          break;
        case 'RED':
          redCount++;
          for (const task of briefing.prestudyTasks) {
            if (task.status === 'RED') {
              zeroTestQueue.push({
                studentId: student.studentId,
                name: student.name,
                bookTitle: task.bookTitle,
                missingScope: task.assignedScope,
                actionRequired: '등원 직후 개념백지 및 구술 설명 영상 촬영'
              });
            }
          }
          break;
        case 'GRAY':
          grayCount++;
          break;
      }
    }

    // Grounded 15:35 Synchronized Timed Assessment for target session
    const synchronizedEvaluations: PreclassCohortBriefingReport['synchronizedEvaluations'] = [
      {
        syncGroupName: 'timed_eval_1535',
        scheduledStartTime: '15:35',
        timeLimitMinutes: 60,
        participants: cohort.map(s => s.studentId)
      }
    ];

    return {
      briefingDate: targetDate,
      briefingTime,
      targetSessionStartTime: '15:00',
      totalStudents: cohort.length,
      trafficLightSummary: {
        green: greenCount,
        yellow: yellowCount,
        red: redCount,
        gray: grayCount
      },
      zeroTestQueue,
      synchronizedEvaluations,
      studentBriefings
    };
  }
}
