/**
 * Native Google Sheets outline design for a reviewed one-tab migration plan.
 * This module is pure: it builds section metadata and request drafts, and it
 * never connects to or changes a spreadsheet.
 */

import {
  REQUIRED_SOURCE_TAB_COUNT,
  type OneTabMigrationPlan,
} from "./oneTabMigrationPlan.ts";

export interface RowDimensionRange {
  readonly sheetId: number;
  readonly dimension: "ROWS";
  readonly startIndex: number;
  readonly endIndex: number;
}

export type GroupRequestDraft =
  | { readonly addDimensionGroup: { readonly range: RowDimensionRange } }
  | {
      readonly updateDimensionGroup: {
        readonly dimensionGroup: {
          readonly range: RowDimensionRange;
          readonly depth: 1;
          readonly collapsed: true;
        };
        readonly fields: "collapsed";
      };
    };

export interface GroupedMainSection {
  readonly sourceSheetId: number;
  readonly sourceTitle: string;
  readonly role: "screen" | "record_table";
  readonly label: string;
  /** Visible section heading, outside the collapsed group. One-based. */
  readonly headerRow: number;
  /** Source content remains in the destination block. */
  readonly contentRange: string;
  /** Rows hidden by the native row group. Zero-based, end-exclusive. */
  readonly groupRange: RowDimensionRange;
  readonly collapsedByDefault: true;
}

export interface GroupedMainLayout {
  readonly spreadsheetId: string;
  readonly mainSheetId: number;
  readonly mainTitle: string;
  readonly reservedMainRange: string;
  readonly requiredMainGridRows: number;
  readonly requiredMainGridColumns: number;
  readonly sections: readonly GroupedMainSection[];
  readonly implementationStatus: "draft_only";
}

export interface ObservedRowGroup {
  readonly range: RowDimensionRange;
  readonly depth: number;
  readonly collapsed: boolean;
}

export interface GroupWritePreflight {
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly sheetTitle: string;
  readonly gridRowCount: number;
  /** Identifier of the fresh, same-target structural snapshot. */
  readonly structuralSnapshotId: string;
  readonly protectionInventoryComplete: true;
  readonly writerCanEditTarget: true;
  /** Each intended heading row was freshly checked empty. One-based rows. */
  readonly verifiedEmptyHeadingRows: readonly number[];
  /** Each copied block was read back at its exact destination range. */
  readonly verifiedCopiedContentRanges: readonly string[];
  /** Must come from a fresh native Sheets rowGroups read, including an empty result. */
  readonly rowGroupsInventoryComplete: true;
  readonly existingRowGroups: readonly ObservedRowGroup[];
  /** Zero-based row indexes already hidden by the editor, not by our groups. */
  readonly rowVisibilityInventoryComplete: true;
  readonly hiddenByUserRowIndexes: readonly number[];
}

function rowSpan(range: string): { start: number; end: number } | null {
  const match = /^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/.exec(range);
  if (!match) return null;
  const start = Number(match[2]);
  const end = Number(match[4]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  return { start, end };
}

function sectionLabel(title: string, ownerName: string): string {
  const prefix = `${ownerName}_`;
  if (!title.startsWith(prefix) || title.length <= prefix.length) {
    throw new Error("Section title does not match the reviewed owner prefix.");
  }
  return title.slice(prefix.length).replace(/^\d{2}_/, "");
}

/**
 * Uses the plan's one-row gaps as persistent headings. The first 72 Main rows
 * stay outside every group; every copied source block starts below its heading.
 * Actual Sheets writes still need live metadata, protection and consumer
 * review, an exact approved batch, and same-target readback.
 */
export function buildGroupedMainLayout(plan: OneTabMigrationPlan, spreadsheetId: string): GroupedMainLayout {
  if (plan.status !== "layout_planned" || plan.mode !== "dry_run_only") {
    throw new Error("Only a reviewed dry-run migration plan may be grouped.");
  }
  if (!spreadsheetId.trim() || spreadsheetId !== spreadsheetId.trim()) {
    throw new Error("An exact target spreadsheet ID is required.");
  }
  if (plan.sourceBlocks.length !== REQUIRED_SOURCE_TAB_COUNT) {
    throw new Error("The grouped layout requires all fifteen owner source blocks.");
  }
  const occupied = rowSpan(plan.mainOccupiedRange);
  if (!occupied || occupied.start !== 1 || occupied.end < 72) {
    throw new Error("Main's existing occupied rows must be preserved before grouping.");
  }

  let previousEnd = occupied.end;
  const seenSourceIds = new Set<number>();
  const sections = plan.sourceBlocks.map(block => {
    const content = rowSpan(block.destinationRange);
    if (!content || content.start !== previousEnd + 2) {
      throw new Error("Each source block must have exactly one preceding header row.");
    }
    if (content.end > plan.requiredMainGridRows || block.destination.sheetId !== plan.main.sheetId) {
      throw new Error("A source block is outside the reviewed Main grid or sheet.");
    }
    if (seenSourceIds.has(block.source.sheetId)) {
      throw new Error("A source sheet cannot appear in more than one section.");
    }
    seenSourceIds.add(block.source.sheetId);

    const headerRow = content.start - 1;
    const range: RowDimensionRange = {
      sheetId: plan.main.sheetId,
      dimension: "ROWS",
      startIndex: content.start - 1,
      endIndex: content.end,
    };
    const section: GroupedMainSection = {
      sourceSheetId: block.source.sheetId,
      sourceTitle: block.source.title,
      role: block.source.title.startsWith(`${plan.ownerName}_DB_`) ? "record_table" : "screen",
      label: sectionLabel(block.source.title, plan.ownerName),
      headerRow,
      contentRange: block.destinationRange,
      groupRange: range,
      collapsedByDefault: true,
    };
    previousEnd = content.end;
    return section;
  });

  return {
    spreadsheetId,
    mainSheetId: plan.main.sheetId,
    mainTitle: plan.main.title,
    reservedMainRange: plan.reservedMainRange,
    requiredMainGridRows: plan.requiredMainGridRows,
    requiredMainGridColumns: plan.requiredMainGridColumns,
    sections,
    implementationStatus: "draft_only",
  };
}

function overlaps(a: RowDimensionRange, b: RowDimensionRange): boolean {
  return a.startIndex < b.endIndex && b.startIndex < a.endIndex;
}

/**
 * Builds native request drafts only after a complete, fresh group/visibility
 * inventory and grid expansion. Exact existing groups are left untouched so a
 * teacher's later expanded state is never collapsed by a retry.
 */
export function buildRowGroupWriteDrafts(
  layout: GroupedMainLayout,
  observed: GroupWritePreflight,
): readonly GroupRequestDraft[] {
  if (observed.rowGroupsInventoryComplete !== true || observed.rowVisibilityInventoryComplete !== true ||
      observed.protectionInventoryComplete !== true || observed.writerCanEditTarget !== true ||
      !observed.structuralSnapshotId.trim() ||
      observed.spreadsheetId !== layout.spreadsheetId ||
      observed.sheetId !== layout.mainSheetId || observed.sheetTitle !== layout.mainTitle ||
      observed.gridRowCount < layout.requiredMainGridRows) {
    throw new Error("Current Main grid, row groups, and row visibility must be completely observed.");
  }
  const headingRows = new Set(observed.verifiedEmptyHeadingRows);
  const copiedRanges = new Set(observed.verifiedCopiedContentRanges);
  if (headingRows.size !== layout.sections.length || copiedRanges.size !== layout.sections.length ||
      layout.sections.some(section =>
        !headingRows.has(section.headerRow) || !copiedRanges.has(section.contentRange)
      )) {
    throw new Error("Every heading must be empty and every copied block must have same-target readback.");
  }
  if (observed.existingRowGroups.some(group =>
    group.range.sheetId !== layout.mainSheetId || group.range.dimension !== "ROWS" ||
    !Number.isSafeInteger(group.depth) || group.depth < 1 ||
    !Number.isSafeInteger(group.range.startIndex) || !Number.isSafeInteger(group.range.endIndex) ||
    group.range.startIndex < 0 || group.range.endIndex <= group.range.startIndex
  )) {
    throw new Error("Observed row-group metadata is invalid or belongs to another tab.");
  }
  const hidden = new Set(observed.hiddenByUserRowIndexes);
  if ([...hidden].some(index => !Number.isSafeInteger(index) || index < 0 || index >= observed.gridRowCount)) {
    throw new Error("Observed hidden-row metadata is invalid.");
  }

  const requests: GroupRequestDraft[] = [];
  for (const section of layout.sections) {
    const headingIndex = section.headerRow - 1;
    if (hidden.has(headingIndex) || observed.existingRowGroups.some(group =>
      group.range.startIndex <= headingIndex && headingIndex < group.range.endIndex
    )) {
      throw new Error("A section heading is hidden or inside an existing row group.");
    }
    const matches = observed.existingRowGroups.filter(group => overlaps(group.range, section.groupRange));
    if (matches.length > 0) {
      if (matches.length !== 1 || matches[0]!.depth !== 1 ||
          matches[0]!.range.startIndex !== section.groupRange.startIndex ||
          matches[0]!.range.endIndex !== section.groupRange.endIndex) {
        throw new Error("An existing row group overlaps a proposed section; manual review is required.");
      }
      continue;
    }
    for (let row = section.groupRange.startIndex; row < section.groupRange.endIndex; row += 1) {
      if (hidden.has(row)) {
        throw new Error("Collapsing this section would alter a previously hidden row.");
      }
    }
    requests.push(
      { addDimensionGroup: { range: section.groupRange } },
      {
        updateDimensionGroup: {
          dimensionGroup: { range: section.groupRange, depth: 1, collapsed: true },
          fields: "collapsed",
        },
      },
    );
  }
  return requests;
}
