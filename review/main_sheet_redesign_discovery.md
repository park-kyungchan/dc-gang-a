# Main Sheet redesign: discovery and implementation contract

Updated: 2026-09-29. This is a working design record, not acceptance of a live LMS read, academy Sheet change, or parent send.

## Confirmed teacher outcome

- Final operating target: the academy workbook `대치강아 학생진도현황`, visible `박경찬` tab (`gid=1754681846`). The teacher wants to complete the practical 14:00-to-homework cycle from this one work surface.
- At 14:00, refresh verified site/app facts automatically, with a manual refresh when needed. An expired session or an unverified read contract must show `확인 불가` with source and time.
- Until the SPT phone workflow is complete, the teacher will also supply live classroom observations through the agent conversation and may directly edit the Sheet. Natural-language requests must resolve to the same student, occurrence, textbook, and event schema as direct entry.
- A homework assignment is first complete when the exact textbook/range is recorded in the Main Sheet. The teacher then reviews the proposed official record before saving it to LMS DayRecord.
- The teacher performs the final parent send.

## Observed lesson cycle from recent user messages

1. Students arrive at different times. The teacher checks attendance and receives each textbook's prior homework.
2. Homework inspection proceeds per textbook. While the teacher checks one student, another may work on a buffer task; a changed or cancelled task must remain distinguishable from completion.
3. The concept whiteboard test covers the exact prior assigned homework, which may be on a different lesson date because of holidays or absence. An absent student may have a makeup date and substitute teacher.
4. Several students can take timed assessments concurrently. The paper identity (`pNo`) and each student's app submission, grade, wrong answers, correction, and teacher inspection are separate states.
5. The teacher assigns the next textbook-specific task/homework, then reviews official DayRecord fields and parent wording. Final delivery remains a teacher action.

The classroom display puts each student's current task and elapsed time beside waiting students and their next task. Textbook inspection and assessment/correction states remain accessible in the selected-student detail. Recent conversation database inspection covered only user-message steps in the ten latest conversations containing such steps; no conversation dump or raw student record was retained in this document.

## Current source and tool boundary

| Capability | Current evidence | Design consequence |
| --- | --- | --- |
| Google Sheet access | Connected Google Drive plugin found both the academy target and the separate synthetic prototype. Target metadata currently lists 40 tabs; the 2026-09-27 topology snapshot listed 43. | Refresh metadata and protections before any academy batch. Preserve other teachers' tabs. |
| Existing Park support tabs | `박경찬_DB_학습`, `박경찬_DB_배정`, `박경찬_DB_트래커`, and `박경찬_DB_이력` already have distinct headers. Bounded key-column reads found existing rows in the last three. | Map their consumers and current revision rules before reusing or changing them; do not overwrite existing history. |
| Route selection | Canonical harness indexes 52 operations: 28 semantically read, 18 safe for generic probing. `day_record_read` is a scoped read-only POST, not a generic probe. | Route by named teacher fact and exact keys. Keep semantic effect, probe safety, and verified selected-student read contract separate. |
| App preparation and grading | Existing backend map verifies teacher-site shells but not the selected-student app submission/grade/correction join. | Show `확인 불가`; no inferred score, upload, or completion. |
| Local sync scripts | `scripts/sync_main_sheet_and_student_dbs.ts` and `scripts/sync_row_grouped_main_sheet.ts` seed hard-coded assessment examples and generate payloads. `LmsDeterministicReadRepository` also bootstraps fixed paper/attempt examples. | Do not treat these as live readers or production evidence. A live adapter needs a reviewed operation, source timestamp, stable keys, bounded pagination, and exact identity check. |
| Google Sheets interaction | The connector supports metadata, bounded CellData reads, and atomic batch updates. | Use a separate synthetic prototype for design checks. Production writes require exact target, before/after, recovery, approval, then readback. |

## Proposed data contract to validate in the next slice

One visible Main tab can present preparation, classroom attention, and closeout over hidden normalized support tables. Its selector is lesson date first, then group and student. A classroom event uses an immutable event ID, lesson occurrence, LMS student key, textbook key, event type, event time, source, and supersedes ID for corrections. Homework assignment carries a textbook edition plus exact unit/page/problem range and due date. Every imported fact carries source operation, observed time, read time, evidence grade, and `verified`/`unknown` state. The current view is a projection of these facts and events; it is not the audit log.

The read planner should accept a named fact request, resolve a single canonical operation, reject mutating or unknown-effect routes, require the route's exact join keys and bounded date scope, and return `unknown` when the selected-student contract or pagination proof is absent. It should never discover routes by directory scan or infer success from HTTP 200.

The teacher chose an explicit `기록` action in a fixed input area for direct Sheet entry. Chat entry and direct entry should call one append-only event writer with an idempotency request ID. The physical v3 tables, ownership and remaining cutover gates are in [main_sheet_v3_architecture.md](main_sheet_v3_architecture.md).

The teacher then chose the whole-class A layout and teal accent from three native layouts and three A-layout color samples. The owner-owned sample workbook now places that selected tab first. Its `기록` checkbox is only a visual sample; it is not wired to an academy or synthetic event writer.

## Google platform constraints used in the design

- Assigned Apps Script image/drawing actions do not execute on mobile: https://developers.google.com/apps-script/guides/menus
- Script/API writes do not fire spreadsheet `onEdit`; an event writer must append its audit record in the same explicit operation: https://developers.google.com/apps-script/guides/triggers
- Sheets batch updates apply atomically, but concurrent collaborators can subsequently alter displayed values, so exact readback is still necessary: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate
- Hidden sheets and protected ranges do not conceal data from workbook readers: https://support.google.com/docs/answer/1218656
