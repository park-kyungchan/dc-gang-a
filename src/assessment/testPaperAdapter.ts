/**
 * Test Paper & Assessment Attempt Adapter.
 *
 * Bridges an independently verified source read to the local assessment ledger.
 * This pure adapter performs no LMS or database request and cannot certify a
 * caller-supplied object as authentic.
 */

import type { IngestAssessmentInput } from './studentAssessmentLedger';
import type { LmsStudentAttemptContract, LmsTestPaperContract } from '../lms/lmsBackendContracts';
import type { AssessmentCategory } from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';
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

    const live = attempt.verificationStatus === 'verified_live' &&
      attempt.isVerifiedLive && attempt.dataSource === 'LIVE_LMS' &&
      paper.provenance === 'LIVE_LMS';
    const snapshot = attempt.verificationStatus === 'verified_snapshot' &&
      !attempt.isVerifiedLive && attempt.dataSource === 'VERIFIED_SNAPSHOT' &&
      paper.provenance === 'VERIFIED_SNAPSHOT';
    if (!live && !snapshot) {
      throw new JoinError('Assessment source and verification status are not consistently verified.');
    }
    if (!attempt.testingNo?.trim() || !attempt.attemptId.trim() ||
        !attempt.studentId.trim() || !attempt.submittedAt.trim() ||
        attempt.score === null || attempt.correctCount === null ||
        attempt.wrongCount === null || attempt.itemOutcomes.length === 0 ||
        attempt.itemOutcomes.length !== attempt.totalQuestions ||
        attempt.correctCount + attempt.wrongCount !== attempt.totalQuestions) {
      throw new JoinError('Exact attempt key, source timestamp, and complete graded items are required.');
    }
    const categories: ReadonlySet<AssessmentCategory> = new Set([
      '대단원총괄평가', 'DailyTest', 'ZeroTest', '주간클리닉',
      '진단평가', '개념백지테스트'
    ]);
    if (!categories.has(paper.categoryName as AssessmentCategory)) {
      throw new JoinError('Assessment category is not recognized by the local ledger.');
    }

    return {
      pNo: attempt.pNo,
      studentId: attempt.studentId,
      sourceRecordId: attempt.attemptId,
      gradeVerification: 'verified',
      verificationEvidence: {
        studentId: attempt.studentId,
        pNo: attempt.pNo,
        sourceRecordId: attempt.attemptId,
        sourceAttemptId: attempt.testingNo,
        sourceTimestamp: attempt.submittedAt
      },
      studentName: attempt.studentName,
      enrolledGroup: attempt.enrolledGroup,
      sessionDate: attempt.sessionDate,
      assessmentCategory: paper.categoryName as AssessmentCategory,
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
      nextAction: '강사 최종 확인 필요'
    };
  }
}
