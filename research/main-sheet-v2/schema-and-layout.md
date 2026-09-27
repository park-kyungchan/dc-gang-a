# Park Main Sheet v2 — first implementation slice

Status: local design contract, 2026-09-27. No shared workbook cells or academy records were changed by this document. This is the PC work surface for the 2026-09-21 lesson; the SPT iPhone app owns live classroom capture. Read `../backend-map/README.md` for verified versus unknown source contracts.

## One-tab operating layout

Keep the existing `박경찬` sheet ID `1754681846` as the single visible work surface. A separate, versioned preview must be checked before replacing its current `A1:P72` contents. The present tab uses a student selector at `I5` and date selector at `I8`, contains fixed narrative text, and has formulas with plausible fallback values. Those cells cannot be treated as live truth. A protected tab still exposes cell contents to workbook readers.

| Main range candidate | Display and decision | Edit rule |
| --- | --- | --- |
| `A1:P2` | Title, source freshness, sync errors, selected lesson identity. | Generated labels/status; never claim integrity from HTTP 200 alone. |
| `A3:G4` | **Date first**, optional class/group filter, all-groups count. | Teacher may select date/group; group 0 means all, not no group. |
| `I3:P4` | Student picker filtered by date and optional group, course/book shown separately from school grade. | Teacher may select one current student. Join by LMS ID, not name. |
| `A6:G20` | Whole-class 14:00 readiness and attention matrix: video, Gauss assigned set, submission, auto-grade, correction, teacher check, unknown. | Derived/read-only except explicit teacher observation. A blank source is `미확인`, not `미제출`. |
| `I6:P20` | Selected-student context: next decision, source links, pre-study evidence, actual course/book/version, exceptions. | Teacher observations versioned separately; original media linked. |
| `A22:G37` | Student activity/assessment queue: assigned vs attempted vs auto-graded vs corrected vs teacher-verified, DT/ZT and paper references. | Read-only official facts plus teacher event links from SPT. No paper creation through an unverified route. |
| `I22:P37` | Selected-student lesson timeline and recent verified outcomes. | Source/time shown on each imported fact. |
| `A39:G57` | Eight DayRecord fields, current LMS value beside proposed reviewed value; explicit save/readback state per field. | Only the eight owner-authorized fields can be saved to LMS after exact field preflight and teacher review. |
| `I39:P57` | Teacher note/LLM draft, current rendered report preview, sent-labelled LMS UI state, independently verified delivered body/receipt if available. | Do not equate preview or icon with immutable delivered text or successful delivery. Teacher performs final Kakao send in LMS. |
| `A59:P72+` | Source/effect timeline, correction history, unresolved source gaps and official-screen links. | Collapsible presentation; not the underlying record store. |

The Main tab protection should continue to allow `packr0723@gmail.com`, the keyless GCP bot, and the file owner. No credential, session cookie or raw media belongs in any cell.

## Underlying tables and ownership

One visible tab can use hidden support tables. Each table should have a stable schema, key, schema version and update time; grouping rows in the Main tab is only a view option.

| Table candidate | Key and minimum fields | Authority and size rule |
| --- | --- | --- |
| `_PK_LESSON_INDEX` | `(lesson_date, occurrence_id, student_id)`; group, official course ID, membership/effective date, source and read time. | Narrow LMS roster/schedule slice; refreshed by date, never a perpetual full LMS mirror. |
| `_PK_FACT_CACHE` | `(source, source_record_id, student_id, lesson_date, fact_type)`; value/status, observed_at, read_at, expiry, source link. | Imported official facts only. Unknown/stale retained explicitly; no guessed fallback. |
| `_PK_TEACHER_RECORD` | `record_id`, subject/date, kind, text/link, author, created_at, supersedes_id, reason. | Teacher-owned notes and corrections; append a new version instead of overwriting history. The owner selected indefinite retention; do not auto-delete. |
| `_PK_DRAFT_REVIEW` | `draft_id`, source fact IDs/hashes, text, model/version if applicable, editor, review status/time, supersedes_id. | An edited reviewed draft returns to unreviewed. Never imply LMS save or parent delivery. |
| `_PK_DAYRECORD_EFFECT` | `effect_id`, target LMS key/date/field, before/proposed value hashes, reviewer, attempt time, exact readback/result, error. | Audit of explicitly reviewed saves only. LMS remains authoritative for current field value. |
| `_PK_SOURCE_LINK` | `subject/date/source/object key`, official media or paper URL, link-checked time. | Link original video/drawing/PDF; no binary content in cells. |

SPT's D1 event ledger stays the authority for rapid in-class actions. The Sheet should display an approved projection and SPT receipt, not duplicate every live tap as a second authoritative history. Drive API is appropriate for linked large artifacts; it is not a database or transaction system. If measured per-student joins, concurrent corrections, retention volume or API latency exceed bounded Sheet support tables, retain this one-tab UI and move normalized records to an owner-controlled service with versioned projections back to the Sheet.

The owner selected **indefinite retention** for teacher notes, LLM drafts, review and correction history. Keep append-only version references and an export/backup path; never silently delete or compact an auditable correction. Long-term capacity and query latency are measured migration triggers, not a reason to hide records from the one-tab work surface.

## First acceptance walkthrough

1. Select 2026-09-21. Confirm the all-groups DayRecord count and select one of the date's students without relying on a stale static roster. Show each student's school grade and date-valid assigned course/book separately; mark the third currently unresolved course `미확인` until exact lookup succeeds.
2. At 14:00, check explanation-video presence and link, assigned Gauss set, submission, automatic grading, wrong items/correction and teacher follow-up. Each value carries source time or `미확인`. The read contract for per-student app submission/grade is still open.
3. At 15:00, hand the class context to the SPT phone board and return only audited student activity facts/attention cues to the Sheet. Student ordering is dynamic.
4. After class, compare selected teacher/LLM text with current LMS DayRecord values and current report preview. The exact delivered body and independent Kakao receipt remain unknown, so the UI must say so.
5. For each of the eight authorized fields, show before/proposed value and reviewer; save only after exact wire contract is verified, then reread the same LMS target. Stop before the teacher's final send.

Cutover requires a current Main-tab snapshot/hash, exact protected-range readback, a versioned and reversible Sheets batch, and post-write readback. A formula fallback that substitutes a plausible student, score, textbook or completion state is a failed acceptance result.
