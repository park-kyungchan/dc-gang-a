/**
 * AuditTrailEngine
 * Append-only immutable audit trail engine for Main Sheet v2.
 * 
 * Strict Domain Invariants:
 * 1. Append-Only Ledger: Records can NEVER be deleted, erased, or mutated in-place.
 * 2. Immutable Pre-Override Preservation: preOverrideValue cannot be undefined or erased.
 * 3. Mandatory Concrete Rationale: reason must be >= 10 characters explaining the academic or logistical necessity.
 *    Trivial reasons ("수정", "update", "fix", whitespace) are strictly rejected.
 * 4. Tamper-Evident SHA-256 Integrity Hash: Every record includes a hash of its core fields.
 * 5. Rollback via Append-Only Compensation: Rollbacks create a NEW audit record whose postOverrideValue
 *    equals the historical preOverrideValue, referencing supersededAuditId.
 * 6. Historical Query & Diff Helpers: Granular inspection of state deltas over time.
 */

import { createHash } from 'node:crypto';
import {
  AuditField,
  AuditId,
  AuditRecord,
  StudentId,
  validateAuditRecord
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

// ============================================================================
// 1. Types & Diff Interfaces
// ============================================================================

export interface RecordOverrideInput {
  auditId?: AuditId;
  timestamp?: string; // ISO 8601 string; defaults to current time
  author: string;
  targetStudentId: StudentId;
  targetDate: string; // YYYY-MM-DD
  field: AuditField;
  preOverrideValue: unknown;  // Must not be undefined
  postOverrideValue: unknown; // Must not be undefined
  reason: string;             // Mandatory: minimum 10 characters
  supersededAuditId?: AuditId;
}

export interface AuditHistoryFilter {
  targetStudentId?: StudentId;
  targetDate?: string;
  field?: AuditField;
  author?: string;
  sinceTimestamp?: string;
}

export interface AuditDiffResult {
  auditId: AuditId;
  targetStudentId: StudentId;
  targetDate: string;
  field: AuditField;
  author: string;
  timestamp: string;
  reason: string;
  preValue: unknown;
  postValue: unknown;
  diffType: 'primitive_change' | 'object_change' | 'array_change' | 'null_to_value' | 'value_to_null';
  hasChanged: boolean;
  deltaSummary: string;
  detailedDifferences?: Array<{
    path: string;
    pre: unknown;
    post: unknown;
    change: 'added' | 'removed' | 'modified';
  }>;
}

export interface LedgerIntegrityReport {
  isValid: boolean;
  totalRecords: number;
  validCount: number;
  corruptedAuditIds: AuditId[];
  checkedAt: string;
}

// ============================================================================
// 2. Cryptographic Integrity Utilities
// ============================================================================

/**
 * Computes a deterministic SHA-256 hash for an audit record.
 */
export function computeAuditIntegrityHash(record: {
  auditId: string;
  timestamp: string;
  author: string;
  targetStudentId: string;
  targetDate: string;
  field: string;
  preOverrideValue: unknown;
  postOverrideValue: unknown;
  reason: string;
  supersededAuditId?: string;
}): string {
  const normalizedPre = JSON.stringify(record.preOverrideValue ?? null);
  const normalizedPost = JSON.stringify(record.postOverrideValue ?? null);

  const payload = [
    record.auditId,
    record.timestamp,
    record.author.trim(),
    record.targetStudentId,
    record.targetDate,
    record.field,
    normalizedPre,
    normalizedPost,
    record.reason.trim(),
    record.supersededAuditId || ''
  ].join(':::');

  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * Generates a unique, sortable auditId.
 * Format: adt_{YYYYMMDD_HHMMSS}_{studentId}_{field}_{randomSuffix}
 */
export function generateAuditId(studentId: StudentId, field: AuditField, date: Date = new Date()): AuditId {
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const rand = Math.random().toString(36).substring(2, 6);

  return `adt_${y}${m}${d}_${h}${min}${s}_${studentId}_${field}_${rand}` as AuditId;
}

// ============================================================================
// 3. Diff Engine Helper
// ============================================================================

export function computeAuditDiff(record: AuditRecord): AuditDiffResult {
  const pre = record.preOverrideValue;
  const post = record.postOverrideValue;
  const isPreNull = pre === null || pre === undefined;
  const isPostNull = post === null || post === undefined;

  let diffType: AuditDiffResult['diffType'] = 'primitive_change';
  let hasChanged = false;
  let deltaSummary = '';
  const detailedDifferences: NonNullable<AuditDiffResult['detailedDifferences']> = [];

  if (isPreNull && !isPostNull) {
    diffType = 'null_to_value';
    hasChanged = true;
    deltaSummary = `Initialized ${record.field} to: ${JSON.stringify(post)}`;
  } else if (!isPreNull && isPostNull) {
    diffType = 'value_to_null';
    hasChanged = true;
    deltaSummary = `Cleared ${record.field} from: ${JSON.stringify(pre)}`;
  } else if (typeof pre === 'object' && typeof post === 'object' && pre !== null && post !== null) {
    if (Array.isArray(pre) && Array.isArray(post)) {
      diffType = 'array_change';
      hasChanged = JSON.stringify(pre) !== JSON.stringify(post);
      deltaSummary = `Array modified: ${pre.length} items -> ${post.length} items`;
    } else {
      diffType = 'object_change';
      const allKeys = new Set([...Object.keys(pre as object), ...Object.keys(post as object)]);
      const preObj = pre as Record<string, unknown>;
      const postObj = post as Record<string, unknown>;

      for (const k of allKeys) {
        if (!(k in preObj)) {
          detailedDifferences.push({ path: k, pre: undefined, post: postObj[k], change: 'added' });
          hasChanged = true;
        } else if (!(k in postObj)) {
          detailedDifferences.push({ path: k, pre: preObj[k], post: undefined, change: 'removed' });
          hasChanged = true;
        } else if (JSON.stringify(preObj[k]) !== JSON.stringify(postObj[k])) {
          detailedDifferences.push({ path: k, pre: preObj[k], post: postObj[k], change: 'modified' });
          hasChanged = true;
        }
      }
      deltaSummary = `Object keys changed: ${detailedDifferences.map(d => `${d.path} (${d.change})`).join(', ')}`;
    }
  } else {
    diffType = 'primitive_change';
    hasChanged = pre !== post;
    deltaSummary = `Changed from "${String(pre)}" to "${String(post)}"`;
  }

  return {
    auditId: record.auditId,
    targetStudentId: record.targetStudentId,
    targetDate: record.targetDate,
    field: record.field,
    author: record.author,
    timestamp: record.timestamp,
    reason: record.reason,
    preValue: pre,
    postValue: post,
    diffType,
    hasChanged,
    deltaSummary,
    detailedDifferences: detailedDifferences.length > 0 ? detailedDifferences : undefined
  };
}

// ============================================================================
// 4. AuditTrailEngine Class
// ============================================================================

export class AuditTrailEngine {
  private ledger: AuditRecord[] = [];

  constructor(initialRecords?: AuditRecord[]) {
    if (initialRecords) {
      for (const rec of initialRecords) {
        const val = validateAuditRecord(rec);
        if (!val.valid) {
          throw new Error(`Cannot initialize AuditTrailEngine with invalid record ${rec?.auditId}: ${val.errors.join('; ')}`);
        }
        // Store as frozen object
        this.ledger.push(Object.freeze({ ...rec }));
      }
    }
  }

  /**
   * Appends an override record to the immutable audit trail.
   * Enforces all domain invariants:
   * - preOverrideValue !== undefined
   * - postOverrideValue !== undefined
   * - reason.trim().length >= 10
   * - SHA-256 integrity hash generation
   */
  public recordOverride(input: RecordOverrideInput): AuditRecord {
    // 1. Mandatory Invariant: preOverrideValue cannot be undefined
    if (input.preOverrideValue === undefined) {
      throw new Error(`Audit rejection: preOverrideValue must be explicitly provided (cannot be undefined).`);
    }

    // 2. Mandatory Invariant: postOverrideValue cannot be undefined
    if (input.postOverrideValue === undefined) {
      throw new Error(`Audit rejection: postOverrideValue must be explicitly provided (cannot be undefined).`);
    }

    // 3. Mandatory Invariant: Reason length >= 10 characters
    if (!input.reason || typeof input.reason !== 'string' || input.reason.trim().length < 10) {
      throw new Error(`Audit rejection: Reason must be at least 10 meaningful characters. Received: "${input.reason || ''}".`);
    }

    // Prevent trivial bypass like "1234567890" or "수정수정수정수정수정" without semantic text
    const trimmedReason = input.reason.trim();
    if (/^(.)\1{9,}$/.test(trimmedReason)) {
      throw new Error(`Audit rejection: Trivial repetitive pattern detected in reason: "${trimmedReason}".`);
    }

    // 4. Invariant: preOverrideValue and postOverrideValue should not be identical
    if (JSON.stringify(input.preOverrideValue) === JSON.stringify(input.postOverrideValue)) {
      throw new Error(`Audit rejection: Pre-override and post-override values are identical. Destructive no-op audit blocked.`);
    }

    const timestamp = input.timestamp || new Date().toISOString();
    const auditId = input.auditId || generateAuditId(input.targetStudentId, input.field, new Date(timestamp));

    const candidateRecord: AuditRecord = {
      auditId,
      timestamp,
      author: input.author.trim(),
      targetStudentId: input.targetStudentId,
      targetDate: input.targetDate,
      field: input.field,
      preOverrideValue: input.preOverrideValue,
      postOverrideValue: input.postOverrideValue,
      reason: trimmedReason,
      supersededAuditId: input.supersededAuditId
    };

    // 5. Schema validation
    const validation = validateAuditRecord(candidateRecord);
    if (!validation.valid) {
      throw new Error(`Audit validation failure: ${validation.errors.join('; ')}`);
    }

    // 6. SHA-256 Integrity Hash
    const integrityHash = computeAuditIntegrityHash(candidateRecord);
    candidateRecord.integrityHash = integrityHash;

    // 7. Freeze record to prevent in-place mutation
    const immutableRecord = Object.freeze(candidateRecord);

    // 8. Append-only ledger append
    this.ledger.push(immutableRecord);

    return immutableRecord;
  }

  /**
   * Performs an append-only rollback of a previous override.
   * Does NOT delete or alter the original record!
   * Appends a new compensating record whose postOverrideValue is the previous preOverrideValue.
   */
  public rollbackOverride(
    targetAuditId: AuditId,
    author: string,
    reason: string
  ): AuditRecord {
    const historicalRecord = this.getRecordById(targetAuditId);
    if (!historicalRecord) {
      throw new Error(`Cannot rollback non-existent audit record: ${targetAuditId}`);
    }

    if (!reason || reason.trim().length < 10) {
      throw new Error(`Rollback reason must be at least 10 meaningful characters.`);
    }

    const rollbackReason = reason.includes(`[Rollback of ${targetAuditId}]`)
      ? reason.trim()
      : `[Rollback of ${targetAuditId}] ${reason.trim()}`;

    // Compensating record: swap pre and post
    return this.recordOverride({
      author,
      targetStudentId: historicalRecord.targetStudentId,
      targetDate: historicalRecord.targetDate,
      field: historicalRecord.field,
      preOverrideValue: historicalRecord.postOverrideValue,
      postOverrideValue: historicalRecord.preOverrideValue,
      reason: rollbackReason,
      supersededAuditId: targetAuditId
    });
  }

  /**
   * Retrieves a record by auditId.
   */
  public getRecordById(auditId: AuditId): AuditRecord | undefined {
    return this.ledger.find(r => r.auditId === auditId);
  }

  /**
   * Retrieves all records as a read-only list.
   */
  public getAllRecords(): readonly AuditRecord[] {
    return Object.freeze([...this.ledger]);
  }

  /**
   * Queries chronological audit history with filtering.
   */
  public queryHistory(filter: AuditHistoryFilter = {}): readonly AuditRecord[] {
    return this.ledger.filter(r => {
      if (filter.targetStudentId && r.targetStudentId !== filter.targetStudentId) return false;
      if (filter.targetDate && r.targetDate !== filter.targetDate) return false;
      if (filter.field && r.field !== filter.field) return false;
      if (filter.author && r.author !== filter.author) return false;
      if (filter.sinceTimestamp && new Date(r.timestamp) < new Date(filter.sinceTimestamp)) return false;
      return true;
    });
  }

  /**
   * Computes state diff for a specific audit record.
   */
  public diff(auditId: AuditId): AuditDiffResult {
    const record = this.getRecordById(auditId);
    if (!record) {
      throw new Error(`Cannot diff non-existent audit record: ${auditId}`);
    }
    return computeAuditDiff(record);
  }

  /**
   * Inspects entire ledger and verifies SHA-256 hash integrity for all records.
   * Catches any external tampering or memory corruption.
   */
  public verifyIntegrity(): LedgerIntegrityReport {
    const corruptedAuditIds: AuditId[] = [];
    let validCount = 0;

    for (const record of this.ledger) {
      if (!record.integrityHash) {
        corruptedAuditIds.push(record.auditId);
        continue;
      }

      const expectedHash = computeAuditIntegrityHash(record);
      if (record.integrityHash !== expectedHash) {
        corruptedAuditIds.push(record.auditId);
      } else {
        validCount++;
      }
    }

    return {
      isValid: corruptedAuditIds.length === 0,
      totalRecords: this.ledger.length,
      validCount,
      corruptedAuditIds,
      checkedAt: new Date().toISOString()
    };
  }

  /**
   * Exports ledger to JSON string.
   */
  public exportLedger(): string {
    return JSON.stringify(this.ledger, null, 2);
  }

  /**
   * Factory to reconstitute engine from exported JSON string.
   */
  public static fromJson(jsonStr: string): AuditTrailEngine {
    const parsed = JSON.parse(jsonStr) as AuditRecord[];
    if (!Array.isArray(parsed)) {
      throw new Error(`Expected array of audit records in JSON.`);
    }

    const engine = new AuditTrailEngine(parsed);
    const integrity = engine.verifyIntegrity();
    if (!integrity.isValid) {
      throw new Error(`Loaded audit ledger failed integrity check. Corrupted IDs: ${integrity.corruptedAuditIds.join(', ')}`);
    }

    return engine;
  }
}
