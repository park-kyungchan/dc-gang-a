import { describe, it, expect, beforeEach } from 'bun:test';
import { CarryForwardQueueManager, type VerifiedSessionCalendar } from '../../src/assessment/carryForwardQueue';

const shinCalendar: VerifiedSessionCalendar = {
  group: '월수1부', studentIds: ['1293032'],
  fromDate: '2026-09-28', throughDate: '2026-09-30',
  coverage: 'complete', sourceRef: 'synthetic-schedule-shin',
  occurrences: [
    { date: '2026-09-28', occurrenceId: 'shin-sep28', status: 'held' },
    { date: '2026-09-30', occurrenceId: 'shin-sep30', status: 'planned' },
  ],
};
const monFriCalendar: VerifiedSessionCalendar = {
  group: '월금1부', studentIds: ['1293067', '1293138'],
  fromDate: '2026-09-28', throughDate: '2026-10-02',
  coverage: 'complete', sourceRef: 'synthetic-schedule-monfri',
  occurrences: [
    { date: '2026-09-28', occurrenceId: 'monfri-sep28', status: 'held' },
    { date: '2026-10-02', occurrenceId: 'monfri-oct02', status: 'planned' },
  ],
};

describe('CarryForwardQueueManager & Next-Session Integration', () => {
  let queueManager: CarryForwardQueueManager;

  beforeEach(() => {
    queueManager = new CarryForwardQueueManager();
  });

  describe('DIM-09: Next Regular Class Schedule Resolution', () => {
    it('correctly maps 월수1부 (신지우) to 2026-09-30 (Wednesday)', () => {
      const nextDate = CarryForwardQueueManager.resolveNextSessionDate('월수1부', '2026-09-28', shinCalendar);
      expect(nextDate).toBe('2026-09-30');
    });

    it('correctly maps 월금1부 (박세은, 유지연) to 2026-10-02 (Friday)', () => {
      const nextDate = CarryForwardQueueManager.resolveNextSessionDate('월금1부', '2026-09-28', monFriCalendar);
      expect(nextDate).toBe('2026-10-02');
    });

    it('skips the October holidays and blocks an unknown intervening class', () => {
      const holidayCalendar: VerifiedSessionCalendar = {
        group: '월금1부', studentIds: ['1293067', '1293138'],
        fromDate: '2026-10-02', throughDate: '2026-10-12',
        coverage: 'complete', sourceRef: 'synthetic-holiday-calendar',
        occurrences: [
          { date: '2026-10-02', occurrenceId: 'oct02', status: 'held' },
          { date: '2026-10-05', occurrenceId: 'oct05', status: 'cancelled' },
          { date: '2026-10-09', occurrenceId: 'oct09', status: 'cancelled' },
          { date: '2026-10-12', occurrenceId: 'oct12', status: 'planned' },
        ],
      };
      expect(CarryForwardQueueManager.resolveNextSessionDate(
        '월금1부', '2026-10-02', holidayCalendar)).toBe('2026-10-12');
      expect(() => CarryForwardQueueManager.resolveNextSessionDate(
        '월금1부', '2026-10-02', {
          ...holidayCalendar,
          occurrences: [
            holidayCalendar.occurrences[0],
            holidayCalendar.occurrences[1],
            { date: '2026-10-09', occurrenceId: 'oct09', status: 'unknown' },
            holidayCalendar.occurrences[3],
          ],
        })).toThrow('status is unknown');
      expect(() => CarryForwardQueueManager.resolveNextSessionDate(
        '월금1부', '2026-10-02', {
          ...holidayCalendar, coverage: 'complete', sourceRef: '',
        })).toThrow('coverage is unverified');
      expect(CarryForwardQueueManager.resolveNextSessionDate('월금1부', '2026-10-02', {
        ...holidayCalendar,
        occurrences: [
          holidayCalendar.occurrences[0],
          holidayCalendar.occurrences[1],
          { date: '2026-10-07', occurrenceId: 'makeup-oct07', status: 'planned' },
          holidayCalendar.occurrences[2],
          holidayCalendar.occurrences[3],
        ],
      })).toBe('2026-10-07');
      expect(() => CarryForwardQueueManager.resolveNextSessionDate('월금1부', '2026-10-02', {
        ...holidayCalendar,
        occurrences: holidayCalendar.occurrences.slice(1),
      })).toThrow('Origin class is not verified held');
    });
  });

  describe('DIM-10: Clinic Package Construction & Problem Labeled Reprints', () => {
    it('constructs identical reprinted problem plus 1~2 labeled similar problems for 풀이노트', () => {
      const clinicItems = CarryForwardQueueManager.buildClinicItems([
        { sourceCategory: '필수예제', originalProblemNumber: 3, similarCount: 2, difficultyLevel: '응용' },
        { sourceCategory: '유형다지기', originalProblemNumber: 8, similarCount: 1, difficultyLevel: '심화' },
        { sourceCategory: '실력다지기', originalProblemNumber: 15, similarCount: 2, difficultyLevel: '응용' }
      ]);

      expect(clinicItems.length).toBe(3);

      // Item 1 (필수예제 3번)
      expect(clinicItems[0].sourceCategory).toBe('필수예제');
      expect(clinicItems[0].originalProblemNumber).toBe(3);
      expect(clinicItems[0].originalProblemPrinted).toBe(false);
      expect(clinicItems[0].labeledSimilarProblems.length).toBe(2);
      expect(clinicItems[0].labeledSimilarProblems[0].label).toBe('유사 1번');
      expect(clinicItems[0].labeledSimilarProblems[1].label).toBe('유사 2번');
      expect(clinicItems[0].executionSurface).toBe('풀이노트 (Practice Notebook)');
      expect(clinicItems[0].teacherInspectionRequired).toBe(true);

      // Item 2 (유형다지기 8번)
      expect(clinicItems[1].labeledSimilarProblems.length).toBe(1);
      expect(clinicItems[1].labeledSimilarProblems[0].difficultyLevel).toBe('심화');
      expect(() => CarryForwardQueueManager.buildClinicItems([
        { sourceCategory: '필수예제', originalProblemNumber: 0, similarCount: 3 }
      ])).toThrow('positive problem number');
    });
  });

  describe('DIM-11: Deferral Queueing & 차기 수업(09/30, 10/02) 14:00 브리핑/체크리스트 생성', () => {
    it('queues Shin Ji-woo deferred tasks to 2026-09-30 and generates 14:00 preparation items', () => {
      const clinicItems = CarryForwardQueueManager.buildClinicItems([
        { sourceCategory: '필수예제', originalProblemNumber: 7, similarCount: 2 },
        { sourceCategory: '유형다지기', originalProblemNumber: 14, similarCount: 2 }
      ]);

      const tasks = queueManager.queueDeferralsForStudent(
        '1293032',
        '신지우',
        '월수1부',
        '2026-09-28',
        '초5-2 가우스 2권',
        'p.100 ~ p.131 (예습 범위)',
        clinicItems,
        'synthetic-shin-deferral',
        'teacher-confirmed unfinished clinic',
        shinCalendar
      );

      expect(tasks.length).toBe(2);
      expect(tasks[0].taskType).toBe('prestudy_error_clinic');
      expect(tasks[0].targetNextSessionDate).toBe('2026-09-30');
      expect(tasks[1].taskType).toBe('daily_test');
      expect(tasks[1].targetNextSessionDate).toBe('2026-09-30');
      expect(queueManager.queueDeferralsForStudent(
        '1293032', '신지우', '월수1부', '2026-09-28',
        '초5-2 가우스 2권', 'p.100 ~ p.131 (예습 범위)', clinicItems,
        'synthetic-shin-deferral', 'teacher-confirmed unfinished clinic',
        shinCalendar)).toEqual(tasks);
      expect(() => queueManager.queueDeferralsForStudent(
        '1293032', '신지우', '월수1부', '2026-09-28',
        '초5-2 가우스 2권', 'different scope', clinicItems,
        'synthetic-shin-deferral', 'teacher-confirmed unfinished clinic',
        shinCalendar)).toThrow('Conflicting deferral retry');

      // Verify bundle for 09/30
      const bundle = queueManager.getCarryForwardBundle('1293032', '2026-09-30');
      expect(bundle).not.toBeNull();
      expect(bundle?.studentName).toBe('신지우');
      expect(bundle?.briefingAlert).toContain('미실시 오답클리닉');
      expect(bundle?.briefingAlert).toContain('Daily Test');

      // Verify 14:00 checklist for 09/30
      const checklist = queueManager.generatePreclassChecklistForDate('2026-09-30');
      expect(checklist.length).toBe(3); // 2 clinic entries (print, notebook) + 1 DT entry
      expect(checklist.some(c => c.taskDescription.includes('[클리닉지 인쇄]'))).toBe(true);
      expect(checklist.some(c => c.taskDescription.includes('[풀이노트 검사 큐잉]'))).toBe(true);
      expect(checklist.some(c => c.taskDescription.includes('[Daily Test 시험지 준비]'))).toBe(true);
    });

    it('queues Park Se-eun & Yoo Ji-yeon deferred tasks to 2026-10-02 (월금1부)', () => {
      const parkClinic = CarryForwardQueueManager.buildClinicItems([
        { sourceCategory: '유형다지기', originalProblemNumber: 5, similarCount: 2 }
      ]);
      queueManager.queueDeferralsForStudent(
        '1293067',
        '박세은',
        '월금1부',
        '2026-09-28',
        '초5-2 가우스 2권',
        'p.78 ~ p.95 (예습 범위)',
        parkClinic,
        'synthetic-park-deferral',
        'teacher-confirmed unfinished clinic',
        monFriCalendar
      );

      const yooClinic = CarryForwardQueueManager.buildClinicItems([
        { sourceCategory: '실력다지기', originalProblemNumber: 12, similarCount: 1 }
      ]);
      queueManager.queueDeferralsForStudent(
        '1293138',
        '유지연',
        '월금1부',
        '2026-09-28',
        '가우스플러스 5-2',
        'p.71 ~ p.89 (예습 범위)',
        yooClinic,
        'synthetic-yoo-deferral',
        'teacher-confirmed unfinished clinic',
        monFriCalendar
      );

      const checklist1002 = queueManager.generatePreclassChecklistForDate('2026-10-02');
      expect(checklist1002.length).toBe(6); // 3 items for Park + 3 items for Yoo
      expect(checklist1002.filter(c => c.studentName === '박세은').length).toBe(3);
      expect(checklist1002.filter(c => c.studentName === '유지연').length).toBe(3);
    });
  });
});
