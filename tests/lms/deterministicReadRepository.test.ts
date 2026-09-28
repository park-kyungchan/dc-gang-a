import { describe, it, expect, beforeEach } from 'bun:test';
import {
  LmsDeterministicReadRepository,
  JoinError
} from '../../src/lms/lmsDeterministicReadRepository';
import { TestPaperAdapter } from '../../src/assessment/testPaperAdapter';
import { StudentAssessmentLedgerEngine } from '../../src/assessment/studentAssessmentLedger';

describe('LMS Deterministic Read Repository & Key Join Engine', () => {
  let repo: LmsDeterministicReadRepository;
  let ledger: StudentAssessmentLedgerEngine;

  beforeEach(() => {
    repo = new LmsDeterministicReadRepository();
    ledger = new StudentAssessmentLedgerEngine();
  });

  describe('DIM-09: pNo First-Class Citizen Test Paper Lookup', () => {
    it('retrieves Yoo Ji-yeon official test paper pNo 6343283 deterministically', () => {
      const paper = repo.getTestPaper('6343283');

      expect(paper).not.toBeNull();
      expect(paper!.pNo).toBe('6343283');
      expect(paper!.bookTitle).toBe('가우스 1-1');
      expect(paper!.scope).toBe('p.176 ~ p.179');
      expect(paper!.categoryName).toBe('대단원총괄평가');
      expect(paper!.totalQuestions).toBe(20);
      expect(paper!.timeLimitMinutes).toBe(60);
      expect(paper!.items.length).toBe(20);
      expect(paper!.provenance).toBe('VERIFIED_SNAPSHOT');

      // Verify specific question metadata
      const q12 = paper!.items.find(i => i.itemNo === 12);
      expect(q12).toBeDefined();
      expect(q12!.correctAnswer).toBe('12');
      expect(q12!.points).toBe(5);
      expect(q12!.topicDescription).toBe('음수 곱셈 부호 판별');
      expect(q12!.lectureKey).toContain('LEC_G7_1_CH2_');
    });

    it('retrieves Shin Ji-woo (pNo 6343110) and Park Se-eun (pNo 6343188) test papers', () => {
      const shinPaper = repo.getTestPaper('6343110');
      expect(shinPaper).not.toBeNull();
      expect(shinPaper!.bookTitle).toBe('초5-2 가우스 2권');
      expect(shinPaper!.scope).toBe('p.71 ~ p.73');

      const parkPaper = repo.getTestPaper('6343188');
      expect(parkPaper).not.toBeNull();
      expect(parkPaper!.bookTitle).toBe('초5-2 가우스 2권');
      expect(parkPaper!.scope).toBe('p.134 ~ p.138');
    });

    it('returns null for uncataloged test papers', () => {
      expect(repo.getTestPaper('9999999')).toBeNull();
    });

    it('throws JoinError when querying invalid or empty pNo', () => {
      expect(() => repo.getTestPaper('')).toThrow(JoinError);
    });
  });

  describe('DIM-09: Anti-Hallucination & Pending Verification Safeguards', () => {
    it('initializes Yoo Ji-yeon attempt as pending_verification with null score', () => {
      const attempt = repo.getStudentAttempt('1293138', '6343283');

      expect(attempt).not.toBeNull();
      expect(attempt!.studentId).toBe('1293138');
      expect(attempt!.pNo).toBe('6343283');
      expect(attempt!.isVerifiedLive).toBe(false);
      expect(attempt!.verificationStatus).toBe('pending_verification');
      // Invariant: No fabricated score!
      expect(attempt!.score).toBeNull();
      expect(attempt!.correctCount).toBeNull();
      expect(attempt!.wrongCount).toBeNull();
      expect(attempt!.percentage).toBeNull();
    });

    it('blocks TestPaperAdapter from ingesting pending/unverified attempt into ledger', () => {
      const attempt = repo.getStudentAttempt('1293138', '6343283')!;
      const paper = repo.getTestPaper('6343283')!;

      // Protection: Zero-hallucination blocker prevents importing null/mock scores
      expect(() => TestPaperAdapter.adaptAttemptToLedgerInput(attempt, paper)).toThrow(JoinError);
    });

    it('blocks TestPaperAdapter when attempt pNo does not match paper pNo', () => {
      const shinPaper = repo.getTestPaper('6343110')!;
      const yooAttempt = repo.getStudentAttempt('1293138', '6343283')!;

      expect(() => TestPaperAdapter.adaptAttemptToLedgerInput(yooAttempt, shinPaper)).toThrow(JoinError);
    });
  });

  describe('DIM-09: Verified Attempt Confirmation & Ledger Integration', () => {
    it('confirms verified student answers and integrates seamlessly into ledger', () => {
      const paper = repo.getTestPaper('6343283')!;

      // Prepare verified answers (19 correct, wrong on item #12: student gave "-12" instead of "12")
      const studentAnswers: Record<number, string> = {};
      for (const item of paper.items) {
        studentAnswers[item.itemNo] = item.itemNo === 12 ? '-12' : item.correctAnswer;
      }

      // Teacher or live LMS confirms attempt
      const verifiedAttempt = repo.confirmVerifiedAttempt({
        pNo: '6343283',
        studentId: '1293138',
        studentName: '유지연',
        enrolledGroup: '월금1부',
        sessionDate: '2026-09-28',
        submittedAt: '2026-09-28T16:35:00+09:00',
        timeSpentMinutes: 55,
        submissionMethod: 'academy_app',
        deviceInfo: 'iPad 10th Gen',
        studentAnswers,
        dataSource: 'VERIFIED_SNAPSHOT',
        teacherNotes: '오답 12번 부호 판별 실수 확인 완료'
      });

      expect(verifiedAttempt.score).toBe(95);
      expect(verifiedAttempt.totalQuestions).toBe(20);
      expect(verifiedAttempt.correctCount).toBe(19);
      expect(verifiedAttempt.wrongCount).toBe(1);
      expect(verifiedAttempt.percentage).toBe(95.0);
      expect(verifiedAttempt.wrongItemNumbers).toEqual([12]);
      expect(verifiedAttempt.verificationStatus).toBe('verified_snapshot');

      // Now adapt to ledger input
      const ledgerInput = TestPaperAdapter.adaptAttemptToLedgerInput(verifiedAttempt, paper);
      expect(ledgerInput.pNo).toBe('6343283');
      expect(ledgerInput.studentId).toBe('1293138');

      // Ingest into student assessment ledger
      const record = ledger.ingestAssessmentRecord(ledgerInput);
      expect(record.pNo).toBe('6343283');
      expect(record.score).toBe(95);
      expect(record.status).toBe('graded');
      expect(ledger.verifyRecordIntegrity(record)).toBe(true);

      // Verify individual DB retrieval
      const history = ledger.getStudentHistory('1293138');
      expect(history.length).toBe(1);
      expect(history[0].pNo).toBe('6343283');
    });
  });
});
