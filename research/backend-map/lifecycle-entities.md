# Student-Centered Lifecycle and Entity Map

Version: 2026-09-27  
Status: static synthesis for the existing Main Sheet refactor.

## Read this file after the backend-map README

Target: C:\Users\packr\Desktop\강의하는아이들_대치점 and workbook 1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg, Main tab gid 1754681846. This file adds the detailed instructor lifecycle and candidate entity model; it is not a separate permission grant or live data snapshot.

Source precedence for decisions: the owner's latest instruction defines scope and effects; a fresh exact-target read defines current LMS or Sheet facts; code defines candidate schemas and joins; dated handoffs and manuals provide historical context. Evidence labels below use the vocabulary in the parent README. No student-level values are included.

Evidence crosswalk: STATIC-CODE means the README's source level; LIVE-OBSERVED-HANDOFF means a bounded live-structure observation recorded in the dated handoff, not rechecked here; USER-CONFIRMED records intent, not backend behavior; INFERENCE and OPEN are design hypotheses or unresolved facts. Use the README's evidence levels for any stronger claim. Its prohibited assumptions and refresh triggers remain the shared rules and are not repeated here.

The parent README has the shared safety boundaries, the warning about the mixed-content cartography file, and the high-level join spine. Read it first and do not ingest that file wholesale. This document uses only schema declarations, structural docs, and aggregate facts already recorded in the handoff.

## 1. Durable candidate entity model

These entities are the smallest useful mental model for a student-centered instructor workspace. They come from static source structures; they are not proof that every source is live or that Park uses every module.

| Entity | Candidate attributes from code/schema | Owning source or author | Current evidence and cautions |
| --- | --- | --- | --- |
| Student identity | LMS student key, display name, grade, homeroom, active status; local student key mapping | Academy LMS for identity; workbench only for explicit local mapping | STATIC-CODE. The local automation schema has separate local and LMS identifiers. Use the opaque academy key for joins, never a display name. |
| Enrollment and course | Student, class/group, course, effective membership, textbook/level/term/volume, pace | LMS for current enrollment; teacher for local pacing decisions | STATIC-CODE / INFERENCE. Enrollment is time-varying and can be many-to-many across classes or courses. Preserve effective dates and source IDs. |
| Lesson occurrence | Date, scheduled class block, teacher, original/makeup occurrence, host occurrence, reason | LMS for schedule; teacher for actual exception and participation | STATIC-CODE / USER-CONFIRMED need for lifecycle context. A schedule row is not observed attendance. Keep original and host occurrence separate. |
| Attendance and arrival | Expected attendance, observed arrival/departure, official attendance, exception | LMS for official attendance; teacher for observed event | Static reader and DayRecord schemas. Arrival, absence, makeup participation, and official attendance are distinct facts. |
| Course progress and curriculum | Course, book edition, unit/subunit, page range, planned/actual section, completion state, lecture/content ID | LMS for official progress; curriculum catalog for stable metadata; teacher for actual lesson coverage | STATIC-CODE. Planned section is not actual progress. Preserve edition, partial/disjoint ranges, and unknown endpoints. |
| Assignment and student work | Assigned pages/problems, due lesson, printed paper, submission/attempt, grading, correction, regrade, feedback | LMS/app for submitted work; teacher for paper handout and inspection | STATIC-CODE. Item catalog and student submission are separate entities. Attempted, corrected, and teacher-verified are separate states. |
| Assessment and item result | Assessment type/session, paper, question/item, score/result, correction or clinic need | LMS/app for official attempt/result | STATIC-CODE. Candidate identifiers include paper, attempt-session, and item IDs; cross-route cardinality is not yet proven. |
| DayRecord | Date, student, course/lesson/record keys, attendance, daily test, progress, homework, memo, homework rate, report reference | Academy LMS | STATIC-CODE. The reader model includes course/record keys, report reference and field values. Exact current wire names and write permissions must be confirmed against the live screen. |
| Teacher observation and checklist | Dated observation, tags, work-process checklist, observed error, next action | Teacher-authored restricted store | STATIC-CODE in the separate automation repo. These notes are not LMS truth and can be especially sensitive. |
| Draft and review | Source facts, generated text, edits, reviewer, review time, version and status | Workbench | STATIC-CODE / USER-CONFIRMED review boundary. LLM text is derived, must retain provenance, and cannot imply a saved LMS value. |
| Parent report and delivery event | Saved report body/version, report key, send-batch reference, recipient reference, time, result/receipt | Report subsystem for saved report; actual sender for delivery receipt | OPEN. A saved report and a delivered message are distinct. The exact body and independent receipt source are not yet identified. |
| Periodic follow-up | Counseling/CISM event, action, owner, due date, outcome | Academy source if present and used; otherwise teacher-authorized restricted store | STATIC-DOC / OPEN. Do not add by default; first confirm relevance and allowed visibility. |
| Workbench queue and audit | Date, routine, field, subject key, draft value/hash, review/approval state, result, state transitions | Workbench | STATIC-CODE. Local queue history is useful for workflow audit, but is not an LMS save receipt. |

### Schema evidence consulted

- Separate automation repository: ganga/students.py declares student, observation, progress-log, error-log and item-checklist tables.
- Separate automation repository: ganga/lms/reader.py declares roster, DayRecord group/row/page and paper models; ganga/pipeline/schema.py declares fact, context, draft, and atomic progress/homework/memo models.
- Separate automation repository: ganga/queue.py declares a work queue and transition history; ganga/lectures.py declares lecture metadata.
- Local source files core/student_db.py and core/curriculum_db.py separate student problem logs/submissions from problem, answer, lecture, feedback, drawing, and time metadata.
- These files were inspected as source text only. No database, cache, session, or report contents were opened.

## 2. Teacher lifecycle and the student-centered view

The practical lesson is not a single ordered checklist. Several student work streams can run at once while the teacher moves among them.

| Stage | Facts to bring together | Candidate UX hypothesis to validate |
| --- | --- | --- |
| Before class: resolve the lesson | Date and class block; enrolled students; scheduled versus moved/makeup occurrence; next lesson; prior verified progress/homework; explicit exceptions | Start with the date and occurrence, then a class overview and focused student card. Show data source and freshness beside each imported fact. |
| Before class: prepare | Preview/video state; student-specific material; wrong-item or clinic print candidate; DT material; planned assignment and resolved due lesson | Separate planned, prepared, printed, assigned, and completed. Never label a generated/printable candidate as work already handed to a student. |
| In class: manage parallel work | Arrival; material hand-in; second-stage homework inspection; independent work; teacher check/feedback queue; oral concept check; DT attempt/correction/regrade; clinic or Habruta | Use a whole-class attention board and quick student event capture. A student can be working independently while waiting for a teacher check; do not force one status to erase the other. |
| In class: record evidence | What was attempted, checked, missing, unassessable, corrected, or still incomplete; actual progress and observed exception | Keep student declaration, teacher observation, official assessment, and mastery separate. No observation means unknown, not failure. |
| After class: compose | Actual progress, exact homework range/actions/due date, attendance, DT judgment, memo and exceptions | Show authoritative source fields beside the draft. Mark which text is teacher-written, generated, or imported from LMS. |
| After class: save | The exact DayRecord row, approved fields, save result, persisted values | Advance to “saved” only after exact-target reread matches the reviewed values. A response status alone is insufficient. |
| Parent handoff | LLM draft, teacher-edited preview, academy-saved report, send UI status, actual delivered body and receipt | Keep each state separate. The user confirmed the final send is manual. Show unknown when the source cannot prove exact text or delivery. |
| Periodic review | Assessment history, test/clinic outcomes, student follow-up, weekly CISM or counseling if used | Build a dated student timeline only from validated joins. Add modules after confirming that Park uses them and deciding data visibility. |

These UX ideas are hypotheses to validate in the next instructor interview and a representative workflow walkthrough; they are not acceptance criteria yet.

Owner update for the 2026-09-21 slice: the instructor arrived at 14:00 for a 15:00 class. The first per-student decision is whether pre-study was actually done: explanation video uploaded and Gauss required-example/type-practice problems submitted through the app and automatically graded. Additional required pre-study components still need sample-book and source verification. After 15:00, several students run in parallel and the activity order is intentionally dynamic; the teacher needs an attention/next-action board instead of one global linear checklist.

## 3. Candidate join rules and cardinality

The most useful code-level join candidates are LMS student key, course key, class-meeting key, DayRecord key, group selector, and problem/lecture key. Assessment and report references add paper, attempt-session, and report identifiers. Keep these as source-namespaced fields with fetch time; do not create a single undocumented universal ID.

| Relationship | Candidate join | What still needs verification |
| --- | --- | --- |
| Student to current roster/enrollment | Academy student key plus effective date; then class/group/course IDs | Whether the same student appears in multiple active groups/courses and how transfers are dated. |
| Lesson to official DayRecord | Date plus student key and the route's course/record/meeting identifiers | Whether an exact row requires group selection, and whether more than one record per student/date is possible. |
| Student work to course content | Student + course + occurrence, then book/unit/page/item | Whether web and tablet submissions share the same identifiers and timestamp semantics. |
| Paper to attempt and item | Paper ID to attempt-session ID to item/lecture key | Cardinality and whether a paper can have multiple attempts or be reused for different students. |
| DayRecord to parent report | DayRecord/report reference | Whether the report body is immutable, current, or merely rendered from current DayRecord fields. |
| Saved report to actual delivery | Report or batch reference to recipient/send event and receipt | No independently verified source found in this task. |
| Teacher note to student/lesson | Explicit mapped student key + occurrence/attempt ID + author/time | The owner selected indefinite retention for notes and corrections; the storage, backup, and append-only version model still need implementation. Never join on name alone. |

### Date-specific group observation

LIVE-OBSERVED-HANDOFF: the bounded read recorded for 2026-09-21 returned three all-view DayRecord rows under group value 0 and exposed four selectable groups. Group-filtered results partitioned as 1, 2, 0, and 0 rows. This shows that group filtering worked for that date even though the unselected view aggregated all three rows. It does not prove group behavior for other dates. Render “all groups” and “specific group” as explicit filter states; never interpret an empty filtered result as absence from the academy.

## 4. Source-of-truth and effect boundaries

| Value or action | Authority | Workbench treatment |
| --- | --- | --- |
| Current student/course/group membership | Academy LMS | Read current values; preserve source and effective date. Do not let a local profile overwrite LMS identity or enrollment. |
| Current official attendance, progress, tests, DayRecord | Academy LMS | Show as imported official values; any save must be a separate reviewed action followed by exact readback. |
| Actual in-class observation, correction check, oral response | Teacher | Capture as a dated teacher observation; do not present as an LMS fact until officially saved there. |
| Generated parent wording | LLM draft process | Keep draft and source facts; allow teacher edits; never let generation imply truth or delivery. |
| Actual parent message and delivery | Academy send/report subsystem | Require the exact delivered body or a reliable receipt source before displaying “sent/confirmed.” |
| Workbench review state and audit | Main Sheet or private workbench store | Authoritative only for review workflow, not for academy save or parent delivery. |

A material static conflict remains: the legacy DayRecord implementation maps overlapping fields but uses some state-changing GET calls and a 200-only success judgment. The legacy map uses daily_test_radio while newer automation code/docs use daily_test_no. Treat all legacy field/method details as hypotheses until the current screen fields and post-save readback are verified. The screen-load POST recorded in the handoff was semantically a read; method alone cannot classify the effect.

## 5. What belongs in Main Sheet versus a linked store

A single Sheet-centered workflow is feasible as a user experience even when the underlying records are normalized or stored elsewhere.

The owner explicitly chose to show student-level detail and text records—including teacher observations, LLM drafts, and parent wording—in shared Main Sheet cells after the workbook's broad link visibility was explained. Original video/drawing media should be linked, not embedded. This permits designing the student detail view there; it does not make sheet protection or hidden tabs a confidentiality boundary. Keep credentials out of the workbook.

Main Sheet support tabs are a reasonable candidate for small, curated, operational records when ACL, collaboration, and audit needs fit: source timestamps, stable lookups, selected lesson/workflow state, review metadata, and bounded drafts. Use a separately permissioned Drive/GCP store for private or growing event histories if the exact audience and retention rules are clear. Drive API is an access path; it does not itself supply relational joins, transactions, or private ACLs. A database is justified when the measured join graph, concurrent writes, revision audit, query needs, or event volume outgrow a Sheet. Keep the Main Sheet as the single work surface in either case.

Do not permanently mirror every LMS table. Read narrow date/student slices, keep official facts owned by LMS, and cache only the fields whose freshness requirements are explicit. Stable book/content metadata can tolerate a longer cache than roster, attendance, DayRecord, and parent-send state.

## 6. Interview and validation gaps for the next phase

1. Which menu and exact row/source exposes the parent-visible body and an independent Kakao delivery receipt?
2. The owner authorized all eight identified DayRecord fields for reviewed saving. What are the current score scale, exact wire parameters, and exact-target readback for each before implementation?
3. On a chosen date, must the screen require class/group/course selection before student selection, or can the all-groups result be safely used?
4. Which workstreams are actually part of Park's weekly life: SmartBook, community, counseling, monthly analysis/newsletter, certificates, user management, app-only submissions, paper pool, or only a subset?
5. Student-level detail and text records are approved for shared cells; original media is linked. The owner selected indefinite retention for notes, drafts, reviews, and corrections. What backup/export and source-verification rules apply, and what are the original media's own retention limits?
6. Does the separate automation repository remain an independent source/tool, or is any local schema intentionally in scope for the new workbench? Its presence does not imply permission or readiness to migrate.
7. The owner selected the 2026-09-21 lesson occurrence from preparation through the point immediately before manual parent send as the first acceptance slice. Assessment/clinic and periodic domains remain in the complete information architecture and need verified joins before their own acceptance.

## 7. Source pointers

- Shared map and safety rules: README.md
- Dated owner interview, live probe summaries, and current unknowns: ../../handoffs/2026-09-27-main-sheet-refactor.md
- Remote source inventory and hash manifest: ../remote-2026-09-27/inventory.md and ../remote-2026-09-27/manifest.json
- Earlier practical-workflow synthesis: C:\Users\packr\Desktop\academy-sheets-instructor-context-2026-09-23\01_CURRENT_BOUNDARY_AND_DUTIES.md
- Sanitized static code locations are listed in “Schema evidence consulted” above. Do not open local data/config/report files or copy any student-level examples into future prompts.
