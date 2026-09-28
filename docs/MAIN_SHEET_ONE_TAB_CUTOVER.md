# Main Sheet one-tab cutover candidate — 2026-09-28

Status: read-only inventory and local TypeScript/Bun planning. No production
Google Sheet cell, tab, protection, or sharing change has been made.

## Exact target and scope

- Workbook: [academy-owned progress workbook](https://docs.google.com/spreadsheets/d/1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg/edit).
- Destination: existing visible `박경찬` tab, sheetId `1754681846`. Preserve its
  existing `A1:P72` area and formulas. Expand the grid only after a reviewed
  migration batch.
- Sources: the 15 companion tabs whose titles start with `박경찬_`, listed
  below. Their current content, formulas, validations, notes, links, and
  reserved input capacity must be accounted for.
- Excluded: every other instructor tab and every shared `DB_*` tab. Do not
  move, edit, hide, delete, or change their protections. The current Main tab
  has 110 formulas that reference three shared DB tabs; retain those links.

| Owner source tab | sheetId | Current state | Occupied rows or DB records |
| --- | ---: | --- | ---: |
| `박경찬_00_홈` | 1418840197 | hidden | 44 occupied rows |
| `박경찬_01_오늘수업` | 551659399 | hidden | 38 occupied rows |
| `박경찬_02_학생진도` | 923904507 | hidden | 23 occupied rows |
| `박경찬_03_캘린더보강` | 766216829 | hidden | 15 occupied rows |
| `박경찬_DB_수업` | 649816441 | hidden | 6 data records |
| `박경찬_DB_출결` | 497558914 | hidden | 1 data record |
| `박경찬_DB_학습` | 1422680518 | hidden | 0 data records |
| `박경찬_DB_보강` | 681731475 | hidden | 4 data records |
| `박경찬_DB_이력` | 146854949 | hidden | 61 data records |
| `박경찬_DB_교재` | 203000901 | hidden | 9 data records |
| `박경찬_DB_단원` | 203000902 | hidden | 168 data records |
| `박경찬_DB_배정` | 203000903 | hidden | 10 data records |
| `박경찬_DB_트래커` | 203000904 | hidden | 4 data records |
| `박경찬_DB_문항` | 960975918 | visible | 40 data records |
| `박경찬_문항관제` | 1651563591 | visible | 24 occupied rows |

This inventory came from live connector metadata and bounded, in-memory
aggregation on 2026-09-28. It contains no student cell values. The workbook
had 40 tabs at read time; 16 were Park-named including Main.

## Dependencies and migration shape

The owner tabs contain 627 formula cells. Home, Today, Calendar, and Question
Control refer to other owner tabs and need formula translation to destination
blocks. A formula-only scan of the other 24 tabs found no references into the
owner tabs. That does not rule out Apps Script, named ranges, charts, API
clients, or external references. The imported SPT
`spt/integrations/tracker/SPTBridge.gs` and `Tracker.gs` explicitly name
several owner tabs; their deployed status is unknown.

Value occupancy is much smaller than functional capacity. For example, Home
formulas extend to row 170; Progress validation extends to row 113; Calendar
validation extends to row 121; the attendance DB validates selected columns
through row 2000. Preserve the maximum of values, formulas, validation,
input, and allocated growth capacity for every source. A vertical block
layout below Main row 72 would need at least column U and roughly 22,000 rows
if existing DB capacity is retained. Local `oneTabMigrationPlan.ts` is a
dry-run range planner, not a Sheets write executor.

Assessment rows must target an explicit bounded table block within Main.
Whole-sheet `appendCells` would place a row at the bottom of the entire
21,000-row grid and is not suitable for a table inside one tab. Partition
records by verified opaque student and lesson keys within that block; do not
create one tab per student.

## Structural destination map for review

This dry-run map retains each source tab's entire currently allocated grid,
including blank rows that carry formulas or input validation. It preserves
Main `A1:P72` and inserts one empty row between blocks. The proposed Main
grid would be at least `A1:U21857`. These coordinates are **not an executable
batch**: formula translation, protection, named-range and active-consumer
checks remain open.

| Source tab | Existing grid | Proposed Main block |
| --- | --- | --- |
+| `박경찬_00_홈` | `A1:P170` | `A74:P243` |
| `박경찬_01_오늘수업` | `A1:U200` | `A245:U444` |
| `박경찬_02_학생진도` | `A1:U300` | `A446:U745` |
| `박경찬_03_캘린더보강` | `A1:R140` | `A747:R886` |
| `박경찬_문항관제` | `A1:R60` | `A888:R947` |
| `박경찬_DB_수업` | `A1:L1000` | `A949:L1948` |
| `박경찬_DB_출결` | `A1:N2000` | `A1950:N3949` |
| `박경찬_DB_학습` | `A1:P5000` | `A3951:P8950` |
| `박경찬_DB_보강` | `A1:O1000` | `A8952:O9951` |
| `박경찬_DB_이력` | `A1:N5000` | `A9953:N14952` |
| `박경찬_DB_교재` | `A1:L100` | `A14954:L15053` |
| `박경찬_DB_단원` | `A1:K500` | `A15055:K15554` |
| `박경찬_DB_배정` | `A1:J300` | `A15556:J15855` |
| `박경찬_DB_트래커` | `A1:M5000` | `A15857:M20856` |
| `박경찬_DB_문항` | `A1:M1000` | `A20858:M21857` |

## Required review before any production batch

1. Re-read exact source ranges, formulas, validation, links/notes, protection
   metadata, named ranges, and current revision. The current connector did not
   expose protected-range metadata, so that gate is still open.
2. Verify the active SPT/Apps Script consumer and every other source-tab
   reference before retirement. The imported source snapshot is not proof of
   deployment parity.
3. Produce a versioned source-to-destination range manifest with exact cell
   count, formula count, validation count, key-record count, and before/after
   hashes. Show the exact proposed batch and a target-specific recovery path
   to the teacher for approval.
4. Copy into new Main blocks while preserving all 15 source tabs. Read back
   every destination block and compare the manifest. If any check fails,
   reverse only the new Main blocks, leaving source tabs intact.
5. Retire the 15 source tabs only in a later approved batch after all
   consumers use Main. Do not use whole-workbook version rollback while other
   instructors may be editing their own tabs.

No production Sheet write, deployment, tab removal, or academy grading read
is accepted by this document.
