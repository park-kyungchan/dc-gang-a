# Native Google Sheets UX for the single instructor Main tab

Status: design and pure TypeScript/Bun request drafts, not a production Sheet
update. Teacher decision on 2026-09-28: retain all five existing working screens
and ten record tabs inside the existing `박경찬` Main tab; keep the sections
collapsed until the teacher expands them. Do not edit another instructor or a
shared tab. The present Main `A1:P72` remains in place.

## Daily teacher flow

1. **Open Main:** retain the current date-first overview in `A1:P72`. It is
   always visible and keeps its current formulas to shared academy data.
2. **Choose a working screen:** fifteen visible section headings begin below
   row 72. The native row-gutter `+` control expands one source screen or
   record area; `-` collapses it again. Headings are outside their groups.
3. **Review one student:** show the teacher's current homework beside clinic
   and Daily Test carry-forward, preserving original date and reason. A grade
   stays unknown until a verified student/attempt/paper read exists. Automatic
   grading does not mark a teacher correction complete.
4. **Inspect history:** use the consolidated record blocks within the same
   Main tab. Student and lesson keys identify rows; fixed table bounds prevent
   whole-sheet appends into unrelated sections.

## Section geometry

This is the reviewed candidate from `MAIN_SHEET_ONE_TAB_CUTOVER.md`. Each
one-row gap becomes a persistent section heading. Group only the content rows,
with depth 1 and `collapsed: true`. After a complete, same-workbook protection,
empty-heading, copied-content, group, and row-visibility preflight, each new
section needs `addDimensionGroup` followed by
`updateDimensionGroup`. An exact group that already exists is left alone, so a
retry cannot undo the teacher's later toggle. The source tab remains intact
until all formulas, validation, consumers, and readback pass.

| Heading row | Content rows | Section |
| ---: | ---: | --- |
| 73 | 74–243 | Home |
| 244 | 245–444 | Today's class |
| 445 | 446–745 | Student progress |
| 746 | 747–886 | Calendar and make-up lessons |
| 887 | 888–947 | Question control |
| 948 | 949–1948 | Lesson records |
| 1949 | 1950–3949 | Attendance records |
| 3950 | 3951–8950 | Learning records |
| 8951 | 8952–9951 | Make-up lesson records |
| 9952 | 9953–14952 | History records |
| 14953 | 14954–15053 | Books |
| 15054 | 15055–15554 | Units |
| 15555 | 15556–15855 | Assignments |
| 15856 | 15857–20856 | Tracker |
| 20857 | 20858–21857 | Question records |

The Main grid would need at least 21 columns and 21,857 rows. Source screens
with their own frozen rows cannot each keep an independent freeze inside one
tab; Main's existing global freeze remains. Section headings provide context
when a block is expanded. This limitation needs teacher visual acceptance.
The current 40-tab workbook has about 902,931 allocated cells from fresh grid
metadata. Expanding Main to this proposal would make about 1,360,776 allocated
cells workbook-wide, below the current Google Sheets file limit of 20 million
cells. This checks capacity, not rendering speed or formula behavior.
Because copied record blocks include reserved input capacity, expanding a large
DB section can expose thousands of blank rows. Keep those ten sections
collapsed in the default view and open only the table being inspected. The
five working screens are also collapsed initially as requested. A row group
organizes the interface; it does not restrict access to the data.
After the initial copy is verified, a second-level group can hide each DB
block's unused reserve tail while leaving its last populated row and next
write row visible. Its boundary must come from the live record and formula
inventory and be recalculated whenever the block grows; it is not part of the
first production batch.

## Native feature choices

For the new heading rows only, follow the existing Main palette observed in
bounded format-only reads: navy/blue (`#1E3A8A`, `#E0F2FE`) for the five working
screens and deep/pale green (`#065F46`, `#ECFDF5`) for the ten record areas.
Keep the content of the original screens in its source formatting. Use a
readable 30–32 px heading row, a concise section label in column A, and a
short note explaining the row-gutter `+`/`-` control. Do not merge cells or
restyle the sheet as a whole. Exact header formatting remains part of the
reviewed production batch and needs a rendered check.

| Native feature | Use in this workbook | Gate before enabling |
| --- | --- | --- |
| Row groups | Primary fold/unfold control for all fifteen sections. Keep headings visible. | Read current row-group and hidden-row metadata from both source and Main; avoid overlapping or duplicate groups and preserve teacher toggles on retries. Verify range, depth, collapse, and neighboring rows after each bounded batch. |
| Filter views | Saved student/date/status views within homogeneous record tables, especially assessment history; each teacher can inspect a view without changing everyone else's basic filter. | Confirm exact record schema, headers, table bounds, existing filter views, and interaction with collapsed groups. Do not apply a sheet-wide basic filter over mixed sections. |
| Data validation and dropdowns | Preserve all existing input rules; add narrow teacher-review choices only in a verified assessment or carry-forward table. | Inspect live allowed values and existing rules. Never equate automatic grading with teacher completion. |
| Conditional formatting | Highlight unknown evidence, unfinished carry-forward, teacher review due, and confirmed completion with distinct rules. | Bind to exact status columns after the ledger schema is accepted; avoid score-threshold completion rules and duplicate rules. |
| Named ranges and internal links | Add stable section anchors and an optional navigation strip after the copied layout is accepted. | Check existing named ranges, exact destination rows, and rendered link behavior. Do not overwrite `A1:P72` to add navigation without a reviewed change. |
| Protected ranges | Preserve Main's existing protected-sheet rule and decide how copied teacher inputs remain writable while formula/output regions stay protected. | A read-only browser view showed a Main protected-sheet rule with two exception ranges, but not their coordinates or the connected writer's effective permission. The connected metadata response exposes only sheet properties. Read the complete rule before any write. |
| Native tables | Consider one structured assessment/history block for reliable types and saved views. | Use only after reviewing formulas, validation, appends, and current sheet compatibility. Do not auto-convert legacy screen blocks. |
| Slicers, pivots, charts | Candidate for later verified longitudinal summaries. | Require real, joined backend data and teacher-selected metrics; do not chart unverified sample grades. |

The current Google Drive/Sheets connector and `google-drive:google-sheets`
skill are the direct implementation path. A plugin search found that this
connector is already installed; a new design or spreadsheet service would add
an unnecessary account and conversion surface. Figma is available for a
separate mockup, but does not implement native Sheet controls. No new plugin,
subscription, or runtime dependency is needed for this design.

A bounded 2026-09-28 web UI inspection found seven warning-level protected
input/output ranges in two owner screens: Today's class `B10:D39`, `H10:H39`,
`K10:K39`, and `Q10:Q39`; Student progress `H14:I113`, `M14:N113`, and
`T14:T113`. Main itself has a protected-sheet rule with two exceptions. The
view-only UI did not expose the exception coordinates or effective writer
permissions. No protection was created, changed, or removed during inspection.

## Production sequence and recovery

1. Re-read exact owner-tab metadata, protected ranges, row groups, hidden rows,
   named ranges, merged cells, formulas, validation, notes, links, and live revision.
   The current connector metadata does **not** return protected ranges or row
   groups; the view-only UI does not expose all protected-sheet exceptions.
   Obtain the full structural state through an authorized read path before a
   write.
2. Verify the deployed SPT/Apps Script consumers. Imported source files still
   hardcode owner companion tab names; preserve those tabs during first copy.
3. Build an exact source-to-destination manifest with cell/formula/validation
   counts, before/after hashes, group ranges, and a bounded request sequence.
   Review the output in a non-production copy or other isolated preview if
   academy data access and retention permit it.
4. Present the academy-owned Main target, exact changes, rollback requests,
   and expected impact for the project-required production-batch approval.
5. Expand Main, copy source blocks and their native metadata, add headings,
   then add and collapse groups in bounded batches. Read back the same Main
   ranges, headings, row visibility, and group metadata after each batch. The
   structural snapshot must pin the workbook ID, Main sheet ID/title, exact
   copied ranges, empty heading rows, protections, and effective writer rights.
   On mismatch, first detect any concurrent user/group change; if none, restore
   only rows newly hidden by this batch to their recorded visible state, delete
   only newly created groups, and reverse only the new Main blocks. Read back
   that recovery. Preserve all source tabs.
6. Translate owner-tab formula references and update active consumers only
   after readback and teacher visual acceptance. Retiring companion tabs is a
   separate later batch with its own approval and recovery path.

No production Sheet write, grouping, source-tab deletion, or new SPT Site
deployment has occurred under this blueprint.

## Google primary references

- [Group and ungroup rows or columns](https://support.google.com/docs/answer/9060449)
- [Sheets API DimensionGroup resource](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/sheets)
- [Sheets API batch updates](https://developers.google.com/workspace/sheets/api/guides/batchupdate)
- [Filter views and basic filters](https://developers.google.com/workspace/sheets/api/guides/filters-overview)
- [Native tables and views](https://support.google.com/docs/answer/14239833)
- [Data validation and dropdowns](https://support.google.com/docs/answer/186103)
- [Conditional formatting](https://developers.google.com/workspace/sheets/api/guides/conditional-format)
- [Google Drive spreadsheet file limits](https://support.google.com/drive/answer/37603?hl=en)
