import { describe, expect, it } from "bun:test";
import {
  MAIN_RESERVED_RANGE,
  REQUIRED_SOURCE_TAB_COUNT,
  planOneTabMigration,
  type OneTabMigrationRequest,
  type SheetMetadata,
} from "../../src/sheets/oneTabMigrationPlan.ts";

function makeSheet(sheetId: number, title: string, overrides: Partial<SheetMetadata> = {}): SheetMetadata {
  return {
    sheetId,
    title,
    gridRows: 30000,
    gridColumns: 26,
    usedRange: "A1:F8",
    formulaRange: null,
    validationRanges: [],
    inputCapacityRanges: ["A1:F20"],
    reservedRanges: [],
    capacityInventoryComplete: true,
    formulaInventoryComplete: true,
    formulas: [],
    appendTables: [],
    ...overrides,
  };
}

function makeRequest(): OneTabMigrationRequest {
  const main = makeSheet(100, "Synthetic Owner Main", {
    usedRange: "A1:P72",
    formulaRange: "A1:P170",
    validationRanges: ["A1:P121"],
    inputCapacityRanges: ["A1:P1000"],
    reservedRanges: ["A1:P72"],
    formulas: [{ cell: "B4", formula: "=COUNTA(A5:A20)" }],
  });
  const sourceSheets = Array.from({ length: REQUIRED_SOURCE_TAB_COUNT }, (_, index) =>
    makeSheet(index + 1, `Synthetic Owner Tab ${index + 1}`),
  );
  return {
    ownerName: "Synthetic Owner",
    expectedMain: { sheetId: 100, title: "Synthetic Owner Main" },
    main,
    expectedSourceSheets: sourceSheets.map(({ sheetId, title }) => ({ sheetId, title })),
    sourceSheets,
    gapRows: 1,
  };
}

describe("one-tab migration layout planner", () => {
  it("reserves Main A1:P72 and all observed Main capacity before allocating 15 non-overlapping blocks", () => {
    const result = planOneTabMigration(makeRequest());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const { plan } = result;
    expect(plan.reservedMainRange).toBe(MAIN_RESERVED_RANGE);
    expect(plan.mainOccupiedRange).toBe("A1:P1000");
    expect(plan.firstSourceRow).toBe(1002);
    expect(plan.sourceBlocks).toHaveLength(REQUIRED_SOURCE_TAB_COUNT);
    expect(plan.sourceBlocks[0]?.destinationRange).toBe("A1002:F1021");
    expect(plan.sourceBlocks[1]?.destinationRange).toBe("A1023:F1042");
    expect(plan.sourceBlocks.every(block => block.destination.sheetId === 100)).toBe(true);

    const ranges = plan.sourceBlocks.map(block => block.destinationRange);
    expect(new Set(ranges).size).toBe(REQUIRED_SOURCE_TAB_COUNT);
    for (let index = 1; index < plan.sourceBlocks.length; index += 1) {
      const previous = plan.sourceBlocks[index - 1]!;
      const current = plan.sourceBlocks[index]!;
      expect(current.destinationRowCount).toBe(current.sourceRowCount);
      expect(current.rowOffset).toBeGreaterThan(previous.rowOffset);
    }
    expect(plan.sourceTabsMayBeRetired).toBe(false);
    expect(plan.externalConsumerBlockers.map(blocker => blocker.path)).toContain("spt/integrations/tracker/SPTBridge.gs");
  });

  it("uses the largest value, formula, validation, input-capacity, and reserved extent", () => {
    const request = makeRequest();
    const firstSource = request.sourceSheets[0]!;
    const sourceSheets = [
      makeSheet(firstSource.sheetId, firstSource.title, {
        usedRange: "A1:F8",
        formulaRange: "A1:F170",
        validationRanges: ["A1:F121"],
        inputCapacityRanges: ["A1:F5000"],
        reservedRanges: ["A1:F2500"],
        appendTables: [{ tableId: "synthetic-daily-test", range: "B1:D5000", nextRow: 120 }],
      }),
      ...request.sourceSheets.slice(1),
    ];
    const result = planOneTabMigration({ ...request, sourceSheets });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const first = result.plan.sourceBlocks[0]!;
    expect(first.sourceExtents.usedRange).toBe("A1:F8");
    expect(first.sourceExtents.formulaRange).toBe("A1:F170");
    expect(first.sourceExtents.validationRanges).toEqual(["A1:F121"]);
    expect(first.sourceExtents.inputCapacityRanges).toEqual(["A1:F5000"]);
    expect(first.sourceEffectiveRange).toBe("A1:F5000");
    expect(first.destinationRange).toBe("A1002:F6001");
    expect(first.sourceRowCount).toBe(5000);
    expect(first.destinationRowCount).toBe(5000);
    expect(first.appendTargets).toEqual([{
      tableId: "synthetic-daily-test",
      sourceRange: "B1:D5000",
      destinationRange: "B1002:D6001",
      sourceNextRow: 120,
      destinationNextRow: 1121,
      destinationEndRow: 6001,
      rowsRemaining: 4881,
    }]);
  });

  it("fails closed when source ownership, exact IDs, or IDs uniqueness do not match", () => {
    const request = makeRequest();
    const nonOwner = { ...request.sourceSheets[0]!, title: "Shared Attendance" };
    const nonOwnerResult = planOneTabMigration({ ...request, sourceSheets: [nonOwner, ...request.sourceSheets.slice(1)] });
    expect(nonOwnerResult.ok).toBe(false);
    if (!nonOwnerResult.ok) expect(nonOwnerResult.errors.some(error => error.code === "NON_OWNER_TITLE")).toBe(true);

    const wrongId = makeSheet(900, request.sourceSheets[0]!.title);
    const wrongIdResult = planOneTabMigration({ ...request, sourceSheets: [wrongId, ...request.sourceSheets.slice(1)] });
    expect(wrongIdResult.ok).toBe(false);
    if (!wrongIdResult.ok) expect(wrongIdResult.errors.some(error => error.code === "SOURCE_SET_MISMATCH")).toBe(true);

    const duplicateId = makeSheet(100, request.sourceSheets[0]!.title);
    const duplicateResult = planOneTabMigration({ ...request, sourceSheets: [duplicateId, ...request.sourceSheets.slice(1)] });
    expect(duplicateResult.ok).toBe(false);
    if (!duplicateResult.ok) expect(duplicateResult.errors.some(error => error.code === "DUPLICATE_SHEET_ID")).toBe(true);
  });

  it("rejects dynamic formula references and incomplete formula inventories", () => {
    const request = makeRequest();
    const first = request.sourceSheets[0]!;
    const dynamic = makeSheet(first.sheetId, first.title, {
      formulas: [{ cell: "B3", formula: '=INDIRECT("A1")' }],
      formulaRange: "B3",
    });
    const dynamicResult = planOneTabMigration({
      ...request,
      sourceSheets: [dynamic, ...request.sourceSheets.slice(1)],
    });
    expect(dynamicResult.ok).toBe(false);
    if (!dynamicResult.ok) expect(dynamicResult.errors.some(error => error.code === "UNSUPPORTED_FORMULA_PATTERN")).toBe(true);

    const incomplete = makeSheet(first.sheetId, first.title, { formulaInventoryComplete: false });
    const incompleteResult = planOneTabMigration({
      ...request,
      sourceSheets: [incomplete, ...request.sourceSheets.slice(1)],
    });
    expect(incompleteResult.ok).toBe(false);
    if (!incompleteResult.ok) expect(incompleteResult.errors.some(error => error.code === "FORMULA_INVENTORY_INCOMPLETE")).toBe(true);
  });

  it("records formula locations and direct owner-tab references for reviewed rewrites", () => {
    const request = makeRequest();
    const main = makeSheet(100, "Synthetic Owner Main", {
      usedRange: "A1:P72",
      inputCapacityRanges: ["A1:P1000"],
      formulas: [{ cell: "C6", formula: "='Synthetic Owner Tab 1'!A2" }],
    });
    const source = makeSheet(1, "Synthetic Owner Tab 1", {
      formulas: [{ cell: "C3", formula: "=SUM(A1:A2)" }],
    });
    const result = planOneTabMigration({
      ...request,
      main,
      sourceSheets: [source, ...request.sourceSheets.slice(1)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.formulaRewriteStatus).toBe("manual_review_required");
    expect(result.plan.formulaInventoryScope).toBe("main_and_expected_owner_tabs");
    expect(result.plan.externalInboundFormulaReferencesScanned).toBe(false);
    expect(result.plan.formulaRewriteRequirements).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sheetId: 100,
        cell: "C6",
        reason: "references_migrated_sheet",
        referencedMigratedSheetIds: [1],
        automaticRewriteAvailable: false,
      }),
      expect.objectContaining({
        sheetId: 1,
        cell: "C3",
        reason: "formula_moves_with_source_block",
        automaticRewriteAvailable: false,
      }),
    ]));
  });

  it("blocks append tables outside capacity and caller-supplied grid limits", () => {
    const request = makeRequest();
    const first = request.sourceSheets[0]!;
    const invalidTable = makeSheet(first.sheetId, first.title, {
      appendTables: [{ tableId: "too-large", range: "A1:F5001", nextRow: 5000 }],
    });
    const invalidTableResult = planOneTabMigration({
      ...request,
      sourceSheets: [invalidTable, ...request.sourceSheets.slice(1)],
    });
    expect(invalidTableResult.ok).toBe(false);
    if (!invalidTableResult.ok) expect(invalidTableResult.errors.some(error => error.code === "INVALID_APPEND_TABLE")).toBe(true);

    const smallGridMain = makeSheet(100, "Synthetic Owner Main", {
      gridRows: 1100,
      usedRange: "A1:P72",
      inputCapacityRanges: ["A1:P1000"],
    });
    const capacityResult = planOneTabMigration({
      ...request,
      main: smallGridMain,
      targetGridLimits: { maxRows: 1100 },
    });
    expect(capacityResult.ok).toBe(false);
    if (!capacityResult.ok) expect(capacityResult.errors.some(error => error.code === "TARGET_GRID_LIMIT_EXCEEDED")).toBe(true);
  });

  it("proposes row expansion from the observed 72x16 Main grid without claiming it already exists", () => {
    const request = makeRequest();
    const main = makeSheet(100, "Synthetic Owner Main", {
      gridRows: 72,
      gridColumns: 16,
      usedRange: "A1:P72",
      formulaRange: null,
      validationRanges: [],
      inputCapacityRanges: [],
      reservedRanges: ["A1:P72"],
    });
    const result = planOneTabMigration({ ...request, main });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.firstSourceRow).toBe(74);
    expect(result.plan.requiredMainGridRows).toBe(387);
    expect(result.plan.requiredMainGridColumns).toBe(16);
    expect(result.plan.proposedMainGridExpansion).toEqual({
      observed: { rowCount: 72, columnCount: 16 },
      required: { rowCount: 387, columnCount: 16 },
      proposed: { rowCount: 387, columnCount: 16 },
      rowsToAdd: 315,
      columnsToAdd: 0,
      resultingCellCount: 6192,
    });
  });

  it("fails closed on malformed ranges and undeclared formula rows", () => {
    const request = makeRequest();
    const first = request.sourceSheets[0]!;
    const malformed = makeSheet(first.sheetId, first.title, { inputCapacityRanges: ["A:A"] });
    const malformedResult = planOneTabMigration({
      ...request,
      sourceSheets: [malformed, ...request.sourceSheets.slice(1)],
    });
    expect(malformedResult.ok).toBe(false);
    if (!malformedResult.ok) expect(malformedResult.errors.some(error => error.code === "INVALID_A1_RANGE")).toBe(true);

    const lostFormulaRow = makeSheet(first.sheetId, first.title, {
      formulas: [{ cell: "B99", formula: "=A1" }],
    });
    const lostFormulaResult = planOneTabMigration({
      ...request,
      sourceSheets: [lostFormulaRow, ...request.sourceSheets.slice(1)],
    });
    expect(lostFormulaResult.ok).toBe(false);
    if (!lostFormulaResult.ok) expect(lostFormulaResult.errors.some(error => error.code === "FORMULA_OUTSIDE_DECLARED_EXTENT")).toBe(true);

    const incompleteCapacity = makeSheet(first.sheetId, first.title, { capacityInventoryComplete: false });
    const incompleteCapacityResult = planOneTabMigration({
      ...request,
      sourceSheets: [incompleteCapacity, ...request.sourceSheets.slice(1)],
    });
    expect(incompleteCapacityResult.ok).toBe(false);
    if (!incompleteCapacityResult.ok) expect(incompleteCapacityResult.errors.some(error => error.code === "CAPACITY_INVENTORY_INCOMPLETE")).toBe(true);
  });
});
