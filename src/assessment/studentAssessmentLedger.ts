/**
 * In-memory, student-partitioned longitudinal assessment ledger.
 * 
 * Domain Rules:
 * 1. Each opaque student ID partitions append-only history in memory; sheet tabs are not created here.
 * 2. All assessment records (대단원 총괄평가, Daily Test, Zero Test, 클리닉 등) accumulate longitudinally.
 * 3. Each record maintains cryptographic SHA-256 checksums to detect grade tampering.
 * 4. Read-only app grading feeds are ingested without destructive overwrites of historical records.
 * 5. Cumulative statistics (average score, weak units, unresolved clinics) are projected dynamically.
 */

import { createHash } from 'crypto';
import type {
  StudentId,
  ClassGroupId,
  AssessmentCategory,
  AssessmentGradingStatus,
  AssessmentItemOutcome,
  StudentAssessmentRecord,
  StudentCumulativeStats,
  AssessmentCorrectionReviewEvent,
  AssessmentVerificationEvidence
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

export interface IngestAssessmentInput {
  studentId: StudentId;
  pNo?: string;
  sourceRecordId?: string;
  verificationEvidence?: AssessmentVerificationEvidence;
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
  submissionMethod: 'academy_app' | 'paper_omr' | 'teacher_direct';
  deviceInfo?: string;
  itemOutcomes?: AssessmentItemOutcome[];
  teacherNotes?: string;
  nextAction?: string;
}

export interface AssessmentCorrectionReviewInput {
  teacherId: string;
  reviewedAt: string;
  reviewedWrongItemNumbers: readonly number[];
  teacherNotes: string;
}

export class StudentAssessmentLedgerEngine {
  // Keyed by StudentId -> Array of StudentAssessmentRecord
  private studentHistories: Map<StudentId, StudentAssessmentRecord[]> = new Map();

  // Assessment facts remain immutable. Corrections are appended as separate events.
  private studentDirectory: Map<StudentId, string> = new Map();
  private correctionEvents: Map<StudentId, AssessmentCorrectionReviewEvent[]> = new Map();

  constructor() {}

  /**
   * Register a student's opaque ID and display name in the in-memory ledger.
   */
  public registerStudent(studentId: StudentId, name: string): void {
    if (!this.studentHistories.has(studentId)) {
      this.studentHistories.set(studentId, []);
    }
    this.studentDirectory.set(studentId, name);
  }

  /**
   * Ingests an assessment into the in-memory partition for its opaque student ID.
   * Calculates scores, item statistics, and SHA-256 checksum automatically.
   */
  public ingestAssessmentRecord(input: IngestAssessmentInput): StudentAssessmentRecord {
    this.registerStudent(input.studentId, input.studentName);
    const existingHistory = this.studentHistories.get(input.studentId)!;
    if (input.sourceRecordId && existingHistory.some(record => record.sourceRecordId === input.sourceRecordId)) {
      throw new Error(`Source assessment ${input.sourceRecordId} is already present for student ${input.studentId}.`);
    }

    const gradeVerification = input.gradeVerification ?? 'unknown';
    const sourceItems = input.itemOutcomes ?? [];
    if (gradeVerification === 'verified') {
      const proof = input.verificationEvidence;
      if (
        !input.sourceRecordId?.trim() ||
        !input.submittedAt.trim() ||
        !proof ||
        proof.studentId !== input.studentId ||
        (input.submissionMethod === 'academy_app' && (!input.pNo?.trim() || proof.pNo !== input.pNo)) ||
        proof.sourceRecordId !== input.sourceRecordId ||
        proof.sourceTimestamp !== input.submittedAt ||
        !proof.sourceAttemptId.trim()
      ) {
        throw new Error('Verified grades require an exact student, attempt, source record ID, and source timestamp join proof.');
      }
    }
    if (gradeVerification === 'verified' && sourceItems.length === 0) {
      throw new Error('Cannot ingest a verified assessment without item outcomes.');
    }

    const itemOutcomes = gradeVerification === 'verified'
      ? sourceItems.map(item => ({ ...item }))
      : null;
    const totalQuestions = itemOutcomes?.length ?? null;
    let correctCount: number | null = null;
    let totalScore: number | null = null;
    let wrongCount: number | null = null;
    let percentage: number | null = null;
    let wrongItemNumbers: number[] | null = null;

    if (itemOutcomes) {
      correctCount = 0;
      totalScore = 0;
      wrongItemNumbers = [];
      for (const item of itemOutcomes) {
        if (item.isCorrect) {
          correctCount += 1;
          totalScore += item.score;
        } else {
          wrongItemNumbers.push(item.itemNo);
        }
      }
      wrongCount = totalQuestions! - correctCount;
      percentage = Number(((correctCount / totalQuestions!) * 100).toFixed(1));
    }

    const status: AssessmentGradingStatus = gradeVerification === 'unknown' ? 'unverified' : 'graded';
    const nextAction = input.nextAction || (gradeVerification === 'unknown'
      ? '성적 확인 대기'
      : '강사 최종 확인 필요');

    const dateCompact = input.sessionDate.replace(/-/g, '');
    const recordId = `asm_${dateCompact}_${input.studentId}_${String(existingHistory.length + 1).padStart(2, '0')}`;
    const checksum = this.calculateRecordChecksum({
      recordId,
      pNo: input.pNo,
      sourceRecordId: input.sourceRecordId,
      sourceAttemptId: input.verificationEvidence?.sourceAttemptId,
      studentId: input.studentId,
      sessionDate: input.sessionDate,
      submittedAt: input.submittedAt,
      score: totalScore,
      correctCount,
      wrongItemNumbers,
      itemOutcomes
    });

    const record: StudentAssessmentRecord = {
      recordId,
      pNo: input.pNo,
      sourceRecordId: input.sourceRecordId,
      sourceAttemptId: input.verificationEvidence?.sourceAttemptId,
      studentId: input.studentId,
      studentName: input.studentName,
      enrolledGroup: input.enrolledGroup,
      sessionDate: input.sessionDate,
      assessmentCategory: input.assessmentCategory,
      bookTitle: input.bookTitle,
      unitName: input.unitName,
      scope: input.scope,
      timeLimitMinutes: input.timeLimitMinutes,
      timeSpentMinutes: input.timeSpentMinutes,
      submittedAt: input.submittedAt,
      submissionMethod: input.submissionMethod,
      totalQuestions,
      correctCount,
      wrongCount,
      score: totalScore,
      percentage,
      wrongItemNumbers,
      itemOutcomes,
      status,
      deviceInfo: input.deviceInfo,
      teacherNotes: input.teacherNotes,
      nextAction,
      checksum
    };

    existingHistory.push(record);
    return {
      ...record,
      wrongItemNumbers: record.wrongItemNumbers ? [...record.wrongItemNumbers] : null,
      itemOutcomes: record.itemOutcomes?.map(item => ({ ...item })) ?? null
    };
  }

  /**
   * Retrieves all historical assessment records for a student.
   */
  public getStudentHistory(studentId: StudentId): StudentAssessmentRecord[] {
    const records = this.studentHistories.get(studentId);
    if (!records) return [];
    const events = this.correctionEvents.get(studentId) ?? [];
    return records.map(record => this.projectEffectiveRecord(record, events));
  }

  /**
   * Retrieves the most recent assessment record for a student.
   */
  public getLatestAssessment(studentId: StudentId): StudentAssessmentRecord | null {
    const history = this.studentHistories.get(studentId);
    if (!history || history.length === 0) return null;
    return this.projectEffectiveRecord(history[history.length - 1], this.correctionEvents.get(studentId) ?? []);
  }

  /**
   * Appends a teacher correction-review event without changing the assessment record.
   */
  public markAssessmentCorrectionsCompleted(
    studentId: StudentId,
    recordId: string,
    review: AssessmentCorrectionReviewInput
  ): StudentAssessmentRecord {
    const history = this.studentHistories.get(studentId);
    if (!history) {
      throw new Error(`Student ${studentId} not found in assessment ledger.`);
    }

    const record = history.find(r => r.recordId === recordId);
    if (!record) {
      throw new Error(`Assessment record ${recordId} not found for student ${studentId}.`);
    }

    if (record.status === 'unverified' || record.wrongItemNumbers === null || record.wrongItemNumbers.length === 0) {
      throw new Error(`Assessment record ${recordId} has no verified clinic work to review.`);
    }

    if (!review.teacherId.trim() || !review.teacherNotes.trim()) {
      throw new Error('Teacher ID and review notes are required to record correction review.');
    }
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(review.reviewedAt) || !Number.isFinite(Date.parse(review.reviewedAt))) {
      throw new Error('Correction review time must be an ISO timestamp with an explicit UTC offset.');
    }
    const expectedItems = [...record.wrongItemNumbers].sort((a, b) => a - b);
    const reviewedItems = [...review.reviewedWrongItemNumbers].sort((a, b) => a - b);
    if (
      reviewedItems.length !== expectedItems.length ||
      new Set(reviewedItems).size !== reviewedItems.length ||
      reviewedItems.some((itemNo, index) => itemNo !== expectedItems[index])
    ) {
      throw new Error('Reviewed wrong-item numbers must exactly match the verified assessment wrong items.');
    }

    const events = this.correctionEvents.get(studentId) ?? [];
    const priorReviewsForRecord = events.filter(event => event.assessmentRecordId === recordId).length;
    const event: AssessmentCorrectionReviewEvent = {
      eventId: `review_${recordId}_${String(priorReviewsForRecord + 1).padStart(2, '0')}`,
      studentId,
      assessmentRecordId: recordId,
      teacherId: review.teacherId,
      reviewedAt: review.reviewedAt,
      reviewedWrongItemNumbers: [...reviewedItems],
      status: 'clinic_completed',
      teacherNotes: review.teacherNotes,
      nextAction: '강사 다음 조치 확인 필요'
    };
    events.push(event);
    this.correctionEvents.set(studentId, events);
    return this.projectEffectiveRecord(record, events);
  }

  public getCorrectionHistory(studentId: StudentId): AssessmentCorrectionReviewEvent[] {
    return (this.correctionEvents.get(studentId) ?? []).map(event => ({ ...event }));
  }

  /**
   * Computes longitudinal cumulative statistics for a student.
   */
  public getCumulativeStats(studentId: StudentId, weakUnitThresholdPercent?: number): StudentCumulativeStats {
    if (weakUnitThresholdPercent !== undefined &&
      (!Number.isFinite(weakUnitThresholdPercent) || weakUnitThresholdPercent < 0 || weakUnitThresholdPercent > 100)) {
      throw new Error('Weak-unit threshold must be a caller-provided percentage from 0 to 100.');
    }
    const history = this.getStudentHistory(studentId);
    const studentName = this.studentDirectory.get(studentId) || studentId;

    if (history.length === 0) {
      return {
        studentId,
        studentName,
        totalAssessmentsCount: 0,
        verifiedAssessmentsCount: 0,
        cumulativeAverageScore: null,
        unresolvedClinicsCount: 0,
        weakUnits: weakUnitThresholdPercent === undefined ? null : [],
        lastAssessedAt: ''
      };
    }

    const verifiedHistory = history.filter((record): record is StudentAssessmentRecord & { score: number; percentage: number } =>
      record.score !== null && record.percentage !== null
    );
    const totalScoreSum = verifiedHistory.reduce((sum, record) => sum + record.score, 0);
    const cumulativeAverageScore = verifiedHistory.length === 0
      ? null
      : Number((totalScoreSum / verifiedHistory.length).toFixed(1));
    const unresolvedClinicsCount = history.filter(record =>
      record.status !== 'clinic_completed' &&
      record.wrongItemNumbers !== null && record.wrongItemNumbers.length > 0
    ).length;

    // Weak-unit classification is omitted until a teacher supplies a threshold.
    const unitScores: Map<string, { total: number; count: number }> = new Map();
    if (weakUnitThresholdPercent !== undefined) {
      for (const r of verifiedHistory) {
        const entry = unitScores.get(r.unitName) || { total: 0, count: 0 };
        entry.total += r.percentage;
        entry.count += 1;
        unitScores.set(r.unitName, entry);
      }
    }

    const weakUnits: string[] | null = weakUnitThresholdPercent === undefined ? null : [];
    if (weakUnits) {
      for (const [unit, data] of unitScores.entries()) {
        if (data.total / data.count < weakUnitThresholdPercent!) {
          weakUnits.push(unit);
        }
      }
    }

    return {
      studentId,
      studentName,
      totalAssessmentsCount: history.length,
      verifiedAssessmentsCount: verifiedHistory.length,
      cumulativeAverageScore,
      unresolvedClinicsCount,
      weakUnits,
      lastAssessedAt: history[history.length - 1].submittedAt
    };
  }

  /**
   * Verifies that a record's checksum matches its contents (tamper detection).
   */
  public verifyRecordIntegrity(record: StudentAssessmentRecord): boolean {
    return record.checksum === this.calculateRecordChecksum(record);
  }

  private calculateRecordChecksum(record: Pick<StudentAssessmentRecord,
    'recordId' | 'pNo' | 'sourceRecordId' | 'sourceAttemptId' | 'studentId' | 'sessionDate' | 'submittedAt' |
    'score' | 'correctCount' | 'wrongItemNumbers' | 'itemOutcomes'>): string {
    const hashPayload = JSON.stringify({
      recordId: record.recordId,
      pNo: record.pNo,
      sourceRecordId: record.sourceRecordId,
      sourceAttemptId: record.sourceAttemptId,
      studentId: record.studentId,
      sessionDate: record.sessionDate,
      submittedAt: record.submittedAt,
      score: record.score,
      correctCount: record.correctCount,
      wrongItemNumbers: record.wrongItemNumbers,
      itemOutcomes: record.itemOutcomes
    });
    return createHash('sha256').update(hashPayload).digest('hex');
  }

  private projectEffectiveRecord(
    record: StudentAssessmentRecord,
    events: AssessmentCorrectionReviewEvent[]
  ): StudentAssessmentRecord {
    const latestReview = [...events].reverse().find(event => event.assessmentRecordId === record.recordId);
    const copy: StudentAssessmentRecord = {
      ...record,
      wrongItemNumbers: record.wrongItemNumbers ? [...record.wrongItemNumbers] : null,
      itemOutcomes: record.itemOutcomes?.map(item => ({ ...item })) ?? null
    };
    if (!latestReview) return copy;
    return {
      ...copy,
      status: latestReview.status,
      teacherNotes: latestReview.teacherNotes,
      nextAction: latestReview.nextAction
    };
  }
}
