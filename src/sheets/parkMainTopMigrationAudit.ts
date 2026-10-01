/** Read-only migration review. This module has no Sheet, network, or database writer. */
export const parkMainTopMigrationAudit = {
  schemaVersion: 1,
  status: 'blocked_pending_native_evidence',
  scope: 'insert_48_rows_preserve_all_original_main_cells',
  targetSheetId: 1754681846,
  sourceTemplateSheetId: 0,
  beforeGrid: { rows: 160, columns: 16 },
  afterGrid: { rows: 208, columns: 18 },
  insertion: { dimension: 'ROWS', startIndex: 0, endIndex: 48 },
  templateRange: 'A1:R47',
  spacerRange: 'A48:R48',
  preservedBefore: 'A1:P160',
  preservedAfter: 'A49:P208',
  selectorMoves: { I5: 'I53', I8: 'I56' },
  sourceNotesMove: { before: 'A75:P132', after: 'A123:P180' },
  productionStudentCellsInTemplate: 'C4:R47',
  productionStudentValuesToWrite: 0,
  preserveColumnWidths: 'A:P',
  sourceTemplateHeightPixels: 21,
  nativeChartIdsToPreserve: [1728410094],
  sourceMerges: ['A2:A3', 'B2:B3', 'C2:C3', 'D2:D3', 'E2:L2', 'M2:R2',
    'A4:A47', 'B4:B8', 'B9:B17', 'B18:B30', 'B31:B47'],
  blockedLegacyPlan: {
    path: 'src/sheets/parkMainSheetCutoverSpec.ts',
    reason: 'Historical clear-and-rebuild plan must not overwrite original A1:P160.',
  },
  sourceConsumers: [
    { path: 'spt/integrations/tracker/SPTBridge.gs', lines: '176-183', risk: 'All nonempty column-C rows after row 3 become mainSource rows; no bounded student table.' },
    { path: 'spt/lib/sheet-bridge.ts', lines: '42-62', risk: 'Confirmed mappings use absolute mainRow and fail after insertion until freshly reviewed.' },
    { path: 'spt/app/api/sheet/route.ts', lines: '14-23', risk: 'Connect persists confirmed mappings and a roster revision; source edits alone do not migrate deployed D1 state.' },
    { path: 'spt/lib/roster.ts', lines: '5-14', risk: 'Roster source provenance also stores mainRow and snapshot hash.' },
  ],
  requirements: [
    'No production clear, paste-all, XLSX import, duplicate tab, synthetic record, or external consumer change.',
    'Native row insertion must relocate original values, formulas, merges, validations, notes, conditional formats, and existing object references together.',
    'Do not manually rewrite every formula by regex; direct, absolute, cross-tab, named, string, INDIRECT, QUERY, and external references need distinct verification.',
    'Inspect native protection mode, editors, range, and unprotectedRanges before/after; export omission is not proof of absence.',
    'Preserve chart identity, spec, source ranges, anchor and size; native chart 1728410094 is absent from the inspected XLSX export.',
    'Reconcile all live consumers and outstanding sync leases; SPT pause alone does not prove integrations or triggers are stopped.',
    'Reconfirm student-ID mappings using fresh source snapshots after migration; do not blindly add 48 to persisted mapping records.',
    'Use ephemeral before/readback digests and structural summaries; do not duplicate real student records into the prototype, Git, or logs.',
    'Freeze count, merged header visibility and narrow G-column readability require a native dry run; do not inherit a 50-row freeze accidentally.',
  ],
} as const;

export const migrationGateIds = [
  'exact_batch_approved',
  'fresh_native_target_inventory',
  'native_protection_and_exceptions',
  'native_chart_and_image_inventory',
  'native_reference_relocation_rehearsal',
  'live_consumer_inventory_and_quiescence',
  'post_insert_identity_rebinding_plan',
  'inverse_rollback_rehearsal',
  'native_top_layout_visual_review',
] as const;

export type MigrationGateId = typeof migrationGateIds[number];
export type MigrationEvidence = Partial<Record<MigrationGateId, {
  readonly status: 'verified' | 'unverified';
  readonly observedAt?: string;
  readonly source?: string;
}>>;

/** Calendar-valid ISO instant with an explicit, known offset; no inferred local timezone. */
function isStrictZonedInstant(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const leap = year! % 4 === 0 && (year! % 100 !== 0 || year! % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month! < 1 || month! > 12 || day! < 1 || day! > monthDays[month! - 1]!
    || hour! > 23 || minute! > 59 || second! > 59) return false;
  const zone = match[7]!;
  // RFC 3339 -00:00 marks an unknown offset, rather than a known instant source.
  if (zone === '-00:00') return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** A report, not permission or an executable plan. A dated claim without a source is not verified. */
export function evaluateTopMigrationReadiness(evidence: MigrationEvidence) {
  const blockers = migrationGateIds.filter(id => {
    const item = evidence[id];
    return item?.status !== 'verified' || !item.source?.trim()
      || !item.observedAt || !isStrictZonedInstant(item.observedAt);
  });
  return { status: blockers.length ? 'blocked' : 'ready_for_exact_batch_review', blockers,
    performsWrites: false as const };
}

/** Translate one reviewed single-sheet cell/range address, never a formula or arbitrary text. */
export function shiftMainAddress48(address: string): string {
  const match = /^(\$?[A-P]\$?)([1-9]\d*)(?::(\$?[A-P]\$?)([1-9]\d*))?$/.exec(address);
  if (!match) throw new Error('unsupported_main_address');
  const start = Number(match[2]);
  const end = match[4] === undefined ? start : Number(match[4]);
  const startColumn = match[1]!.replaceAll('$', '');
  const endColumn = (match[3] ?? match[1])!.replaceAll('$', '');
  if (start > 160 || end > 160 || end < start || endColumn < startColumn) {
    throw new Error('address_outside_preserved_main');
  }
  return `${match[1]}${start + 48}${match[3] ? `:${match[3]}${end + 48}` : ''}`;
}

export type InverseRollbackEvidence = {
  readonly exactOriginalContentRecoveredBelow: boolean;
  readonly originalObjectsAndProtectionsRecoverable: boolean;
  readonly insertedBlockEqualsApprovedLabels: boolean;
  readonly noConcurrentOrSubsequentEdits: boolean;
  readonly noConsumerResumed: boolean;
};

/** Never delete inserted rows blindly after an uncertain write or a teacher edit. */
export function canReviewInverseRollback(evidence: InverseRollbackEvidence): boolean {
  const fields: readonly (keyof InverseRollbackEvidence)[] = ['exactOriginalContentRecoveredBelow',
    'originalObjectsAndProtectionsRecoverable', 'insertedBlockEqualsApprovedLabels',
    'noConcurrentOrSubsequentEdits', 'noConsumerResumed'];
  return fields.every(field => evidence[field] === true) && Object.keys(evidence).length === fields.length;
}
