/**
 * Pure, dry-run layout planner for consolidating one instructor's tabs into
 * the existing Main tab. This module has no Google Sheets/API dependency and
 * never constructs write requests.
 */

export const MAIN_RESERVED_RANGE = "A1:P72";
export const REQUIRED_SOURCE_TAB_COUNT = 15;

export interface SheetIdentity {
  readonly sheetId: number;
  readonly title: string;
}

export interface FormulaCellMetadata {
  readonly cell: string;
  readonly formula: string;
}

export interface AppendTableMetadata {
  /** Stable, caller-provided identifier; unique within the source tab. */
  readonly tableId: string;
  /** Full table capacity, not just its currently populated rows. */
  readonly range: string;
  /** First row that may receive a new record. */
  readonly nextRow: number;
}

/**
 * All ranges are local A1 ranges without a sheet prefix. Null `usedRange` or
 * `formulaRange` means that the caller explicitly observed no such cells.
 * Capacity and reservation arrays must be present even when empty.
 */
export interface SheetMetadata extends SheetIdentity {
  readonly gridRows: number;
  readonly gridColumns: number;
  readonly usedRange: string | null;
  readonly formulaRange: string | null;
  readonly validationRanges: readonly string[];
  readonly inputCapacityRanges: readonly string[];
  readonly reservedRanges: readonly string[];
  readonly capacityInventoryComplete: boolean;
  readonly formulaInventoryComplete: boolean;
  readonly formulas: readonly FormulaCellMetadata[];
  readonly appendTables: readonly AppendTableMetadata[];
}

export interface TargetGridLimits {
  /** Optional hard maximum; omitted means that expansion may be proposed. */
  readonly maxRows?: number;
  /** Optional hard maximum; omitted means that expansion may be proposed. */
  readonly maxColumns?: number;
  /** Optional maximum for the resulting rowCount * columnCount. */
  readonly maxCells?: number;
}

export interface OneTabMigrationRequest {
  readonly ownerName: string;
  readonly expectedMain: SheetIdentity;
  readonly main: SheetMetadata;
  /** Exact, complete registry of the 15 owner tabs that will be consolidated. */
  readonly expectedSourceSheets: readonly SheetIdentity[];
  readonly sourceSheets: readonly SheetMetadata[];
  /** Empty rows inserted between consecutive source blocks. Defaults to one. */
  readonly gapRows?: number;
  /** Only supplied limits block a proposed Main grid expansion. */
  readonly targetGridLimits?: TargetGridLimits;
}

export interface A1Range {
  readonly startColumn: number;
  readonly startRow: number;
  readonly endColumn: number;
  readonly endRow: number;
}

export interface FormulaRewriteRequirement {
  readonly sheetId: number;
  readonly title: string;
  readonly cell: string;
  readonly reason: "formula_moves_with_source_block" | "references_migrated_sheet";
  readonly referencedMigratedSheetIds: readonly number[];
  /** Formula translation is intentionally left for a separately reviewed step. */
  readonly automaticRewriteAvailable: false;
}

export interface AppendTargetPlan {
  readonly tableId: string;
  readonly sourceRange: string;
  readonly destinationRange: string;
  readonly sourceNextRow: number;
  readonly destinationNextRow: number;
  readonly destinationEndRow: number;
  readonly rowsRemaining: number;
}

export interface SourceRangeInventory {
  readonly usedRange: string | null;
  readonly formulaRange: string | null;
  readonly validationRanges: readonly string[];
  readonly inputCapacityRanges: readonly string[];
  readonly reservedRanges: readonly string[];
}

export interface SourceBlockPlan {
  readonly source: SheetIdentity;
  /** Union of value, formula, validation, input-capacity, and reserved extents. */
  readonly sourceEffectiveRange: string;
  /** Original caller-provided extents retained verbatim for traceability. */
  readonly sourceExtents: SourceRangeInventory;
  readonly destination: SheetIdentity;
  readonly destinationRange: string;
  readonly sourceRowCount: number;
  readonly destinationRowCount: number;
  readonly rowOffset: number;
  readonly columnOffset: number;
  readonly appendTargets: readonly AppendTargetPlan[];
}

export interface ExternalConsumerBlocker {
  readonly path: string;
  readonly summary: string;
  readonly requiredBeforeSourceTabRetirement: string;
}

export interface OneTabMigrationPlan {
  readonly status: "layout_planned";
  readonly mode: "dry_run_only";
  readonly ownerName: string;
  readonly main: SheetIdentity;
  /** Existing layout area retained by the plan; workbook protection was not inspected. */
  readonly reservedMainRange: typeof MAIN_RESERVED_RANGE;
  readonly mainOccupiedRange: string;
  readonly firstSourceRow: number;
  readonly requiredMainGridRows: number;
  readonly requiredMainGridColumns: number;
  readonly proposedMainGridExpansion: {
    readonly observed: { readonly rowCount: number; readonly columnCount: number };
    readonly required: { readonly rowCount: number; readonly columnCount: number };
    readonly proposed: { readonly rowCount: number; readonly columnCount: number };
    readonly rowsToAdd: number;
    readonly columnsToAdd: number;
    readonly resultingCellCount: number;
  };
  readonly sourceBlocks: readonly SourceBlockPlan[];
  readonly formulaRewriteRequirements: readonly FormulaRewriteRequirement[];
  readonly formulaInventoryScope: "main_and_expected_owner_tabs";
  readonly externalInboundFormulaReferencesScanned: false;
  readonly formulaRewriteStatus: "scoped_inventory_clear" | "manual_review_required";
  readonly sourceTabsMayBeRetired: false;
  readonly externalConsumerBlockers: readonly ExternalConsumerBlocker[];
}

export type PlanErrorCode =
  | "INVALID_OWNER_NAME"
  | "INVALID_GAP_ROWS"
  | "INVALID_IDENTITY"
  | "NON_OWNER_TITLE"
  | "MAIN_IDENTITY_MISMATCH"
  | "DUPLICATE_SHEET_ID"
  | "SOURCE_SET_MISMATCH"
  | "INVALID_GRID_SIZE"
  | "INVALID_GRID_LIMIT"
  | "CAPACITY_INVENTORY_INCOMPLETE"
  | "INVALID_A1_RANGE"
  | "RANGE_OUTSIDE_GRID"
  | "FORMULA_INVENTORY_INCOMPLETE"
  | "INVALID_FORMULA_CELL"
  | "FORMULA_OUTSIDE_DECLARED_EXTENT"
  | "UNSUPPORTED_FORMULA_PATTERN"
  | "INVALID_APPEND_TABLE"
  | "APPEND_TABLE_CAPACITY_EXHAUSTED"
  | "TARGET_GRID_LIMIT_EXCEEDED"
  | "SOURCE_ROWS_LOST"
  | "OVERLAPPING_DESTINATION_BLOCKS";

export interface PlanError {
  readonly code: PlanErrorCode;
  readonly sheetId?: number;
  readonly cell?: string;
  readonly detail: string;
}

export type OneTabMigrationPlanResult =
  | { readonly ok: true; readonly plan: OneTabMigrationPlan }
  | { readonly ok: false; readonly errors: readonly PlanError[] };

const EXTERNAL_CONSUMER_BLOCKERS: readonly ExternalConsumerBlocker[] = [
  {
    path: "spt/integrations/tracker/SPTBridge.gs",
    summary: "The imported SPT Apps Script source hardcodes owner tab names.",
    requiredBeforeSourceTabRetirement:
      "Audit each reference and verify its replacement before renaming or retiring any companion tab.",
  },
  {
    path: "spt/integrations/tracker/Tracker.gs",
    summary: "Tracker.gs references the owner DB_수업 and 보강 tabs.",
    requiredBeforeSourceTabRetirement:
      "Audit each reference and verify its replacement before renaming or retiring any companion tab.",
  },
];

const UNSUPPORTED_FUNCTIONS = ["INDIRECT", "OFFSET", "ADDRESS", "CELL", "IMPORTRANGE"] as const;

interface ParsedRange extends A1Range {
  readonly text: string;
}

interface ParsedSheet {
  readonly metadata: SheetMetadata;
  readonly extents: readonly ParsedRange[];
  readonly effective: ParsedRange;
}

function columnToNumber(column: string): number {
  let value = 0;
  for (const character of column.toUpperCase()) {
    value = value * 26 + character.charCodeAt(0) - 64;
  }
  return value;
}

function numberToColumn(value: number): string {
  let remainder = value;
  let result = "";
  while (remainder > 0) {
    remainder -= 1;
    result = String.fromCharCode(65 + (remainder % 26)) + result;
    remainder = Math.floor(remainder / 26);
  }
  return result;
}

/** Parses a single-cell or rectangular A1 range. Named/whole-row ranges fail closed. */
export function parseA1Range(value: string): A1Range | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) return null;

  const parseCell = (cell: string): { column: number; row: number } | null => {
    const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(cell.trim());
    if (!match) return null;
    const column = columnToNumber(match[1]!);
    const row = Number(match[2]);
    if (!Number.isSafeInteger(row) || row < 1 || column < 1 || column > 18278) return null;
    return { column, row };
  };

  const first = parseCell(parts[0]!);
  const last = parseCell(parts[1] ?? parts[0]!);
  if (!first || !last || last.row < first.row || last.column < first.column) return null;
  return {
    startColumn: first.column,
    startRow: first.row,
    endColumn: last.column,
    endRow: last.row,
  };
}

function formatRange(range: A1Range): string {
  const start = `${numberToColumn(range.startColumn)}${range.startRow}`;
  const end = `${numberToColumn(range.endColumn)}${range.endRow}`;
  return start === end ? start : `${start}:${end}`;
}

function unionRanges(ranges: readonly ParsedRange[]): ParsedRange | null {
  if (ranges.length === 0) return null;
  const first = ranges[0]!;
  const bounds = ranges.reduce(
    (current, range) => ({
      startColumn: Math.min(current.startColumn, range.startColumn),
      startRow: Math.min(current.startRow, range.startRow),
      endColumn: Math.max(current.endColumn, range.endColumn),
      endRow: Math.max(current.endRow, range.endRow),
    }),
    {
      startColumn: first.startColumn,
      startRow: first.startRow,
      endColumn: first.endColumn,
      endRow: first.endRow,
    },
  );
  return { ...bounds, text: formatRange(bounds) };
}

function rangesOverlap(left: A1Range, right: A1Range): boolean {
  return !(
    left.endColumn < right.startColumn ||
    right.endColumn < left.startColumn ||
    left.endRow < right.startRow ||
    right.endRow < left.startRow
  );
}

function rangeContains(outer: A1Range, inner: A1Range): boolean {
  return (
    inner.startColumn >= outer.startColumn &&
    inner.endColumn <= outer.endColumn &&
    inner.startRow >= outer.startRow &&
    inner.endRow <= outer.endRow
  );
}

function isIdentity(value: SheetIdentity): boolean {
  return Number.isSafeInteger(value.sheetId) && value.sheetId >= 0 && value.title.trim().length > 0;
}

function maskFormulaStrings(formula: string): string | null {
  let inString = false;
  let masked = "";
  for (let index = 0; index < formula.length; index += 1) {
    const character = formula[index]!;
    if (character === '"') {
      if (inString && formula[index + 1] === '"') {
        masked += "  ";
        index += 1;
        continue;
      }
      inString = !inString;
      masked += " ";
      continue;
    }
    masked += inString ? " " : character;
  }
  return inString ? null : masked;
}

function unsupportedFormulaFunction(formula: string): string | null {
  const masked = maskFormulaStrings(formula);
  if (masked === null) return "unclosed string literal";
  for (const functionName of UNSUPPORTED_FUNCTIONS) {
    const pattern = new RegExp(`\\b${functionName}\\s*\\(`, "i");
    if (pattern.test(masked)) return functionName;
  }
  if (/\[[^\]]+\]/.test(masked)) return "external workbook reference";
  return null;
}

function referencesMigratedSheet(formula: string, candidates: readonly SheetIdentity[]): number[] {
  const masked = maskFormulaStrings(formula);
  if (masked === null) return [];
  const referenced = new Set<number>();
  for (const candidate of candidates) {
    const quotedTitle = `'${candidate.title.replaceAll("'", "''")}'`;
    const quotedPattern = new RegExp(`${escapeRegExp(quotedTitle)}\\s*!`, "i");
    if (quotedPattern.test(masked)) {
      referenced.add(candidate.sheetId);
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(candidate.title)) {
      const unquotedPattern = new RegExp(`\\b${escapeRegExp(candidate.title)}\\s*!`, "i");
      if (unquotedPattern.test(masked)) referenced.add(candidate.sheetId);
    }
  }
  return [...referenced].sort((left, right) => left - right);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseSheet(metadata: SheetMetadata, errors: PlanError[]): ParsedSheet | null {
  const where = { sheetId: metadata.sheetId };
  if (!metadata.capacityInventoryComplete) {
    errors.push({
      code: "CAPACITY_INVENTORY_INCOMPLETE",
      ...where,
      detail: "Caller must confirm that value, formula, validation, input-capacity, and reserved extents were completely inventoried.",
    });
  }
  if (!Number.isSafeInteger(metadata.gridRows) || metadata.gridRows < 1 ||
      !Number.isSafeInteger(metadata.gridColumns) || metadata.gridColumns < 1) {
    errors.push({ code: "INVALID_GRID_SIZE", ...where, detail: "Sheet grid dimensions must be positive safe integers." });
    return null;
  }

  const rawRanges: Array<{ label: string; text: string }> = [];
  if (metadata.usedRange !== null) rawRanges.push({ label: "usedRange", text: metadata.usedRange });
  if (metadata.formulaRange !== null) rawRanges.push({ label: "formulaRange", text: metadata.formulaRange });
  metadata.validationRanges.forEach((text, index) => rawRanges.push({ label: `validationRanges[${index}]`, text }));
  metadata.inputCapacityRanges.forEach((text, index) => rawRanges.push({ label: `inputCapacityRanges[${index}]`, text }));
  metadata.reservedRanges.forEach((text, index) => rawRanges.push({ label: `reservedRanges[${index}]`, text }));

  const parsed: ParsedRange[] = [];
  for (const entry of rawRanges) {
    const bounds = parseA1Range(entry.text);
    if (!bounds) {
      errors.push({ code: "INVALID_A1_RANGE", ...where, detail: `${entry.label} must be a bounded rectangular A1 range.` });
      continue;
    }
    if (bounds.endRow > metadata.gridRows || bounds.endColumn > metadata.gridColumns) {
      errors.push({ code: "RANGE_OUTSIDE_GRID", ...where, detail: `${entry.label} extends beyond the declared sheet grid.` });
      continue;
    }
    parsed.push({ ...bounds, text: formatRange(bounds) });
  }

  const effective = unionRanges(parsed);
  if (!effective) {
    errors.push({ code: "INVALID_A1_RANGE", ...where, detail: "At least one declared value, formula, validation, input, or reserved extent is required." });
    return null;
  }
  return { metadata, extents: parsed, effective };
}

function rangeFromOffset(source: A1Range, rowOffset: number, columnOffset: number): A1Range {
  return {
    startColumn: source.startColumn + columnOffset,
    startRow: source.startRow + rowOffset,
    endColumn: source.endColumn + columnOffset,
    endRow: source.endRow + rowOffset,
  };
}

function validateFormulaInventory(sheet: ParsedSheet, errors: PlanError[]): void {
  const { metadata } = sheet;
  if (!metadata.formulaInventoryComplete) {
    errors.push({
      code: "FORMULA_INVENTORY_INCOMPLETE",
      sheetId: metadata.sheetId,
      detail: "Complete formula-cell inventory is required for every migrated sheet and Main.",
    });
  }

  const seenCells = new Set<string>();
  for (const entry of metadata.formulas) {
    const address = parseA1Range(entry.cell);
    const key = entry.cell.trim().toUpperCase();
    if (!address || address.startRow !== address.endRow || address.startColumn !== address.endColumn ||
        !entry.formula.startsWith("=") || seenCells.has(key)) {
      errors.push({
        code: "INVALID_FORMULA_CELL",
        sheetId: metadata.sheetId,
        cell: entry.cell,
        detail: "Formula cell must be unique, use a single A1 cell address, and contain a formula inside declared extents.",
      });
      continue;
    }
    if (!sheet.extents.some(extent => rangeContains(extent, address))) {
      errors.push({
        code: "FORMULA_OUTSIDE_DECLARED_EXTENT",
        sheetId: metadata.sheetId,
        cell: entry.cell,
        detail: "Formula cell is outside the supplied value, formula, validation, input-capacity, and reserved ranges.",
      });
      continue;
    }
    seenCells.add(key);
    const unsupported = unsupportedFormulaFunction(entry.formula);
    if (unsupported) {
      errors.push({
        code: "UNSUPPORTED_FORMULA_PATTERN",
        sheetId: metadata.sheetId,
        cell: entry.cell,
        detail: `Formula uses unsupported dynamic or external reference pattern: ${unsupported}.`,
      });
    }
  }
}

function validateAppendTables(sheet: ParsedSheet, errors: PlanError[]): void {
  const { metadata } = sheet;
  const seenIds = new Set<string>();
  for (const table of metadata.appendTables) {
    const range = parseA1Range(table.range);
    if (!table.tableId.trim() || seenIds.has(table.tableId) || !range ||
        !sheet.extents.some(extent => rangeContains(extent, range)) ||
        !Number.isSafeInteger(table.nextRow) || table.nextRow < range.startRow || table.nextRow > range.endRow + 1) {
      errors.push({
        code: "INVALID_APPEND_TABLE",
        sheetId: metadata.sheetId,
        detail: "Append table needs a unique ID, a bounded range inside declared capacity, and nextRow inside that range.",
      });
      continue;
    }
    seenIds.add(table.tableId);
    if (table.nextRow === range.endRow + 1) {
      errors.push({
        code: "APPEND_TABLE_CAPACITY_EXHAUSTED",
        sheetId: metadata.sheetId,
        detail: `Append table ${table.tableId} has no remaining row inside its declared capacity.`,
      });
    }
  }
}

function makeAppendTarget(table: AppendTableMetadata, rowOffset: number, columnOffset: number): AppendTargetPlan {
  const source = parseA1Range(table.range)!;
  const destination = rangeFromOffset(source, rowOffset, columnOffset);
  return {
    tableId: table.tableId,
    sourceRange: formatRange(source),
    destinationRange: formatRange(destination),
    sourceNextRow: table.nextRow,
    destinationNextRow: table.nextRow + rowOffset,
    destinationEndRow: destination.endRow,
    rowsRemaining: source.endRow - table.nextRow + 1,
  };
}

/**
 * Plans bounded source blocks in the existing Main tab. This function is
 * deterministic and pure: it does not connect to Google Sheets or mutate data.
 */
export function planOneTabMigration(request: OneTabMigrationRequest): OneTabMigrationPlanResult {
  const errors: PlanError[] = [];
  const ownerName = request.ownerName.trim();
  const gapRows = request.gapRows ?? 1;
  if (!ownerName) errors.push({ code: "INVALID_OWNER_NAME", detail: "ownerName must be non-empty." });
  if (!Number.isSafeInteger(gapRows) || gapRows < 0) {
    errors.push({ code: "INVALID_GAP_ROWS", detail: "gapRows must be a non-negative safe integer." });
  }
  for (const [name, value] of Object.entries(request.targetGridLimits ?? {})) {
    if (!Number.isSafeInteger(value) || value! < 1) {
      errors.push({ code: "INVALID_GRID_LIMIT", detail: `${name} must be a positive safe integer when supplied.` });
    }
  }
  if (errors.some(error =>
    error.code === "INVALID_OWNER_NAME" ||
    error.code === "INVALID_GAP_ROWS" ||
    error.code === "INVALID_GRID_LIMIT"
  )) {
    return { ok: false, errors };
  }

  if (!isIdentity(request.expectedMain) || !isIdentity(request.main)) {
    errors.push({ code: "INVALID_IDENTITY", detail: "Main identity must have a non-negative integer ID and non-empty title." });
  }
  if (request.main.sheetId !== request.expectedMain.sheetId || request.main.title !== request.expectedMain.title) {
    errors.push({ code: "MAIN_IDENTITY_MISMATCH", sheetId: request.main.sheetId, detail: "Observed Main identity does not match the caller's exact expected identity." });
  }
  if (ownerName && !request.main.title.includes(ownerName)) {
    errors.push({ code: "NON_OWNER_TITLE", sheetId: request.main.sheetId, detail: "Main title does not contain the asserted owner name." });
  }

  if (request.expectedSourceSheets.length !== REQUIRED_SOURCE_TAB_COUNT ||
      request.sourceSheets.length !== REQUIRED_SOURCE_TAB_COUNT) {
    errors.push({
      code: "SOURCE_SET_MISMATCH",
      detail: `Exactly ${REQUIRED_SOURCE_TAB_COUNT} expected owner source tabs and observed source tabs are required.`,
    });
  }

  const allIdentities: SheetIdentity[] = [request.main, ...request.sourceSheets];
  for (const identity of allIdentities) {
    if (!isIdentity(identity)) {
      errors.push({ code: "INVALID_IDENTITY", sheetId: identity.sheetId, detail: "Sheet identity must have a non-negative integer ID and non-empty title." });
    }
  }

  const checkUniqueIds = (identities: readonly SheetIdentity[], label: string): void => {
    const ids = new Set<number>();
    for (const identity of identities) {
      if (ids.has(identity.sheetId)) {
        errors.push({ code: "DUPLICATE_SHEET_ID", sheetId: identity.sheetId, detail: `${label} contains a duplicate sheet ID.` });
      }
      ids.add(identity.sheetId);
    }
  };
  // Expected and observed registries mirror one another, so validate duplicates per registry.
  checkUniqueIds(allIdentities, "Observed sheet metadata");
  checkUniqueIds(request.expectedSourceSheets, "Expected source registry");

  if (ownerName) {
    for (const identity of [...request.expectedSourceSheets, ...request.sourceSheets]) {
      if (!identity.title.includes(ownerName)) {
        errors.push({ code: "NON_OWNER_TITLE", sheetId: identity.sheetId, detail: "Source title does not contain the asserted owner name." });
      }
    }
  }

  const expectedById = new Map(request.expectedSourceSheets.map(sheet => [sheet.sheetId, sheet]));
  const observedById = new Map(request.sourceSheets.map(sheet => [sheet.sheetId, sheet]));
  if (expectedById.size !== REQUIRED_SOURCE_TAB_COUNT || observedById.size !== REQUIRED_SOURCE_TAB_COUNT ||
      [...expectedById].some(([id, expected]) => {
        const observed = observedById.get(id);
        return !observed || observed.title !== expected.title;
      })) {
    errors.push({ code: "SOURCE_SET_MISMATCH", detail: "Observed source IDs and titles must exactly match the caller's complete owner-tab registry." });
  }

  const parsedMain = parseSheet(request.main, errors);
  const observedForPlan = expectedById.size === REQUIRED_SOURCE_TAB_COUNT
    ? request.expectedSourceSheets.map(identity => observedById.get(identity.sheetId)).filter((sheet): sheet is SheetMetadata => sheet !== undefined)
    : request.sourceSheets;
  const parsedSources = observedForPlan.map(sheet => parseSheet(sheet, errors));
  if (parsedMain) {
    validateFormulaInventory(parsedMain, errors);
    validateAppendTables(parsedMain, errors);
  }
  for (const source of parsedSources) {
    if (source) {
      validateFormulaInventory(source, errors);
      validateAppendTables(source, errors);
    }
  }

  if (!parsedMain || parsedSources.some(source => source === null) || errors.length > 0) {
    return { ok: false, errors };
  }

  const fixedMainRange = parseA1Range(MAIN_RESERVED_RANGE)!;
  const mainOccupied = unionRanges([...parsedMain.extents, { ...fixedMainRange, text: MAIN_RESERVED_RANGE }])!;
  const mainIdentity: SheetIdentity = { sheetId: request.main.sheetId, title: request.main.title };
  const migratedIdentities: readonly SheetIdentity[] = [mainIdentity, ...request.sourceSheets.map(({ sheetId, title }) => ({ sheetId, title }))];
  const formulaRewriteRequirements: FormulaRewriteRequirement[] = [];

  const addFormulaRequirements = (sheet: ParsedSheet, isSource: boolean): void => {
    for (const formula of sheet.metadata.formulas) {
      const referenced = referencesMigratedSheet(formula.formula, migratedIdentities)
        .filter(sheetId => sheetId !== sheet.metadata.sheetId || isSource);
      if (isSource || referenced.length > 0) {
        formulaRewriteRequirements.push({
          sheetId: sheet.metadata.sheetId,
          title: sheet.metadata.title,
          cell: formula.cell,
          reason: isSource ? "formula_moves_with_source_block" : "references_migrated_sheet",
          referencedMigratedSheetIds: referenced,
          automaticRewriteAvailable: false,
        });
      }
    }
  };
  addFormulaRequirements(parsedMain, false);
  for (const source of parsedSources) addFormulaRequirements(source!, true);

  let cursor = mainOccupied.endRow + gapRows + 1;
  const firstSourceRow = cursor;
  const sourceBlocks: SourceBlockPlan[] = [];
  const occupiedTargets: A1Range[] = [mainOccupied];
  let requiredMainGridRows = mainOccupied.endRow;
  let requiredMainGridColumns = mainOccupied.endColumn;

  for (const source of parsedSources) {
    const sourceRange = source!.effective;
    const height = sourceRange.endRow - sourceRange.startRow + 1;
    const destinationRange: A1Range = {
      startColumn: sourceRange.startColumn,
      startRow: cursor,
      endColumn: sourceRange.endColumn,
      endRow: cursor + height - 1,
    };
    const sourceRows = height;
    const destinationRows = destinationRange.endRow - destinationRange.startRow + 1;
    if (destinationRows !== sourceRows) {
      errors.push({ code: "SOURCE_ROWS_LOST", sheetId: source!.metadata.sheetId, detail: "Destination block row count differs from the source's full effective row count." });
    }
    if (occupiedTargets.some(target => rangesOverlap(target, destinationRange))) {
      errors.push({ code: "OVERLAPPING_DESTINATION_BLOCKS", sheetId: source!.metadata.sheetId, detail: "Destination block overlaps Main's reserved/occupied range or another source block." });
    }
    requiredMainGridRows = Math.max(requiredMainGridRows, destinationRange.endRow);
    requiredMainGridColumns = Math.max(requiredMainGridColumns, destinationRange.endColumn);

    const rowOffset = destinationRange.startRow - sourceRange.startRow;
    const columnOffset = destinationRange.startColumn - sourceRange.startColumn;
    const appendTargets = source!.metadata.appendTables.map(table => makeAppendTarget(table, rowOffset, columnOffset));
    sourceBlocks.push({
      source: { sheetId: source!.metadata.sheetId, title: source!.metadata.title },
      sourceEffectiveRange: sourceRange.text,
      sourceExtents: {
        usedRange: source!.metadata.usedRange,
        formulaRange: source!.metadata.formulaRange,
        validationRanges: source!.metadata.validationRanges,
        inputCapacityRanges: source!.metadata.inputCapacityRanges,
        reservedRanges: source!.metadata.reservedRanges,
      },
      destination: mainIdentity,
      destinationRange: formatRange(destinationRange),
      sourceRowCount: sourceRows,
      destinationRowCount: destinationRows,
      rowOffset,
      columnOffset,
      appendTargets,
    });
    occupiedTargets.push(destinationRange);
    cursor = destinationRange.endRow + gapRows + 1;
  }

  const proposedRows = Math.max(request.main.gridRows, requiredMainGridRows);
  const proposedColumns = Math.max(request.main.gridColumns, requiredMainGridColumns);
  const proposedCellCountBigInt = BigInt(proposedRows) * BigInt(proposedColumns);
  if (!Number.isSafeInteger(Number(proposedCellCountBigInt))) {
    errors.push({ code: "TARGET_GRID_LIMIT_EXCEEDED", detail: "Proposed grid cell count exceeds the safe integer range." });
  }
  const limits = request.targetGridLimits;
  if (limits?.maxRows !== undefined && proposedRows > limits.maxRows) {
    errors.push({ code: "TARGET_GRID_LIMIT_EXCEEDED", detail: "Proposed row count exceeds the caller-supplied hard maximum." });
  }
  if (limits?.maxColumns !== undefined && proposedColumns > limits.maxColumns) {
    errors.push({ code: "TARGET_GRID_LIMIT_EXCEEDED", detail: "Proposed column count exceeds the caller-supplied hard maximum." });
  }
  if (limits?.maxCells !== undefined && proposedCellCountBigInt > BigInt(limits.maxCells)) {
    errors.push({ code: "TARGET_GRID_LIMIT_EXCEEDED", detail: "Proposed cell count exceeds the caller-supplied hard cell budget." });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    plan: {
      status: "layout_planned",
      mode: "dry_run_only",
      ownerName,
      main: mainIdentity,
      reservedMainRange: MAIN_RESERVED_RANGE,
      mainOccupiedRange: mainOccupied.text,
      firstSourceRow,
      requiredMainGridRows,
      requiredMainGridColumns,
      proposedMainGridExpansion: {
        observed: { rowCount: request.main.gridRows, columnCount: request.main.gridColumns },
        required: { rowCount: requiredMainGridRows, columnCount: requiredMainGridColumns },
        proposed: { rowCount: proposedRows, columnCount: proposedColumns },
        rowsToAdd: proposedRows - request.main.gridRows,
        columnsToAdd: proposedColumns - request.main.gridColumns,
        resultingCellCount: Number(proposedCellCountBigInt),
      },
      sourceBlocks,
      formulaRewriteRequirements,
      formulaInventoryScope: "main_and_expected_owner_tabs",
      externalInboundFormulaReferencesScanned: false,
      formulaRewriteStatus: formulaRewriteRequirements.length === 0 ? "scoped_inventory_clear" : "manual_review_required",
      sourceTabsMayBeRetired: false,
      externalConsumerBlockers: EXTERNAL_CONSUMER_BLOCKERS,
    },
  };
}
