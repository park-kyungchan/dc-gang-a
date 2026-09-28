/**
 * Student Individual Database & Longitudinal Assessment Ledger Engine.
 * 
 * Domain Rules:
 * 1. Each student maintains an independent, append-only historical database (`DB_{studentName}` or `DB_{studentId}`).
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
  StudentCumulativeStats
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

export interface IngestAssessmentInput {
  studentId: StudentId;
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
  submissionMethod: 'academy_app' | 'paper_omr' | 'teacher_direct';
  deviceInfo?: string;
  itemOutcomes: AssessmentItemOutcome[];
  teacherNotes?: string;
  nextAction?: string;
}

export class StudentAssessmentLedgerEngine {
  // Keyed by StudentId -> Array of StudentAssessmentRecord
  private studentDatabases: Map<StudentId, StudentAssessmentRecord[]> = new Map();

  // Student metadata cache (StudentId -> { name, sheetTabName })
  private studentDirectory: Map<StudentId, { name: string; sheetTabName: string }> = new Map();

  constructor() {}

  /**
   * Register or ensure a student's individual DB tab exists.
   */
  public registerStudent(studentId: StudentId, name: string): string {
    const sheetTabName = `DB_${name}`;
    if (!this.studentDatabases.has(studentId)) {
      this.studentDatabases.set(studentId, []);
    }
    this.studentDirectory.set(studentId, { name, sheetTabName });
    return sheetTabName;
  }

  /**
   * Ingests a completed assessment into the student's individual database.
   * Calculates scores, item statistics, and SHA-256 checksum automatically.
   */
  public ingestAssessmentRecord(input: IngestAssessmentInput): StudentAssessmentRecord {
    const sheetTabName = this.registerStudent(input.studentId, input.studentName);

    if (!input.itemOutcomes || input.itemOutcomes.length === 0) {
      throw new Error(`Cannot ingest assessment without item outcomes. Received 0 questions.`);
    }

    const totalQuestions = input.itemOutcomes.length;
    let correctCount = 0;
    let totalScore = 0;
    const wrongItemNumbers: number[] = [];

    for (const item of input.itemOutcomes) {
      if (item.isCorrect) {
        correctCount++;
        totalScore += item.score;
      } else {
        wrongItemNumbers.push(item.itemNo);
      }
    }

    const wrongCount = totalQuestions - correctCount;
    const percentage = Number(((correctCount / totalQuestions) * 100).toFixed(1));

    // Determine default status and nextAction
    const status: AssessmentGradingStatus = wrongCount > 0 ? 'graded' : 'mastered';
    const nextAction = input.nextAction || (wrongCount > 0 
      ? `오답 문항(${wrongItemNumbers.join(', ')}번) 클리닉지 인쇄 및 해설강의 배정`
      : '전문항 정답 마스터 완료');

    // Generate unique recordId
    const dateCompact = input.sessionDate.replace(/-/g, '');
    const currentCount = (this.studentDatabases.get(input.studentId) || []).length + 1;
    const recordId = `asm_${dateCompact}_${input.studentId}_${String(currentCount).padStart(2, '0')}`;

    // Compute cryptographic SHA-256 hash of assessment facts
    const hashPayload = JSON.stringify({
      recordId,
      studentId: input.studentId,
      sessionDate: input.sessionDate,
      score: totalScore,
      correctCount,
      wrongItemNumbers,
      submittedAt: input.submittedAt
    });
    const checksum = createHash('sha256').update(hashPayload).digest('hex');

    const record: StudentAssessmentRecord = {
      recordId,
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
      itemOutcomes: input.itemOutcomes,
      status,
      deviceInfo: input.deviceInfo,
      teacherNotes: input.teacherNotes,
      nextAction,
      checksum
    };

    // Append to student's individual DB
    const studentHistory = this.studentDatabases.get(input.studentId)!;
    studentHistory.push(record);

    return record;
  }

  /**
   * Retrieves all historical assessment records for a student.
   */
  public getStudentHistory(studentId: StudentId): StudentAssessmentRecord[] {
    const records = this.studentDatabases.get(studentId);
    if (!records) return [];
    // Return a shallow clone of the array to prevent direct external mutation
    return [...records];
  }

  /**
   * Retrieves the most recent assessment record for a student.
   */
  public getLatestAssessment(studentId: StudentId): StudentAssessmentRecord | null {
    const history = this.studentDatabases.get(studentId);
    if (!history || history.length === 0) return null;
    return history[history.length - 1];
  }

  /**
   * Computes longitudinal cumulative statistics for a student.
   */
  public getCumulativeStats(studentId: StudentId): StudentCumulativeStats {
    const history = this.studentDatabases.get(studentId) || [];
    const meta = this.studentDirectory.get(studentId);
    const studentName = meta?.name || studentId;
    const sheetTabName = meta?.sheetTabName || `DB_${studentId}`;

    if (history.length === 0) {
      return {
        studentId,
        studentName,
        sheetTabName,
        totalAssessmentsCount: 0,
        cumulativeAverageScore: 0,
        unresolvedClinicsCount: 0,
        weakUnits: [],
        lastAssessedAt: ''
      };
    }

    const totalScoreSum = history.reduce((sum, r) => sum + r.score, 0);
    const cumulativeAverageScore = Number((totalScoreSum / history.length).toFixed(1));
    const unresolvedClinicsCount = history.filter(r => r.status === 'graded' || r.status === 'clinic_assigned').length;

    // Detect weak units (units with average score < 85%)
    const unitScores: Map<string, { total: number; count: number }> = new Map();
    for (const r of history) {
      const entry = unitScores.get(r.unitName) || { total: 0, count: 0 };
      entry.total += r.percentage;
      entry.count += 1;
      unitScores.set(r.unitName, entry);
    }

    const weakUnits: string[] = [];
    for (const [unit, data] of unitScores.entries()) {
      if (data.total / data.count < 85) {
        weakUnits.push(unit);
      }
    }

    return {
      studentId,
      studentName,
      sheetTabName,
      totalAssessmentsCount: history.length,
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
    const hashPayload = JSON.stringify({
      recordId: record.recordId,
      studentId: record.studentId,
      sessionDate: record.sessionDate,
      score: record.score,
      correctCount: record.correctCount,
      wrongItemNumbers: record.wrongItemNumbers,
      submittedAt: record.submittedAt
    });
    const expectedChecksum = createHash('sha256').update(hashPayload).digest('hex');
    return record.checksum === expectedChecksum;
  }

  /**
   * Exports the entire student database into Google Sheets 2D row array for tabular sync.
   */
  public exportStudentDbRows(studentId: StudentId): (string | number)[][] {
    const history = this.studentDatabases.get(studentId) || [];
    return history.map(rec => [
      rec.sessionDate,
      rec.enrolledGroup,
      rec.assessmentCategory,
      rec.bookTitle,
      rec.unitName,
      rec.scope,
      rec.timeLimitMinutes,
      rec.timeSpentMinutes,
      rec.totalQuestions,
      rec.correctCount,
      rec.wrongCount,
      rec.score,
      `${rec.percentage}%`,
      rec.wrongItemNumbers.length > 0 ? rec.wrongItemNumbers.join(', ') : '없음',
      rec.status,
      rec.nextAction || '',
      rec.checksum.substring(0, 12) // Short hash for sheet audit display
    ]);
  }
}
