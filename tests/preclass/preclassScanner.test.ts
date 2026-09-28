/**
 * Unit Test Suite: PreclassScanner & 14:00 Briefing Resolver
 * Testing against rubric DIM-03 requirements and adversarial edge cases.
 */

import { describe, expect, it } from 'bun:test';
import {
  DEFAULT_ACADEMY_HOLIDAYS_2026,
  PreclassScanner,
  STANDARD_CLASS_SCHEDULES,
  evaluatePrestudyTrafficLight
} from '../../src/preclass/preclassScanner';

describe('PreclassScanner & 14:00 Pre-class Briefing Engine', () => {
  const scanner = new PreclassScanner();

  describe('DIM-03: Heterogeneous Holiday-Aware Lookback Resolver', () => {
    it('Shin Ji-woo (월수1부) walks back past 09/23 Chuseok absence to 2026-09-21 (BLOCKER-4)', () => {
      const result = scanner.resolveStudentBaseline(
        '1293032',
        '2', // 월수1부 [1, 3]
        '2026-09-28',
        { '2026-09-23': '추석 연휴 결석' }
      );

      expect(result.studentId).toBe('1293032');
      expect(result.baselineDate).toBe('2026-09-21');
      expect(result.absenceIntervened).toBe(true);
      expect(result.holidayIntervened).toBe(true);
      expect(result.lookbackDays).toBe(7);

      // Verify resolution chain contains candidate evaluations
      const sep23Entry = result.resolutionChain.find(r => r.candidateDate === '2026-09-23');
      expect(sep23Entry).toBeDefined();
      expect(sep23Entry?.isScheduled).toBe(true);
      expect(sep23Entry?.attendanceStatus).toBe('absent');
      expect(sep23Entry?.selectedAsBaseline).toBe(false);

      const sep21Entry = result.resolutionChain.find(r => r.candidateDate === '2026-09-21');
      expect(sep21Entry).toBeDefined();
      expect(sep21Entry?.selectedAsBaseline).toBe(true);
      expect(sep21Entry?.attendanceStatus).toBe('present');
    });

    it('Park Se-eun & Yoo Ji-yeon (월금1부) resolve to 2026-09-25 (TEST-03-A)', () => {
      const parkResult = scanner.resolveStudentBaseline(
        '1293067',
        '3', // 월금1부 [1, 5]
        '2026-09-28',
        {}
      );

      expect(parkResult.studentId).toBe('1293067');
      expect(parkResult.baselineDate).toBe('2026-09-25');
      expect(parkResult.absenceIntervened).toBe(false);
      expect(parkResult.lookbackDays).toBe(3);

      const yooResult = scanner.resolveStudentBaseline(
        '1293138',
        '3', // 월금1부 [1, 5]
        '2026-09-28',
        {}
      );

      expect(yooResult.baselineDate).toBe('2026-09-25');
    });

    it('prevents naive uniform lookback where all students get identical date', () => {
      const shinBaseline = scanner.resolveStudentBaseline(
        '1293032',
        '2',
        '2026-09-28',
        { '2026-09-23': '추석 연휴 결석' }
      );

      const parkBaseline = scanner.resolveStudentBaseline(
        '1293067',
        '3',
        '2026-09-28',
        {}
      );

      // Must be heterogeneous
      expect(shinBaseline.baselineDate).not.toBe(parkBaseline.baselineDate);
      expect(shinBaseline.baselineDate).toBe('2026-09-21');
      expect(parkBaseline.baselineDate).toBe('2026-09-25');
    });
  });

  describe('DIM-03: Regex Parser for Prestudy Videos & Scope Exclusion', () => {
    it('accurately parses prestudy video scope and excludes general drilling scope (TEST-03-C)', () => {
      const rawHomework = '초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영';
      const parsed = scanner.parseBaselineHomework(rawHomework);

      expect(parsed.prestudyTasks).toHaveLength(1);
      const videoTask = parsed.prestudyTasks[0];
      expect(videoTask.pageStart).toBe(78);
      expect(videoTask.pageEnd).toBe(99);
      expect(videoTask.assignedScope).toBe('p.78 ~ p.99');
      // Context inherited from previous clause
      expect(videoTask.bookTitle).toContain('가우스');

      // General drilling scope was segregated and excluded from prestudy
      expect(parsed.drillingScopes).toHaveLength(1);
      expect(parsed.drillingScopes[0]).toContain('p.100 ~ p.131');
    });

    it('recognizes multiple prestudy keywords and page formats', () => {
      const keywords = [
        '초5-1 다빈치 1권 42 ~ 49쪽 개념설명 영상 촬영',
        '가우스 1-1 p.176-179 개념백지테스트 준비 및 동영상 업로드',
        '가우스플러스 5-2 페이지 50 ~ 페이지 60 예습영상'
      ];

      for (const kw of keywords) {
        const parsed = scanner.parseBaselineHomework(kw);
        expect(parsed.prestudyTasks.length).toBeGreaterThanOrEqual(1);
        expect(parsed.prestudyTasks[0].requiresVideoUpload).toBe(true);
        expect(parsed.prestudyTasks[0].pageStart).toBeGreaterThan(0);
        expect(parsed.prestudyTasks[0].pageEnd).toBeGreaterThan(0);
      }
    });

    it('returns empty prestudy tasks when homework contains no video/preview keywords', () => {
      const rawHomework = '초5-2 가우스 2권 p.50 ~ p.70 오답노트 정리 및 단원평가 대비 풀이';
      const parsed = scanner.parseBaselineHomework(rawHomework);
      expect(parsed.prestudyTasks).toHaveLength(0);
      expect(parsed.drillingScopes).toHaveLength(1);
    });
  });

  describe('DIM-03: Concept Blank Test Invariant Binding', () => {
    it('auto-injects baseline prestudy scope into conceptTest.scope', () => {
      const rawHomework = '초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영';
      const injected = scanner.injectConceptTestScope(rawHomework);

      expect(injected.scope).toBe('p.78 ~ p.99');
      expect(injected.bookTitle).toContain('가우스');
    });

    it('provides graceful fallback when no prestudy scope exists', () => {
      const rawHomework = '초5-2 가우스 2권 p.100 ~ p.131 문제 풀이';
      const injected = scanner.injectConceptTestScope(rawHomework, '전 단원 핵심 공식 백지 테스트');

      expect(injected.scope).toBe('전 단원 핵심 공식 백지 테스트');
      expect(injected.bookTitle).toBe('미지정');
    });
  });

  describe('DIM-03: Traffic-Light Status Engine', () => {
    it('returns GREEN for video uploaded before 14:00 briefing', () => {
      const light = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: {
          uploadedAt: '13:45',
          qualityApproved: true
        },
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00',
        classStartTimeStr: '15:00'
      });
      expect(light).toBe('GREEN');
    });

    it('returns YELLOW for video uploaded late (< 30 min before class start)', () => {
      const light = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: {
          uploadedAt: '14:40',
          qualityApproved: true
        },
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00',
        classStartTimeStr: '15:00'
      });
      expect(light).toBe('YELLOW');
    });

    it('returns YELLOW when audio/video quality is not approved', () => {
      const light = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: {
          uploadedAt: '13:30',
          qualityApproved: false
        },
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00',
        classStartTimeStr: '15:00'
      });
      expect(light).toBe('YELLOW');
    });

    it('returns RED when video is missing or unconfirmed', () => {
      const light = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: null,
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00',
        classStartTimeStr: '15:00'
      });
      expect(light).toBe('RED');
    });

    it('returns GRAY when task does not require video upload', () => {
      const light = evaluatePrestudyTrafficLight({
        requiresVideoUpload: false,
        submission: null,
        targetDateStr: '2026-09-28'
      });
      expect(light).toBe('GRAY');
    });
  });

  describe('DIM-03: 14:00 Master Classroom Briefing Scanner', () => {
    it('scans real 2026-09-28 session cohort generating zero test queue and carry-forward alerts', () => {
      const cohort = [
        // Shin Ji-woo: 09/23 absence walked back to 09/21, with 09/23 teacher override
        {
          studentId: '1293032' as const,
          name: '신지우',
          classGroupId: '2' as const, // 월수1부
          absenceHistory: { '2026-09-23': '추석 연휴 결석' },
          baselineHomeworkOverride: '초5-2 가우스 2권 p.100 ~ p.131 + 초5-1 다빈치 1권 p.42 ~ p.49 + p.78 ~ p.99 개념 예습영상 촬영',
          videoSubmissions: {
            '초5-2 가우스 2권': { uploadedAt: '13:50', qualityApproved: true }
          }
        },
        // Park Se-eun: 09/25 baseline, video uploaded on time
        {
          studentId: '1293067' as const,
          name: '박세은',
          classGroupId: '3' as const, // 월금1부
          homeworkLogs: {
            '2026-09-25': '초5-2 가우스 2권 p.120 ~ p.140 + p.50 ~ p.65 개념 예습영상 촬영'
          },
          videoSubmissions: {
            '초5-2 가우스 2권': { uploadedAt: '13:30', qualityApproved: true }
          }
        },
        // Yoo Ji-yeon: 09/25 baseline, video missing -> Queues Zero Test
        {
          studentId: '1293138' as const,
          name: '유지연',
          classGroupId: '3' as const, // 월금1부
          homeworkLogs: {
            '2026-09-25': '가우스 1-1 p.176 ~ p.179 개념백지테스트 예습영상 촬영'
          },
          videoSubmissions: {},
          specialAlerts: ['15:15 도착 사전 접수 (15분 지각 예정)']
        }
      ];

      const report = scanner.scanCohort(cohort, '2026-09-28', '14:00');

      expect(report.totalStudents).toBe(3);
      expect(report.trafficLightSummary.green).toBe(2); // Shin, Park
      expect(report.trafficLightSummary.red).toBe(1);   // Yoo (missing video)

      // Yoo Ji-yeon queued for Zero Test upon arrival
      expect(report.zeroTestQueue).toHaveLength(1);
      expect(report.zeroTestQueue[0].studentId).toBe('1293138');
      expect(report.zeroTestQueue[0].name).toBe('유지연');

      // Shin Ji-woo has learning gap walkback alert
      const shinBriefing = report.studentBriefings['1293032'];
      expect(shinBriefing.baselineDate).toBe('2026-09-21');
      expect(shinBriefing.alerts.some(a => a.includes('학습공백 보완'))).toBe(true);

      // Yoo Ji-yeon has ZT alert and tardy alert
      const yooBriefing = report.studentBriefings['1293138'];
      expect(yooBriefing.alerts.some(a => a.includes('Zero Test 대기'))).toBe(true);
      expect(yooBriefing.alerts.some(a => a.includes('지각'))).toBe(true);

      // 15:35 Synchronized Timed Assessment is scheduled
      expect(report.synchronizedEvaluations).toHaveLength(1);
      expect(report.synchronizedEvaluations[0].syncGroupName).toBe('timed_eval_1535');
      expect(report.synchronizedEvaluations[0].scheduledStartTime).toBe('15:35');
      expect(report.synchronizedEvaluations[0].timeLimitMinutes).toBe(60);
      expect(report.synchronizedEvaluations[0].participants).toEqual(['1293032', '1293067', '1293138']);
    });
  });
});
