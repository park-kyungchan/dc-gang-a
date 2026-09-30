/**
 * Carry-forward queue for unfinished clinic and Daily Test work.
 *
 * The queue is local domain logic. It does not read or write the academy LMS,
 * Google Sheet, student database, or any remote service.
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
  similarCount?: number;
  difficultyLevel?: '기본' | '응용' | '심화';
}

export interface TeacherCompletionConfirmation {
  teacherId: string;
  confirmedAt: string;
  /** Required for a clinic and must name every item inspected face to face. */
  inspectedClinicItemIds?: readonly string[];
}

export interface QueueDeferralOptions {
  /** A stable key for the exact source work item, not a student/date label. */
  sourceWorkKey: string;
  /** Dates already verified as this student's future lesson occurrences. */
  verifiedFutureSessionDates: readonly string[];
  deferClinic: boolean;
  deferDailyTest: boolean;
}

export type StoredDeferredSessionTask = DeferredSessionTask & {
  sourceWorkKey: string;
  teacherConfirmation?: Readonly<TeacherCompletionConfirmation>;
};

export type CarryForwardBundle = Omit<CarryForwardSessionBundle, 'deferredTasks'> & {
  deferredTasks: StoredDeferredSessionTask[];
};

export type PreclassChecklistTaskType =
  | 'current_homework'
  | 'prestudy_error_clinic'
  | 'daily_test';

export interface PreclassChecklistItem {
  studentId: StudentId;
  studentName: string;
  taskType: PreclassChecklistTaskType;
  taskId: string | null;
  targetDate: string;
  /** Original scheduled lesson date. Null for the current-homework review row. */
  originSessionDate: string | null;
  /** Exact reason the work remained unfinished. Null for current homework. */
  unfinishedReason: string | null;
  taskDescription: string;
  priority: 'HIGH';
  status: DeferredSessionTask['status'] | null;
  currentHomeworkCheckRequired: boolean;
  teacherConfirmationRequired: boolean;
}

export class CarryForwardQueueManager {
  private deferredTaskStore: Map<StudentId, StoredDeferredSessionTask[]> = new Map();

  /** Select the next date only from caller-verified lesson occurrences. */
  public static resolveNextSessionDate(
    currentDate: string,
    verifiedFutureSessionDates: readonly string[]
  ): string {
    assertCalendarDate(currentDate, 'currentDate');
    if (verifiedFutureSessionDates.length === 0) {
      throw new Error('verified future lesson dates are required');
    }
    for (const date of verifiedFutureSessionDates) {
      assertCalendarDate(date, 'verifiedFutureSessionDate');
      if (date <= currentDate) {
        throw new Error('verified lesson dates must be after the origin date');
      }
    }
    return [...new Set(verifiedFutureSessionDates)].sort()[0]!;
  }

  /** Build identical reprints and 1-2 labeled similar problems for the notebook. */
  public static buildClinicItems(items: CreateClinicItemInput[]): CarryForwardClinicItem[] {
    return items.map((item, index) => {
      const count = item.similarCount ?? 2;
      const labeledSimilarProblems = Array.from({ length: count }, (_, problemIndex) => ({
        similarProblemId: 'SIM_' + item.originalProblemNumber + '_' + (problemIndex + 1),
        label: '유사 ' + (problemIndex + 1) + '번',
        difficultyLevel: item.difficultyLevel || '응용'
      }));

      return {
        itemId: 'CLN_' + item.sourceCategory + '_P' + item.originalProblemNumber + '_' + (index + 1),
        sourceCategory: item.sourceCategory,
        originalProblemNumber: item.originalProblemNumber,
        originalProblemPrinted: false,
        labeledSimilarProblems,
        executionSurface: '풀이노트 (Practice Notebook)',
        teacherInspectionRequired: true,
        status: 'pending_print'
      };
    });
  }

  /**
   * Queue clinic and Daily Test work that was unfinished on originSessionDate.
   * The supplied unfinishedReason is retained verbatim on both task records.
   * Repeating the same deferral is idempotent and does not replace its history.
   */
  public queueDeferralsForStudent(
    studentId: StudentId,
    studentName: string,
    enrolledGroup: ClassGroupId,
    originSessionDate: string,
    bookTitle: string,
    prestudyScope: string,
    clinicItems: CarryForwardClinicItem[],
    unfinishedReason: string,
    options: QueueDeferralOptions
  ): StoredDeferredSessionTask[] {
    assertCalendarDate(originSessionDate, 'originSessionDate');
    if (!unfinishedReason || unfinishedReason.trim() !== unfinishedReason) {
      throw new Error('unfinishedReason must be provided without normalization');
    }
    if (!options || typeof options.sourceWorkKey !== 'string' ||
        !options.sourceWorkKey || options.sourceWorkKey.trim() !== options.sourceWorkKey) {
      throw new Error('an exact sourceWorkKey is required');
    }
    if (!options.deferClinic && !options.deferDailyTest) {
      throw new Error('at least one unfinished task must be selected');
    }
    if (options.deferClinic && clinicItems.length === 0) {
      throw new Error('a deferred clinic needs inspectable item IDs');
    }

    const targetNextSessionDate = CarryForwardQueueManager.resolveNextSessionDate(
      originSessionDate, options.verifiedFutureSessionDates
    );
    const sourceIdentity = studentId.length + ':' + studentId +
      options.sourceWorkKey.length + ':' + options.sourceWorkKey;
    const requested: StoredDeferredSessionTask[] = [];
    if (options.deferClinic) requested.push({
        taskId: 'DEF_CLN_' + sourceIdentity,
        sourceWorkKey: options.sourceWorkKey,
        studentId,
        studentName,
        enrolledGroup,
        originSessionDate,
        targetNextSessionDate,
        taskType: 'prestudy_error_clinic',
        bookTitle,
        scope: prestudyScope,
        deferralReason: unfinishedReason,
        clinicItems: clinicItems.map(cloneClinicItem),
        executionPriority: 1,
        status: 'deferred'
      });
    if (options.deferDailyTest) requested.push({
        taskId: 'DEF_DT_' + sourceIdentity,
        sourceWorkKey: options.sourceWorkKey,
        studentId,
        studentName,
        enrolledGroup,
        originSessionDate,
        targetNextSessionDate,
        taskType: 'daily_test',
        bookTitle,
        scope: prestudyScope + ' Daily Test',
        deferralReason: unfinishedReason,
        executionPriority: 1,
        status: 'deferred'
      });

    const stored = this.deferredTaskStore.get(studentId) || [];
    const selected = requested.map((candidate) => {
      const prior = stored.find((task) => task.taskId === candidate.taskId);
      if (prior) return prior;
      stored.push(candidate);
      return candidate;
    });
    this.deferredTaskStore.set(studentId, stored);
    return selected.map(cloneTask);
  }

  /**
   * Return all due, unresolved carry-forward work for this class date.
   * A missed target date does not erase an item; its original date and reason
   * stay attached until an explicit teacher confirmation resolves the task.
   */
  public getCarryForwardBundle(
    studentId: StudentId,
    targetDate: string
  ): CarryForwardBundle | null {
    assertCalendarDate(targetDate, 'targetDate');
    const tasks = this.deferredTaskStore.get(studentId) || [];
    const matched = tasks.filter(
      (task) => task.targetNextSessionDate <= targetDate && task.status !== 'resolved'
    );

    if (matched.length === 0) return null;

    const first = matched[0]!;
    const clinicCount = matched
      .filter((task) => task.taskType === 'prestudy_error_clinic')
      .reduce((count, task) => count + (task.clinicItems?.length ?? 0), 0);
    const history = Array.from(new Set(matched.map(
      (task) => task.originSessionDate + ' (' + task.deferralReason + ')'
    ))).join('; ');
    const briefingAlert =
      '[차기수업 ' + targetDate + ' 이월 알림] ' + first.studentName +
      ': 현재 숙제와 지난 미완료 클리닉 (' + clinicCount +
      '개 문항) 및 Daily Test를 함께 확인하세요. 원래 예정일과 미완료 사유: ' +
      history + '. 강사 확인 전 완료 처리 금지.';

    return {
      targetDate,
      studentId,
      studentName: first.studentName,
      enrolledGroup: first.enrolledGroup,
      deferredTasks: matched.map(cloneTask),
      homeworkCheckRequired: true,
      briefingAlert
    };
  }

  /**
   * Create one current-homework review row beside every unresolved carry-forward
   * item due by targetDate. Reading this checklist never changes task status.
   */
  public generatePreclassChecklistForDate(targetDate: string): PreclassChecklistItem[] {
    assertCalendarDate(targetDate, 'targetDate');
    const checklist: PreclassChecklistItem[] = [];

    for (const tasks of this.deferredTaskStore.values()) {
      const activeForDate = tasks.filter(
        (task) => task.targetNextSessionDate <= targetDate && task.status !== 'resolved'
      );
      if (activeForDate.length === 0) continue;

      const first = activeForDate[0]!;
      checklist.push({
        studentId: first.studentId,
        studentName: first.studentName,
        taskType: 'current_homework',
        taskId: null,
        targetDate,
        originSessionDate: null,
        unfinishedReason: null,
        taskDescription: '[현재 숙제 확인] ' + targetDate +
          ' 수업의 현행 숙제를 확인하고 아래 이월 과제와 함께 검토',
        priority: 'HIGH',
        status: null,
        currentHomeworkCheckRequired: true,
        teacherConfirmationRequired: false
      });

      for (const task of activeForDate) {
        const history = '원래 예정일 ' + task.originSessionDate +
          '; 미완료 사유 ' + task.deferralReason;
        const common = {
          studentId: task.studentId,
          studentName: task.studentName,
          taskId: task.taskId,
          targetDate,
          originSessionDate: task.originSessionDate,
          unfinishedReason: task.deferralReason,
          priority: 'HIGH' as const,
          status: task.status,
          currentHomeworkCheckRequired: true,
          teacherConfirmationRequired: true
        };

        if (task.taskType === 'prestudy_error_clinic') {
          const itemCount = task.clinicItems?.length ?? 0;
          checklist.push({
            ...common,
            taskType: 'prestudy_error_clinic',
            taskDescription: '[클리닉지 인쇄] ' + task.bookTitle + ' (' + task.scope +
              ') 오답 ' + itemCount + '문항 원본 + 유사문제 라벨링 준비. ' + history
          });
          checklist.push({
            ...common,
            taskType: 'prestudy_error_clinic',
            taskDescription: '[풀이노트 검사 큐잉] ' + task.studentName +
              ' 학생의 클리닉 풀이노트를 강사가 대면 검사. ' + history
          });
        } else {
          checklist.push({
            ...common,
            taskType: 'daily_test',
            taskDescription: '[Daily Test 시험지 준비] ' + task.bookTitle + ' ' +
              task.scope + ' 응시 준비. ' + history
          });
        }
      }
    }

    return checklist;
  }

  /**
   * Resolve one task only after an explicit teacher confirmation.
   * Clinic completion additionally requires confirmation of every listed item.
   */
  public confirmTaskCompletion(
    studentId: StudentId,
    taskId: string,
    confirmation: TeacherCompletionConfirmation
  ): StoredDeferredSessionTask {
    const teacherId = confirmation?.teacherId;
    if (typeof teacherId !== 'string' || teacherId.length === 0 || teacherId.trim() !== teacherId) {
      throw new Error('teacher confirmation requires a teacherId');
    }
    assertOffsetTimestamp(confirmation.confirmedAt);

    const tasks = this.deferredTaskStore.get(studentId) || [];
    const task = tasks.find((candidate) => candidate.taskId === taskId);
    if (!task) throw new Error('carry-forward task not found');

    if (task.status === 'resolved') {
      throw new Error('carry-forward task is already resolved');
    }
    if (task.taskType === 'prestudy_error_clinic') {
      const itemIds = (task.clinicItems || []).map((item) => item.itemId);
      if (itemIds.length === 0) throw new Error('clinic task has no inspectable items');
      const inspected = confirmation.inspectedClinicItemIds || [];
      if (new Set(inspected).size !== inspected.length ||
          itemIds.length !== inspected.length ||
          itemIds.some((itemId) => !inspected.includes(itemId))) {
        throw new Error('teacher must confirm inspection of every clinic item');
      }
      for (const item of task.clinicItems || []) item.status = 'inspected_passed';
    } else if ((confirmation.inspectedClinicItemIds || []).length > 0) {
      throw new Error('Daily Test confirmation cannot include clinic item IDs');
    }

    task.teacherConfirmation = Object.freeze({
      teacherId,
      confirmedAt: confirmation.confirmedAt,
      inspectedClinicItemIds: confirmation.inspectedClinicItemIds
        ? Object.freeze([...confirmation.inspectedClinicItemIds])
        : undefined
    });
    task.status = 'resolved';
    return cloneTask(task);
  }
}

function cloneClinicItem(item: CarryForwardClinicItem): CarryForwardClinicItem {
  return {
    ...item,
    labeledSimilarProblems: item.labeledSimilarProblems.map((problem) => ({ ...problem }))
  };
}

function cloneTask(task: StoredDeferredSessionTask): StoredDeferredSessionTask {
  return {
    ...task,
    clinicItems: task.clinicItems?.map(cloneClinicItem),
    teacherConfirmation: task.teacherConfirmation
      ? {
          ...task.teacherConfirmation,
          inspectedClinicItemIds: task.teacherConfirmation.inspectedClinicItemIds
            ? [...task.teacherConfirmation.inspectedClinicItemIds]
            : undefined
        }
      : undefined
  };
}

function assertCalendarDate(value: string, label: string): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      Number.isNaN(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    throw new Error(label + ' must be an ISO calendar date');
  }
}

function assertOffsetTimestamp(value: string): void {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Number.isNaN(Date.parse(value))) {
    throw new Error('teacher confirmation needs a timezone-aware timestamp');
  }
}
