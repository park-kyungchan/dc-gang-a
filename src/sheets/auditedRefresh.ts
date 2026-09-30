/**
 * I/O-free orchestration for one approved, exact student/lesson Main Sheet refresh.
 * Adapters must serialize by idempotency key and persist the teacher-only ledger.
 * No LMS or Google Sheets client is included here.
 */

import { isDeepStrictEqual } from 'node:util';

export type DisplayValue =
  | { kind: 'known'; value: string | number | boolean | null }
  | { kind: 'unknown'; reason: string };

export type DisplayFields = Record<string, DisplayValue>;

export interface RefreshScope {
  workbookId: string;
  sheetId: number;
  rangeA1: string;
  lesson: {
    date: string;
    teacherId: string;
    groupId: string;
    studentId: string;
    courseId: string;
    recordId: string;
    curriculumId: string;
    occurrenceId: string;
  };
}

export interface ScopedDisplay {
  scope: RefreshScope;
  /** Adapter-derived complete field list for the exact displayed range, including blank cells. */
  displayedFields: readonly string[];
  values: DisplayFields;
}

export interface FieldDiff {
  field: string;
  before: DisplayValue;
  after: DisplayValue;
}

export interface RefreshApproval {
  batchId: string;
  scope: RefreshScope;
  before: DisplayFields;
  after: DisplayFields;
  recoveryReference: string;
}

export interface RefreshRequest {
  idempotencyKey: string;
  scope: RefreshScope;
  displayedFields: readonly string[];
  proposed: DisplayFields;
  approval: RefreshApproval;
}

export interface BeforeRecord {
  type: 'before';
  id: string;
  idempotencyKey: string;
  capturedAt: string;
  scope: RefreshScope;
  values: DisplayFields;
  approvedBatchId: string;
  recoveryReference: string;
}

export type RefreshStatus =
  | 'applied'
  | 'stale_before_write'
  | 'write_failed'
  | 'readback_failed'
  | 'readback_mismatch';

export interface OutcomeRecord {
  type: 'outcome';
  id: string;
  idempotencyKey: string;
  beforeId: string;
  recordedAt: string;
  scope: RefreshScope;
  status: RefreshStatus;
  expected: DisplayFields;
  observed?: DisplayFields;
  diffs: FieldDiff[];
}

export type AuditRecord = BeforeRecord | OutcomeRecord;

export interface TeacherOnlyAuditLedger {
  /** The adapter must reject changes to existing records and restrict reader access to teachers. */
  findByIdempotencyKey(key: string): Promise<readonly AuditRecord[]>;
  append(record: AuditRecord): Promise<void>;
  readById(id: string): Promise<AuditRecord | undefined>;
}

export interface DisplayStore {
  read(scope: RefreshScope): Promise<ScopedDisplay>;
  /** Applies only to the exact scope; expectedBefore supports optimistic concurrency. */
  write(scope: RefreshScope, expectedBefore: DisplayFields, next: DisplayFields): Promise<void>;
}

export interface RefreshPorts {
  ledger: TeacherOnlyAuditLedger;
  display: DisplayStore;
  /** Distributed or document lock. Caller passes one global writer key, so different requests cannot race. */
  runExclusive<T>(key: string, work: () => Promise<T>): Promise<T>;
  now(): string;
}

export class RefreshRejected extends Error {
  constructor(public readonly code: string) {
    super(`Audited refresh rejected: ${code}`);
    this.name = 'RefreshRejected';
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown): boolean => isDeepStrictEqual(left, right);

function timestamp(now: () => string): string {
  const value = now();
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new RefreshRejected('invalid_audit_timestamp');
  }
  return value;
}

function validateScope(scope: RefreshScope): void {
  const parts = [scope.workbookId, scope.rangeA1, ...Object.values(scope.lesson)];
  if (!Number.isSafeInteger(scope.sheetId) || scope.sheetId < 0 || parts.some(x => typeof x !== 'string' || !x.trim())) {
    throw new RefreshRejected('invalid_scope');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scope.lesson.date) || !/^[A-Za-z]+\d+(?::[A-Za-z]+\d+)?$/.test(scope.rangeA1)) {
    throw new RefreshRejected('invalid_scope');
  }
}

function validateFields(fields: DisplayFields, names: readonly string[]): void {
  if (!names.length || new Set(names).size !== names.length || names.some(x => !x.trim())) {
    throw new RefreshRejected('invalid_field_manifest');
  }
  if (!same(Object.keys(fields).sort(), [...names].sort())) throw new RefreshRejected('field_set_mismatch');
  for (const value of Object.values(fields)) {
    if (!value || typeof value !== 'object') throw new RefreshRejected('invalid_value');
    if (value.kind === 'unknown') {
      if (typeof value.reason !== 'string' || !value.reason.trim()) throw new RefreshRejected('invalid_unknown');
    } else if (value.kind === 'known') {
      if (!Object.hasOwn(value, 'value') || (value.value !== null && !['string', 'number', 'boolean'].includes(typeof value.value)) || (typeof value.value === 'number' && !Number.isFinite(value.value))) {
        throw new RefreshRejected('invalid_value');
      }
    } else throw new RefreshRejected('invalid_value');
  }
}

function verifyRead(read: ScopedDisplay, scope: RefreshScope, names: readonly string[]): DisplayFields {
  if (!same(read.scope, scope)) throw new RefreshRejected('target_mismatch');
  if (!same([...read.displayedFields].sort(), [...names].sort())) throw new RefreshRejected('display_manifest_mismatch');
  validateFields(read.values, names);
  return clone(read.values);
}

function differences(before: DisplayFields, after: DisplayFields, names: readonly string[]): FieldDiff[] {
  return names.filter(field => !same(before[field], after[field]))
    .map(field => ({ field, before: clone(before[field]), after: clone(after[field]) }));
}

/**
 * Snapshot append and readback happen before any Main Sheet write. A failed or
 * incomplete key is never retried automatically, since the effect may be unknown.
 */
export async function auditedRefresh(request: RefreshRequest, ports: RefreshPorts): Promise<OutcomeRecord> {
  validateScope(request.scope);
  if (!request.idempotencyKey.trim()) throw new RefreshRejected('missing_idempotency_key');
  validateFields(request.proposed, request.displayedFields);
  const approval = request.approval;
  if (!approval.batchId.trim() || !approval.recoveryReference.trim() || !same(approval.scope, request.scope)) {
    throw new RefreshRejected('approval_mismatch');
  }
  validateFields(approval.before, request.displayedFields);
  validateFields(approval.after, request.displayedFields);
  if (!same(approval.after, request.proposed)) throw new RefreshRejected('approval_mismatch');

  return ports.runExclusive('main-sheet-audited-refresh', async () => {
    if ((await ports.ledger.findByIdempotencyKey(request.idempotencyKey)).length) {
      throw new RefreshRejected('duplicate_or_incomplete_key');
    }
    const before = verifyRead(await ports.display.read(request.scope), request.scope, request.displayedFields);
    if (!same(before, approval.before)) throw new RefreshRejected('approval_stale');

    const beforeRecord: BeforeRecord = {
      type: 'before', id: `${request.idempotencyKey}:before`, idempotencyKey: request.idempotencyKey,
      capturedAt: timestamp(ports.now), scope: clone(request.scope), values: clone(before),
      approvedBatchId: approval.batchId, recoveryReference: approval.recoveryReference,
    };
    try {
      await ports.ledger.append(beforeRecord);
    } catch {
      throw new RefreshRejected('audit_before_write_failed');
    }
    let storedBefore: AuditRecord | undefined;
    try {
      storedBefore = await ports.ledger.readById(beforeRecord.id);
    } catch {
      throw new RefreshRejected('audit_before_readback_failed');
    }
    if (!same(storedBefore, beforeRecord)) {
      throw new RefreshRejected('audit_before_readback_failed');
    }

    const recordOutcome = async (status: RefreshStatus, observed?: DisplayFields): Promise<OutcomeRecord> => {
      const outcome: OutcomeRecord = {
        type: 'outcome', id: `${request.idempotencyKey}:outcome`, idempotencyKey: request.idempotencyKey,
        beforeId: beforeRecord.id, recordedAt: timestamp(ports.now), scope: clone(request.scope), status,
        expected: clone(request.proposed), ...(observed ? { observed: clone(observed) } : {}),
        diffs: observed ? differences(before, observed, request.displayedFields) : [],
      };
      try {
        await ports.ledger.append(outcome);
      } catch {
        throw new RefreshRejected('audit_outcome_write_failed');
      }
      let storedOutcome: AuditRecord | undefined;
      try {
        storedOutcome = await ports.ledger.readById(outcome.id);
      } catch {
        throw new RefreshRejected('audit_outcome_readback_failed');
      }
      if (!same(storedOutcome, outcome)) throw new RefreshRejected('audit_outcome_readback_failed');
      return outcome;
    };

    const justBeforeWrite = verifyRead(await ports.display.read(request.scope), request.scope, request.displayedFields);
    if (!same(justBeforeWrite, before)) {
      await recordOutcome('stale_before_write', justBeforeWrite);
      throw new RefreshRejected('stale_before_write');
    }
    try {
      await ports.display.write(request.scope, clone(before), clone(request.proposed));
    } catch {
      await recordOutcome('write_failed');
      throw new RefreshRejected('write_failed');
    }

    let after: DisplayFields;
    try {
      after = verifyRead(await ports.display.read(request.scope), request.scope, request.displayedFields);
    } catch {
      await recordOutcome('readback_failed');
      throw new RefreshRejected('readback_failed');
    }
    if (!same(after, request.proposed)) {
      await recordOutcome('readback_mismatch', after);
      throw new RefreshRejected('readback_mismatch');
    }
    return recordOutcome('applied', after);
  });
}
