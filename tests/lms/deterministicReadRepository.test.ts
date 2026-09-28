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
      expect(paper!.unitName).toBe('3. 방정식');
      expect(paper!.categoryName).toBe('대단원총괄평가');
      expect(paper!.totalQuestions).toBe(25);
      expect(paper!.timeLimitMinutes).toBe(60);
      expect(paper!.items.length).toBe(25);
      expect(paper!.provenance).toBe('VERIFIED_SNAPSHOT');

      // Verify specific question metadata
      const q1 = paper!.items.find(i => i.itemNo === 1);
      expect(q1).toBeDefined();
      expect(q1!.points).toBe(4);
      expect(q1!.topicDescription).toBe('중1-1 방정식 대단원 문항 1');
    });

    it('retrieves Shin Ji-woo (pNo 6725858 / 6343110) and Park Se-eun (pNo 6724304 / 6343188) test papers', () => {
      const shinPaper = repo.getTestPaper('6725858');
      expect(shinPaper).not.toBeNull();
      expect(shinPaper!.bookTitle).toBe('초5-2 가우스 2권');
      expect(shinPaper!.unitName).toBe('4. 소수의 곱셈');

      const parkPaper = repo.getTestPaper('6724304');
      expect(parkPaper).not.toBeNull();
      expect(parkPaper!.bookTitle).toBe('초5-2 가우스 2권');
      expect(parkPaper!.unitName).toBe('2. 분수의 곱셈');
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
      const shinPaper = repo.getTestPaper('6725858')!;
      const yooAttempt = repo.getStudentAttempt('1293138', '6343283')!;

      expect(() => TestPaperAdapter.adaptAttemptToLedgerInput(yooAttempt, shinPaper)).toThrow(JoinError);
    });
  });

  describe('DIM-09: Verified Attempt Confirmation & Ledger Integration', () => {
    it('confirms verified student answers and integrates seamlessly into ledger', () => {
      const paper = repo.getTestPaper('6343283')!;

      // Prepare verified answers (21 correct, 4 wrong: 1, 15, 16, 23)
      const wrongItems = [1, 15, 16, 23];
      const studentAnswers: Record<number, string> = {};
      for (const item of paper.items) {
        studentAnswers[item.itemNo] = wrongItems.includes(item.itemNo) ? 'wrong_ans' : item.correctAnswer;
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
        teacherNotes: '실측 채점 완료: 84점 (4문항 오답 확인)'
      });

      expect(verifiedAttempt.score).toBe(84);
      expect(verifiedAttempt.totalQuestions).toBe(25);
      expect(verifiedAttempt.correctCount).toBe(21);
      expect(verifiedAttempt.wrongCount).toBe(4);
      expect(verifiedAttempt.percentage).toBe(84.0);
      expect(verifiedAttempt.wrongItemNumbers).toEqual([1, 15, 16, 23]);
      expect(verifiedAttempt.verificationStatus).toBe('verified_snapshot');

      // Now adapt to ledger input
      const ledgerInput = TestPaperAdapter.adaptAttemptToLedgerInput(verifiedAttempt, paper);
      expect(ledgerInput.pNo).toBe('6343283');
      expect(ledgerInput.studentId).toBe('1293138');

      // Ingest into student assessment ledger
      const record = ledger.ingestAssessmentRecord(ledgerInput);
      expect(record.pNo).toBe('6343283');
      expect(record.score).toBe(84);
      expect(record.status).toBe('graded');
      expect(ledger.verifyRecordIntegrity(record)).toBe(true);

      // Verify individual DB retrieval
      const history = ledger.getStudentHistory('1293138');
      expect(history.length).toBe(1);
      expect(history[0].pNo).toBe('6343283');
    });
  });
});
