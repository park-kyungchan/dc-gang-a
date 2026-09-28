/**
 * Unit Test Suite: AuditTrailEngine
 * Testing against rubric DIM-04 requirements and adversarial edge cases.
 */

import { describe, expect, it } from 'bun:test';
import {
  AuditTrailEngine,
  computeAuditDiff,
  computeAuditIntegrityHash,
  generateAuditId
} from '../../src/audit/auditTrailEngine';
import { AuditRecord, validateAuditRecord } from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

describe('AuditTrailEngine & Immutable Audit Trail', () => {
  describe('DIM-04: Mandatory Schema & Invariant Enforcement', () => {
    it('successfully appends a valid override record with all required metadata', () => {
      const engine = new AuditTrailEngine();
      const record = engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293032',
        targetDate: '2026-09-21',
        field: 'homework',
        preOverrideValue: '초5-2 가우스 2권 p.100 ~ p.131',
        postOverrideValue: '초5-2 가우스 2권 p.100 ~ p.131 + 초5-1 다빈치 1권 p.42 ~ p.49',
        reason: '09/23 추석연휴 결석 통보 접수 후 학습 공백 보완을 위해 사후 추가 및 일지 Override'
      });

      expect(record.auditId.startsWith('adt_')).toBe(true);
      expect(record.author).toBe('박경찬T');
      expect(record.targetStudentId).toBe('1293032');
      expect(record.targetDate).toBe('2026-09-21');
      expect(record.field).toBe('homework');
      expect(record.preOverrideValue).toBe('초5-2 가우스 2권 p.100 ~ p.131');
      expect(record.postOverrideValue).toContain('다빈치 1권');
      expect(record.reason.length).toBeGreaterThanOrEqual(10);
      expect(record.integrityHash).toBeDefined();
      expect(record.integrityHash?.length).toBe(64); // SHA-256 hex string

      // Verify Object is frozen (cannot be mutated)
      expect(Object.isFrozen(record)).toBe(true);
    });

    it('rejects preOverrideValue undefined (BLOCKER-3 / TEST-04-B protection)', () => {
      const engine = new AuditTrailEngine();

      expect(() => {
        engine.recordOverride({
          author: '박경찬T',
          targetStudentId: '1293032',
          targetDate: '2026-09-21',
          field: 'homework',
          preOverrideValue: undefined as any,
          postOverrideValue: '가우스 p.100',
          reason: '09/23 추석연휴 결석 통보 접수 후 학습 공백 보완'
        });
      }).toThrow(/preOverrideValue must be explicitly provided/);
    });

    it('rejects postOverrideValue undefined', () => {
      const engine = new AuditTrailEngine();

      expect(() => {
        engine.recordOverride({
          author: '박경찬T',
          targetStudentId: '1293032',
          targetDate: '2026-09-21',
          field: 'homework',
          preOverrideValue: '가우스 p.100',
          postOverrideValue: undefined as any,
          reason: '09/23 추석연휴 결석 통보 접수 후 학습 공백 보완'
        });
      }).toThrow(/postOverrideValue must be explicitly provided/);
    });

    it('rejects trivial or short reason (< 10 chars) (TEST-04-C)', () => {
      const engine = new AuditTrailEngine();
      const invalidReasons = ['', '수정', 'fix', 'updated', '123456789', '   수정했습니다  '];

      for (const badReason of invalidReasons) {
        expect(() => {
          engine.recordOverride({
            author: '박경찬T',
            targetStudentId: '1293032',
            targetDate: '2026-09-21',
            field: 'homework',
            preOverrideValue: 'A',
            postOverrideValue: 'B',
            reason: badReason
          });
        }).toThrow(/Reason must be at least 10 meaningful characters/);
      }
    });

    it('rejects identical pre and post values (destructive no-op protection)', () => {
      const engine = new AuditTrailEngine();

      expect(() => {
        engine.recordOverride({
          author: '박경찬T',
          targetStudentId: '1293032',
          targetDate: '2026-09-21',
          field: 'attendance',
          preOverrideValue: 'O',
          postOverrideValue: 'O',
          reason: '동일한 값으로 변경하려는 잘못된 시도'
        });
      }).toThrow(/Pre-override and post-override values are identical/);
    });
  });

  describe('DIM-04: Append-Only Rollback via Compensation', () => {
    it('performs rollback by appending a new record without mutating or deleting historical records', () => {
      const engine = new AuditTrailEngine();

      // Step 1: Record initial override
      const firstOverride = engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293067',
        targetDate: '2026-09-25',
        field: 'homework',
        preOverrideValue: '가우스 5-2 p.10~20',
        postOverrideValue: '가우스 5-2 p.10~30',
        reason: '수업 후 진도 추가 배정으로 인한 일지 사후 수정'
      });

      expect(engine.getAllRecords()).toHaveLength(1);

      // Step 2: Rollback
      const rollbackRecord = engine.rollbackOverride(
        firstOverride.auditId,
        '박경찬T',
        '학부모 요청 및 과제 부담 완화를 위해 원래 진도로 원복 조치'
      );

      // Both records exist in ledger
      const allRecords = engine.getAllRecords();
      expect(allRecords).toHaveLength(2);

      // Rollback postOverrideValue matches first preOverrideValue
      expect(rollbackRecord.preOverrideValue).toBe('가우스 5-2 p.10~30');
      expect(rollbackRecord.postOverrideValue).toBe('가우스 5-2 p.10~20');
      expect(rollbackRecord.supersededAuditId).toBe(firstOverride.auditId);
      expect(rollbackRecord.reason).toContain(firstOverride.auditId);

      // Original record is unchanged
      expect(allRecords[0].postOverrideValue).toBe('가우스 5-2 p.10~30');
    });

    it('rejects rollback of non-existent auditId', () => {
      const engine = new AuditTrailEngine();
      expect(() => {
        engine.rollbackOverride('adt_invalid_id' as any, '박경찬T', '유효하지 않은 레코드 롤백 시도');
      }).toThrow(/Cannot rollback non-existent audit record/);
    });
  });

  describe('DIM-04: Cryptographic SHA-256 Integrity Verification', () => {
    it('verifies ledger integrity successfully when records are untampered', () => {
      const engine = new AuditTrailEngine();
      engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293032',
        targetDate: '2026-09-21',
        field: 'progress',
        preOverrideValue: { chapter: '소수의 나눗셈', pStart: 10, pEnd: 20 },
        postOverrideValue: { chapter: '소수의 나눗셈', pStart: 10, pEnd: 25 },
        reason: '수업 종료 직전 5페이지 추가 확인으로 진도 기록 정정'
      });

      engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293138',
        targetDate: '2026-09-25',
        field: 'attendance',
        preOverrideValue: 'O',
        postOverrideValue: 'O(지각)',
        reason: '지각 사유 확인 후 출석부 코드 및 지각 메모 보정'
      });

      const report = engine.verifyIntegrity();
      expect(report.isValid).toBe(true);
      expect(report.totalRecords).toBe(2);
      expect(report.validCount).toBe(2);
      expect(report.corruptedAuditIds).toHaveLength(0);
    });

    it('detects tampering if raw JSON data was altered outside the engine', () => {
      const rec: AuditRecord = {
        auditId: 'adt_20260921_1293032_hw_test',
        timestamp: '2026-09-21T18:00:00+09:00',
        author: '박경찬T',
        targetStudentId: '1293032',
        targetDate: '2026-09-21',
        field: 'homework',
        preOverrideValue: 'A',
        postOverrideValue: 'B',
        reason: '정상적인 정당한 사유 설명 문장입니다.'
      };
      rec.integrityHash = computeAuditIntegrityHash(rec);

      // Tampered copy
      const tamperedRecord = { ...rec, postOverrideValue: 'Tampered Value' };

      const engine = new AuditTrailEngine([tamperedRecord as AuditRecord]);
      const report = engine.verifyIntegrity();

      expect(report.isValid).toBe(false);
      expect(report.corruptedAuditIds).toContain(tamperedRecord.auditId);
    });
  });

  describe('DIM-04: Historical Query & Diff Engine', () => {
    it('queries historical overrides by student, date, and field', () => {
      const engine = new AuditTrailEngine();

      engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293032',
        targetDate: '2026-09-21',
        field: 'homework',
        preOverrideValue: 'v1',
        postOverrideValue: 'v2',
        reason: '첫 번째 숙제 수정에 대한 구체적 사유'
      });

      engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293067',
        targetDate: '2026-09-25',
        field: 'progress',
        preOverrideValue: 'p1',
        postOverrideValue: 'p2',
        reason: '두 번째 진도 수정에 대한 구체적 사유'
      });

      const shinHistory = engine.queryHistory({ targetStudentId: '1293032' });
      expect(shinHistory).toHaveLength(1);
      expect(shinHistory[0].targetStudentId).toBe('1293032');

      const progressHistory = engine.queryHistory({ field: 'progress' });
      expect(progressHistory).toHaveLength(1);
      expect(progressHistory[0].field).toBe('progress');
    });

    it('computes structured diff for object modifications', () => {
      const engine = new AuditTrailEngine();
      const rec = engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293067',
        targetDate: '2026-09-25',
        field: 'homework',
        preOverrideValue: { book: '가우스', pStart: 10, pEnd: 20 },
        postOverrideValue: { book: '가우스', pStart: 10, pEnd: 30, bonus: '다빈치' },
        reason: '진도 보완을 위한 추가 과제 범위 및 보너스 교재 지정'
      });

      const diffResult = engine.diff(rec.auditId);
      expect(diffResult.hasChanged).toBe(true);
      expect(diffResult.diffType).toBe('object_change');
      expect(diffResult.detailedDifferences).toBeDefined();

      const modifiedKey = diffResult.detailedDifferences?.find(d => d.path === 'pEnd');
      expect(modifiedKey?.change).toBe('modified');
      expect(modifiedKey?.pre).toBe(20);
      expect(modifiedKey?.post).toBe(30);

      const addedKey = diffResult.detailedDifferences?.find(d => d.path === 'bonus');
      expect(addedKey?.change).toBe('added');
      expect(addedKey?.post).toBe('다빈치');
    });
  });

  describe('DIM-04: Serialization & Import', () => {
    it('exports and re-imports audit ledger maintaining verified integrity', () => {
      const engine = new AuditTrailEngine();
      engine.recordOverride({
        author: '박경찬T',
        targetStudentId: '1293032',
        targetDate: '2026-09-21',
        field: 'homework',
        preOverrideValue: '숙제A',
        postOverrideValue: '숙제B',
        reason: '과제 정정에 대한 타당한 사유 설명'
      });

      const jsonStr = engine.exportLedger();
      const importedEngine = AuditTrailEngine.fromJson(jsonStr);

      expect(importedEngine.getAllRecords()).toHaveLength(1);
      expect(importedEngine.verifyIntegrity().isValid).toBe(true);
    });
  });
});
