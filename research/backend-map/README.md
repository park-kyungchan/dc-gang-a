# Academy backend map — Park Gyeongchan instructor workspace

Version: 2026-09-27. Status: research map, not an implementation or permission grant. Target workbook: `1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg`, Main tab `박경찬` (`gid=1754681846`). Target local project: `C:\Users\packr\Desktop\강의하는아이들_대치점`.

## Read this first

This map is for a new agent with no conversation context. It distinguishes source declarations, dated teacher-site structure, bounded live values, and unresolved joins. It covers Park-related academy instructor work and its Main Sheet design target. The live app-adjacent pages are teacher-site shells; this map does not verify the native app API, student submissions/grading, or a complete current Park roster. The academy backend is externally owned, and no map document grants permission to mutate it.

Read this file first, then open only the detail needed for the current task:

1. [Course and parent delivery](course-delivery.md) for schedule, groups, attendance, DayRecord operations, report preview, Kakao send-screen boundary, and delivery unknowns.
2. [Learning and assessment](learning-assessment.md) for progress, preparation, DT/ZT, FA/NA/DA, textbook, papers, items, Smartbook, and app-adjacent source declarations.
3. [Assignment live evidence](assignment-live.md) for the bounded 2026-09-21 course-period joins and the incomplete current-roster query.
4. [Preclass evidence](preclass-evidence.md) for owner-confirmed workflow, training-based checklist candidates, static sample limits, and app read-contract gaps.
5. [Instructor lifecycle and entities](lifecycle-entities.md) for product design, classroom flow, source ownership, and joins.
6. [App/site static route map](app-static.md), [bounded live teacher-site shells](app-live.md), and [student-level read-contract audit](app-read-contracts.md) for source declarations, 13 fixed live views, and the exact unresolved app joins. Native-app state and selected-student submissions/grading remain unverified.
7. [Operation registry](route-registry.json) for the 51 operation-level entries, their semantic effect, evidence grade, join-key names, and probe limits. Entries include source and historical evidence; 51 does not mean 51 live-verified operations.
8. [Main Sheet UX proposal](main-sheet-ux-proposal.md) for the owner interview and the evidence-backed design hypothesis; it is not an accepted implementation.
9. [Sheet topology snapshot](sheet-topology.json) before workbook work; it records the bounded tab structure, formula dependencies, and sharing/protection metadata observed on 2026-09-27.
10. [Remote source inventory](../remote-2026-09-27/inventory.md) and [hash manifest](../remote-2026-09-27/manifest.json) only when checking copied-source provenance. The source checkout was `e91b4d7d9f48013469cf823bec5693e5276c01e5` when copied.
11. [Dated working handoff](../../handoffs/2026-09-27-main-sheet-refactor.md) when resuming an unfinished phase or owner decision. A handoff is a checkpoint, not authority to write.
12. [Map hash manifest](map-manifest.json) for the current canonical file hashes and evidence summary. It covers the 12 canonical files in this directory and excludes itself.
13. [Google Cloud bootstrap notes](../gcp/README.md) for the selected project, keyless bot identity, protected Main tab, and configured-versus-tested status.
14. [Main Sheet v2 layout contract](../main-sheet-v2/schema-and-layout.md) and [synthetic Google Sheets prototype readback](../main-sheet-v2/prototype-readback.md) for the dated UI implementation experiment; this is separate from the academy-owned workbook.

## Evidence levels

| Level | What it proves | What it does not prove |
| --- | --- | --- |
| `source` | Code or a document declares a route, field, or behavior at a stated revision/date. | That the deployed LMS still behaves the same way. |
| `live-route` | The exact route returned a response without an observed login/session-error marker on the stated date. | Correct row coverage, current student data, or permission to mutate. |
| `live-structure` | A bounded live response exposed a specific selector, field, status marker, or key relation. | That all rows, pages, classes, or app states were captured. |
| `live-value` | An exact authorized subject/date/field was read, with its source and timestamp. | That a local copy is still current or that a send occurred. Do not put values in this map. |
| `effect-readback` | An authorized write was followed by an exact-target read that matched the intended value. | Parent delivery or downstream acceptance unless separately verified. |
| `accepted` | The owner checked the complete intended workflow and result. | Automatic future correctness after source or UI drift. |

Never promote a lower level to a higher one from HTTP 200, a hidden tab, a dashboard caption, a sent-looking icon, a historical test label, or a static code path.

## Current bounded evidence status

- The operation registry has 51 entries across live, source-only, historical, and static-JavaScript evidence. The 13 routes in `app-live.md` establish reachable teacher-site page shells and form structure only. They do not establish a native app API, student-level app states, complete pagination, or app-to-site joins.
- `assignment-live.md` records date-valid course-period matches for two of the three 2026-09-21 DayRecord students. The third lesson-specific course remains unknown, and the current Park roster query is incomplete.
- `preclass-evidence.md` separates the owner's readiness requirements from training material and sample textbooks. Lesson-specific preparation assignment, app submission, grading, correction, and video-watch states remain unverified.
- `app-read-contracts.md` source-reviewed the current pre-study form commands and historical detail path without making a new academy request. It did not find a verified Park student/lesson key or a semantically classified selected-student app read. The Main Sheet readiness card must keep these states `unknown`.
- The `DailyReport` page was read as a current preview and the Kakao send screen was opened read-only. No Kakao send/cancel was invoked; the exact parent-delivered text and an independent delivery receipt remain unverified.

The remote package now also includes a [sanitized academy source-system Wiki](../remote-2026-09-27/shared-llm-wiki/concepts/academy-source-system-structure-map.md) (`as_of` 2026-08-26) and a [sanitized SPT classroom-direction extraction](../remote-2026-09-27/summaries/workspaces/spt/classroom-product-direction-structural.md). They give more detailed source-lane and effect contracts but remain dated evidence. The SPT original mixed real-use observations and was not copied. Use these only when the relevant detail ledgers do not answer a source question; do not promote their historical status labels to current acceptance.

## Hard boundaries

- **Classify by operation, not HTTP method.** The current DayRecord screen load is a read-only `POST` with `p_process=Main`; DayRecord `udtPrg`, `udtHw`, `udtMemo`, `udtStuMemo`, and `udtAttn` are mutating `GET` operations. No generic GET-only policy can guarantee database read-only behavior.
- A historical Wiki documents a narrow core-five reversible Action class, while the owner has now authorized future reviewed saving of eight DayRecord fields. Authorization does not supply current wire/readback evidence for the three additional fields; verify each before implementation.
- The owner authorized investigation of Park-related LMS data and future reviewed saves for all eight identified DayRecord fields: attendance, daily test, progress, homework, memo, homework rate, persistent student memo, and unit selection. Each exact operation still needs current field/target validation and post-save readback. The owner performs final parent delivery. Do not call `sendMultiStudyReport`, `cancelAlimtalk`, or an LMS save while doing read-only mapping.
- Legacy `core/day_record_sync.py` uses HTTP 200 as success without exact-value readback; do not execute it as a write path. Legacy `core/engine.py` contains a hardcoded session value and was intentionally excluded from the copied package. Do not open or copy it for routine map use.
- Dated source mapping shows that a pre-study teacher comment can also trigger student-app and parent/teacher push messages. Treat comment save, rating, app push, and parent delivery as separate effects; do not make them implicit consequences of a Main Sheet note.
- `src/mcp_server.py` in the target project can return fixed exam examples after an empty live result; those examples are not academy facts. The historical `similar.create=1` route may create a paper and is not a read probe.
- The target project's `docs/cartography.md` mixes route notes with real student identifiers and dated work details. Do not ingest or copy it wholesale into a zero-context prompt; use only the privacy-reviewed schema references in the detailed ledgers.
- Keep credentials, raw student records, report URLs with identifiers, private observations, and response bodies out of this map, terminal output, and general logs. A user-supplied session was used only in process memory for bounded probes; it was not persisted. Suppress scraper request logging before any parameterized call.
- The workbook currently has an `anyone: writer` Drive permission. A 2026-09-27 keyless bot API read verified one sheet-wide, enforced protection on `박경찬`; `packr0723@gmail.com` and the new bot are listed editors and the bot's `requestingUserCanEdit` is true. No actual cell write was attempted. Protection, hidden tabs, and collapsed rows do not restrict reading. After being told this, the owner explicitly chose to display student-level detail and text records (teacher observations, LLM drafts, parent wording) in shared Main Sheet cells, with original media linked rather than embedded. Treat that visibility as an intentional requirement; keep credentials and unrelated private records out of scope.

## Student-centered join spine

```text
Instructor + lesson date + optional group
    -> DayRecord row: course_seq / stu_pri_no / record_seq / cm_seq
    -> current LMS fields and report_seq / report URL
    -> schedule, attendance, course/progress, preparation, tests, papers
    -> paper/attempt keys (p_no / testing_no, exact cardinality unverified)
    -> lecture_key -> item metadata / image / explanation / video

Teacher-owned local observations, draft, approval, and audit history
    -> must carry an explicit mapped student ID, lesson/attempt ID, source,
       observation time, author, and revision; never join by name alone.
```

`login_id`, `stu_pri_no`, `grp_seq`, `course_seq`, `record_seq`, `cm_seq`, `p_no`, `testing_no`, and `lecture_key` are different identifiers. Their current cross-screen relationships require field-level checks where detailed source documents say `unknown`. Empty or missing data means **unknown/not observed**, not absence, noncompletion, or failure.

## Life-cycle coverage and Main Sheet design direction

| Work phase | Backend/teacher inputs to join | Main Sheet behavior to test |
| --- | --- | --- |
| Before class (owner: 14:00–15:00 on 2026-09-21) | Schedule, current group/attendance expectation, assigned course/book, last verified progress/homework, explanation-video upload, Gauss required-example/type-practice app submission and automatic grading, materials and DT preparation. | Open on date and student, then a readiness board showing each required item, source state, unresolved check, and freshness. Uploaded, graded, teacher-reviewed, and ready are different states. Other pre-study items still need source and owner confirmation. |
| During class (owner: starts 15:00) | Arrival/attendance, submitted materials, teacher inspection, concept oral check, DT/regrade, clinic, concurrent teacher attention queue, actual progress and exceptions. | Fast event capture and visible queue across students; activity order is dynamic, so distinguish assigned, attempted, student-declared done, teacher-checked, and mastered without a forced sequence. |
| After class | Teacher-reviewed progress/homework/memo, DayRecord save and readback, current report preview, Kakao send screen, sent-labelled UI state, any independently verifiable receipt. | Separate draft, reviewed, LMS-saved, currently rendered report, sent-labelled, and receipt states. Final send remains a human action. |
| Periodic | FA/NA/DA and Smartbook results, paper pool and item errors, counseling, makeup, CISM, longer-term student follow-up. | Student timeline and exceptions; keep catalogs, assignments, attempts, results, and follow-up distinct. Link to official creation screens until those actions are separately designed and authorized. |

The best current design hypothesis is **one Main Sheet work surface over keyed, source-labelled tables**, rather than one flat, folded block that duplicates every LMS entity. The current workbook has 43 tabs and about 904,467 allocated cells, so cell capacity alone does not force a Drive move. Student-level detail is approved for shared Main Sheet cells; owner-allowed hidden tabs can hold bounded operational tables, with the same workbook-wide read visibility. The owner chose indefinite retention for teacher notes, LLM drafts, reviews, and corrections, so edits must append versions and capacity/backup must be measured. Google Drive API can manage larger files, versioned artifacts, or material with different access requirements, but file storage is not automatically a better query database. A project and keyless bot identity have since been configured; decide the storage and service boundary from measured joins, latency, and maintenance before adding implementation resources. See the [GCP bootstrap notes](../gcp/README.md).

## Evidence-backed usability opportunities

| Current friction or gap | Evidence level | Main Sheet proposal to review with the instructor |
| --- | --- | --- |
| Progress, preparation video, DT/ZT result, and FA list are separate LMS routes. | Live route observations on 2026-09-27; exact navigation time is unmeasured. | One selected-student summary with source timestamps and a direct link to each official detail screen. |
| DayRecord, current Study Report preview, sent-labelled row icon, and Kakao send popup are separate effects. The preview did not contain all current source text verbatim in one bounded check. | Live structure on 2026-09-27 for the 2026-09-21 lesson; recipient receipt and immutable sent text remain unknown. | Put draft, reviewed text, exact LMS save/readback, current report preview, send-labelled state, and verified receipt in separate visible states. Never claim delivery from a link or icon alone. |
| The test-paper pool includes other branch teachers, and a paper catalog does not establish student assignment or completion. | Local parser and historical UI source; current Park-only join unverified. | Separate reusable paper pool from the selected student's assigned, attempted, graded, and clinic-needed work. |
| The academy DayRecord DailyTest is a teacher judgment for a lesson; measured DT/ZT attempts have different grain. | Dated sanitized SPT/source map, not a fresh same-student comparison. | Show the two values side by side with separate sources and dates; never auto-copy an attempt score into the diary judgment. |
| Existing screens and local models do not establish one student-wide overview across site and app data. | Bounded source inference; not proof no other screen exists. | A student timeline and whole-class attention queue, with explicit unknown data and next teacher action. Validate both against real classroom use. |
| Existing Main Sheet has a student/date selector and three sync/cache dependencies, but large areas are literal display content. | Live Sheets metadata/cell structure read on 2026-09-27. | Retain the familiar selection entry point while replacing fixed claims with keyed, refreshed, evidence-labelled cards and reviewed input controls. |
| App-adjacent teacher pages use different date, grade, class, student, course, and workbook filters; thirteen fixed views responded live, but their selected-student joins were not verified. | Live page-shell and inline-JS structure on 2026-09-27; [app-live.md](app-live.md). | Keep one Main Sheet date/student context, translate it only through verified source-specific keys, and show `unknown` until a filtered read is proven. |

## Zero-context continuation procedure

1. Read this map and the exact detailed surface entry. Check its source revision/date, semantic effect, expected identifiers, and explicit unknowns.
2. Reconfirm the current LMS route and authorized identity with a bounded, allowlisted read. Do not inspect credential stores or print a session. Do not assume all branch rows are Park's students.
3. Select the exact date/student/lesson or test attempt. Fetch only required fields and pages. Preserve source, read time, pagination/completeness, and `unknown` states. Do not copy raw records into research artifacts.
4. For any proposed LMS write, first confirm the owner-authorized field and instructor review. Use a single gated write path, then reread that exact field/row and record the before/after result. Do not infer parent delivery from the save.
5. Refresh sheet topology and permissions before changing the workbook. Bot file Writer and protected-tab `requestingUserCanEdit` were read back on 2026-09-27, but no cell-write acceptance test has been run. The spreadsheet-wide API scope cannot be limited to one tab.
6. Update a surface's evidence level only after a fresh exact-target check. Add the source path, line or fixed operation, timestamp, and what was actually verified. Leave unresolved app or delivery fields marked unknown.

## Open owner decisions

- The owner approved student-level detail and text records in shared cells, with original media linked, and selected indefinite retention for teacher notes, LLM drafts, reviews, and corrections. Exact backup/export and media-link retention behavior still need implementation.
- All eight identified DayRecord fields are authorized for future reviewed saving. Which current wire parameters, field scales, and exact readbacks are confirmed for each before implementation?
- Where can the exact parent-delivered message and an independent delivery receipt be read? The current `DailyReport` page is a rendered preview, while the row icon is only a sent-labelled UI state.
- Which app-only student actions and teacher-visible app states are accessible through an authorized, semantically read-only route? Current source maps do not establish complete app coverage.
- What is the first owner-accepted Main Sheet workflow, and which actions should remain official-site links rather than automated writes?
