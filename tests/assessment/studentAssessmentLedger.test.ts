import { describe, it, expect, beforeEach } from 'bun:test';
import { StudentAssessmentLedgerEngine } from '../../src/assessment/studentAssessmentLedger';
import { AppGradingReader } from '../../src/assessment/appGradingReader';
import { MainSheetAssessmentProjector } from '../../src/sheets/mainSheetAssessmentProjector';
import {
  syntheticAlphaGradingPayload,
  syntheticBetaGradingPayload,
  syntheticGammaGradingPayload
} from './appGradingFixtures';

describe('Student-partitioned assessment ledger and Main-tab projection', () => {
  let ledger: StudentAssessmentLedgerEngine;

  beforeEach(() => {
    ledger = new StudentAssessmentLedgerEngine();
  });

  describe('DIM-06: Student partitioning and ingestion', () => {
    it('normalizes synthetic app grading input without exposing a live read route', () => {
      const methods = Object.getOwnPropertyNames(AppGradingReader).filter(name =>
        name !== 'length' && name !== 'name' && name !== 'prototype' &&
        typeof (AppGradingReader as unknown as Record<string, unknown>)[name] === 'function'
      );
      expect(methods).toEqual(['normalizeAppSubmission']);

      const raw = syntheticAlphaGradingPayload;
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.recordId).toContain('asm_20990101_TEST-STUDENT-ALPHA_');
      expect(record.studentId).toBe('TEST-STUDENT-ALPHA');
      expect(record.sourceRecordId).toBe('TEST-SOURCE-ALPHA');
      expect(record.sourceAttemptId).toBe('TEST-ATTEMPT-ALPHA');
      expect(record.studentName).toBe('Synthetic Student ALPHA');
      expect(record.score).toBe(90);
      expect(record.totalQuestions).toBe(20);
      expect(record.correctCount).toBe(18);
      expect(record.wrongCount).toBe(2);
      expect(record.percentage).toBe(90.0);
      expect(record.wrongItemNumbers).toEqual([7, 14]);
      expect(record.status).toBe('graded');
      expect(record.submissionMethod).toBe('academy_app');

      // Verify student-ID partition retrieval
      const history = ledger.getStudentHistory('TEST-STUDENT-ALPHA');
      expect(history.length).toBe(1);
      expect(history[0].recordId).toBe(record.recordId);
      record.wrongItemNumbers?.push(999);
      expect(ledger.getStudentHistory('TEST-STUDENT-ALPHA')[0].wrongItemNumbers).toEqual([7, 14]);
    });

    it('ingests a second synthetic grading fixture with one incorrect answer', () => {
      const raw = syntheticBetaGradingPayload;
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.studentId).toBe('TEST-STUDENT-BETA');
      expect(record.studentName).toBe('Synthetic Student BETA');
      expect(record.bookTitle).toBe('Synthetic Workbook');
      expect(record.scope).toBe('Synthetic questions 1-20');
      expect(record.score).toBe(95);
      expect(record.correctCount).toBe(19);
      expect(record.wrongCount).toBe(1);
      expect(record.wrongItemNumbers).toEqual([12]);
      expect(record.status).toBe('graded');

      const history = ledger.getStudentHistory('TEST-STUDENT-BETA');
      expect(history.length).toBe(1);
    });

    it('keeps synthetic assessment histories partitioned by opaque student ID', () => {
      const alpha = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(syntheticAlphaGradingPayload));
      const beta = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(syntheticBetaGradingPayload));

      expect(ledger.getStudentHistory('TEST-STUDENT-ALPHA').map(record => record.recordId)).toEqual([alpha.recordId]);
      expect(ledger.getStudentHistory('TEST-STUDENT-BETA').map(record => record.recordId)).toEqual([beta.recordId]);
    });

    it('keeps clean auto-grades awaiting teacher review without assigning clinic or mastery', () => {
      const raw = {
        ...syntheticBetaGradingPayload,
        questions: syntheticBetaGradingPayload.questions.map(question => ({
          ...question,
          submittedAnswer: question.correctAnswer
        }))
      };
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      expect(record.wrongCount).toBe(0);
      expect(record.status).toBe('graded');
      expect(record.nextAction).toBe('강사 최종 확인 필요');
      expect(ledger.getCumulativeStats(record.studentId).unresolvedClinicsCount).toBe(0);
      expect(MainSheetAssessmentProjector.projectRow(record).statusBadge).toBe('🟡 강사확인필요');
    });

    it('fails closed when a caller claims verification without an exact source join proof', () => {
      const raw = { ...syntheticAlphaGradingPayload, verificationEvidence: undefined };
      expect(() => ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw)))
        .toThrow('Verified grades require an exact student, attempt, source record ID, and source timestamp join proof.');
    });

    it('ingests a third synthetic grading fixture with three incorrect answers', () => {
      const raw = syntheticGammaGradingPayload;
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.studentId).toBe('TEST-STUDENT-GAMMA');
      expect(record.studentName).toBe('Synthetic Student GAMMA');
      expect(record.bookTitle).toBe('Synthetic Workbook');
      expect(record.scope).toBe('Synthetic questions 1-20');
      expect(record.score).toBe(85);
      expect(record.totalQuestions).toBe(20);
      expect(record.correctCount).toBe(17);
      expect(record.wrongCount).toBe(3);
      expect(record.wrongItemNumbers).toEqual([5, 11, 19]);
      expect(record.status).toBe('graded');

      const history = ledger.getStudentHistory('TEST-STUDENT-GAMMA');
      expect(history.length).toBe(1);
      expect(ledger.verifyRecordIntegrity(record)).toBe(true);
    });

    it('verifies cryptographic SHA-256 integrity and catches grade tampering', () => {
      const raw = syntheticAlphaGradingPayload;
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      // Untampered check
      expect(ledger.verifyRecordIntegrity(record)).toBe(true);

      // Tampered check (e.g. someone manually changed score 90 -> 100)
      const tamperedRecord = { ...record, score: 100 };
      expect(ledger.verifyRecordIntegrity(tamperedRecord)).toBe(false);
    });
  });

  describe('DIM-07: Longitudinal Accumulation & Cumulative Statistics', () => {
    it('accumulates multiple assessments over time without overwriting history', () => {
      // Session 1: synthetic historical assessment
      ledger.ingestAssessmentRecord({
        studentId: 'TEST-STUDENT-ALPHA',
        sourceRecordId: 'TEST-SOURCE-ALPHA-HISTORICAL',
        studentName: 'Synthetic Student ALPHA',
        enrolledGroup: '2',
        sessionDate: '2098-12-25',
        assessmentCategory: 'DailyTest',
        bookTitle: 'Synthetic Workbook',
        unitName: 'Synthetic Unit',
        scope: 'Synthetic questions 1-2',
        timeLimitMinutes: 20,
        timeSpentMinutes: 18,
        submittedAt: '2098-12-25T10:00:00+09:00',
        gradeVerification: 'verified',
        verificationEvidence: {
          studentId: 'TEST-STUDENT-ALPHA',
          sourceRecordId: 'TEST-SOURCE-ALPHA-HISTORICAL',
          sourceAttemptId: 'TEST-ATTEMPT-ALPHA-HISTORICAL',
          sourceTimestamp: '2098-12-25T10:00:00+09:00'
        },
        submissionMethod: 'academy_app',
        itemOutcomes: [
          { itemNo: 1, studentAnswer: '1', correctAnswer: '1', isCorrect: true, score: 50, maxScore: 50 },
          { itemNo: 2, studentAnswer: '2', correctAnswer: '3', isCorrect: false, score: 0, maxScore: 50 }
        ]
      });

      // Session 2: synthetic comprehensive assessment
      const raw = syntheticAlphaGradingPayload;
      ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      const history = ledger.getStudentHistory('TEST-STUDENT-ALPHA');
      expect(history.length).toBe(2);
      expect(history[0].sessionDate).toBe('2098-12-25');
      expect(history[1].sessionDate).toBe('2099-01-01');

      // Cumulative stats
      const stats = ledger.getCumulativeStats('TEST-STUDENT-ALPHA');
      expect(stats.totalAssessmentsCount).toBe(2);
      expect(stats.verifiedAssessmentsCount).toBe(2);
      // Avg: (50 + 90) / 2 = 70.0
      expect(stats.cumulativeAverageScore).toBe(70.0);
      expect(stats.weakUnits).toBeNull();
      expect(ledger.getCumulativeStats('TEST-STUDENT-ALPHA', 85).weakUnits).toContain('Synthetic Unit');
      expect(stats.unresolvedClinicsCount).toBe(2);
    });

    it('preserves source IDs and timestamps and keeps unverified grades unknown', () => {
      const { gradeVerification: _gradeVerification, verificationEvidence: _verificationEvidence, ...unverifiedFixture } = syntheticAlphaGradingPayload;
      const raw = {
        ...unverifiedFixture,
        sourceRecordId: 'source-assessment-alpha-001',
        submittedAt: '2099-01-01T11:59:58+09:00',
        questions: []
      };
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));
      const row = MainSheetAssessmentProjector.projectRow(record);

      expect(record.sourceRecordId).toBe('source-assessment-alpha-001');
      expect(record.submittedAt).toBe('2099-01-01T11:59:58+09:00');
      expect(record.score).toBeNull();
      expect(record.percentage).toBeNull();
      expect(record.status).toBe('unverified');
      expect(row.statusBadge).toBe('⚪ 성적미확인');
      expect(row.scoreDisplay).toBe('성적 미확인');
      expect(row.sheetRowValues).toContain('source-assessment-alpha-001');
      expect(row.sheetRowValues).toContain('2099-01-01T11:59:58+09:00');
      expect(ledger.getCumulativeStats('TEST-STUDENT-ALPHA').cumulativeAverageScore).toBeNull();
      expect(ledger.getCumulativeStats('TEST-STUDENT-ALPHA').weakUnits).toBeNull();
    });
  });

  describe('DIM-08: Main Sheet Projection & Hover Notes', () => {
    it('projects a synthetic assessment card with a grading badge and hover note', () => {
      const raw = syntheticAlphaGradingPayload;
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));
      const stats = ledger.getCumulativeStats('TEST-STUDENT-ALPHA');

      const card = MainSheetAssessmentProjector.projectRow(record, stats);

      expect(card.studentName).toBe('Synthetic Student ALPHA');
      expect(card.statusBadge).toBe('🟡 강사확인필요');
      expect(card.scoreDisplay).toBe('90점 (18/20)');
      expect(card.wrongItemsDisplay).toBe('7번, 14번');
      expect(card.hoverNote).toContain('7번');
      expect(card.hoverNote).toContain('14번');
      expect(card.hoverNote).toContain('해설 키 연결됨');
      expect(card.hoverNote).not.toContain('synthetic-wrong-7');
      expect(card.hoverNote).not.toContain('synthetic-correct-7');
      expect(card.hoverNote).not.toContain('synthetic-test-device');
    });

    it('projects one synthetic row and builds a bounded Main-tab update request', () => {
      const raw = syntheticBetaGradingPayload;
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      const card = MainSheetAssessmentProjector.projectRow(record);
      expect(card.studentName).toBe('Synthetic Student BETA');
      expect(card.statusBadge).toBe('🟡 강사확인필요');
      expect(card.scoreDisplay).toBe('95점 (19/20)');
      expect(card.wrongItemsDisplay).toBe('12번');

      // Build one bounded request for a caller-identified synthetic Main-tab block.
      const target = {
        spreadsheetId: 'SYNTHETIC-SPREADSHEET',
        sheetId: 42,
        tabName: '박경찬' as const,
        block: {
          startRowIndex: 100,
          endRowIndex: 103,
          nextRowIndex: 101,
          startColumnIndex: 0,
          endColumnIndex: card.sheetRowValues.length
        }
      };
      const updateOp = MainSheetAssessmentProjector.buildMainSheetAssessmentRowRequest(target, card);
      expect(updateOp.target.spreadsheetId).toBe('SYNTHETIC-SPREADSHEET');
      expect(updateOp.operation.updateCells).toBeDefined();
      expect(updateOp.operation.updateCells?.range.sheetId).toBe(42);
      expect(updateOp.operation.updateCells?.range.startRowIndex).toBe(101);
      expect(updateOp.operation.updateCells?.range.endRowIndex).toBe(102);
      expect(updateOp.operation.updateCells?.rows[0].values).toHaveLength(15);
      expect(updateOp.operation.updateCells?.fields).toBe('userEnteredValue,note');
      expect('appendCells' in updateOp.operation).toBe(false);
    });

    it('rejects a full assessment block without writing outside its capacity', () => {
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(syntheticBetaGradingPayload));
      const row = MainSheetAssessmentProjector.projectRow(record);
      expect(() => MainSheetAssessmentProjector.buildMainSheetAssessmentRowRequest({
        spreadsheetId: 'SYNTHETIC-SPREADSHEET',
        sheetId: 42,
        tabName: '박경찬',
        block: {
          startRowIndex: 100,
          endRowIndex: 101,
          nextRowIndex: 101,
          startColumnIndex: 0,
          endColumnIndex: row.sheetRowValues.length
        }
      }, row)).toThrow('Assessment block offsets are invalid or the block has no remaining row capacity.');
    });

    it('updates a synthetic card after teacher correction review', () => {
      const raw = syntheticAlphaGradingPayload;
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      // Initial state: 🟢 채점완료
      const initialCard = MainSheetAssessmentProjector.projectRow(record);
      expect(initialCard.statusBadge).toBe('🟡 강사확인필요');
      const originalChecksum = record.checksum;

      // Teacher reviews the synthetic fixture's correction state.
      const updated = ledger.markAssessmentCorrectionsCompleted('TEST-STUDENT-ALPHA', record.recordId, {
        teacherId: 'TEST-TEACHER-ALPHA',
        reviewedAt: '2099-01-01T12:30:00+09:00',
        reviewedWrongItemNumbers: [7, 14],
        teacherNotes: 'Synthetic correction review complete for items 7 and 14'
      });
      expect(updated.status).toBe('clinic_completed');
      expect(ledger.verifyRecordIntegrity(updated)).toBe(true);
      expect(updated.checksum).toBe(originalChecksum);
      expect(ledger.getCorrectionHistory('TEST-STUDENT-ALPHA')).toHaveLength(1);
      expect(ledger.getCumulativeStats('TEST-STUDENT-ALPHA').unresolvedClinicsCount).toBe(0);

      // Card reflects 🟢 오답검사완료
      const finalCard = MainSheetAssessmentProjector.projectRow(updated);
      expect(finalCard.statusBadge).toBe('🟢 오답검사완료');
      expect(finalCard.nextStepAction).toContain('강사 다음 조치 확인 필요');
    });
  });
});
