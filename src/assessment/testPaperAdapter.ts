/**
 * Test Paper & Assessment Attempt Adapter.
 * 
 * Bridges LMS Deterministic Repository contracts with the Student Assessment Ledger.
 * Enforces zero-hallucination policies:
 * - If an attempt is unverified or pending, it raises an explicit error or exports a pending placeholder.
 * - Confirmed attempts are cleanly mapped to `IngestAssessmentInput` with exact `pNo` provenance.
 */

import type { IngestAssessmentInput } from './studentAssessmentLedger';
import type { LmsStudentAttemptContract, LmsTestPaperContract } from '../lms/lmsBackendContracts';
import { JoinError } from '../lms/lmsDeterministicReadRepository';

export class TestPaperAdapter {
  /**
   * Adapts a verified student attempt into ledger ingestion input.
   */
  public static adaptAttemptToLedgerInput(
    attempt: LmsStudentAttemptContract,
    paper: LmsTestPaperContract
  ): IngestAssessmentInput {
    if (attempt.pNo !== paper.pNo) {
      throw new JoinError(
        `Mismatched paper join: Attempt references pNo ${attempt.pNo}, but Paper is pNo ${paper.pNo}`
      );
    }

    if (attempt.score === null || attempt.verificationStatus === 'pending_verification') {
      throw new JoinError(
        `Cannot ingest pending/unverified attempt for student ${attempt.studentName} (pNo: ${attempt.pNo}). ` +
        `Real score must be verified before claiming grade completion.`
      );
    }

    return {
      pNo: attempt.pNo,
      studentId: attempt.studentId,
      studentName: attempt.studentName,
      enrolledGroup: attempt.enrolledGroup,
      sessionDate: attempt.sessionDate,
      assessmentCategory: paper.categoryName as any,
      bookTitle: paper.bookTitle,
      unitName: paper.unitName,
      scope: paper.scope,
      timeLimitMinutes: paper.timeLimitMinutes,
      timeSpentMinutes: attempt.timeSpentMinutes,
      submittedAt: attempt.submittedAt,
      submissionMethod: attempt.submissionMethod,
      deviceInfo: attempt.deviceInfo,
      itemOutcomes: attempt.itemOutcomes.map(item => ({
        itemNo: item.itemNo,
        studentAnswer: item.studentAnswer,
        correctAnswer: item.correctAnswer,
        isCorrect: item.isCorrect,
        score: item.score,
        maxScore: item.maxScore,
        lectureKey: item.lectureKey,
        topicDescription: item.topicDescription
      })),
      teacherNotes: attempt.teacherNotes,
      nextAction: attempt.wrongCount && attempt.wrongCount > 0
        ? `오답 문항(${attempt.wrongItemNumbers.join(', ')}번) 클리닉지 인쇄 및 대면 풀이노트 검사`
        : '전문항 정답 완료'
    };
  }
}
