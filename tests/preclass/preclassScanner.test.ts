/**
 * Synthetic-only tests for the preclass scanner and evidence handling.
 */

import { describe, expect, it } from 'bun:test';
import {
  PreclassScanner,
  STANDARD_CLASS_SCHEDULES,
  evaluatePrestudyTrafficLight,
  findVideoSubmission,
  VideoSubmissionRecord
} from '../../src/preclass/preclassScanner';

const scanner = new PreclassScanner([
  { date: '2026-09-23', name: 'Synthetic closure', isClassCancelled: true }
]);

function makeVerifiedSubmission(
  studentId: string,
  occurrenceId: string,
  uploadedAt: string,
  qualityApproved = true
): VideoSubmissionRecord {
  return {
    studentId,
    occurrenceId,
    verificationSource: 'app_backend_submission',
    verifiedExactReadJoin: true,
    uploadedAt,
    qualityApproved
  };
}

describe('PreclassScanner synthetic scenarios', () => {
  describe('holiday-aware lookback', () => {
    it('skips a synthetic closure and recorded absence for one student', () => {
      const result = scanner.resolveStudentBaseline(
        'student-alpha',
        '2',
        '2026-09-28',
        { '2026-09-23': 'synthetic absence' }
      );

      expect(result.studentId).toBe('student-alpha');
      expect(result.baselineDate).toBe('2026-09-21');
      expect(result.absenceIntervened).toBe(true);
      expect(result.holidayIntervened).toBe(true);
      expect(result.lookbackDays).toBe(7);
    });

    it('resolves two synthetic cohorts to their respective prior session dates', () => {
      const mondayWednesday = scanner.resolveStudentBaseline('student-beta', '2', '2026-09-28');
      const mondayFriday = scanner.resolveStudentBaseline('student-gamma', '3', '2026-09-28');

      expect(mondayWednesday.baselineDate).toBe('2026-09-21');
      expect(mondayFriday.baselineDate).toBe('2026-09-25');
      expect(mondayWednesday.baselineDate).not.toBe(mondayFriday.baselineDate);
    });
  });

  describe('prestudy parsing and concept-test scope', () => {
    it('separates a synthetic drilling range from its assigned video range', () => {
      const parsed = scanner.parseBaselineHomework(
        '초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영'
      );

      expect(parsed.prestudyTasks).toHaveLength(1);
      expect(parsed.prestudyTasks[0].pageStart).toBe(78);
      expect(parsed.prestudyTasks[0].pageEnd).toBe(99);
      expect(parsed.prestudyTasks[0].assignedScope).toBe('p.78 ~ p.99');
      expect(parsed.prestudyTasks[0].bookTitle).toContain('가우스');
      expect(parsed.drillingScopes).toHaveLength(1);
      expect(parsed.drillingScopes[0]).toContain('p.100 ~ p.131');
    });

    it('recognizes supported synthetic page formats and keywords', () => {
      const examples = [
        '초5-1 다빈치 1권 42 ~ 49쪽 개념설명 영상 촬영',
        '가우스 1-1 p.176-179 개념백지테스트 준비 및 동영상 업로드',
        '가우스플러스 5-2 페이지 50 ~ 페이지 60 예습영상'
      ];

      for (const example of examples) {
        const tasks = scanner.parseBaselineHomework(example).prestudyTasks;
        expect(tasks.length).toBeGreaterThanOrEqual(1);
        expect(tasks[0].requiresVideoUpload).toBe(true);
        expect(tasks[0].pageStart).toBeGreaterThan(0);
        expect(tasks[0].pageEnd).toBeGreaterThan(0);
      }
    });

    it('returns no prestudy task for synthetic drilling-only homework', () => {
      const parsed = scanner.parseBaselineHomework('초5-2 가우스 2권 p.50 ~ p.70 오답노트 정리');
      expect(parsed.prestudyTasks).toHaveLength(0);
      expect(parsed.drillingScopes).toHaveLength(1);
    });

    it('uses the assigned synthetic prestudy scope for the concept test', () => {
      const result = scanner.injectConceptTestScope(
        '초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영'
      );
      expect(result.scope).toBe('p.78 ~ p.99');
      expect(result.bookTitle).toContain('가우스');
    });

    it('keeps an explicit fallback when no synthetic prestudy task is present', () => {
      const result = scanner.injectConceptTestScope('가우스 p.100 ~ p.131 문제 풀이', '기본 개념 확인');
      expect(result.scope).toBe('기본 개념 확인');
      expect(result.bookTitle).toBe('미지정');
    });
  });

  describe('source- and occurrence-verified submission status', () => {
    const studentId = 'student-alpha';
    const occurrenceId = 'opaque-occurrence-alpha';

    it('returns GREEN for an exact verified occurrence uploaded by briefing', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: makeVerifiedSubmission(studentId, occurrenceId, '2026-09-28T13:45:00'),
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00'
      });
      expect(result).toBe('GREEN');
    });

    it('returns YELLOW after briefing without applying a class-start cutoff', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: makeVerifiedSubmission(studentId, occurrenceId, '2026-09-28T14:10:00'),
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28',
        briefingTimeStr: '14:00'
      });
      expect(result).toBe('YELLOW');
    });

    it('returns YELLOW for a verified quality issue', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: makeVerifiedSubmission(studentId, occurrenceId, '2026-09-28T13:30:00', false),
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28'
      });
      expect(result).toBe('YELLOW');
    });

    it('keeps an absent submission UNKNOWN', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: null,
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28'
      });
      expect(result).toBe('UNKNOWN');
    });

    it('keeps an unverified submission UNKNOWN', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: { studentId, occurrenceId, uploadedAt: '2026-09-28T13:30:00', qualityApproved: true },
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28'
      });
      expect(result).toBe('UNKNOWN');
    });

    it('keeps a submission with unknown quality UNKNOWN', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: {
          studentId,
          occurrenceId,
          verificationSource: 'app_backend_submission',
          verifiedExactReadJoin: true,
          uploadedAt: '2026-09-28T13:30:00'
        },
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28'
      });
      expect(result).toBe('UNKNOWN');
    });

    it('keeps timestamps with an unresolved timezone or date UNKNOWN', () => {
      for (const uploadedAt of ['13:30', '2026-09-28T13:30:00+09:00', '2026-09-27T13:30:00']) {
        const result = evaluatePrestudyTrafficLight({
          requiresVideoUpload: true,
          submission: makeVerifiedSubmission(studentId, occurrenceId, uploadedAt),
          expectedStudentId: studentId,
          expectedOccurrenceId: occurrenceId,
          targetDateStr: '2026-09-28'
        });
        expect(result).toBe('UNKNOWN');
      }
    });

    it('does not match another occurrence by substring or single-entry fallback', () => {
      const otherOccurrenceId = 'opaque-occurrence-beta';
      const onlyOtherSubmission = makeVerifiedSubmission(studentId, otherOccurrenceId, '2026-09-28T13:30:00');
      expect(findVideoSubmission(studentId, occurrenceId, { [otherOccurrenceId]: onlyOtherSubmission })).toBeUndefined();
      expect(findVideoSubmission(studentId, occurrenceId, { default: onlyOtherSubmission })).toBeUndefined();
      const otherStudentSubmission = makeVerifiedSubmission('student-beta', occurrenceId, '2026-09-28T13:30:00');
      expect(findVideoSubmission(studentId, occurrenceId, { [occurrenceId]: otherStudentSubmission })).toBeUndefined();
    });

    it('does not trust a page-shell source label without an exact app read/join', () => {
      const pageShellCandidate = {
        studentId,
        occurrenceId,
        verificationSource: 'lms_TeacherPrestudySummary' as const,
        verifiedExactReadJoin: true as const,
        uploadedAt: '2026-09-28T13:30:00',
        qualityApproved: true
      };

      expect(findVideoSubmission(studentId, occurrenceId, { [occurrenceId]: pageShellCandidate })).toBeUndefined();
      expect(evaluatePrestudyTrafficLight({
        requiresVideoUpload: true,
        submission: pageShellCandidate,
        expectedStudentId: studentId,
        expectedOccurrenceId: occurrenceId,
        targetDateStr: '2026-09-28'
      })).toBe('UNKNOWN');
    });

    it('requires the explicit exact-read/join flag even for the app backend source', () => {
      const missingFlag = {
        studentId,
        occurrenceId,
        verificationSource: 'app_backend_submission' as const,
        uploadedAt: '2026-09-28T13:30:00',
        qualityApproved: true
      };

      expect(findVideoSubmission(studentId, occurrenceId, { [occurrenceId]: missingFlag })).toBeUndefined();
    });

    it('returns GRAY when upload is not assigned', () => {
      const result = evaluatePrestudyTrafficLight({
        requiresVideoUpload: false,
        targetDateStr: '2026-09-28'
      });
      expect(result).toBe('GRAY');
    });
  });

  describe('synthetic cohort briefing', () => {
    it('uses the caller supplied briefing time for an individual scan', () => {
      const homework = '가우스 1-1 p.1 ~ p.2 개념 예습영상';
      const occurrenceId = 'opaque-occurrence-delta';
      const briefing = scanner.scanStudent({
        studentId: 'student-delta',
        name: 'Synthetic Student D',
        classGroupId: '1',
        homeworkLogs: { '2026-09-24': homework },
        prestudyOccurrenceIds: [occurrenceId],
        videoSubmissions: { [occurrenceId]: makeVerifiedSubmission('student-delta', occurrenceId, '2026-09-28T14:10:00') }
      }, '2026-09-28', '14:30');

      expect(briefing.baselineDate).toBe('2026-09-24');
      expect(briefing.prestudyTrafficLight).toBe('GREEN');
    });

    it('keeps missing occurrence evidence UNKNOWN and emits no inferred action or schedule', () => {
      const firstHomework = '초5-2 가우스 2권 p.100 ~ p.131 + p.78 ~ p.99 개념 예습영상 촬영';
      const firstOccurrenceId = 'opaque-cohort-occurrence-alpha';

      const secondHomework = '초5-2 가우스 2권 p.120 ~ p.140 + p.50 ~ p.65 개념 예습영상 촬영';
      const secondOccurrenceId = 'opaque-cohort-occurrence-beta';

      const report = scanner.scanCohort([
        {
          studentId: 'student-alpha',
          name: 'Synthetic Student A',
          classGroupId: '2',
          absenceHistory: { '2026-09-23': 'synthetic absence' },
          baselineHomeworkOverride: firstHomework,
          prestudyOccurrenceIds: [firstOccurrenceId],
          videoSubmissions: { [firstOccurrenceId]: makeVerifiedSubmission('student-alpha', firstOccurrenceId, '2026-09-28T13:50:00') }
        },
        {
          studentId: 'student-beta',
          name: 'Synthetic Student B',
          classGroupId: '3',
          homeworkLogs: { '2026-09-25': secondHomework },
          prestudyOccurrenceIds: [secondOccurrenceId],
          videoSubmissions: { [secondOccurrenceId]: makeVerifiedSubmission('student-beta', secondOccurrenceId, '2026-09-28T13:30:00') }
        },
        {
          studentId: 'student-gamma',
          name: 'Synthetic Student C',
          classGroupId: '3',
          homeworkLogs: {
            '2026-09-25': '가우스 1-1 p.176 ~ p.179 개념백지테스트 예습영상 촬영'
          },
          videoSubmissions: {}
        }
      ], '2026-09-28', '14:00');

      expect(report.totalStudents).toBe(3);
      expect(report.trafficLightSummary).toEqual({ green: 2, yellow: 0, gray: 0, unknown: 1 });
      expect(report.studentBriefings['student-gamma'].prestudyTrafficLight).toBe('UNKNOWN');
      expect(report.studentBriefings['student-gamma'].alerts.some(alert => alert.includes('미확인'))).toBe(true);
      expect(Object.keys(report)).not.toContain('zeroTestQueue');
      expect(Object.keys(report)).not.toContain('synchronizedEvaluations');
      expect(Object.keys(report)).not.toContain('targetSessionStartTime');
    });
  });

  it('retains the synthetic schedule configuration shape', () => {
    expect(STANDARD_CLASS_SCHEDULES['2'].daysOfWeek).toEqual([1, 3]);
  });

  it('rejects a missing or malformed scan date instead of choosing a historical default', () => {
    expect(() => scanner.scanCohort([], undefined as unknown as string)).toThrow(/explicit valid YYYY-MM-DD/);
    expect(() => scanner.resolveStudentBaseline('student-epsilon', '2', '2026-02-30')).toThrow(/explicit valid YYYY-MM-DD/);
  });
});
