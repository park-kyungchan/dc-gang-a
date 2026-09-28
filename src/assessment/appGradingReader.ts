/**
 * Pure normalizer for an already obtained academy app grading payload.
 *
 * This module does not connect to the academy backend and exposes no live read
 * route. Backend access must be implemented and reviewed separately once its
 * authorized, verified read contract is known. Synthetic payloads belong in
 * test fixtures, never in production source.
 */

import type {
  AssessmentCategory,
  AssessmentItemOutcome,
  AssessmentVerificationEvidence,
  StudentId,
  ClassGroupId
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';
import type { IngestAssessmentInput } from './studentAssessmentLedger';

export interface RawAppQuestionSubmission {
  questionNo: number;
  submittedAnswer: string;
  correctAnswer: string;
  points: number;
  lectureKey?: string;
  topic?: string;
}

export interface RawAppAssessmentSubmission {
  studentId: StudentId;
  sourceRecordId?: string;
  studentName: string;
  enrolledGroup: ClassGroupId;
  sessionDate: string; // YYYY-MM-DD
  assessmentCategory: AssessmentCategory;
  bookTitle: string;
  unitName: string;
  scope: string;
  timeLimitMinutes: number;
  timeSpentMinutes: number;
  submittedAt: string; // ISO 8601
  gradeVerification?: 'verified' | 'unknown';
  verificationEvidence?: AssessmentVerificationEvidence;
  deviceInfo?: string;
  questions: RawAppQuestionSubmission[];
}

export class AppGradingReader {
  /**
   * Pure normalization function. Converts a supplied payload into a structured
   * ledger input without performing network, LMS, database, or Sheet access.
   */
  public static normalizeAppSubmission(raw: RawAppAssessmentSubmission): IngestAssessmentInput {
    if ((!raw.questions || raw.questions.length === 0) && raw.gradeVerification === 'verified') {
      throw new Error(`Empty app submission received for student ${raw.studentId}.`);
    }

    const itemOutcomes: AssessmentItemOutcome[] = raw.gradeVerification !== 'verified' ? [] : raw.questions.map(q => {
      const isCorrect = String(q.submittedAnswer).trim() === String(q.correctAnswer).trim();
      return {
        itemNo: q.questionNo,
        studentAnswer: String(q.submittedAnswer).trim(),
        correctAnswer: String(q.correctAnswer).trim(),
        isCorrect,
        score: isCorrect ? q.points : 0,
        maxScore: q.points,
        lectureKey: q.lectureKey,
        topicDescription: q.topic
      };
    });

    return {
      studentId: raw.studentId,
      sourceRecordId: raw.sourceRecordId,
      studentName: raw.studentName,
      enrolledGroup: raw.enrolledGroup,
      sessionDate: raw.sessionDate,
      assessmentCategory: raw.assessmentCategory,
      bookTitle: raw.bookTitle,
      unitName: raw.unitName,
      scope: raw.scope,
      timeLimitMinutes: raw.timeLimitMinutes,
      timeSpentMinutes: raw.timeSpentMinutes,
      submittedAt: raw.submittedAt,
      gradeVerification: raw.gradeVerification,
      verificationEvidence: raw.verificationEvidence,
      submissionMethod: 'academy_app',
      deviceInfo: raw.deviceInfo,
      itemOutcomes
    };
  }
}
