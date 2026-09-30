/**
 * Local LMS evidence cache and key-join model.
 *
 * Stores caller-supplied evidence for deterministic local queries. It performs
 * no HTTP or database read and must not promote a student grade.
 *
 * Local query keys:
 * 1. LMS Exam Papers (indexed by pNo, e.g. "opaque-id")
 * 2. Student Assessment Attempts (joined by studentId + pNo)
 * 3. Prestudy Video Statuses (joined by studentId + lookbackDate)
 *
 * Invariants:
 * - Deterministic: Same input query produces identical output.
 * - Anti-Hallucination: Pending/unverified attempts return `score: null` and `isVerifiedLive: false`.
 * - No live LMS access: registration below accepts synthetic papers only.
 */

import { createHash } from 'crypto';
import type { StudentId, ClassGroupId } from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';
import type {
  LmsTestPaperContract,
  LmsTestPaperItem,
  LmsStudentAttemptContract,
  LmsPrestudyVideoContract,
  LmsDataSource
} from './lmsBackendContracts';

export class JoinError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JoinError';
  }
}

export class LmsDeterministicReadRepository {
  // Registry of known LMS Exam Papers (Key: pNo)
  private testPapers: Map<string, LmsTestPaperContract> = new Map();

  // Registry of synthetic student assessment attempts (unambiguous tuple key)
  private studentAttempts: Map<string, LmsStudentAttemptContract> = new Map();

  // No production pre-study read contract is connected to this cache.
  private prestudyVideos: Map<string, LmsPrestudyVideoContract> = new Map();

  constructor() {}

  // ==========================================================================
  // Public Query API (Pure Read-Only)
  // ==========================================================================

  /**
   * Retrieves an LMS Test Paper by its canonical unique identifier (`pNo`).
   */
  public getTestPaper(pNo: string): LmsTestPaperContract | null {
    if (!pNo || typeof pNo !== 'string') {
      throw new JoinError(`Invalid pNo provided: ${pNo}`);
    }
    const paper = this.testPapers.get(pNo.trim());
    return paper ? { ...paper, items: paper.items.map(item => ({ ...item })) } : null;
  }

  /**
   * Retrieves a student's assessment attempt for a given paper (`pNo`).
   */
  public getStudentAttempt(studentId: StudentId, pNo: string): LmsStudentAttemptContract | null {
    if (!studentId || !pNo) {
      throw new JoinError(`studentId and pNo are both mandatory for attempt lookup.`);
    }
    const key = JSON.stringify([studentId, pNo.trim()]);
    const attempt = this.studentAttempts.get(key);
    return attempt ? {
      ...attempt,
      wrongItemNumbers: [...attempt.wrongItemNumbers],
      itemOutcomes: attempt.itemOutcomes.map(item => ({ ...item }))
    } : null;
  }

  /**
   * Lists all registered test papers, optionally filtered by book title.
   */
  public listTestPapers(bookTitleFilter?: string): LmsTestPaperContract[] {
    const all = Array.from(this.testPapers.values());
    const selected = bookTitleFilter ? all.filter(p => p.bookTitle === bookTitleFilter) : all;
    return selected.map(paper => ({ ...paper, items: paper.items.map(item => ({ ...item })) }));
  }

  /**
   * Retrieves prestudy video submission status for a student on a specific date.
   */
  public getPrestudyVideoStatus(studentId: StudentId, date: string): LmsPrestudyVideoContract | null {
    const key = `${studentId}_${date}`;
    const status = this.prestudyVideos.get(key);
    return status ? { ...status } : null;
  }

  // ==========================================================================
  // Ingestion & Verification Registration (Controlled Data Feeds)
  // ==========================================================================

  /**
   * Registers a test paper into the repository.
   */
  public registerTestPaper(paper: LmsTestPaperContract): void {
    if (paper.provenance !== 'SYNTHETIC_HARNESS') {
      throw new JoinError('Live or verified paper registration requires a reviewed source read contract.');
    }
    if (!paper.pNo?.trim() || paper.items.length === 0) {
      throw new JoinError(`Cannot register test paper without valid pNo and items.`);
    }
    const copy = { ...paper, items: paper.items.map(item => ({ ...item })) };
    copy.checksum = this.computeChecksum(copy.pNo, copy.items);
    this.testPapers.set(copy.pNo, copy);
  }

  /**
   * Registers an unverified pending student attempt.
   * Invariant: score, correctCount, wrongCount are strictly null.
   */
  public registerPendingAttempt(params: {
    pNo: string;
    studentId: StudentId;
    studentName: string;
    enrolledGroup: ClassGroupId;
    sessionDate: string;
    submittedAt: string;
    timeSpentMinutes: number;
    submissionMethod: 'academy_app' | 'paper_omr' | 'teacher_direct';
    deviceInfo?: string;
  }): LmsStudentAttemptContract {
    const paper = this.getTestPaper(params.pNo);
    if (!paper) {
      throw new JoinError(`Cannot register attempt for unknown paper pNo: ${params.pNo}`);
    }

    const attemptId = `SYN_ATT_${params.sessionDate.replace(/-/g, '')}_${params.pNo}_${params.studentId}`;
    const key = JSON.stringify([params.studentId, params.pNo]);

    const checksum = createHash('sha256').update(JSON.stringify({
      attemptId,
      pNo: params.pNo,
      studentId: params.studentId,
      status: 'pending_verification'
    })).digest('hex');

    const attempt: LmsStudentAttemptContract = {
      attemptId,
      pNo: params.pNo,
      studentId: params.studentId,
      studentName: params.studentName,
      enrolledGroup: params.enrolledGroup,
      sessionDate: params.sessionDate,
      submittedAt: params.submittedAt,
      timeSpentMinutes: params.timeSpentMinutes,
      submissionMethod: params.submissionMethod,
      isVerifiedLive: false,
      verificationStatus: 'unverified_synthetic',
      dataSource: 'SYNTHETIC_HARNESS',
      score: null,
      totalQuestions: paper.totalQuestions,
      correctCount: null,
      wrongCount: null,
      percentage: null,
      wrongItemNumbers: [],
      itemOutcomes: [],
      deviceInfo: params.deviceInfo,
      teacherNotes: undefined,
      checksum
    };

    this.studentAttempts.set(key, attempt);
    return {
      ...attempt,
      wrongItemNumbers: [...attempt.wrongItemNumbers],
      itemOutcomes: attempt.itemOutcomes.map(item => ({ ...item }))
    };
  }

  /** No live result contract is implemented; verification cannot be inferred locally. */
  public confirmVerifiedAttempt(_params: unknown): never {
    throw new JoinError("A verified LMS/app result read contract is required before confirming an attempt.");
  }

  /**
   * Helper to compute cryptographic checksum for a test paper.
   */
  private computeChecksum(pNo: string, items: LmsTestPaperItem[]): string {
    return createHash('sha256')
      .update(JSON.stringify({ pNo, items: items.map(item => ({
        itemNo: item.itemNo,
        lectureKey: item.lectureKey,
        points: item.points,
        correctAnswer: item.correctAnswer,
        topicDescription: item.topicDescription,
        difficulty: item.difficulty ?? null
      })) }))
      .digest('hex');
  }
}
