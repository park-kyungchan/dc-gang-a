# Main Sheet v3 architecture and acceptance boundary

Updated 2026-09-29. The teacher confirmed one visible `박경찬` tab, ordered as 14:00 preparation → live class → closeout, and a fixed input area whose **record** action commits teacher entries. The three native Sheet design samples are synthetic; they are not an academy workbook migration.

## Source ownership and current decision

| Information | Authority | Main Sheet treatment |
| --- | --- | --- |
| Lesson occurrence, enrollment, assigned course, official DayRecord | LMS | Exact-key, time-stamped read facts and a separately reviewed draft of eight official fields. |
| Video uploads, problem attempts, backend grades, correction evidence | Verified app backend | Show only after selected-student/course/submission/attempt joins and pagination are proven. Until then show `확인 불가`. |
| Classroom task, waiting, textbook inspection, teacher judgment | Teacher input, and SPT only after its exact receipt is proven | Append-only events; current board is a projection. Original media remains linked. |
| Homework assigned during class | Teacher-approved Sheet event | Each assignment has its own event ID, textbook edition/key, exact range and optional due date. Several assignments may share a book. |
| Parent message | Teacher-reviewed draft and official sender | Preview and sender receipt are separate; the teacher performs the final send. |

The visible tab is a **working view**. It must not become the source of identity, app evidence, or official LMS save status. The existing `박경찬_DB_*` tabs already have data and SPT consumers, so v3 uses new versioned support tables or a reviewed migration. Do not repurpose those headers in place.

## Proposed v3 tables

These logical tables now have matching hidden `V3_*` header tabs in the owner-owned synthetic workbook. Their headers demonstrate the schema only; the exact academy workbook placement and protections still require a separate reviewed batch.

| Table | Stable key and required columns | Update rule |
| --- | --- | --- |
| `V3_OCCURRENCE` | lesson date, LMS teacher/group/student/course/record keys, occurrence ID, verification source and time | Upsert only with exact source binding; absence or makeup must retain a distinct occurrence. |
| `V3_SOURCE_FACT` | fact ID, occurrence, entity key, fact kind, value or unknown reason, source operation, source timestamp, read timestamp, pagination/coverage proof | Append source revisions; no inferred app completion. |
| `V3_ASSIGNMENT` | assignment ID, exact source occurrence and student, textbook edition, range, due date, source reference, verification state | Preserve each book and assignment independently; never replace another assignment for the same student. |
| `V3_BOOK_EDITION` | edition ID, title, curriculum revision, TOC coverage/source, verified time | A missing TOC leaves chapter labels unknown but does not block exact page event capture. |
| `V3_PAGE_EVENT` | event ID, occurrence/student/edition, inclusive page interval, optional problem subset, status, source/time, supersedes ID and reason | Append page evidence; assignment, student report, partial work and teacher verification are distinct. |
| `V3_CLASS_EVENT` | event ID, occurrence and student, kind, activity/textbook/paper/attempt keys as applicable, value, occurred/received times, input source, source reference, supersedes ID | Append only. Corrections reference an earlier same-kind event. |
| `V3_INPUT` | request ID, exact selector snapshot, field payload, commit control, submitted time, result event ID/error | Teacher edits a fixed area, then confirms `기록`. Chat adapter resolves and commits through the same event writer. Duplicate request IDs return the existing result. |
| `V3_DRAFT` | draft ID/revision, occurrence, assignment/event references, eight DayRecord field proposals, reviewer, review time, supersedes ID | Append draft and review history. Editing reviewed text makes a new unreviewed revision. |
| `V3_EFFECT` | effect ID, exact LMS target keys, reviewed values, write time, same-target readback values/time, status | Append only after explicit batch approval and a verified wire/readback contract. |
| `V3_CALENDAR_LINK` | absence and makeup occurrence IDs, makeup date, substitute teacher, handoff note, source and verification state | Keep schedule changes linked to the right student and occurrence; unverified future plans stay unknown. |
| `V3_RAW_INBOX` (proposed) | immutable input ID, exact student/lesson selector, original teacher wording, received time, input channel, source reference, optional book/page/question hints | Append first during class. Preserve ambiguous wording; never overwrite it with a model's interpretation. The synthetic workbook does not yet have this table. |
| `V3_EOD_REVIEW` (proposed) | review ID, lesson date, student, raw input IDs, unresolved questions, status, reviewer/time, correction revision | Build a whole-class unresolved queue before the teacher leaves. Each normalized page/question event points back to the raw input. The synthetic workbook does not yet have this table. |

The first sheet iteration may combine low-volume logical tables physically, but it must retain these identities and update rules. Protect support tabs from accidental edits; hidden/protected tabs are not confidentiality boundaries.

The existing `src/assessment/studentAssessmentLedger.ts` names its store a student DB, but its records live in a process-local `Map`; the `AppGradingReader.create*GradingPayload()` methods are fixed sample generators. Neither is a durable per-student database or verified current app grading. Do not feed those sample scores into personal pace or accuracy decisions, or run the old sample sync scripts against an operational workbook.

## One visible tab

1. **Selector and freshness:** lesson date first, optional group, selected student, source time and manual refresh. At 14:00 a scheduled job requests only verified bounded facts needed for that date. A time trigger is a refresh window, not a guarantee of execution at exactly 14:00.
2. **Preparation:** all date-scoped students before selected detail. Show last homework's exact book/range and matching video, app attempt/grade, wrong-answer video/correction, and teacher inspection. Display unknown per fact and source. Coverage is unknown until date/group pagination is proven.
3. **Live class:** current task, elapsed time, waiting state and next task for all students. Selected detail shows book checks and test attempt stages. No invented waiting-time alarm. Task cancel differs from finish.
4. **Fixed input:** choose exact student/occurrence, event kind and required identity, enter range/note/time, then confirm `기록`. Show the returned event ID and error when a join is uncertain. A mobile-capable control is required; a drawing-assigned Apps Script button does not run on mobile.
5. **Closeout:** assignments in the Sheet are first-class recorded events. DayRecord proposals, teacher review, official save, same-target readback, report preview and human parent send remain separate states.

During homework inspection, the teacher can dictate exact observed question details without stopping the class cycle. The chat/direct-input writer appends the original wording to the selected student's raw inbox with an exact student/lesson key and time, then shows a recorded ID. If book, page, question, app attempt or correction state is unclear, the normalized fields remain unknown and enter an end-of-day review queue. The teacher can open the whole-class cleanup queue at any time; the usual 21:30-22:00 after-class window should make pending counts prominent, and the last-class closeout opens the same list. The local pure `workbench_v2/raw_inbox.py` projects this state from synthetic events but does not persist, schedule or notify. Raw text belongs in the protected operational workbook only after its target/range and recovery batch are reviewed. Synthetic prototypes may use invented text. A teacher-inspected page becomes complete only after wrong-answer correction has been checked. App grading and first correction, starred questions after a video, and teacher reinspection must retain distinct evidence and timestamps.

The 2026-09-29 kickoff and the earlier Phase 4 observation template add four concrete rules: (a) physical homework inspection is a single-teacher queue, so waiting students need a one-action buffer task; (b) each textbook has independent possession and inspection status; (c) a concept whiteboard test uses the **exact previous lesson's verified homework scope**, even across an absence or holiday, and auto-fill pauses when the previous occurrence or book range is ambiguous; (d) an overloaded task may be cancelled with a reason, while a timed paper remains keyed by `pNo` and attempt ID. The selected teal A sample now shows these states, an absence/makeup/substitute handoff, and a before/after correction example. Its rows are invented and its actions are not yet wired.

The current pure Python projection in `workbench_v2/classroom_events.py` covers a synthetic subset of the event model. It retains multiple assignments for the same book and supports as-of correction history. It neither reads nor writes the academy system.

## Deterministic read and commit path

### Student-specific weekly homework proposal

At about 14:00, show a **draft** quantity and page-scope review for every student due that day. Just before each group's class ends, recompute from the latest student/page evidence and let the teacher choose or revise each book's assignment. Approval creates a separate append-only assignment event; a draft never becomes homework by itself. Keep this review in the visible Main Sheet; the calculator belongs in a deterministic adapter and SPT supplies classroom observations only after exact receipt.

For an observed 10-day interval, the teacher's baseline of Gauss 3-4 subunits per seven days becomes 5-6; a supplementary book at two per seven days becomes about three. This is a **reference range**, not an automatic student assignment. `workbench_v2/weekly_plan.py` computes it with exact dates and proposes a **new-subunit review interval**: its conservative end reserves one whole slot for each unfinished subunit; its upper end uses the fraction of unfinished pages as a capacity ceiling, not an assertion about equal page difficulty. The teacher selects actual units/pages after reviewing the evidence. If calendar coverage, textbook edition/page map, page-audit coverage or individual pace is missing, it returns a baseline or blocks, rather than guessing exact new pages. It does not use time spent on a problem. Correctness from app backend grading and teacher assessment may refine the pace only after student-specific joins and teacher review are established; no accuracy weight is active now.

The proposal needs a verified held origin, complete intervening calendar including academy cancellations and makeups, verified next class, student and book edition, ordered subsection/page map, all outstanding assignments and page states, and a measured personal history. A source reference string or a caller-supplied `complete` flag is only an interface assertion; the academy adapter must prove coverage and freshness before calling the calculator. The current academy gateway cannot yet do this for the 2026-09-30 pilot, so there is no real page-level proposal or approved homework.

The legacy clinic queue is also synthetic. It now requires explicit student calendar membership, a teacher-supplied deferral ID and reason, and idempotent retry; a proposed similar problem is not proof that a matching original was printed. Its app problem/attempt and printing receipts remain unverified, so it cannot create an operational clinic assignment from a bare problem number.

**Backlog:** [Question-level audit and individual correctness adjustment](main_sheet_backlog.md) require edition-specific page/question maps, exact app joins, and student-specific teacher review. Preserve unknown states and source timestamps throughout.

The existing `harness roster` and `harness routes` commands are the only lookup entrypoints for canonical student/group/route identities. A requested fact is mapped to a named canonical route. The planner checks semantic effect, verified wire/response contract, required keys, date and pagination bounds, then invokes the reviewed read adapter. Generic `safeToProbe` is not the same as a bounded authenticated read: a read-only POST may be valid for the latter, while an unsafe GET must remain blocked. Unknown joins return `확인 불가` and no guessed value.

The local `workbench_v2/concept_scope.py` binds a concept test to a caller-supplied, source-verified previous occurrence and its individual textbook assignments. It does not pick the previous calendar date or infer that an LMS homework text represents a verified book range. The input adapter must still prove the previous-occurrence link and split/book identity.

For teacher writes, the explicit commit operation validates selector freshness and exact keys, appends one event with an idempotency request ID, then projects the visible board and reads back the committed event. Script/API updates do not fire `onEdit`, so the chat writer must call the same commit path explicitly. Concurrent input needs a document lock or another serialized writer and exact readback. The LMS save path is separate and requires teacher-reviewed values plus per-batch production approval.

## Remaining evidence before academy cutover

Fresh connector metadata on 2026-09-29 showed the academy-owned workbook `대치강아 학생진도현황` has 40 tabs; its `박경찬` tab is `sheetId=1754681846`, 72 rows by 16 columns, with two frozen rows. The earlier 43-tab topology is stale. A bounded A1:P63 structural read found formulas in the selector/detail and class grids, validation in I5/I8 and P40:P45/P50:P54/P59:P63, and populated rows through 63. Existing formulas and validation must be preserved or explicitly migrated. The connector metadata read did not establish protection coverage, so a production batch still needs a fresh protection check. The operating workbook was not edited.

- Teacher chooses a native visual sample and checks legibility on PC and phone. The current synthetic workbook is [here](https://docs.google.com/spreadsheets/d/1wWCMWHbR_aEP4J3lXFkbKz8twaVhqjkrEcUFCzQpVw4/edit).
- The teacher selected the whole-class A layout and teal accent. `시안 A · 청록 강조` is now the first visible synthetic tab, with a fixed input area marked as a nonfunctional visual sample. Eight hidden `V3_*` schema tabs were added to that synthetic workbook; no runtime writer is deployed.
- The teacher requested a 2026-09-30 single-student page audit pilot, then conditional expansion on Friday. The selected tab now includes an invented page audit example; ten hidden `V3_*` schema tabs cover its book edition and page events. See [page_progress_pilot.md](page_progress_pilot.md) for source gaps and acceptance steps.
- On 2026-09-29, the selected synthetic `시안 A · 청록 강조` tab gained rows 70:83 for an invented weekly quantity review, whole-class raw-input cleanup, and a starred-question decision. These are labeled synthetic, have no active write/notification controls, and do not imply the academy-owned workbook changed. The proposed `V3_RAW_INBOX` and `V3_EOD_REVIEW` tables have not been created in either workbook.
- Refresh academy metadata, protections and exact Park tab/formula consumers. Produce a cell/range-level before/after and recovery copy for approval.
- Verify current lesson/course/DayRecord identity and the app student/submission/grade/correction read contracts. An HTTP 200 or page shell is insufficient.
- Rehearse fixed input, duplicate submit, correction and unknown data on the synthetic workbook; then teacher review of a real 14:00 and class cycle.
- Verify the eight official DayRecord field wire formats and same-target readback before any LMS save. Parent delivery stays with the teacher.
