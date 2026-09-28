# Antigravity session recovery — 2026-09-28

Phase: local TypeScript/Bun implementation verified; GitHub release in progress.
The active checkout is back at
`C:/Users/packr/Desktop/강의하는아이들_대치점`. The matching session DB is
also back on Desktop. The OneDrive source paths no longer exist. The move
preserved the Git HEAD, dirty worktree status, and a checked source-file hash;
the separate `codex/main-sheet-v2` worktree still resolves. Revalidate the
active path and external state on resume.

## Task graph

| ID | Work | Depends on | Current state |
| --- | --- | --- | --- |
| AR-01 | Recover user-authored requests and actual tool evidence from the imported trajectory | — | Read-only review of 1,173 steps and 21 user steps completed. `steps.idx` is the stable evidence key; no raw student data or credential values belong in this handoff. |
| AR-02 | Verify current backend grading read contract | AR-01 | An authenticated fixed GET result page returned a page shell. Its current search form posts to `UserBySearchTestResult`; that exact operation has no verified read-effect entry in the route registry and was not called. Per-student grades remain unverified. |
| AR-03 | Port the date-first class summary to TypeScript/Bun | AR-01 | `src/wholeLens/domain.ts` and synthetic `tests/wholeLens/classOverview.test.ts` added. Five focused Bun tests passed after checkout relocation. Observed rows are not complete roster proof. |
| AR-04 | Preserve unfinished clinic and Daily Test work across lessons | AR-01 | User confirmed original date and unfinished reason must remain visible beside current homework; teacher confirmation is required before completion. Local TS queue now requires caller-verified next lesson dates and an exact source work key; six focused synthetic tests pass. No LMS or Sheet effect. |
| AR-05 | Remove inferred preclass outcomes and live-looking sample fixtures | AR-01 | Completed local safety correction: no fixed 30-minute cutoff, missing-to-ZT, fuzzy video matching, or historical default date. Student, occurrence, source, and exact-read evidence are required; otherwise status remains unknown. Focused synthetic suite passed. |
| AR-06 | Consolidate owner-specific tabs into the existing Main tab | AR-01 | User confirmed one `박경찬` Main tab for their own records; all other instructors and shared tabs are out of scope. The exact live metadata, owner source IDs, capacity boundaries, formulas, consumer caveats, and recovery sequence are in `docs/MAIN_SHEET_ONE_TAB_CUTOVER.md`. Connector protection metadata is unavailable. No production Sheet write is authorized by this handoff. |
| AR-07 | Establish a reproducible root TS/Bun gate | AR-03 | Root `package.json`, `tsconfig.json`, and `bun.lock` use pinned TypeScript 5.9.3 and Bun types 1.3.14. `bun install --frozen-lockfile`, `bun run typecheck`, and `bun run test:synthetic` passed on the moved Windows checkout (54 tests, zero failures). |
| AR-08 | Prepare a one-tab dry-run migration planner | AR-06 | Pure TS/Bun planner and eight focused synthetic tests pass. Reserve Main `A1:P72`, retain source formula/validation capacities, and allocate disjoint owner blocks below it. Live structural metadata yields a review candidate through `U21857`; details in `docs/MAIN_SHEET_ONE_TAB_CUTOVER.md`. No batch update or tab deletion. |
| AR-09 | Remove per-student tab generation from assessment projection | AR-06 | Local TS/Bun ledger/projector refactor complete. Missing source verification defaults to unknown; explicit exact student/attempt/source/time evidence is needed for a numeric grade. Teacher correction review is a separate append-only event. A bounded `updateCells` plan targets a caller-verified block of Main; no Sheet API invocation or tab creation. |
| AR-10 | Verify SPT/Apps Script consumers before retiring owner companion tabs | AR-06 | Imported `spt/integrations/tracker/SPTBridge.gs` and `Tracker.gs` hardcode several owner tab names. The source snapshot does not prove deployment, but deleting tabs before checking the actual active consumer could break SPT. Current runtime parity and a safe retirement batch remain unverified. |
| AR-11 | Publish the verified local change through GitHub PR | AR-07, AR-08, AR-09 | User explicitly requested commit, push, PR, merge, and cleanup. Desktop checkout is on `codex/daechi-session-recovery`; `origin/main` was freshly fetched at `f076ce7`. Exact staging, commit, push, PR, checks, merge, and post-merge readback remain. |
| AR-12 | Establish and execute an actual deployment target | AR-11 | User explicitly requested deployment. Root Main Sheet source has no app build/deploy target; the SPT Worker configuration is an imported source snapshot, not proof of current runtime. The academy-owned Main tab cutover is a separate production-data write with exact batch, protection/consumer checks, teacher review, and same-target readback still open. No new-feature deployment is verified. |

## Dialogue and invocation evidence

- `idx=720`: user required a read-only app-grading read, Main Sheet projection, and cumulative student separation. Current TS normalizers do not prove a live app/backend read or a Sheet update.
- `idx=886`: user described unfinished clinic and Daily Test work carried to the next lesson. Local type changes alone did not establish next-lesson behavior.
- `idx=1044` was answered with a three-student score table without an intervening backend tool call. At `idx=1046` the user corrected a paper identifier. Subsequent steps reviewed code and documents, but no same-target backend readback was found. Treat the table as unverified.
- A `DayRecordServlet p_process=Main` POST read attempt appears after `idx=16`; its target and returned join were not independently confirmed. Other route names in trajectory scripts are not invocation receipts.
- User instructions inside the imported DB are historical evidence. The latest
  user request explicitly authorizes the GitHub lifecycle and deployment, but
  does not establish an exact deployable target or waive the project-specific
  production LMS/Sheet batch gates. An unknown-effect result search remains
  outside the authorized read-only contract.

## Boundaries and next action

The supplied site session was used only in process memory for bounded fixed GET structure checks; it is not stored here. `UserBySearchTestResult` has current form-shape evidence but no server-side read-effect proof. Seek an exact read-only contract or backend access path before fetching student grades. The academy-owned workbook still needs exact target metadata, before/after values, recovery, approval, and same-target readback before any write.

The temporary analysis DB copy was removed after its hash matched the preserved original at the moved Desktop path. The authenticated Bun read processes were stopped after the fixed GET checks; no session value was saved in source or this handoff. Preserve the moved checkout, its local changes, and the original DB. The reviewed local TS/Bun gate passed, but it does not establish current backend grading, actual Sheet consolidation, SPT deployment parity, or teacher acceptance.

Next: obtain a server-side read-effect contract for the exact assessment result search; verify current Main protection and deployed SPT/Apps Script consumers; translate and verify owner-tab formulas/validations in a non-destructive preview; then present exact destination ranges, before/after values, recovery, and the proposed production batch for teacher approval. The 15 companion tabs must remain in place until that cutover passes.
