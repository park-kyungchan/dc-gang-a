# Review of the other-PC LMS and row-group branch

Reviewed 2026-09-28 against `origin/feat/lms-harness-route-map-and-sheet-db-grouping`
at `7139f0f84e8ac897c4caf4d4888b17351df505fa` and this branch's
`03ba585`. This is a source review, not a backend invocation or workbook write.
The remote branch remains separate.
The user has assigned its subsequent integration and merge decision to the
other PC. This review does not authorize merging or deleting that branch here.

## Findings

1. `src/lms/lmsRouteRegistry.ts` labels the assessment result-search POST and
   the typesetting POST as safe reads without a server-side effect contract.
   `assertSafeRead` rejects only `MUTATING`, thereby allowing `TYPESET_READ`.
   `buildRequest` does not call that guard, and accepts arbitrary extra
   parameters. For GET, a caller can override `p_process` through those
   parameters, and `baseUrl` is also caller-selectable. A client-side function
   name or response format does not prove that an endpoint has no write effect.
   The catalog contains thirteen route definitions across five categories,
   not the claimed thirty-plus verified contracts across seven menus. The
   other menu names are useful navigation candidates, not implemented and
   evidenced routes. The route map's result-search URL also includes a query
   selector that the registry's corresponding route omits.
2. `scripts/lms_reverse_engineer.ts` is a live authenticated POST with fixed
   student search parameters. It saves extracted source snippets to a report
   file. Its regex infers HTTP method from nearby text and does not fetch the
   external JS bundles it lists, so it cannot establish the actual request or
   server effect. It also lacks response status, content-type, authentication
   identity, and redaction checks before saving snippets. Do not run it as a
   read-only audit.
   `docs/LMS_FULL_ROUTE_TREE_MAP.md` currently says `Production Ready` and
   that the safety guard is automatic; neither follows from the code.
3. `scripts/sync_row_grouped_main_sheet.ts` uses hard-coded student examples
   and a simulated teacher correction event, then writes only a local JSON
   payload under `data/sync_payloads`, which can retain student information.
   It performs no authenticated LMS read, Sheets API update, or
   same-target readback. Its success message therefore cannot mean that Main
   Sheet was synchronized. The example rows are inside the current Main
   `A1:P72` reserved area and would overwrite live cells if sent unchanged.
   No current row lookup or empty-target check confirms those positions.
4. `src/sheets/mainSheetAssessmentProjector.ts` adds useful row-group request
   shapes, but the row-group methods have no checked target block, capacity,
   collision, idempotency, or rollback contract. They write columns B:H and
   assume history rows already exist. The file also retains a per-student tab
   append method with no student or assessment occurrence key in the appended
   row, contrary to the agreed single existing Main tab. Its badge
   rule treats a score threshold as completion and places answers in notes;
   the current implementation separates grading from teacher review and
   avoids raw answer text in hover notes.
5. The branch tests inspect generated request shapes and fixed example scores.
   They do not verify server effects, backend joins, workbook topology, formula
   preservation, Sheets readback, or teacher acceptance. They call fixture
   factories removed by this branch's fail-closed assessment refactor, so the
   reported test count from the other PC does not establish a passing merged
   tree.

## Integration route

1. Keep PR #1's fail-closed grading and one-tab migration planner as the
   base. Preserve the other-PC commit as a recoverable source branch.
2. Import only source-neutral discoveries after recording the originating
   HTML/JS path, observed request shape, response shape, time, and exact
   student/attempt/paper join. Mark every unproven effect `UNKNOWN` and never
   call it through a read-only guard. Obtain a server-side read-effect contract
   or a dedicated read-only backend path before querying grades.
3. Adapt the row-group operation builder to caller-supplied Main sheet ID and
   bounded block offsets below row 72. Add synthetic tests for empty history,
   repeat execution, row growth, collision, and preservation of formulas and
   validation capacity. Do not import fixed student rows or the sample sync
   runner.
4. Before a production batch, inspect live protection metadata and active
   SPT/Apps Script consumers; prepare exact before/after ranges, a reversible
   batch and readback. Retain all fifteen owner companion tabs through first
   validation. Do not touch other instructors' or shared tabs.

No production deployment or verified student grading is established by the
other-PC branch or this review.
