/** Pure wiring for the deployed Park layout. No scheduler, credentials or writer. */
import { assertDate, assertInstant, canonicalJson, digest, immutableCopy, requireText } from '../learning/model';
import type { DisplayFields, DisplayValue, RefreshScope } from './auditedRefresh';
import type { AcademyReadResult } from '../lms/academyReadAcceptance';

export const DEPLOYED_MAIN = immutableCopy({
  spreadsheetId: '1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg',
  sheetId: 1754681846, title: '박경찬', layoutVersion: 'park-common-47-legacy-86-v1',
  rows: 133, columns: 18, frozenRows: 3, timeZone: 'Asia/Seoul',
  studentSlots: 'C4:R47', preservedLegacy: 'A48:P133', unassignedBlank: 'Q48:R133',
  protectionPolicy: 'do_not_restore_removed_protection',
  requestedRefreshWindow: { start: '13:15', target: '13:30', end: '14:00' },
  requestedRefreshWeekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  teacherPlanColumns: ['O', 'R'],
});

export type RefreshIntent =
  | Readonly<{ trigger: 'manual'; requestId: string; lessonDate: string }>
  | Readonly<{ trigger: 'weekday_preparation' | 'daily_1330'; scheduledLessonDate: string }>;

export type RefreshDispatchDecision =
  | Readonly<{ status: 'not_due' | 'already_claimed' | 'expired_schedule_date' }>
  | Readonly<{ status: 'prepare_refresh'; lessonDate: string; claimKey: string;
      trigger: RefreshIntent['trigger']; effect: 'read_and_prepare_only';
      timing: 'manual' | 'within_requested_window' | 'late' }>;

/**
 * Host calls this after authenticating the command and before atomic durable claim.
 * claimedKeys includes pending/failed/uncertain attempts, not only successes.
 * Scheduled refresh uses Mon–Fri, 13:15–14:00 Asia/Seoul, including the exact
 * endpoints. Delivery and uptime are not guaranteed. A late same-day weekday
 * wake is flagged, not hidden; an old scheduled date is never replayed.
 * daily_1330 is a compatibility alias with the same weekday/window policy.
 * This function does NOT persist a claim or install a runtime trigger.
 */
export function decideRefreshDispatch(
  intent: RefreshIntent, now: string, claimedKeys: readonly string[], scopeIdentity: string,
): RefreshDispatchDecision {
  assertInstant(now); requireText(scopeIdentity, 'scope identity');
  const instant = new Date(now);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: DEPLOYED_MAIN.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(part => [part.type, part.value]));
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  let date: string, identity: string;
  let timing: 'manual' | 'within_requested_window' | 'late' = 'manual';
  if (intent.trigger === 'manual') {
    requireText(intent.requestId, 'request identity'); assertDate(intent.lessonDate);
    date = intent.lessonDate; identity = intent.requestId;
  } else if (intent.trigger === 'weekday_preparation' || intent.trigger === 'daily_1330') {
    assertDate(intent.scheduledLessonDate); date = intent.scheduledLessonDate; identity = date;
    if (date < localDate) return immutableCopy({ status: 'expired_schedule_date' });
    const localTime = `${parts.hour}:${parts.minute}:${parts.second}.${String(instant.getUTCMilliseconds()).padStart(3, '0')}`;
    if (date > localDate || !DEPLOYED_MAIN.requestedRefreshWeekdays.includes(parts.weekday!)
      || localTime < `${DEPLOYED_MAIN.requestedRefreshWindow.start}:00.000`) return immutableCopy({ status: 'not_due' });
    timing = localTime > `${DEPLOYED_MAIN.requestedRefreshWindow.end}:00.000` ? 'late' : 'within_requested_window';
  } else throw new Error('invalid_refresh_trigger');
  // Keep existing durable daily_1330 claims effective across the canonical alias.
  const claimTrigger = intent.trigger === 'manual' ? 'manual' : 'daily_1330';
  const claimKey = digest({ target: DEPLOYED_MAIN.spreadsheetId, sheetId: DEPLOYED_MAIN.sheetId,
    scopeIdentity, trigger: claimTrigger, identity, lessonDate: date });
  return claimedKeys.includes(claimKey) ? immutableCopy({ status: 'already_claimed' })
    : immutableCopy({ status: 'prepare_refresh', lessonDate: date, claimKey, trigger: intent.trigger,
        effect: 'read_and_prepare_only', timing });
}

export type SlotCellOwner = 'source' | 'teacher' | 'preserve';
export interface DeployedRowSnapshot {
  readonly target: Pick<typeof DEPLOYED_MAIN, 'spreadsheetId' | 'sheetId' | 'title' | 'layoutVersion'>;
  readonly grid: { readonly rows: number; readonly columns: number; readonly frozenRows: number };
  readonly observedAt: string;
  readonly structureFingerprint: string;
  readonly ownershipEvidenceRef: string;
  readonly bindingEvidenceRef: string;
  readonly row: number;
  readonly lesson: RefreshScope['lesson'];
  /** Exact native C:R row, including explicit blanks; supplied by a trusted adapter. */
  readonly cells: readonly { readonly cell: string; readonly owner: SlotCellOwner;
    readonly value: DisplayValue; readonly formula: string | null; readonly note: string | null }[];
}

export interface SourceCellProjection {
  readonly cell: string;
  readonly value: DisplayValue;
  readonly lesson: RefreshScope['lesson'];
  readonly sourceEvidenceRef: string;
  /** Separately reviewed source-field → template-column meaning, not a guessed label join. */
  readonly sourceFieldContractRef: string;
}

function valueValid(value: DisplayValue): void {
  if (value.kind === 'unknown') requireText(value.reason, 'unknown reason');
  else if (value.kind !== 'known' || !Object.hasOwn(value, 'value')
    || (value.value !== null && !['string', 'boolean', 'number'].includes(typeof value.value))
    || (typeof value.value === 'number' && !Number.isFinite(value.value))) throw new Error('invalid_display_value');
}

/**
 * Explicit ownership and exact occurrence binding are required, never inferred
 * from the name, an empty cell, removed selectors or the historical A:P renderer.
 * Result is review data compatible with auditedRefresh, NOT an approved request.
 */
export function prepareDeployedRowRefresh(
  snapshot: DeployedRowSnapshot, source: readonly SourceCellProjection[], now: string, maxAgeMs: number,
) {
  assertInstant(now); assertInstant(snapshot.observedAt);
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs <= 0) throw new Error('invalid_freshness_policy');
  const age = Date.parse(now) - Date.parse(snapshot.observedAt);
  if (age < 0 || age > maxAgeMs) throw new Error('stale_sheet_snapshot');
  const expectedTarget = { spreadsheetId: DEPLOYED_MAIN.spreadsheetId, sheetId: DEPLOYED_MAIN.sheetId,
    title: DEPLOYED_MAIN.title, layoutVersion: DEPLOYED_MAIN.layoutVersion };
  if (canonicalJson(snapshot.target) !== canonicalJson(expectedTarget)
    || canonicalJson(snapshot.grid) !== canonicalJson({ rows: 133, columns: 18, frozenRows: 3 })) {
    throw new Error('deployed_target_or_layout_mismatch');
  }
  [snapshot.structureFingerprint, snapshot.ownershipEvidenceRef, snapshot.bindingEvidenceRef].forEach(value => requireText(value, 'binding evidence'));
  Object.values(snapshot.lesson).forEach(value => requireText(value, 'lesson identity'));
  assertDate(snapshot.lesson.date);
  if (!Number.isSafeInteger(snapshot.row) || snapshot.row < 4 || snapshot.row > 47) throw new Error('outside_student_slots');
  const addresses = Array.from({ length: 16 }, (_, i) => `${String.fromCharCode(67 + i)}${snapshot.row}`);
  if (snapshot.cells.length !== addresses.length || new Set(snapshot.cells.map(cell => cell.cell)).size !== addresses.length
    || snapshot.cells.some(cell => !addresses.includes(cell.cell))) throw new Error('incomplete_row_inventory');
  const before: DisplayFields = {}, proposed: DisplayFields = {};
  for (const cell of snapshot.cells) {
    if (!['source', 'teacher', 'preserve'].includes(cell.owner)) throw new Error('unbound_cell_owner');
    valueValid(cell.value); before[cell.cell] = cell.value; proposed[cell.cell] = cell.value;
  }
  if (!source.length || new Set(source.map(cell => cell.cell)).size !== source.length) throw new Error('invalid_projection_manifest');
  for (const projection of source) {
    const target = snapshot.cells.find(cell => cell.cell === projection.cell);
    if (!target || target.owner !== 'source') throw new Error('projection_not_source_owned');
    if (['O', 'R'].includes(projection.cell[0]!)) throw new Error('expected_end_date_is_teacher_plan');
    if (target.formula !== null || target.note !== null) throw new Error('annotated_cell_requires_review');
    if (canonicalJson(projection.lesson) !== canonicalJson(snapshot.lesson)) throw new Error('source_occurrence_mismatch');
    requireText(projection.sourceEvidenceRef, 'source evidence');
    requireText(projection.sourceFieldContractRef, 'source field contract'); valueValid(projection.value);
    proposed[projection.cell] = projection.value;
  }
  const changes = addresses.filter(cell => canonicalJson(before[cell]) !== canonicalJson(proposed[cell]))
    .map(cell => ({ cell, before: before[cell]!, after: proposed[cell]! }));
  return immutableCopy({
    kind: 'deployed_row_refresh_review' as const, executable: false as const,
    scope: { workbookId: snapshot.target.spreadsheetId, sheetId: snapshot.target.sheetId,
      rangeA1: `C${snapshot.row}:R${snapshot.row}`, lesson: snapshot.lesson } satisfies RefreshScope,
    displayedFields: addresses, before, proposed, changes,
    preservedCells: snapshot.cells.filter(cell => cell.owner !== 'source').map(cell => cell.cell).sort(),
    structuralPrecondition: snapshot.structureFingerprint,
    bindingEvidenceRef: snapshot.bindingEvidenceRef, ownershipEvidenceRef: snapshot.ownershipEvidenceRef,
    reviewDigest: digest({ snapshot, source, before, proposed }),
    requiredWriteMask: 'changed_source_cells_userEnteredValue_only' as const,
    requiredBeforeWrite: ['accepted_fresh_source_read', 'exact_batch_approval', 'verified_teacher_only_before_ledger',
      'fresh_structure_and_binding_check', 'compare_complete_row_before', 'same_target_readback'] as const,
  });
}

/** Trusted runtime entry point: a successful login or DOM shell cannot unlock projection. */
export function prepareAcceptedDeployedRowRefresh(
  receipt: AcademyReadResult, snapshot: DeployedRowSnapshot, source: readonly SourceCellProjection[],
  trigger: RefreshIntent['trigger'], now: string, maxAgeMs: number,
) {
  if (receipt.status !== 'accepted') return immutableCopy({ status: 'blocked' as const,
    reason: 'source_read_not_accepted', sourceStatus: receipt.status });
  if (trigger !== 'manual' && receipt.mode !== 'unattended') return immutableCopy({ status: 'blocked' as const,
    reason: 'unattended_source_read_not_verified', sourceStatus: receipt.status });
  assertInstant(now); assertInstant(receipt.observedAt);
  const age = Date.parse(now) - Date.parse(receipt.observedAt);
  if (age < 0 || age > maxAgeMs) return immutableCopy({ status: 'blocked' as const,
    reason: 'source_read_stale', sourceStatus: receipt.status });
  const expected = { teacherId: snapshot.lesson.teacherId, date: snapshot.lesson.date,
    groupId: snapshot.lesson.groupId, studentId: snapshot.lesson.studentId, courseId: snapshot.lesson.courseId,
    recordId: snapshot.lesson.recordId, membershipId: snapshot.lesson.curriculumId, occurrenceId: snapshot.lesson.occurrenceId };
  if (canonicalJson(receipt.scope) !== canonicalJson(expected)
    || source.some(cell => !receipt.evidenceRefs.includes(cell.sourceEvidenceRef))) {
    return immutableCopy({ status: 'blocked' as const, reason: 'source_receipt_scope_or_evidence_mismatch', sourceStatus: receipt.status });
  }
  return immutableCopy({ status: 'review_ready' as const,
    review: prepareDeployedRowRefresh(snapshot, source, now, maxAgeMs),
    readEvidenceRefs: receipt.evidenceRefs, productionWriteAuthorized: false as const });
}
