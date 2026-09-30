/**
 * Carry-Forward Clinic & Daily Test Pipeline Engine.
 * 
 * Domain Rules:
 * 1. Time-shortage deferred tasks (클리닉 및 Daily Test) are queued into the student's next session.
 * 2. Next session comes from a complete, source-backed class calendar.
 *    Cancellations are skipped, makeups are included, and unknowns block routing.
 * 3. Prestudy Clinic Specifications:
 *    - Identical wrong problem reprinted from [필수예제 / 유형다지기 / 실력다지기].
 *    - 1~2 labeled similar problems per wrong question.
 *    - Must be solved in student's "풀이노트 (Practice Notebook)" and inspected face-to-face by the teacher.
 * 4. Next session integration:
 *    - Bundled with next session's homework inspection into the 14:00 preparation checklist.
 */

import type {
  StudentId,
  ClassGroupId,
  DeferredSessionTask,
  CarryForwardClinicItem,
  CarryForwardSessionBundle,
  PrestudyProblemCategory
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

export interface CreateClinicItemInput {
  sourceCategory: PrestudyProblemCategory;
  originalProblemNumber: number;
  similarCount?: number; // 1 or 2
  difficultyLevel?: '기본' | '응용' | '심화';
}

export interface VerifiedSessionCalendar {
  group: ClassGroupId;
  studentIds: ReadonlyArray<StudentId>;
  fromDate: string;
  throughDate: string;
  coverage: 'complete';
  sourceRef: string;
  occurrences: ReadonlyArray<{
    date: string;
    occurrenceId: string;
    status: 'held' | 'planned' | 'cancelled' | 'unknown';
  }>;
}

function exactDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid class date');
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error('Invalid class date');
  }
  return time;
}

export class CarryForwardQueueManager {
  // Keyed by StudentId -> List of DeferredSessionTask
  private deferredTaskStore: Map<StudentId, DeferredSessionTask[]> = new Map();

  /** Select the first source-backed future class, including makeup lessons. */
  public static resolveNextSessionDate(
    group: ClassGroupId, currentDate: string, calendar: VerifiedSessionCalendar
  ): string {
    const current = exactDate(currentDate);
    if (calendar.group !== group || calendar.coverage !== 'complete' || !calendar.sourceRef.trim()) {
      throw new Error('Class calendar scope or coverage is unverified');
    }
    if (exactDate(calendar.fromDate) > current || exactDate(calendar.throughDate) <= current) {
      throw new Error('Class calendar does not cover the requested interval');
    }
    const seenDates = new Set<string>();
    const occurrences = calendar.occurrences.filter(item => {
      const time = exactDate(item.date);
      if (!item.occurrenceId.trim() || seenDates.has(item.date)) {
        throw new Error('Ambiguous or incomplete class occurrence');
      }
      seenDates.add(item.date);
      if (time < exactDate(calendar.fromDate) || time > exactDate(calendar.throughDate)) {
        throw new Error('Class occurrence falls outside verified coverage');
      }
      if (!['held', 'planned', 'cancelled', 'unknown'].includes(item.status)) {
        throw new Error('Invalid class status');
      }
      return true;
    }).sort((a, b) => a.date.localeCompare(b.date));
    if (occurrences.find(item => item.date === currentDate)?.status !== 'held') {
      throw new Error('Origin class is not verified held');
    }
    for (const item of occurrences.filter(item => exactDate(item.date) > current)) {
      if (item.status === 'unknown') throw new Error('Future class status is unknown');
      if (item.status === 'held' || item.status === 'planned') return item.date;
    }
    throw new Error('No next class in verified calendar window');
  }

  /**
   * Builds a synthetic clinic specification; no printing or source lookup occurs.
   */
  public static buildClinicItems(items: CreateClinicItemInput[]): CarryForwardClinicItem[] {
    return items.map((it, idx) => {
      const count = it.similarCount ?? 2;
      if (!Number.isInteger(it.originalProblemNumber) || it.originalProblemNumber < 1
          || !Number.isInteger(count) || count < 1 || count > 2) {
        throw new Error('Clinic item needs a positive problem number and 1 or 2 similar problems');
      }
      const labeledSimilarProblems = Array.from({ length: count }, (_, i) => ({
        similarProblemId: `SIM_${it.originalProblemNumber}_${i + 1}`,
        label: `유사 ${i + 1}번`,
        difficultyLevel: it.difficultyLevel || '응용'
      }));

      return {
        itemId: `CLN_${it.sourceCategory}_P${it.originalProblemNumber}_${idx + 1}`,
        sourceCategory: it.sourceCategory,
        originalProblemNumber: it.originalProblemNumber,
        originalProblemPrinted: false,
        labeledSimilarProblems,
        executionSurface: '풀이노트 (Practice Notebook)',
        teacherInspectionRequired: true,
        status: 'pending_print'
      };
    });
  }

  /**
   * Queue a teacher-evidenced deferral to the next verified student session.
   */
  public queueDeferralsForStudent(
    studentId: StudentId,
    studentName: string,
    enrolledGroup: ClassGroupId,
    originDate: string,
    bookTitle: string,
    prestudyScope: string,
    clinicItems: CarryForwardClinicItem[],
    deferralId: string,
    deferralReason: string,
    calendar: VerifiedSessionCalendar
  ): DeferredSessionTask[] {
    if (!calendar.studentIds.includes(studentId) || !deferralId.trim()
        || !deferralReason.trim()) {
      throw new Error('Deferral identity, reason, or student calendar binding is missing');
    }
    const targetNextSessionDate = CarryForwardQueueManager.resolveNextSessionDate(
      enrolledGroup, originDate, calendar);

    const clinicTask: DeferredSessionTask = {
      taskId: `DEF_CLN_${studentId}_${deferralId}`,
      studentId,
      studentName,
      enrolledGroup,
      originSessionDate: originDate,
      targetNextSessionDate,
      taskType: 'prestudy_error_clinic',
      bookTitle,
      scope: prestudyScope,
      deferralReason,
      clinicItems,
      executionPriority: 1,
      status: 'deferred'
    };

    const dailyTestTask: DeferredSessionTask = {
      taskId: `DEF_DT_${studentId}_${deferralId}`,
      studentId,
      studentName,
      enrolledGroup,
      originSessionDate: originDate,
      targetNextSessionDate,
      taskType: 'daily_test',
      bookTitle,
      scope: `${prestudyScope} Daily Test`,
      deferralReason,
      executionPriority: 1,
      status: 'deferred'
    };

    const existing = this.deferredTaskStore.get(studentId) || [];
    const prior = existing.filter(task => task.taskId === clinicTask.taskId
                                 || task.taskId === dailyTestTask.taskId);
    if (prior.length) {
      if (prior.length !== 2 || JSON.stringify(prior) !== JSON.stringify([clinicTask, dailyTestTask])) {
        throw new Error('Conflicting deferral retry');
      }
      return prior;
    }
    existing.push(clinicTask, dailyTestTask);
    this.deferredTaskStore.set(studentId, existing);

    return [clinicTask, dailyTestTask];
  }

  /**
   * Retrieves all carry-forward tasks scheduled for a specific target session date.
   */
  public getCarryForwardBundle(
    studentId: StudentId,
    targetDate: string
  ): CarryForwardSessionBundle | null {
    const tasks = this.deferredTaskStore.get(studentId) || [];
    const matched = tasks.filter(t => t.targetNextSessionDate === targetDate);

    if (matched.length === 0) return null;

    const first = matched[0];
    const clinicTask = matched.find(t => t.taskType === 'prestudy_error_clinic');
    const clinicCount = clinicTask?.clinicItems?.length ?? 0;

    const briefingAlert = `[차기수업 ${targetDate} 이월 알림] ${first.studentName}: 지난시간 미실시 오답클리닉 (${clinicCount}개 문항 쌍둥이/유사문제 풀이노트 검사) 및 Daily Test 진행 필수.`;

    return {
      targetDate,
      studentId,
      studentName: first.studentName,
      enrolledGroup: first.enrolledGroup,
      deferredTasks: matched,
      homeworkCheckRequired: true,
      briefingAlert
    };
  }

  /**
   * Generates next-session 14:00 preparation checklist items for all queued students.
   */
  public generatePreclassChecklistForDate(targetDate: string): Array<{ studentName: string; taskDescription: string; priority: string }> {
    const checklist: Array<{ studentName: string; taskDescription: string; priority: string }> = [];

    for (const [studentId, tasks] of this.deferredTaskStore.entries()) {
      const activeForDate = tasks.filter(t => t.targetNextSessionDate === targetDate);
      for (const t of activeForDate) {
        if (t.taskType === 'prestudy_error_clinic') {
          const itemCount = t.clinicItems?.length || 0;
          checklist.push({
            studentName: t.studentName,
            taskDescription: `[클리닉지 인쇄] ${t.bookTitle} (${t.scope}) 오답 ${itemCount}문항 원본 + 유사문제(1~2개) 라벨링 프린트 준비`,
            priority: 'HIGH'
          });
          checklist.push({
            studentName: t.studentName,
            taskDescription: `[풀이노트 검사 큐잉] 수업 진입 시 ${t.studentName} 학생 클리닉 풀이노트 작성 후 강사 대면 실물 검사`,
            priority: 'HIGH'
          });
        } else if (t.taskType === 'daily_test') {
          checklist.push({
            studentName: t.studentName,
            taskDescription: `[Daily Test 시험지 준비] ${t.bookTitle} ${t.scope} 등원 즉시 응시 셋업`,
            priority: 'HIGH'
          });
        }
      }
    }

    return checklist;
  }
}
