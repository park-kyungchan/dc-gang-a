import { beforeEach, describe, expect, it } from 'bun:test';
import { CarryForwardQueueManager } from '../../src/assessment/carryForwardQueue';

describe('CarryForwardQueueManager & next-session integration', () => {
  let queueManager: CarryForwardQueueManager;

  beforeEach(() => {
    queueManager = new CarryForwardQueueManager();
  });

  it('selects the next date only from caller-verified future lessons', () => {
    expect(CarryForwardQueueManager.resolveNextSessionDate(
      '2026-09-28', ['2026-10-02', '2026-09-30']
    ))
      .toBe('2026-09-30');
    expect(CarryForwardQueueManager.resolveNextSessionDate(
      '2026-09-28', ['2026-10-02']
    ))
      .toBe('2026-10-02');
    expect(CarryForwardQueueManager.resolveNextSessionDate(
      '2027-01-04', ['2027-01-11']
    )).toBe('2027-01-11');
    expect(() => CarryForwardQueueManager.resolveNextSessionDate(
      '2026-09-28', ['2026-09-21']
    )).toThrow('after the origin date');
    expect(() => CarryForwardQueueManager.resolveNextSessionDate(
      '2026-09-28', []
    )).toThrow('verified future lesson dates');
  });

  it('builds clinic items that require face-to-face teacher inspection', () => {
    const clinicItems = CarryForwardQueueManager.buildClinicItems([
      { sourceCategory: '필수예제', originalProblemNumber: 3, similarCount: 2, difficultyLevel: '응용' },
      { sourceCategory: '유형다지기', originalProblemNumber: 8, similarCount: 1, difficultyLevel: '심화' }
    ]);

    expect(clinicItems).toHaveLength(2);
    expect(clinicItems[0]?.originalProblemPrinted).toBe(false);
    expect(clinicItems[0]?.labeledSimilarProblems.map((item) => item.label))
      .toEqual(['유사 1번', '유사 2번']);
    expect(clinicItems[0]?.teacherInspectionRequired).toBe(true);
    expect(clinicItems[0]?.status).toBe('pending_print');
    expect(clinicItems[1]?.labeledSimilarProblems).toHaveLength(1);
  });

  it('keeps original date and reason, pairs carry-forward work with current homework, and never auto-completes', () => {
    const clinicItems = CarryForwardQueueManager.buildClinicItems([
      { sourceCategory: '필수예제', originalProblemNumber: 7 },
      { sourceCategory: '유형다지기', originalProblemNumber: 14, similarCount: 1 }
    ]);
    const unfinishedReason = 'Synthetic reason: chapter assessment used the remaining class time.';
    const tasks = queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-001',
      'Synthetic Student A',
      '2',
      '2026-09-28',
      'Synthetic Book A',
      'Synthetic pages 100-131',
      clinicItems,
      unfinishedReason,
      {
        sourceWorkKey: 'SYN-WORK-001',
        verifiedFutureSessionDates: ['2026-09-30'],
        deferClinic: true,
        deferDailyTest: true
      }
    );

    expect(tasks).toHaveLength(2);
    expect(tasks.map((task) => task.originSessionDate)).toEqual(['2026-09-28', '2026-09-28']);
    expect(tasks.map((task) => task.deferralReason)).toEqual([unfinishedReason, unfinishedReason]);
    expect(tasks.every((task) => task.status === 'deferred')).toBe(true);

    const bundle = queueManager.getCarryForwardBundle('SYN-STUDENT-001', '2026-09-30');
    expect(bundle).not.toBeNull();
    expect(bundle?.homeworkCheckRequired).toBe(true);
    expect(bundle?.deferredTasks.map((task) => task.taskType))
      .toEqual(['prestudy_error_clinic', 'daily_test']);
    expect(bundle?.briefingAlert).toContain('2026-09-28');
    expect(bundle?.briefingAlert).toContain(unfinishedReason);
    expect(bundle?.deferredTasks.every((task) =>
      task.originSessionDate === '2026-09-28' && task.deferralReason === unfinishedReason
    )).toBe(true);

    const checklist = queueManager.generatePreclassChecklistForDate('2026-09-30');
    expect(checklist).toHaveLength(4);
    expect(checklist.filter((item) => item.taskType === 'current_homework')).toHaveLength(1);
    const carryForwardItems = checklist.filter((item) => item.taskType !== 'current_homework');
    expect(carryForwardItems).toHaveLength(3);
    expect(carryForwardItems.every((item) =>
      item.currentHomeworkCheckRequired &&
      item.teacherConfirmationRequired &&
      item.originSessionDate === '2026-09-28' &&
      item.unfinishedReason === unfinishedReason &&
      item.status === 'deferred'
    )).toBe(true);

    const laterClass = queueManager.getCarryForwardBundle('SYN-STUDENT-001', '2026-10-07');
    expect(laterClass?.deferredTasks).toHaveLength(2);
    expect(queueManager.generatePreclassChecklistForDate('2026-10-07')).toHaveLength(4);
    expect(queueManager.getCarryForwardBundle('SYN-STUDENT-001', '2026-09-27')).toBeNull();

    const repeated = queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-001',
      'Synthetic Student A',
      '2',
      '2026-09-28',
      'Synthetic Book A',
      'Synthetic pages 100-131',
      clinicItems,
      'A replacement reason must not overwrite the original.',
      {
        sourceWorkKey: 'SYN-WORK-001',
        verifiedFutureSessionDates: ['2026-09-30'],
        deferClinic: true,
        deferDailyTest: true
      }
    );
    expect(repeated.map((task) => task.deferralReason))
      .toEqual([unfinishedReason, unfinishedReason]);
    expect(repeated.every((task) => task.status === 'deferred')).toBe(true);
  });

  it('requires explicit teacher confirmation before resolving clinic or Daily Test work', () => {
    const clinicItems = CarryForwardQueueManager.buildClinicItems([
      { sourceCategory: '실력다지기', originalProblemNumber: 5, similarCount: 1 }
    ]);
    const tasks = queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-002',
      'Synthetic Student B',
      '3',
      '2026-09-28',
      'Synthetic Book B',
      'Synthetic pages 78-95',
      clinicItems,
      'Synthetic reason: clinic and test were not reached.',
      {
        sourceWorkKey: 'SYN-WORK-002',
        verifiedFutureSessionDates: ['2026-10-02'],
        deferClinic: true,
        deferDailyTest: true
      }
    );

    const clinic = tasks.find((task) => task.taskType === 'prestudy_error_clinic')!;
    const dailyTest = tasks.find((task) => task.taskType === 'daily_test')!;
    const confirmation = {
      teacherId: 'SYN-TEACHER-001',
      confirmedAt: '2026-10-02T15:30:00+09:00'
    };

    expect(() => queueManager.confirmTaskCompletion(
      'SYN-STUDENT-002',
      clinic.taskId,
      { ...confirmation, inspectedClinicItemIds: [] }
    )).toThrow('teacher must confirm inspection of every clinic item');
    expect(queueManager.getCarryForwardBundle('SYN-STUDENT-002', '2026-10-02')
      ?.deferredTasks.every((task) => task.status === 'deferred')).toBe(true);

    const completedClinic = queueManager.confirmTaskCompletion(
      'SYN-STUDENT-002',
      clinic.taskId,
      {
        ...confirmation,
        inspectedClinicItemIds: clinic.clinicItems!.map((item) => item.itemId)
      }
    );
    expect(completedClinic.status).toBe('resolved');
    expect(completedClinic.teacherConfirmation?.teacherId).toBe(confirmation.teacherId);
    expect(completedClinic.clinicItems?.every((item) => item.status === 'inspected_passed')).toBe(true);
    expect(completedClinic.originSessionDate).toBe('2026-09-28');

    const stillOpen = queueManager.getCarryForwardBundle('SYN-STUDENT-002', '2026-10-02');
    expect(stillOpen?.deferredTasks.map((task) => task.taskType)).toEqual(['daily_test']);
    expect(stillOpen?.deferredTasks[0]?.status).toBe('deferred');

    const completedDailyTest = queueManager.confirmTaskCompletion(
      'SYN-STUDENT-002',
      dailyTest.taskId,
      confirmation
    );
    expect(completedDailyTest.status).toBe('resolved');
    expect(completedDailyTest.deferralReason)
      .toBe('Synthetic reason: clinic and test were not reached.');
    expect(queueManager.getCarryForwardBundle('SYN-STUDENT-002', '2026-10-07')).toBeNull();
  });

  it('does not let callers mutate stored tasks through returned copies', () => {
    const clinicItems = CarryForwardQueueManager.buildClinicItems([
      { sourceCategory: '유형다지기', originalProblemNumber: 2 }
    ]);
    const returned = queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-003',
      'Synthetic Student C',
      '2',
      '2026-09-28',
      'Synthetic Book C',
      'Synthetic pages 1-10',
      clinicItems,
      'Synthetic unfinished reason.',
      {
        sourceWorkKey: 'SYN-WORK-003',
        verifiedFutureSessionDates: ['2026-09-30'],
        deferClinic: true,
        deferDailyTest: true
      }
    );

    returned[0]!.status = 'resolved';
    returned[0]!.clinicItems![0]!.status = 'inspected_passed';
    const stored = queueManager.getCarryForwardBundle('SYN-STUDENT-003', '2026-09-30');
    expect(stored?.deferredTasks[0]?.status).toBe('deferred');
    expect(stored?.deferredTasks[0]?.clinicItems?.[0]?.status).toBe('pending_print');
  });

  it('keeps distinct source work independent and can defer Daily Test alone', () => {
    const clinicItems = CarryForwardQueueManager.buildClinicItems([
      { sourceCategory: '필수예제', originalProblemNumber: 1 }
    ]);
    queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-004', 'Synthetic Student D', '2', '2026-09-28',
      'Synthetic Book D', 'Synthetic scope A', clinicItems, 'Synthetic first reason.',
      {
        sourceWorkKey: 'SYN-WORK-A',
        verifiedFutureSessionDates: ['2026-09-30'],
        deferClinic: true,
        deferDailyTest: true
      }
    );
    const later = queueManager.queueDeferralsForStudent(
      'SYN-STUDENT-004', 'Synthetic Student D', '2', '2026-09-28',
      'Synthetic Book D', 'Synthetic scope B', [], 'Synthetic second reason.',
      {
        sourceWorkKey: 'SYN-WORK-B',
        verifiedFutureSessionDates: ['2026-09-30'],
        deferClinic: false,
        deferDailyTest: true
      }
    );
    expect(later).toHaveLength(1);
    expect(later[0]?.taskType).toBe('daily_test');
    expect(later[0]?.sourceWorkKey).toBe('SYN-WORK-B');
    const bundle = queueManager.getCarryForwardBundle('SYN-STUDENT-004', '2026-09-30');
    expect(bundle?.deferredTasks).toHaveLength(3);
    expect(new Set(bundle?.deferredTasks.map((task) => task.taskId)).size).toBe(3);
    expect(bundle?.deferredTasks.map((task) => task.deferralReason))
      .toEqual(['Synthetic first reason.', 'Synthetic first reason.', 'Synthetic second reason.']);
  });
});
