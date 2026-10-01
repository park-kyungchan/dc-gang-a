import { parkMainTopMigrationAudit, shiftMainAddress48 } from './parkMainTopMigrationAudit';

const RECEIPT_SHA256 = 'c641630c9967baed1e3152e60b519cf488cc855ddd089fae995221dda6a4f48c';
const METADATA_SHA256 = '4e6131816114ee219c47aa9da5837ba9037a24cdfef9400cd77562c9f6b42a77';
const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireCondition(value: unknown): asserts value { if (!value) throw new Error('native_preview_source_mismatch'); }

/** The legacy receipt's ownerUser label means the connected SDK user, never Drive ownership. */
export function connectedUserEditorObservation(details: Record<string, unknown>): boolean {
  const legacy = details.ownerUserIsExplicitEditor;
  const current = details.connectedUserIsExplicitEditor;
  if (typeof legacy !== 'boolean' && typeof current !== 'boolean') throw new Error('connected_editor_observation_missing');
  if (typeof legacy === 'boolean' && typeof current === 'boolean' && legacy !== current) throw new Error('connected_editor_alias_conflict');
  return typeof current === 'boolean' ? current : legacy as boolean;
}

/** Pure, exact-evidence preview. Produces no API request or executable mutation batch. */
export function buildNativePreservationPreview(summary: unknown, receiptSha256: string) {
  requireCondition(receiptSha256 === RECEIPT_SHA256 && record(summary) && summary.receipt === 'read_summary'
    && summary.requestedMetadataSha256 === METADATA_SHA256 && summary.responseScopeGuardPassed === true
    && summary.cellValuesRead === false && summary.writesPerformed === false
    && summary.target?.sheetId === parkMainTopMigrationAudit.targetSheetId);
  const grid = summary.grid?.details, chart = summary.chart?.details, protection = summary.protection?.details;
  requireCondition(record(grid) && grid.rowCount === 160 && grid.columnCount === 16 && grid.frozenRowCount === 2
    && record(chart) && chart.chartId === 1728410094 && chart.chartType?.value === 'COMBO'
    && chart.series?.state === 'absent' && chart.domains?.count === 1
    && record(protection) && protection.protectedRangeId === 1054892822 && protection.enforced === true
    && Object.keys(protection.range ?? {}).length === 1 && protection.range.sheetId === summary.target.sheetId
    && summary.merges?.count === 48);
  const sourceRange = chart.sourceRanges?.[0], overlay = chart.position?.overlayPosition;
  requireCondition(chart.sourceRanges?.length === 1 && sourceRange?.startRowIndex === 5 && sourceRange.endRowIndex === 9
    && sourceRange.startColumnIndex === 0 && sourceRange.endColumnIndex === 1
    && sourceRange.sheetId === summary.target.sheetId && overlay?.anchorCell?.rowIndex === 20
    && overlay.anchorCell.columnIndex === 6 && overlay.anchorCell.sheetId === summary.target.sheetId
    && overlay.offsetXPixels === 20 && overlay.offsetYPixels === 27 && overlay.widthPixels === 818 && overlay.heightPixels === 350
    && JSON.stringify([...protection.unprotectedCells].sort()) === JSON.stringify(['I5', 'I8'])
    && protection.editorUserCount === 3 && protection.editorGroupCount === 0 && protection.domainUsersCanEdit === false);
  const connectedEditor = connectedUserEditorObservation(protection);
  const shifts = [
    { subject: 'chart_anchor', before: 'G21', after: shiftMainAddress48('G21') },
    { subject: 'chart_domain', before: 'A6:A9', after: shiftMainAddress48('A6:A9') },
    ...['I5', 'I8'].map(before => ({ subject: 'protection_exception', before, after: shiftMainAddress48(before) })),
  ];
  return {
    schemaVersion: 1,
    status: 'reviewable_preview_blocked_for_execution',
    observedAtUtc: summary.verifiedAt,
    canonicalCheckpoint: 'handoffs/workflow-current-state.json',
    evidence: { fileName: 'sheet-native-preservation-repeat-receipts-2026-10-01.jsonl', location: 'workspace_parent',
      receiptSha256, metadataSha256: METADATA_SHA256, meaning: 'Verified bounded metadata read, not preservation or deployment acceptance' },
    target: { spreadsheetId: summary.spreadsheetId, sheetId: summary.target.sheetId, title: summary.target.title },
    verifiedBefore: {
      grid: { rows: 160, columns: 16, frozenRows: 2 }, mergeCount: 48,
      chart: { id: chart.chartId, type: 'COMBO', domain: 'A6:A9', series: 'absent', anchor: 'G21',
        offsetsPixels: { x: 20, y: 27 }, sizePixels: { width: 818, height: 350 },
        specSha256: chart.returnedSpecSha256, positionSha256: chart.returnedPositionSha256,
        interpretation: 'Absent series is an observed state; do not invent a series or replace/rebuild this chart' },
      protection: { id: protection.protectedRangeId, scope: 'entire_sheet', enforced: true,
        unprotectedCells: ['I5', 'I8'], explicitUsers: 3, groups: 0, domainUsersCanEdit: false,
        botIsExplicitEditor: protection.botIsExplicitEditor, connectedUserIsExplicitEditor: connectedEditor,
        requestingUserCanEdit: protection.requestingUserCanEdit, requestingPrincipal: 'canonical_sheet_bot',
        spreadsheetOwnerVerified: false },
    },
    declaredCandidate: {
      source: 'src/sheets/parkMainTopMigrationAudit.ts',
      insertion: { dimension: 'ROWS', startIndex: 0, endIndex: 48 },
      template: 'A1:R47', spacer: 'A48:R48', originalContent: { before: 'A1:P160', expectedAfter: 'A49:P208' },
      rowInsertionOnlyGrid: { rows: 208, columns: 16 },
      candidateFinalGrid: { rows: 208, columns: 18 },
      separateColumnDecision: 'The 18-column template needs Q:R expansion; a 48-row insertion alone does not add columns',
      studentValuesToWrite: 0,
    },
    machineCheckedCoordinateExpectations: {
      verification: 'Arithmetic only; actual native relocation has not been rehearsed', shifts,
      zeroBasedChartAnchor: { before: { rowIndex: 20, columnIndex: 6 }, expectedAfter: { rowIndex: 68, columnIndex: 6 } },
      zeroBasedChartDomain: { before: sourceRange, expectedAfter: { ...sourceRange, startRowIndex: 53, endRowIndex: 57 } },
      chartIdentityPixelsAndUnconfiguredSeries: 'Preserve chart ID, spec semantics, offsets, size, and absent-series state; verify native source-reference relocation',
    },
    protectionDecision: {
      preserve: 'Keep the original whole-sheet protection semantics and existing editor set, including any expanded grid',
      expectedOriginalExceptions: ['I53', 'I56'], nativeRelocationVerified: false,
      newTopManualInputCells: 'Not approved or inferred. A new editable top block requires an exact separately reviewed exception set',
      prohibitedInference: 'Do not shrink protection to A49:P208 or unlock A1:R48 simply because rows were inserted',
    },
    freezeDecision: {
      verifiedBeforeCount: 2, approvedAfterCount: null,
      rule: 'Native insertion might adjust frozen boundaries. Neither keeping 2 nor inheriting 50 is accepted without native rehearsal and visual review',
    },
    mergeDecision: {
      verifiedOriginalCount: 48, exactOriginalRangesAvailableInReceipt: false,
      rule: 'Existing merges must relocate without loss. Original count is not an exact merge map; template merges are declared source, not verified native results',
    },
    remainingAcceptance: [
      'Native image/drawing inventory and preservation, beyond the verified chart',
      'Native backup fidelity and inverse rollback rehearsal; digests and summaries are not restorable backups',
      'Native reference relocation for formulas, names, chart sources, merge coordinates, validations, notes, and protection exceptions',
      'Live SPT/other-consumer inventory and quiescence, then fresh identity rebinding rather than blindly adding 48 to persisted mainRow values',
      'Teacher review of freeze behavior, Q:R expansion, template layout, and any new manual-input exceptions',
      'Fresh exact-target checks and approval of the complete reversible production batch before any write',
    ],
    minimalUserOutcome: 'Review this preservation-first transition preview and the remaining native rehearsal decisions; no production mutation is needed to review it',
    authorization: { apiRequestsPerformed: 0, cellReadsPerformed: 0, writesPerformed: 0,
      nativeBehaviorVerified: false, preservationAcceptanceEstablished: false, deploymentPerformed: false,
      executableMutationBatchProduced: false, grantsFurtherTokenOrReadApproval: false },
  };
}
