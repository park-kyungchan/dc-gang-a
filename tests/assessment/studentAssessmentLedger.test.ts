import { describe, it, expect, beforeEach } from 'bun:test';
import { StudentAssessmentLedgerEngine } from '../../src/assessment/studentAssessmentLedger';
import { AppGradingReader } from '../../src/assessment/appGradingReader';
import { MainSheetAssessmentProjector } from '../../src/sheets/mainSheetAssessmentProjector';

describe('Student Assessment Ledger & Individual DB Engine', () => {
  let ledger: StudentAssessmentLedgerEngine;

  beforeEach(() => {
    ledger = new StudentAssessmentLedgerEngine();
  });

  describe('DIM-06: Student Individual Database Isolation & Ingestion', () => {
    it('creates dedicated DB tab per student and ingests Shin Ji-woo app grading results', () => {
      const raw = AppGradingReader.createShinJiwooGradingPayload();
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.recordId).toContain('asm_20260928_1293032_');
      expect(record.studentId).toBe('1293032');
      expect(record.studentName).toBe('신지우');
      expect(record.score).toBe(90);
      expect(record.totalQuestions).toBe(20);
      expect(record.correctCount).toBe(18);
      expect(record.wrongCount).toBe(2);
      expect(record.percentage).toBe(90.0);
      expect(record.wrongItemNumbers).toEqual([7, 14]);
      expect(record.status).toBe('graded');
      expect(record.submissionMethod).toBe('academy_app');

      // Verify individual DB retrieval
      const history = ledger.getStudentHistory('1293032');
      expect(history.length).toBe(1);
      expect(history[0].recordId).toBe(record.recordId);
    });

    it('ingests Yoo Ji-yeon app grading results with concept test linkage', () => {
      const raw = AppGradingReader.createYooJiyeonGradingPayload();
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.studentId).toBe('1293138');
      expect(record.studentName).toBe('유지연');
      expect(record.bookTitle).toBe('가우스 1-1');
      expect(record.scope).toBe('p.176 ~ p.179');
      expect(record.score).toBe(95);
      expect(record.correctCount).toBe(19);
      expect(record.wrongCount).toBe(1);
      expect(record.wrongItemNumbers).toEqual([12]);
      expect(record.status).toBe('graded');

      const history = ledger.getStudentHistory('1293138');
      expect(history.length).toBe(1);
    });

    it('ingests Park Se-eun app grading results for DB_박세은', () => {
      const raw = AppGradingReader.createParkSeeunGradingPayload();
      const normalized = AppGradingReader.normalizeAppSubmission(raw);

      const record = ledger.ingestAssessmentRecord(normalized);

      expect(record.studentId).toBe('1293067');
      expect(record.studentName).toBe('박세은');
      expect(record.bookTitle).toBe('초5-2 가우스 2권');
      expect(record.scope).toBe('p.134 ~ p.138');
      expect(record.score).toBe(85);
      expect(record.totalQuestions).toBe(20);
      expect(record.correctCount).toBe(17);
      expect(record.wrongCount).toBe(3);
      expect(record.wrongItemNumbers).toEqual([5, 11, 19]);
      expect(record.status).toBe('graded');

      const history = ledger.getStudentHistory('1293067');
      expect(history.length).toBe(1);
      expect(ledger.verifyRecordIntegrity(record)).toBe(true);
    });

    it('verifies cryptographic SHA-256 integrity and catches grade tampering', () => {
      const raw = AppGradingReader.createShinJiwooGradingPayload();
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
      // Session 1: 09/21
      ledger.ingestAssessmentRecord({
        studentId: '1293032',
        studentName: '신지우',
        enrolledGroup: '월수1부',
        sessionDate: '2026-09-21',
        assessmentCategory: 'DailyTest',
        bookTitle: '초5-2 가우스 2권',
        unitName: '2-5-1 직사각형',
        scope: 'p.78 ~ p.95',
        timeLimitMinutes: 20,
        timeSpentMinutes: 18,
        submittedAt: '2026-09-21T15:45:00+09:00',
        submissionMethod: 'academy_app',
        itemOutcomes: [
          { itemNo: 1, studentAnswer: '1', correctAnswer: '1', isCorrect: true, score: 50, maxScore: 50 },
          { itemNo: 2, studentAnswer: '2', correctAnswer: '3', isCorrect: false, score: 0, maxScore: 50 }
        ]
      });

      // Session 2: 09/28 (대단원 총괄평가)
      const raw = AppGradingReader.createShinJiwooGradingPayload();
      ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      const history = ledger.getStudentHistory('1293032');
      expect(history.length).toBe(2);
      expect(history[0].sessionDate).toBe('2026-09-21');
      expect(history[1].sessionDate).toBe('2026-09-28');

      // Cumulative stats
      const stats = ledger.getCumulativeStats('1293032');
      expect(stats.totalAssessmentsCount).toBe(2);
      // Avg: (50 + 90) / 2 = 70.0
      expect(stats.cumulativeAverageScore).toBe(70.0);
      expect(stats.sheetTabName).toBe('DB_신지우');
      expect(stats.weakUnits).toContain('2-5-1 직사각형');
    });

    it('exports clean 2D tabular rows for Google Sheets DB tab synchronization', () => {
      const raw = AppGradingReader.createShinJiwooGradingPayload();
      ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      const rows = ledger.exportStudentDbRows('1293032');
      expect(rows.length).toBe(1);
      const row = rows[0];

      expect(row[0]).toBe('2026-09-28'); // Date
      expect(row[1]).toBe('월수1부');     // Group
      expect(row[2]).toBe('대단원총괄평가');
      expect(row[3]).toBe('초5-2 가우스 2권');
      expect(row[11]).toBe(90);          // Score
      expect(row[12]).toBe('90%');       // Percentage
      expect(row[13]).toBe('7, 14');     // Wrong items
    });
  });

  describe('DIM-08: Main Sheet Projection & Hover Notes', () => {
    it('projects Shin Ji-woo assessment card with 🟢 채점완료 badge and rich hover note', () => {
      const raw = AppGradingReader.createShinJiwooGradingPayload();
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));
      const stats = ledger.getCumulativeStats('1293032');

      const card = MainSheetAssessmentProjector.projectCard(record, stats);

      expect(card.studentName).toBe('신지우');
      expect(card.statusBadge).toBe('🟢 채점완료');
      expect(card.scoreDisplay).toBe('90점 (18/20)');
      expect(card.wrongItemsDisplay).toBe('7번, 14번');
      expect(card.hoverNote).toContain('7번');
      expect(card.hoverNote).toContain('14번');
      expect(card.hoverNote).toContain('LEC_G5_2_CH1_P72_Q07');
      expect(card.hoverNote).toContain('Galaxy Tab A9');
    });

    it('projects Yoo Ji-yeon card and generates Google Sheets API batchUpdate operations', () => {
      const raw = AppGradingReader.createYooJiyeonGradingPayload();
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      const card = MainSheetAssessmentProjector.projectCard(record);
      expect(card.studentName).toBe('유지연');
      expect(card.statusBadge).toBe('🟢 채점완료');
      expect(card.scoreDisplay).toBe('95점 (19/20)');
      expect(card.wrongItemsDisplay).toBe('12번');

      // Test Sheets API updateCells payload builder
      const updateOp = MainSheetAssessmentProjector.buildUpdateMainSheetFrontCardRequest(1754681846, 10, card);
      expect(updateOp.updateCells).toBeDefined();
      expect(updateOp.updateCells?.range.startRowIndex).toBe(10);
      expect(updateOp.updateCells?.fields).toBe('userEnteredValue,note');

      // Test Sheets API appendCells for student individual DB
      const appendOp = MainSheetAssessmentProjector.buildAppendToStudentDbRequest(923904507, record);
      expect(appendOp.appendCells).toBeDefined();
      expect(appendOp.appendCells?.fields).toBe('userEnteredValue,note');
      expect(appendOp.appendCells?.rows[0].values.length).toBe(17);
    });

    it('updates Shin Ji-woo card to 🟢 오답검사완료 upon teacher face-to-face inspection', () => {
      const raw = AppGradingReader.createShinJiwooGradingPayload();
      const record = ledger.ingestAssessmentRecord(AppGradingReader.normalizeAppSubmission(raw));

      // Initial state: 🟢 채점완료
      const initialCard = MainSheetAssessmentProjector.projectCard(record);
      expect(initialCard.statusBadge).toBe('🟢 채점완료');

      // Teacher inspects and approves Shin Ji-woo's error corrections
      const updated = ledger.markAssessmentCorrectionsCompleted(
        '1293032',
        record.recordId,
        '오답 7번, 14번 재풀이 확인 완료 및 p.68~70 배정'
      );
      expect(updated.status).toBe('clinic_completed');
      expect(ledger.verifyRecordIntegrity(updated)).toBe(true);

      // Card reflects 🟢 오답검사완료
      const finalCard = MainSheetAssessmentProjector.projectCard(updated);
      expect(finalCard.statusBadge).toBe('🟢 오답검사완료');
      expect(finalCard.nextStepAction).toContain('후속 진도');
    });
  });
});
