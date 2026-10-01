/**
 * Pure, non-executable Main Sheet preview. No transport, credentials or writer.
 * The A:P design is proposed; an observed legacy tab is never treated as adopted.
 */
import { assertInstant, canonicalJson, digest, immutableCopy, requireText } from "../learning/model.ts";

export const LEARNING_VIEW_LAYOUT_VERSION = "learning-view-ap-v1" as const;
export const LEARNING_VIEW_GRID = Object.freeze({ rows: 160, columns: 16 });
export type CellOwner = "projection" | "teacher" | "preserve";
export interface CellOwnershipRule {
  readonly range: string;
  readonly owner: CellOwner;
  readonly purpose: string;
}

/** Every unspecified cell is preserve-only. The exact allowlist is not authority to write. */
export const LEARNING_VIEW_OWNERSHIP: readonly CellOwnershipRule[] = immutableCopy([
  { range: "A1:P2", owner: "projection", purpose: "Title and snapshot freshness" },
  { range: "A3:P3", owner: "projection", purpose: "Month, date, time, student and edition labels" },
  { range: "B4", owner: "teacher", purpose: "Month selector" },
  { range: "E4", owner: "teacher", purpose: "Date selector" },
  { range: "H4", owner: "teacher", purpose: "Lesson time selector" },
  { range: "K4", owner: "teacher", purpose: "Verified student selector" },
  { range: "N4", owner: "teacher", purpose: "Edition selector" },
  { range: "A5:P5", owner: "projection", purpose: "Major, middle, minor, page and question labels" },
  { range: "B6", owner: "teacher", purpose: "Major unit selector" },
  { range: "E6", owner: "teacher", purpose: "Middle unit selector" },
  { range: "H6", owner: "teacher", purpose: "Minor unit selector" },
  { range: "K6", owner: "teacher", purpose: "Printed page selector" },
  { range: "N6", owner: "teacher", purpose: "Question selector" },
  { range: "A8:P9", owner: "projection", purpose: "Coverage, selected scope and unresolved counts" },
  { range: "A11:P31", owner: "projection", purpose: "Whole-class overview, first 20 rows" },
  { range: "A33:P53", owner: "projection", purpose: "Academy lesson and makeup facts, first 20 rows" },
  { range: "A55:P75", owner: "projection", purpose: "Teacher present and future plans, first 20 rows" },
  { range: "A77:P117", owner: "projection", purpose: "Edition, unit, page and question audit, first 40 rows" },
  { range: "A119:P139", owner: "projection", purpose: "Unresolved identity and filter matches, first 20 rows" },
  { range: "A141:P142", owner: "projection", purpose: "Fixed teacher editor labels" },
  { range: "A143:P146", owner: "teacher", purpose: "Fixed input and raw note; explicit record action only" },
  { range: "A148:P160", owner: "projection", purpose: "Section pagination, provenance and review warnings" },
]);
export const LEARNING_VIEW_AUTO_RANGES = Object.freeze(
  LEARNING_VIEW_OWNERSHIP.filter(rule => rule.owner === "projection").map(rule => rule.range),
);
export const LEARNING_VIEW_MANUAL_RANGES = Object.freeze(
  LEARNING_VIEW_OWNERSHIP.filter(rule => rule.owner === "teacher").map(rule => rule.range),
);

/** Observed boundaries only, not a migration map or permission to modify other tabs. */
export const EXISTING_SHEET_PRESERVATION = immutableCopy({
  main: { selectors: ["I5", "I8"], observedGrid: { rows: 160, columns: 16 }, layoutAdopted: false },
  todayPanel: {
    dateSelector: "C5", headerRange: "B9:U9", inputRows: "10:39",
    sourceOwnedRanges: ["B10:D39", "H10:H39", "K10:K39", "Q10:Q39"],
    teacherOwnedRanges: ["E10:G39", "I10:J39", "L10:P39", "R10:U39"],
  },
  supportTabs: [
    { title: "DB_원생_SYNC", header: "A1:G1", owner: "source" },
    { title: "DB_수업로그_SYNC", header: "A1:T1", owner: "source" },
    { title: "DB_학생현황_캐시", header: "A1:K1", owner: "derived" },
    { title: "DB_강사_피드백", header: "A1:I1", owner: "teacher" },
  ],
  legacyTables: "Preserve all existing 박경찬_DB_* tables and consumers",
  otherTabs: "Preserve every non-target tab; hidden does not mean private",
});

interface Bounds { firstRow: number; lastRow: number; firstColumn: number; lastColumn: number }
function parseRange(range: string): Bounds {
  const match = /^([A-P])([1-9]\d*)(?::([A-P])([1-9]\d*))?$/.exec(range);
  if (!match) throw new Error("Only exact unqualified A:P cell ranges are supported");
  const firstColumn = match[1]!.charCodeAt(0) - 65;
  const lastColumn = (match[3] ?? match[1])!.charCodeAt(0) - 65;
  const firstRow = Number(match[2]);
  const lastRow = Number(match[4] ?? match[2]);
  if (lastRow < firstRow || lastColumn < firstColumn || lastRow > LEARNING_VIEW_GRID.rows) {
    throw new Error("Range is outside the proposed A1:P160 view");
  }
  return { firstRow, lastRow, firstColumn, lastColumn };
}
export function cellsInLearningRange(range: string): readonly string[] {
  const bounds = parseRange(range);
  const cells: string[] = [];
  for (let row = bounds.firstRow; row <= bounds.lastRow; row++) {
    for (let column = bounds.firstColumn; column <= bounds.lastColumn; column++) {
      cells.push(`${String.fromCharCode(65 + column)}${row}`);
    }
  }
  return cells;
}
export function learningCellOwner(cell: string): CellOwner {
  const point = parseRange(cell);
  if (cell.includes(":")) throw new Error("A cell address is required");
  return LEARNING_VIEW_OWNERSHIP.find(rule => {
    const range = parseRange(rule.range);
    return point.firstRow >= range.firstRow && point.firstRow <= range.lastRow &&
      point.firstColumn >= range.firstColumn && point.firstColumn <= range.lastColumn;
  })?.owner ?? "preserve";
}

export type LiteralValue = string | number | boolean | null;
export interface LiteralCell {
  readonly cell: string;
  /** String prefixes such as '=' remain literal. No generated formula API exists. */
  readonly value: LiteralValue;
  readonly valueKind: "literal";
}
export interface ObservedCell {
  readonly cell: string;
  readonly value: LiteralValue;
  readonly formula: string | null;
  readonly note: string | null;
  readonly protected: boolean;
  readonly teacherOwned: boolean;
}
export interface MainSheetTarget {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly title: string;
}
export interface MainSheetSnapshot {
  readonly target: MainSheetTarget;
  readonly snapshotId: string;
  readonly observedAt: string;
  readonly revisionToken: string;
  readonly layoutVersion: string;
  readonly rows: number;
  readonly columns: number;
  readonly inventory: {
    readonly cellsComplete: boolean;
    readonly formulasComplete: boolean;
    readonly protectionsComplete: boolean;
    readonly manualOwnershipComplete: boolean;
    readonly structureFingerprint: string;
    readonly protectionFingerprint: string;
  };
  /** Full A1:P160 capture. Missing cells are not assumed blank. */
  readonly cells: readonly ObservedCell[];
}
export interface MainSheetValueDiff {
  readonly cell: string;
  readonly before: LiteralValue;
  readonly after: LiteralValue;
  readonly valueKind: "literal";
  readonly reason: "projection_refresh";
}
export interface MainSheetPreviewIssue {
  readonly code: string;
  readonly cells: readonly string[];
}
export interface MainSheetDryRun {
  readonly mode: "dry_run_only";
  readonly executable: false;
  readonly status: "blocked" | "preview_ready";
  readonly target: MainSheetTarget;
  readonly beforeSnapshotId: string;
  readonly observedSnapshotId: string;
  readonly beforeDigest: string;
  readonly observedDigest: string;
  readonly previewDigest: string;
  readonly issues: readonly MainSheetPreviewIssue[];
  readonly changes: readonly MainSheetValueDiff[];
  readonly unchangedCells: readonly string[];
  readonly preservedCells: readonly string[];
  /** Value-only conditional restoration preview. Not a recovery executor. */
  readonly recovery: readonly { cell: string; onlyIfCurrentValueEquals: LiteralValue; restore: LiteralValue }[];
  readonly requiredBeforeAnyProductionBatch: readonly string[];
}
function validateTarget(target: MainSheetTarget): void {
  requireText(target.spreadsheetId, "spreadsheet id");
  requireText(target.title, "tab title");
  if (!Number.isSafeInteger(target.sheetId) || target.sheetId < 0) throw new Error("invalid sheet id");
}
function validateValue(value: LiteralValue): void {
  if (value !== null && typeof value !== "string" && typeof value !== "boolean" &&
    !(typeof value === "number" && Number.isFinite(value))) throw new Error("invalid literal value");
}
function snapshotDigest(snapshot: MainSheetSnapshot): string {
  return digest({ ...snapshot, cells: [...snapshot.cells].sort((a, b) => a.cell.localeCompare(b.cell)) });
}
function inspectSnapshot(snapshot: MainSheetSnapshot, prefix: string): MainSheetPreviewIssue[] {
  validateTarget(snapshot.target);
  requireText(snapshot.snapshotId, "snapshot id");
  requireText(snapshot.revisionToken, "revision token");
  assertInstant(snapshot.observedAt);
  const issues: MainSheetPreviewIssue[] = [];
  if (!Number.isSafeInteger(snapshot.rows) || snapshot.rows < 160 || !Number.isSafeInteger(snapshot.columns) || snapshot.columns < 16) {
    issues.push({ code: `${prefix}_grid_too_small`, cells: [] });
  }
  const inventory = snapshot.inventory;
  if (inventory.cellsComplete !== true || inventory.formulasComplete !== true || inventory.protectionsComplete !== true ||
    inventory.manualOwnershipComplete !== true || !inventory.structureFingerprint.trim() || !inventory.protectionFingerprint.trim()) {
    issues.push({ code: `${prefix}_inventory_incomplete`, cells: [] });
  }
  if (snapshot.layoutVersion !== LEARNING_VIEW_LAYOUT_VERSION) {
    issues.push({ code: `${prefix}_layout_not_adopted`, cells: [] });
  }
  const seen = new Set<string>();
  for (const cell of snapshot.cells) {
    parseRange(cell.cell);
    if (cell.cell.includes(":") || seen.has(cell.cell)) throw new Error("Snapshot cell addresses must be unique");
    seen.add(cell.cell);
    validateValue(cell.value);
    if (cell.formula !== null && (typeof cell.formula !== "string" || !cell.formula.startsWith("="))) throw new Error("Invalid observed formula");
    if (cell.note !== null && typeof cell.note !== "string") throw new Error("Invalid observed note");
    if (typeof cell.protected !== "boolean" || typeof cell.teacherOwned !== "boolean") throw new Error("Missing cell ownership");
  }
  const missing = cellsInLearningRange("A1:P160").filter(cell => !seen.has(cell));
  if (missing.length) issues.push({ code: `${prefix}_cells_missing`, cells: missing });
  return issues;
}

/**
 * Calculates a reviewed value delta, never a Sheets request. Both snapshots and
 * every cell are checked even if a caller reuses a snapshot ID/revision token.
 * maxSnapshotAgeMs is caller policy; there is no invented operational TTL.
 */
export function buildMainSheetDryRun(input: {
  readonly expectedTarget: MainSheetTarget;
  readonly baseline: MainSheetSnapshot;
  readonly observed: MainSheetSnapshot;
  readonly desired: readonly LiteralCell[];
  readonly now: string;
  readonly maxSnapshotAgeMs: number;
}): MainSheetDryRun {
  const { baseline, observed } = input;
  validateTarget(input.expectedTarget);
  assertInstant(input.now);
  if (!Number.isSafeInteger(input.maxSnapshotAgeMs) || input.maxSnapshotAgeMs < 0) throw new Error("Explicit nonnegative snapshot age policy required");
  const issues = [...inspectSnapshot(baseline, "baseline"), ...inspectSnapshot(observed, "observed")];
  for (const [label, snapshot] of [["baseline", baseline], ["observed", observed]] as const) {
    if (canonicalJson(snapshot.target) !== canonicalJson(input.expectedTarget)) issues.push({ code: `${label}_target_mismatch`, cells: [] });
    const age = Date.parse(input.now) - Date.parse(snapshot.observedAt);
    if (age < 0 || age > input.maxSnapshotAgeMs) issues.push({ code: `${label}_snapshot_stale`, cells: [] });
  }
  const before = new Map(baseline.cells.map(cell => [cell.cell, cell]));
  const current = new Map(observed.cells.map(cell => [cell.cell, cell]));
  const changedSinceRead = [...before.keys()].filter(cell => !current.has(cell) || canonicalJson(before.get(cell)) !== canonicalJson(current.get(cell)));
  if (changedSinceRead.length) issues.push({ code: "snapshot_cells_changed", cells: changedSinceRead });
  if (baseline.revisionToken !== observed.revisionToken || baseline.layoutVersion !== observed.layoutVersion ||
    baseline.rows !== observed.rows || baseline.columns !== observed.columns || canonicalJson(baseline.inventory) !== canonicalJson(observed.inventory)) {
    issues.push({ code: "snapshot_metadata_changed", cells: [] });
  }
  const changes: MainSheetValueDiff[] = [];
  const unchangedCells: string[] = [];
  const preservedCells = observed.cells.filter(cell => learningCellOwner(cell.cell) !== "projection" || cell.teacherOwned || cell.protected || cell.formula !== null || cell.note !== null).map(cell => cell.cell);
  const desiredCells = new Set<string>();
  for (const cell of input.desired) {
    parseRange(cell.cell);
    if (cell.cell.includes(":") || desiredCells.has(cell.cell)) throw new Error("Desired cell addresses must be unique");
    desiredCells.add(cell.cell);
    validateValue(cell.value);
    if (cell.valueKind !== "literal") throw new Error("Only literal proposed values are allowed");
    const observedCell = current.get(cell.cell);
    if (!observedCell) { issues.push({ code: "desired_cell_unobserved", cells: [cell.cell] }); continue; }
    if (learningCellOwner(cell.cell) !== "projection") { issues.push({ code: "outside_projection_allowlist", cells: [cell.cell] }); continue; }
    if (observedCell.teacherOwned || observedCell.protected) { issues.push({ code: "manual_or_protected_cell", cells: [cell.cell] }); continue; }
    // Blank values do not make a formula or annotation expendable.
    if (observedCell.formula !== null || observedCell.note !== null) { issues.push({ code: "existing_formula_or_note", cells: [cell.cell] }); continue; }
    if (observedCell.value === cell.value) { unchangedCells.push(cell.cell); continue; }
    changes.push({ cell: cell.cell, before: observedCell.value, after: cell.value, valueKind: "literal", reason: "projection_refresh" });
  }
  const sortCell = (left: string, right: string): number => {
    const a = parseRange(left), b = parseRange(right);
    return a.firstRow - b.firstRow || a.firstColumn - b.firstColumn;
  };
  changes.sort((a, b) => sortCell(a.cell, b.cell));
  unchangedCells.sort(sortCell);
  preservedCells.sort(sortCell);
  const beforeDigest = snapshotDigest(baseline), observedDigest = snapshotDigest(observed);
  const previewDigest = digest({ target: input.expectedTarget, beforeDigest, observedDigest, changes, issues });
  return immutableCopy({
    mode: "dry_run_only", executable: false, status: issues.length ? "blocked" : "preview_ready",
    target: input.expectedTarget, beforeSnapshotId: baseline.snapshotId, observedSnapshotId: observed.snapshotId,
    beforeDigest, observedDigest, previewDigest, issues, changes, unchangedCells, preservedCells,
    recovery: changes.map(change => ({ cell: change.cell, onlyIfCurrentValueEquals: change.after, restore: change.before })),
    requiredBeforeAnyProductionBatch: [
      "Refresh exact native metadata, protections, formulas, manual ownership and all affected cells",
      "Resolve legacy layout conflicts and review all formula and SPT consumers",
      "Obtain teacher approval of the exact target, before/after values and recovery method",
      "Capture and verify a durable before snapshot; stop on concurrent changes",
      "Use a separately reviewed writer and verify same-target readback",
    ],
  });
}
