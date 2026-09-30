import { describe, expect, it } from 'bun:test';
import {
  auditedRefresh, type AuditRecord, type DisplayFields, type RefreshPorts,
  type RefreshRequest, type RefreshScope,
} from '../../src/sheets/auditedRefresh';

const scope: RefreshScope = {
  workbookId: 'synthetic-book', sheetId: 17, rangeA1: 'B9:D9',
  lesson: {
    date: '2026-10-01', teacherId: 'teacher-synthetic', groupId: 'group-synthetic',
    studentId: 'student-synthetic', courseId: 'course-synthetic', recordId: 'record-synthetic',
    curriculumId: 'curriculum-synthetic', occurrenceId: 'occurrence-synthetic',
  },
};
const before: DisplayFields = {
  homework: { kind: 'known', value: 'pages 1-2' },
  appGrade: { kind: 'unknown', reason: 'join unverified' },
  teacherCheck: { kind: 'known', value: false },
};
const proposed: DisplayFields = {
  homework: { kind: 'known', value: 'pages 3-4' },
  appGrade: { kind: 'unknown', reason: 'join unverified' },
  teacherCheck: { kind: 'known', value: false },
};
const request = (): RefreshRequest => ({
  idempotencyKey: 'refresh-synthetic-1', scope: structuredClone(scope),
  displayedFields: ['homework', 'appGrade', 'teacherCheck'],
  proposed: structuredClone(proposed),
  approval: {
    batchId: 'approved-synthetic-batch', scope: structuredClone(scope),
    before: structuredClone(before), after: structuredClone(proposed),
    recoveryReference: 'synthetic-recovery-copy',
  },
});

function fixture() {
  const calls: string[] = [];
  const records = new Map<string, AuditRecord>();
  let displayed = structuredClone(before);
  let readCount = 0;
  let failAuditReadback = false;
  let failWrite = false;
  let mismatchAfterWrite = false;
  let targetMismatch = false;
  let staleBeforeWrite = false;
  let failFinalRead = false;
  let failOutcomeAppend = false;
  let hiddenDisplayField = false;
  const ports: RefreshPorts = {
    now: () => '2026-10-01T05:00:00.000Z',
    runExclusive: async (_key, work) => { calls.push('lock'); return work(); },
    ledger: {
      findByIdempotencyKey: async key => {
        calls.push('find');
        return [...records.values()].filter(x => x.idempotencyKey === key);
      },
      append: async record => {
        calls.push(`append:${record.type}`);
        if (failOutcomeAppend && record.type === 'outcome') throw new Error('synthetic ledger outage');
        if (records.has(record.id)) throw new Error('append-only');
        records.set(record.id, JSON.parse(JSON.stringify(record)) as AuditRecord);
      },
      readById: async id => {
        calls.push(`audit-read:${id.endsWith(':before') ? 'before' : 'outcome'}`);
        return failAuditReadback ? undefined : records.get(id);
      },
    },
    display: {
      read: async exact => {
        calls.push('display-read');
        readCount++;
        if (failFinalRead && readCount === 3) throw new Error('synthetic read outage');
        const values = structuredClone(displayed);
        if (staleBeforeWrite && readCount === 2) values.homework = { kind: 'known', value: 'other edit' };
        return {
          scope: targetMismatch ? { ...exact, sheetId: exact.sheetId + 1 } : structuredClone(exact),
          displayedFields: hiddenDisplayField
            ? ['homework', 'appGrade', 'teacherCheck', 'unlisted']
            : ['homework', 'appGrade', 'teacherCheck'], values,
        };
      },
      write: async (exact, expected, next) => {
        calls.push('display-write');
        expect(exact).toEqual(scope);
        expect(expected).toEqual(before);
        if (failWrite) throw new Error('synthetic write failure');
        displayed = structuredClone(next);
        if (mismatchAfterWrite) displayed.homework = { kind: 'known', value: 'unexpected' };
      },
    },
  };
  return {
    calls, records, ports,
    setAuditReadbackFailure: () => { failAuditReadback = true; },
    setWriteFailure: () => { failWrite = true; },
    setReadbackMismatch: () => { mismatchAfterWrite = true; },
    setTargetMismatch: () => { targetMismatch = true; },
    setStaleBeforeWrite: () => { staleBeforeWrite = true; },
    setFinalReadFailure: () => { failFinalRead = true; },
    setOutcomeAppendFailure: () => { failOutcomeAppend = true; },
    setHiddenDisplayField: () => { hiddenDisplayField = true; },
  };
}

describe('audited Main Sheet refresh (synthetic ports)', () => {
  it('reads all displayed values, verifies teacher-only snapshot, then writes and records exact diffs', async () => {
    const f = fixture();
    const result = await auditedRefresh(request(), f.ports);
    expect(f.calls).toEqual([
      'lock', 'find', 'display-read', 'append:before', 'audit-read:before',
      'display-read', 'display-write', 'display-read', 'append:outcome', 'audit-read:outcome',
    ]);
    expect(f.records.get('refresh-synthetic-1:before')).toMatchObject({
      type: 'before', scope, values: before, capturedAt: '2026-10-01T05:00:00.000Z',
    });
    expect(result.status).toBe('applied');
    expect(result.diffs).toEqual([{
      field: 'homework', before: before.homework, after: proposed.homework,
    }]);
    expect(result.observed?.appGrade).toEqual(before.appGrade);
    await expect(auditedRefresh(request(), f.ports)).rejects.toMatchObject({ code: 'duplicate_or_incomplete_key' });
    expect(f.calls.filter(x => x === 'display-write')).toHaveLength(1);
  });

  it('does not write when the snapshot cannot be read back', async () => {
    const f = fixture();
    f.setAuditReadbackFailure();
    await expect(auditedRefresh(request(), f.ports)).rejects.toMatchObject({ code: 'audit_before_readback_failed' });
    expect(f.calls).not.toContain('display-write');
    expect(f.records.has('refresh-synthetic-1:before')).toBe(true);
  });

  it('does not write a stale approval, wrong target, or changed prewrite view', async () => {
    const staleApproval = fixture();
    const staleRequest = request();
    staleRequest.approval.before.homework = { kind: 'known', value: 'wrong approved value' };
    await expect(auditedRefresh(staleRequest, staleApproval.ports)).rejects.toMatchObject({ code: 'approval_stale' });
    expect(staleApproval.calls).not.toContain('display-write');

    const wrongTarget = fixture();
    wrongTarget.setTargetMismatch();
    await expect(auditedRefresh(request(), wrongTarget.ports)).rejects.toMatchObject({ code: 'target_mismatch' });
    expect(wrongTarget.calls).not.toContain('display-write');

    const changed = fixture();
    changed.setStaleBeforeWrite();
    await expect(auditedRefresh(request(), changed.ports)).rejects.toMatchObject({ code: 'stale_before_write' });
    expect(changed.calls).not.toContain('display-write');
    expect(changed.records.get('refresh-synthetic-1:outcome')).toMatchObject({ status: 'stale_before_write' });
  });

  it('records write failure and readback mismatch; never claims application', async () => {
    const failed = fixture();
    failed.setWriteFailure();
    await expect(auditedRefresh(request(), failed.ports)).rejects.toMatchObject({ code: 'write_failed' });
    expect(failed.records.get('refresh-synthetic-1:outcome')).toMatchObject({ status: 'write_failed' });

    const mismatch = fixture();
    mismatch.setReadbackMismatch();
    await expect(auditedRefresh(request(), mismatch.ports)).rejects.toMatchObject({ code: 'readback_mismatch' });
    expect(mismatch.records.get('refresh-synthetic-1:outcome')).toMatchObject({
      status: 'readback_mismatch', observed: { homework: { kind: 'known', value: 'unexpected' } },
    });
  });

  it('records a failed Main Sheet readback and fails closed on a ledger outage after writing', async () => {
    const unreadable = fixture();
    unreadable.setFinalReadFailure();
    await expect(auditedRefresh(request(), unreadable.ports)).rejects.toMatchObject({ code: 'readback_failed' });
    expect(unreadable.records.get('refresh-synthetic-1:outcome')).toMatchObject({ status: 'readback_failed' });

    const ledgerOutage = fixture();
    ledgerOutage.setOutcomeAppendFailure();
    await expect(auditedRefresh(request(), ledgerOutage.ports)).rejects.toMatchObject({ code: 'audit_outcome_write_failed' });
    expect(ledgerOutage.calls).toContain('display-write');
    expect(ledgerOutage.records.has('refresh-synthetic-1:outcome')).toBe(false);
    await expect(auditedRefresh(request(), ledgerOutage.ports)).rejects.toMatchObject({ code: 'duplicate_or_incomplete_key' });
  });

  it('rejects incomplete displayed field manifests and inferred unknowns', async () => {
    const f = fixture();
    const omitted = request();
    omitted.displayedFields = ['homework', 'teacherCheck'];
    await expect(auditedRefresh(omitted, f.ports)).rejects.toMatchObject({ code: 'field_set_mismatch' });
    const badUnknown = request();
    badUnknown.proposed.appGrade = { kind: 'unknown', reason: '' };
    await expect(auditedRefresh(badUnknown, f.ports)).rejects.toMatchObject({ code: 'invalid_unknown' });
    expect(f.calls).not.toContain('display-write');

    const hidden = fixture();
    hidden.setHiddenDisplayField();
    await expect(auditedRefresh(request(), hidden.ports)).rejects.toMatchObject({ code: 'display_manifest_mismatch' });
    expect(hidden.calls).not.toContain('display-write');
  });
});
