/**
 * Carry-Forward Clinic & Daily Test Pipeline Engine.
 * 
 * Domain Rules:
 * 1. Time-shortage deferred tasks (클리닉 및 Daily Test) are queued into the student's next session.
 * 2. Next session schedule resolution:
 *    - 월수1부 (신지우) ➔ 2026-09-30 (수) 15:00
 *    - 월금1부 (박세은, 유지연) ➔ 2026-10-02 (금) 15:00
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

export class CarryForwardQueueManager {
  // Keyed by StudentId -> List of DeferredSessionTask
  private deferredTaskStore: Map<StudentId, DeferredSessionTask[]> = new Map();

  /**
   * Resolves the student's next regular class date.
   */
  public static resolveNextSessionDate(group: ClassGroupId, currentDate: string): string {
    // Current date: 2026-09-28 (Monday)
    if (group === '월수1부') {
      return '2026-09-30'; // Wednesday
    } else if (group === '월금1부') {
      return '2026-10-02'; // Friday
    }
    // Fallback +2 days
    return '2026-09-30';
  }

  /**
   * Builds standardized clinic items with identical reprinted problem and 1~2 labeled similar problems.
   */
  public static buildClinicItems(items: CreateClinicItemInput[]): CarryForwardClinicItem[] {
    return items.map((it, idx) => {
      const count = it.similarCount ?? 2;
      const labeledSimilarProblems = Array.from({ length: count }, (_, i) => ({
        similarProblemId: `SIM_${it.originalProblemNumber}_${i + 1}`,
        label: `유사 ${i + 1}번`,
        difficultyLevel: it.difficultyLevel || '응용'
      }));

      return {
        itemId: `CLN_${it.sourceCategory}_P${it.originalProblemNumber}_${idx + 1}`,
        sourceCategory: it.sourceCategory,
        originalProblemNumber: it.originalProblemNumber,
        originalProblemPrinted: true,
        labeledSimilarProblems,
        executionSurface: '풀이노트 (Practice Notebook)',
        teacherInspectionRequired: true,
        status: 'pending_print'
      };
    });
  }

  /**
   * Defer today's uncompleted clinic and Daily Test due to time shortage.
   */
  public queueDeferralsForStudent(
    studentId: StudentId,
    studentName: string,
    enrolledGroup: ClassGroupId,
    originDate: string,
    bookTitle: string,
    prestudyScope: string,
    clinicItems: CarryForwardClinicItem[]
  ): DeferredSessionTask[] {
    const targetNextSessionDate = CarryForwardQueueManager.resolveNextSessionDate(enrolledGroup, originDate);

    const clinicTask: DeferredSessionTask = {
      taskId: `DEF_CLN_${targetNextSessionDate.replace(/-/g, '')}_${studentId}`,
      studentId,
      studentName,
      enrolledGroup,
      originSessionDate: originDate,
      targetNextSessionDate,
      taskType: 'prestudy_error_clinic',
      bookTitle,
      scope: prestudyScope,
      deferralReason: 'time_shortage_due_to_grand_chapter_eval',
      clinicItems,
      executionPriority: 1,
      status: 'deferred'
    };

    const dailyTestTask: DeferredSessionTask = {
      taskId: `DEF_DT_${targetNextSessionDate.replace(/-/g, '')}_${studentId}`,
      studentId,
      studentName,
      enrolledGroup,
      originSessionDate: originDate,
      targetNextSessionDate,
      taskType: 'daily_test',
      bookTitle,
      scope: `${prestudyScope} Daily Test`,
      deferralReason: 'time_shortage_due_to_grand_chapter_eval',
      executionPriority: 1,
      status: 'deferred'
    };

    const existing = this.deferredTaskStore.get(studentId) || [];
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
