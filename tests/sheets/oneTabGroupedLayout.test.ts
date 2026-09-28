import { describe, expect, it } from "bun:test";
import { buildGroupedMainLayout, buildRowGroupWriteDrafts, type ObservedRowGroup } from "../../src/sheets/oneTabGroupedLayout.ts";
import type { OneTabMigrationPlan, SourceBlockPlan } from "../../src/sheets/oneTabMigrationPlan.ts";

function syntheticPlan(): OneTabMigrationPlan {
  const main = { sheetId: 100, title: "Teacher" };
  const sourceBlocks: SourceBlockPlan[] = Array.from({ length: 15 }, (_, index) => {
    const start = 74 + index * 6;
    return {
      source: { sheetId: index + 1, title: index < 5 ? `Teacher_0${index}_Screen` : `Teacher_DB_Records${index}` },
      sourceEffectiveRange: "A1:F5",
      sourceExtents: {
        usedRange: "A1:F5",
        formulaRange: null,
        validationRanges: [],
        inputCapacityRanges: [],
        reservedRanges: [],
      },
      destination: main,
      destinationRange: `A${start}:F${start + 4}`,
      sourceRowCount: 5,
      destinationRowCount: 5,
      rowOffset: start - 1,
      columnOffset: 0,
      appendTargets: [],
    };
  });
  return {
    status: "layout_planned",
    mode: "dry_run_only",
    ownerName: "Teacher",
    main,
    reservedMainRange: "A1:P72",
    mainOccupiedRange: "A1:P72",
    firstSourceRow: 74,
    requiredMainGridRows: 162,
    requiredMainGridColumns: 16,
    proposedMainGridExpansion: {
      observed: { rowCount: 72, columnCount: 16 },
      required: { rowCount: 162, columnCount: 16 },
      proposed: { rowCount: 162, columnCount: 16 },
      rowsToAdd: 90,
      columnsToAdd: 0,
      resultingCellCount: 2592,
    },
    sourceBlocks,
    formulaRewriteRequirements: [],
    formulaInventoryScope: "main_and_expected_owner_tabs",
    externalInboundFormulaReferencesScanned: false,
    formulaRewriteStatus: "scoped_inventory_clear",
    sourceTabsMayBeRetired: false,
    externalConsumerBlockers: [],
  };
}

function completePreflight(layout: ReturnType<typeof buildGroupedMainLayout>) {
  return {
    spreadsheetId: "synthetic-workbook",
    sheetId: 100,
    sheetTitle: "Teacher",
    gridRowCount: 162,
    structuralSnapshotId: "synthetic-structural-read-1",
    protectionInventoryComplete: true as const,
    writerCanEditTarget: true as const,
    verifiedEmptyHeadingRows: layout.sections.map(section => section.headerRow),
    verifiedCopiedContentRanges: layout.sections.map(section => section.contentRange),
    rowGroupsInventoryComplete: true as const,
    existingRowGroups: [] as ObservedRowGroup[],
    rowVisibilityInventoryComplete: true as const,
    hiddenByUserRowIndexes: [] as number[],
  };
}

describe("one-tab native grouped layout", () => {
  it("keeps Main and each section heading visible while all 15 source blocks start collapsed", () => {
    const layout = buildGroupedMainLayout(syntheticPlan(), "synthetic-workbook");
    expect(layout.sections).toHaveLength(15);
    expect(layout.implementationStatus).toBe("draft_only");
    expect(layout.sections[0]).toMatchObject({
      headerRow: 73,
      contentRange: "A74:F78",
      groupRange: { sheetId: 100, dimension: "ROWS", startIndex: 73, endIndex: 78 },
      collapsedByDefault: true,
      role: "screen",
      label: "Screen",
    });
    expect(layout.sections[5]?.role).toBe("record_table");
    for (const [index, section] of layout.sections.entries()) {
      expect(section.headerRow).toBe(73 + index * 6);
      expect(section.groupRange.startIndex).toBe(section.headerRow);
      expect(section.groupRange.endIndex).toBe(section.headerRow + 5);
    }
    const drafts = buildRowGroupWriteDrafts(layout, completePreflight(layout));
    expect(drafts).toHaveLength(30);
    const firstRange = layout.sections[0]!.groupRange;
    expect(drafts.slice(0, 2)).toEqual([
      { addDimensionGroup: { range: firstRange } },
      {
        updateDimensionGroup: {
          dimensionGroup: { range: firstRange, depth: 1, collapsed: true },
          fields: "collapsed",
        },
      },
    ]);
  });

  it("rejects a missing heading gap, a different target tab, and duplicate source IDs", () => {
    const base = syntheticPlan();
    const noGap = {
      ...base,
      sourceBlocks: [
        base.sourceBlocks[0]!,
        { ...base.sourceBlocks[1]!, destinationRange: "A79:F83" },
        ...base.sourceBlocks.slice(2),
      ],
    };
    expect(() => buildGroupedMainLayout(noGap, "synthetic-workbook")).toThrow(/preceding header/);

    const wrongTarget = {
      ...base,
      sourceBlocks: [
        { ...base.sourceBlocks[0]!, destination: { sheetId: 900, title: "Other teacher" } },
        ...base.sourceBlocks.slice(1),
      ],
    };
    expect(() => buildGroupedMainLayout(wrongTarget, "synthetic-workbook")).toThrow(/reviewed Main grid or sheet/);

    const duplicateSource = {
      ...base,
      sourceBlocks: [
        base.sourceBlocks[0]!,
        { ...base.sourceBlocks[1]!, source: base.sourceBlocks[0]!.source },
        ...base.sourceBlocks.slice(2),
      ],
    };
    expect(() => buildGroupedMainLayout(duplicateSource, "synthetic-workbook")).toThrow(/more than one section/);
  });

  it("does not replay an existing group or overwrite hidden rows and rejects an overlapping group", () => {
    const layout = buildGroupedMainLayout(syntheticPlan(), "synthetic-workbook");
    const first = layout.sections[0]!.groupRange;
    const base = {
      ...completePreflight(layout),
      existingRowGroups: [{ range: first, depth: 1, collapsed: false }],
    };
    const safeRetry = buildRowGroupWriteDrafts(layout, base);
    expect(safeRetry).toHaveLength(28);
    expect(safeRetry.some(request => "addDimensionGroup" in request &&
      request.addDimensionGroup.range.startIndex === first.startIndex)).toBe(false);

    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      existingRowGroups: [],
      hiddenByUserRowIndexes: [first.startIndex],
    })).toThrow(/previously hidden row/);
    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      existingRowGroups: [{ range: { ...first, endIndex: first.endIndex - 1 }, depth: 1, collapsed: false }],
    })).toThrow(/overlaps/);
    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      gridRowCount: 72,
    })).toThrow(/completely observed/);
    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      spreadsheetId: "different-workbook",
    })).toThrow(/completely observed/);
    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      verifiedEmptyHeadingRows: base.verifiedEmptyHeadingRows.slice(1),
    })).toThrow(/Every heading/);
    expect(() => buildRowGroupWriteDrafts(layout, {
      ...base,
      hiddenByUserRowIndexes: [layout.sections[1]!.headerRow - 1],
    })).toThrow(/heading is hidden/);
  });
});
