---
title: Academy Source System Structure Map
created: 2026-08-23
updated: 2026-08-26
as_of: 2026-08-26
type: concept
tags: [ontology, source-authority, verification, security, known-gap]
sources:
  - raw/transcripts/academy-authenticated-source-structure-stage1-2026-08-23.md
  - raw/transcripts/academy-authenticated-source-structure-stage2-2026-08-23.md
  - raw/transcripts/academy-authenticated-source-structure-stage3-2026-08-23.md
  - raw/transcripts/academy-authenticated-source-structure-stage4-2026-08-23.md
  - raw/transcripts/academy-authenticated-source-structure-stage5-2026-08-23.md
  - raw/transcripts/academy-authenticated-source-structure-stage6-2026-08-23.md
  - raw/transcripts/academy-preclass-routine-source-structure-stage7-2026-08-25.md
  - raw/transcripts/academy-occurrence-history-structure-2026-08-26.md
  - raw/transcripts/academy-student-profile-school-counsel-cartography-2026-08-26.md
  - /opt/data/palantir-ontology-harness/source-manifests/academy_ga_study_answer_middle_files.json
  - /opt/data/palantir-ontology-harness/work-contracts/academy_preclass_routine_source_map_readonly.work-contract.json
  - /opt/data/palantir-ontology-harness/validation/academy_preclass_routine_source_map_readonly_hashes.sha256
  - /opt/data/palantir-ontology-harness/audit/academy_preclass_dayrecord_apply_assurance.json
  - /opt/data/palantir-ontology-harness/work-contracts/academy_calendar_property_reconciliation_v1.work-contract.json
  - /opt/data/palantir-ontology-harness/work-contracts/academy_phone_v3_class_board_calendar_v1.work-contract.json
  - /opt/data/palantir-ontology-harness/validation/math_ontology_current_governance_hashes.sha256
confidence: medium
freshness: per-task
runtime_scope: external
revalidate_when:
  - the academy login, tutor menu, servlet routes, parameters, or response shapes change
  - the user/profile, counseling, LCAD, school, or diagnostic-result source shapes change or conflict
  - an authenticated source-mapping or site-write unit is proposed
  - the iPhone override, XLSX assertion, Drive revision, or property-level reconciliation contract changes
  - the protected session is reissued after a site deployment
contested: true
contradictions: []
---

# Academy Source System Structure Map

## Purpose

This page is the sanitized, progressively verified map of the academy source system needed by [[academy-real-time-class-journal-vertical-slice]]. It records current endpoint, field, method, and effect shapes without treating the website schema as canonical ontology. Raw application values may exist only in the owner-only protected account snapshot; credentials, cookies, raw pages, and dynamic student values are not copied here.

The mapping follows [[palantir-data-backing-lineage-evolution]] for source lineage/evolution and [[palantir-reality-semantic-identity-contracts]] for the distinction between source keys and local canonical identity.

## Authority boundary

- The user is the authority for the local instructional workflow and desired operational meaning.
- The live academy site is evidence for current administrative/source structure and values.
- Executable probes establish what a route currently returns; menu presence alone establishes only discoverability.
- Legacy code is endpoint/selector evidence and must be re-derived against the current site.
- Source fields and route names are mapping candidates, not ObjectTypes or canonical property names by default.

## Capability status

| Capability | Status | Evidence |
|---|---|---|
| Public login-page discovery | VERIFIED | Current form and JavaScript parsed without credentials |
| VPS-origin direct login | VERIFIED | Login POST succeeded from the target runtime |
| Persisted session reuse | VERIFIED | A fresh process authenticated with only the protected session |
| Tutor-menu GET | VERIFIED | HTTP 200, no session/login marker |
| Domain route inventory | ACCOUNT_MENU_GET_SNAPSHOT_VERIFIED | Current account-visible menu navigation was crawled with same-origin GET only; mutation-like script controls remained frontier |
| Protected account snapshot | READ_OPERATIONAL / INCOMPLETE_FRONTIER | 74 strict records, 7,033,493 bytes, 65 GET and 9 exact read-only POST responses; manifest SHA-256 `b11c750648a3754a62907939d2f0c483f660239dd34f7fc1389ca8c5c02b09a4`; ten unexecuted/frontier controls remain |
| Student identity, profile, school, and counseling | READ_QUERY_VERIFIED / FRAGMENTED_AUTHORITY | User search, student detail, class assignment, schedule, counseling, student-status, LCAD-history, and diagnostic-result surfaces were compared. A dated LCAD query exposes school/grade/history fields, but no single current student-master school field is verified. |
| Class schedule and official DayRecord | CORE_FIVE_ACTION_CONTRACT_READY / PHONE_APPLY_UNCALLED | Current rows/fields observed; progress/homework has historical live apply/readback evidence, while class memo, attendance, and DailyTest have source-verified request contracts but no phone-v2 live write; homework-rate/CourseData remain apply-disabled |
| Pre-study review and comment | READ_SHAPE_VERIFIED / WRITE_EFFECT_CLASSIFIED | Waiting, completed, summary, detail, AI-report, video, rating, comment, student push, and parent push shapes mapped; no comment/rating/push called |
| Learning-result search | READ_ONLY_POST_VERIFIED | `StudentNameSearch` and `DtResultSearch` exact form contracts executed as bounded read-only queries |
| Textbook progress and clinics | READ_ONLY_POST_VERIFIED / GENERATE_EFFECT_CLASSIFIED | `getTextBookProgress` search and source identifiers observed; incorrect/similar/advanced paper Typeset effects mapped but not called |
| Student-course/progress shapes | GET_SHAPE_VERIFIED | `user_course_key`, course/unit hierarchy, filters, and mutable update contracts observed without values |
| Middle-school content library | DYNAMIC_LINK_INVENTORY_VERIFIED | Static authenticated HTML and Scrapling Dynamic agreed on 96 clickable PDFs; protected corpus and sanitized manifest verified |
| DT/ZT category and paper inventory | READ_ONLY_SELECTOR_VERIFIED / PRINT_EFFECT_CLASSIFIED | Scrapling HTTP resolved dynamic category XML, exact list search, and `TestInfo`; Typeset print/generate and lecture-code effects remain blocked |
| Session assignment authority/item identity | PARTIAL / LOCATOR_CANDIDATE_ONLY | Teacher occurrence scope is locally separated; printed/app/QR canonical identity remains unverified after document/app structural comparison |
| Application-value ingestion | PROTECTED_ONLY | Account-visible values may be read and snapshotted under the approved owner-only boundary; no dynamic value is retained in this Wiki |
| Academy write/edit/apply | ONE_CORE_FIVE_REVERSIBLE_CLASS_CONTRACT_READY | The current apply-enabled class is exactly progress, homework, class memo, attendance, and DailyTest under manual approval every time, full-bundle preview binding, durable pre-write rollback material, whole-row readback, and rollback. Phone-v2 live apply remains uncalled; homework-rate, CourseData, persistent note, and every other write remain blocked |
| Historical occurrence bundle | READ_OPERATIONAL_PROTECTED / SOURCE_CONFLICTS_EXPLICIT | Exact read-only date navigation, three existing parent-report views, one date-bounded pre-study summary, and per-subject completed-prestudy/learning-result/DT-ZT/textbook-progress queries were protected for two adjacent real operating dates. Raw values remain protected; the reusable finding is that occurrence, attempt, report projection, and source labels have different grain and can conflict. |

## Cartography topology and coverage

This is the current whole-account atlas. `Coverage` describes verified source understanding, not authorization. Detailed route claims remain in the sections below; program priority and product maturity remain owned by `/opt/data/palantir-ontology-harness/plans/academy-site-automation-roadmap.yaml`.

| Lane | Primary source anchors | Coverage | Highest-value frontier |
|---|---|---|---|
| Authentication/session | public login contract, `LoginServlet`, protected session reuse | `READ_OPERATIONAL` | deployment-triggered form/session drift |
| Navigation/account shell | `TutorMenuIndexServlet`, same-origin menu routes, protected snapshot manifest | `READ_OPERATIONAL_INCOMPLETE_FRONTIER` | complete route→operation→method→effect classification; root redirect and script/native controls |
| User/profile/counseling | `UserSearchServlet`, `UserManageStudentServlet`, `UserClsManageServlet`, counseling JSPs, `CounselServlet` | `READ_QUERY_VERIFIED / FRAGMENTED_AUTHORITY` | identify a current student-master school/grade authority and preserve conflicts with dated LCAD history |
| Class occurrence/membership | `CourseScheduleServlet`, `CourseGroupServlet`, `CourseMemberServlet`, `AttendanceServlet`, `DayRecordServlet` | `READ_SHAPE_VERIFIED` | actual occurrence assignment, makeup/transfer semantics, teacher override, revision history |
| Assignment/pre-study/progress | `StudyCourse`, `StudySchedule`, `WebUnPreStudy`, `WebCtPreStudy`, `WebPreStudy`, `TeacherPrestudySummary` | `READ_QUERY_VERIFIED / EFFECTS_CLASSIFIED` | occurrence-specific assignment authority; comment/rating/push separation |
| Materials/content/workbooks | `GaStudyAnswer`, `TextBookManageServlet`, workbook/SmartBook routes, storage corpus | `READ_OPERATIONAL_PARTIAL_CORPUS` | edition-complete app/printed/QR/item identity and workbook-generation effects |
| Assessment/grading/clinic | DA/FA/NA/diagnostic/test-pool routes, DT/ZT selectors/results, learning-result and clinic queries | `READ_SELECTOR_AND_RESULT_PARTIAL` | assignment→attempt→grading→correction→regrade grain and report/generation effects |
| Journal/report/delivery | `DayRecordServlet`, parent-report views, Alimtalk sender/list | `READ_OPERATIONAL_PARTIAL / EFFECT_FRONTIER` | sender payload, recipient derivation, consent, acknowledgement, partial failure, retry, compensation |
| Administrative/book operations | account, class assignment, book order, workbook, print, export | `MENU_OR_DOCUMENT_DISCOVERED` | classify each action independently; no blanket mutation inference |
| Local phone/XLSX projections | protected local source cache, iPhone calendar, attendance workbook | `LOCAL_RECONCILIATION_ENGINE_GREEN / PHONE_UI_PARTIAL` | connect explicit iPhone override and XLSX assertion ledgers, ingest Drive revision drift, and preserve no silent promotion to educational evidence |

Cartography grows opportunistically from real product work: every bounded slice should harvest reusable route/field/authority/effect knowledge into this owner, but whole-site completeness is not a prerequisite for the next safe product step. Broad understanding reduces repeated discovery; it does not broaden the Action allowlist.

## Authentication shape

The current public site uses a same-origin login POST. The browser transforms each credential by appending a separate random suffix and applying standard Base64 before submission. A session issued by a login originating on the VPS was reusable by a separate Hermes process.

This proves a bounded target-runtime authentication path. It does not make credential files or login responses ontology evidence, and it does not authorize site mutation or parent delivery.

## Current source areas

### Student identity, profile, school, and counseling

The current account fragments student-related source assertions across several surfaces. `UserSearchServlet?p_process=Main` can search by name and exposes source student identity, display name, grade/class, account status, and a student-detail navigation contract. `UserManageStudentServlet?p_process=Main` exposes contact/address/account-maintenance fields, while `UserClsManageServlet?p_process=Main` uses student key, name, displayed birth date, grade, and class for assignment. None of these verified documents exposes a school field. A task-specific rendered-browser check agreed with the static student-detail document and observed no hidden school XHR.

Counseling is another lifecycle. The counseling roster links to per-student counseling history and a student-status card; `CounselServlet?reqCmd=getStudentStatus` returns study/status attributes but no school. The separate LCAD report-link dialog queries `CounselServlet?reqCmd=getLCADStudents` with student name plus academy context and returns `d_student_name`, `d_school_name`, `gradeName`, and `d_history_datetime`. This is a dated report-history assertion, not proof of a current student-master profile.

The returned LCAD display name can append a terminal six-digit parenthesized birth-date token. Source joins must therefore preserve the raw display, normalize only that exact terminal pattern for lookup, and keep protected source identity separate. Arbitrary prefix/suffix matching remains forbidden. If normalized matches disagree on school or grade, the projection must quarantine the conflict or ask the instructor rather than silently selecting the latest report.

The diagnostic-result list is adjacent evidence, but its report button invokes native Typeset report creation; it is an effect rather than a read-only school lookup. LCAD report linking, student-status save, class move/save, report generation, print, and delivery likewise remain distinct effects. The sanitized executable observation is `raw/transcripts/academy-student-profile-school-counsel-cartography-2026-08-26.md`.

A schedule row's `(이동)` text is also not sufficient movement truth. In the observed test case the marker remained after a schedule was moved away and then returned to the original date. Treat it as a sticky source-display defect unless an actual change event, original/target occurrence, and reason are independently established.

Required mapping questions:

- Which current source, if any, owns authoritative school and grade rather than dated LCAD/report history?
- How are planned schedule moves, absence-following makeup attendance, ordinary attendance, and sticky display markers distinguished?
- Which student-status/counseling fields are internal instructor state, and which can reach a parent-facing memo or report?
- What source key and freshness rule safely joins administrative profile, class participation, counseling, assessment, and local opaque student identity?

### Class occurrence and membership

`CourseScheduleServlet?p_process=Main` is now GET-shape verified. It combines recurring group and actual-schedule candidates with student/source keys, attendance/status, date ranges, student/teacher/todo memos, and official day-record linkage. It is therefore a composite application surface, not a single `ClassSession` table.

`CourseGroupServlet`, `CourseMemberServlet`, and `AttendanceServlet` remain menu-discovered candidates. Membership values are deliberately deferred because the schedule surface already proved direct-identifier fields exist.

Required mapping questions:

- Which source key identifies an actual class occurrence versus a recurring group?
- Which date/group/course combination is stable enough for a source mapping?
- Which memo and attendance fields are administrative state versus teacher observation evidence?
- How does the verified day-record route bind an occurrence, tutor, student, and revision?

### Assignment, pre-study, and progression

The current learning menu explicitly distinguishes `강아학습결과`, `교재리포트 생성`, `DT / ZT 목록`, `DT / ZT 결과`, progression views, `예습 확인`, and `예습영상 현황`. Labels are current UI evidence, not ontology names.

`WebUnPreStudy` is the inspection-waiting list; `WebCtPreStudy` is the completed list; and `WebPreStudy&prestudy_key=...` is the detail. Exact student-name search POSTs for waiting/completed lists use `reqCmd`, academy/instructor context fields, and `student_name`. The detail exposes source keys for pre-study, student, instructor, course, small unit, version, status, score, video path/date, and the teacher `comment` textarea. `TeacherPrestudySummary` separately exposes student/unit/date/video/AI-score/rating/report analysis and must remain source analysis evidence rather than teacher observation or assignment authority.

The detail `send_message` path is a compound external effect. First it POSTs `WebSetPreStudyComment` with pre-study identity, comment content, actor/recipient identifiers, and parent flag; after success it constructs student-app action `prestudy_comment` and parent/teacher action `teacher_prestudy_comment` for native push delivery. The page also states that an AI report notification may be sent automatically after uploaded-video analysis. No comment, rating, native push, or report delivery was called in this mapping unit.

`StudyCourse` remains the per-student learning-course management surface. Its current source relationship/update contract uses `student_pri_no`, `course_key`, `user_course_key`, and mutable `status`. `StudySchedule` adds `course_key → bunit_key → sunit_key → colIndex` with date/state/score operations and dynamically loaded filters. These are separate source relationship/progress resources, not a session assignment field copied onto a student.

User-approved local interpretation: the source student-course/progress structure is longitudinal plan/current-state evidence; required work for one class occurrence is a separate `ClassSession` assignment that may have a teacher override. Source assertions and teacher observations link but never overwrite one another.

Required mapping questions:

- Which source creates the expected pre-study scope for one occurrence, separately from the resulting video/AI/rating evidence?
- Is occurrence assignment student-specific, group-default-plus-override, or both?
- How should a teacher comment draft, a committed source comment, and subsequent student/parent delivery remain separate local states?
- How do `user_course_key`, longitudinal progress, and a session-specific assignment relate without collapsing into one object?
- Which AI/rating outputs require human review before they can support a local instructional proposal?

### Material editions

`TextBookManageServlet?reqCmd=getTextBookMain` combines student lookup, textbook progress, similar/advanced clinic-paper generation, incorrect/report/print operations, and test-paper metadata; it is not an edition master. The exact `getTextBookProgress` student-name POST was verified as a read-only query. Its result relates `course_key`, `book_no`, source student identity, and `testing_no` and may expose learning completion plus an incorrect-note action.

The incorrect-paper path first queries wrong-answer-note results and then invokes native `Typeset.createResultPaper` with `incorrect.create=1`. The clinic path uses one testing occurrence, student identity, score, and one of multiply/divide/custom modes. Similar clinic generation is rejected at 100% because there are no wrong items; advanced clinic generation is rejected at 0% because there are no correct items. The generate/Typeset/printed-check sequence is an effect, not a read. None of these paper-generation or print effects was called.

The middle-school `GaStudyAnswer` content-library GET now verifies source selection dimensions for grade, level, combined edition, semester, volumes 1–4, and midterm/final material. `level` is not yet proven equivalent to the user's series vocabulary.

On 2026-08-24, an expired protected session was automatically renewed through the verified login flow. Static parsing found 98 PDF strings, while Scrapling Dynamic proved that 96 were current clickable links and two were raw-source-only, non-clickable strings. All 96 clickable PDFs were downloaded from exact HTTPS `storage.studyq.net` without forwarding the academy cookie: 37 answer, 3 daily, 19 errata, 36 sample, and 1 unclassified source document, totaling 1,089,179,027 bytes. The protected corpus preserves the server-relative path and filename for source mapping; filenames are not canonical identities. The sanitized manifest is `/opt/data/palantir-ontology-harness/source-manifests/academy_ga_study_answer_middle_files.json` with SHA-256 `22e77c7701bfc2bbe093d347029aaa0c12465f12efe0591d39e349b625775c93`.

On 2026-08-25, a freshness-triggered authenticated Scrapling HTTP and Dynamic comparison rechecked `GaStudyAnswer`, `StudyCourse`, `StudySchedule`, the SmartBook index, and the workbook list. PDF literals remained confined to the `GaStudyAnswer` answer/daily/errata/sample surface; no complete/original-edition textbook marker or PDF corpus was observed on SmartBook, workbook, or longitudinal progress pages. The pages expose native `LecturePlay` and `CreateWorkBook` bridge commands, but the tutor web session does not prove direct access to the student app's internal corpus. The safe current disposition is page-first plus free-text fallback; item-code design remains blocked on edition-complete app/printed evidence.

Of 36 sample PDFs, 33 exposed readable text layers and three were empty/scanned at the current extraction layer. Empty text is an OCR/rendering gap, not evidence that the document has no content. The approved first Slice 4 fixture anchor is source code `1T16`, source label `22개정 중2-2-가우스`, and original filename `g8_gauss_sample_2_3.pdf`; its sample remains `PARTIAL_SOURCE_EVIDENCE`.

Required material identity shape:

```text
material family/type
+ grade
+ semester
+ series
+ volume/edition
+ source key
+ temporal validity
```

The submitted concept textbook and clinic workbook remain independent learning flows even if the source UI groups them under one menu.

### Item, answer, video, and QR linkage

The content-library page verifies a `lecture_key` input and `getVideoLecture` lookup, with lecture type/URL and app `LecturePlay` concepts. It also exposes book-preview/workbook-creation behavior and a `book_code` candidate. This makes `lecture_key` the strongest current QR/video locator candidate, not a proven item identity.

The 2026-08-25 Dynamic recheck confirmed that these app concepts are native-command bridges, not evidence that a headless tutor-web browser can enter the student app or enumerate a complete textbook. `getVideoLecture` is a lecture lookup, while `CreateWorkBook` is an effectful native command and was not invoked. No student-app deep content, full-book file, or edition-complete item table was acquired.

Workbook, SmartBook, and stream-player routes remain related candidates. Stable item identity still requires clickable-attribute/PDF comparison. Page numbers or lecture keys alone must not become canonical locators without edition and printed/app item evidence.

On 2026-08-24, the exact protected Slice 4 sample and answer documents were compared in process memory without emitting problem text, answer text, QR payload values, or video URLs. Seven QR payloads were decoded from the 37-page sample, but none matched the answer document's seven-digit lecture-key candidates. A simple printed-page-plus-problem tuple also collided across book/section context. The current authenticated web surface exposes a same-origin `getVideoLecture` lookup and browser stream fallback, and the related paths were network-reachable with HEAD, but no lookup POST, video play, or status update was called. The governed disposition is therefore `LOCATOR_CANDIDATE_ONLY`: use an opaque local exception reference and keep document hash/path, optional page/item number, and optional lecture key as noncanonical source locators until one-to-one edition-aware evidence exists.

### Assessment, clinic, journal, and delivery surfaces

DT/ZT dynamic selectors are now current-response verified. For `evalgubun=1005`, Category GETs return `cl2result`/`cl3result`; the reviewed `[22개정] 중2` branch uses source option `cl1=148`, `cl2=203` (`수학`), and `cl3=1034` (`5. 도형의 성질`). The exact `DailyZeroTestSeach` read-only POST uses `evalgubun` plus `frm_cl1/2/3`. `TestInfo` GET returns paper number, title, source file path, question count, type, level type/order, category, and a test/lecture code field. Access-code values are intentionally excluded here.

For the current `이등변삼각형의 성질` source row, the inventory exposes two homework-performance DT paper candidates, one class-understanding DT candidate, and four small-unit ZT candidates. Paper metadata is stable source mapping only; the paper number is not a canonical educational identity. `createTestPaper` invokes native `Typeset.createTestPaper` for teacher/student/answer paper cases, while information preview and lecture-code lookup are separate GET paths. No paper, answer, code, or print operation was created or opened.

Result-driven clinic generation is a separate event from pre-study checking and DayRecord. It consumes a testing occurrence, source student identity, score, and incorrect/correct item structure; it can request incorrect, similar, or advanced paper output and then mark printed state. Do not embed DT/ZT or clinic lifecycle inside a homework-inspection component merely because the source menu places them nearby.

`DayRecordServlet?p_process=Main` is current-value read verified. Its row fields include occurrence date/group, student/course, persistent note, prior/current progress, homework, memo, attendance, and daily-test status. The legacy page mutates persistent note, progress, homework, memo, and attendance through `udt*` GET routes; daily-test/course-data updates use `CourseCommonServlet` POSTs; print uses `PrintMain`; study-report delivery opens an Alimtalk sender. These are effects even when the legacy transport is GET.

The current DayRecord page also embeds an ordered `course_unit_list` containing source `bunit_key`, `sunit_key`, big/small-unit names, and `book_code`. Native `SetCourseData` concatenates the selected big- and small-unit names into one `homework_memo` request value; it does not submit three independent big-unit/small-unit/memo values. The captured row DOM instantiates no selected `bunitN`/`sunitN` controls, so fresh current-before and rollback values remain unavailable. Native options may scaffold local instructor choice, but homework-rate and CourseData remain apply-disabled until exact selected-before/readback semantics are verified.

#### Native study-report Alimtalk surfaces

The dated DayRecord source exposes one `onNewBatchAlimtalk` control plus one `onOneAlimtalk` control per report row. `allReportSeqList` carries all study-report source identities for the selected date, while `newReportSeqList` carries only rows whose source status is not yet sent. The batch control fails locally when `newReportSeqList` is empty; otherwise it opens `/alimtalk/send_studyreport_alimtalk.jsp` with the all-report set, target unsent set, and report date. The individual control opens the same sender route with one report as the target. Source rows distinguish ready/unsent and sent icons, but these are delivery-state observations rather than educational evidence or authorization to resend.

A separate read-only menu surface, `AlimtalkServlet?p_process=AlimtalkList`, lists delivery records and filters by message template, month, student, instructor, and page. Current template classes include study report and pre-study-video AI analysis. List rows expose a masked recipient number, template class, reservation state, send time, delivery state, and state-dependent action. Scheduled-message cancellation is a distinct confirmed-user POST to `p_process=cancelAlimtalk` with an Alimtalk source identity; it was not invoked. The sender page body, recipient derivation, editable preview, actual send request, acknowledgement, partial-batch behavior, retry/resend semantics, consent, and compensation remain an explicit effect frontier. No sender, cancellation, resend, or delivery request was executed during this mapping.

After Stage 7's no-effect read unit, one separately approved Action invoked only `udtPrg` and `udtHw` for an exact current row. Both fields passed same-process and fresh-process readback; persistent note, memo, attendance, and daily-test were unchanged, rollback was not required, and paper generation, comment/rating, push, Alimtalk, and parent delivery remained zero. This evidence activates only the `dayrecord_progress_homework_prefill` class; it does not generalize to other rows, fields, writes, or delivery.

### Local operational source observation

The phone successor now separates academy source freshness from both local draft and future educational evidence. Fresh bundle reads on student-drawer open, app resume, explicit refresh, exact preview, and Action precondition/readback update owner-only SQLite `source_snapshot_latest`; `source_snapshot_history` appends only when the deterministic full-bundle fingerprint changes. An unchanged refresh updates only last-observed metadata. A changed refresh increments an opaque per-student source revision, reports changed field names to the authenticated phone UI, and invalidates any cached exact preview. It never overwrites instructor local draft, never becomes longitudinal student evidence, and never invokes an academy write. This is the local source-cache/data-backing boundary described by [[palantir-data-backing-lineage-evolution]], not a promotion of source schema into [[academy-real-time-class-journal-vertical-slice]] canonical meaning.

Because comparison, persistence, and badge generation are deterministic server-side operations, routine source refresh does not require an LLM/chat turn. Manual academy edits therefore do not require the instructor to notify the agent merely to keep current source aligned; a notification is useful only when human attribution or educational interpretation matters. The current phone display exposes the source-verified core-five values read-only; broader pre-study/result/clinic/course/report categories remain a progressive source-panel extension.

#### Property-level local reconciliation and Calendar Command

The tested local reconciliation engine groups assertions by opaque target plus property, separates explicit `SET` and `CLEAR` from no assertion, orders only trustworthy `changed_at`, and never uses later `observed_at` as a change claim. Equal trusted times with different values and unknown chronology with different semantics remain structured conflicts; a user override can be retained pending conflict, while a strictly newer trusted explicit change can supersede it. Ordered source provenance is preserved, input order is deterministic, and only resolved required `SET` values may project into the unchanged attendance-workbook validator. The local contract has 16 focused regressions; the workbook remains a derived projection, not a current-state owner.

The production phone composition now has a separate Calendar Command route, but its connected data is deliberately partial. It converts nonblank academy core-five observations into academy assertions with `changed_at` unknown, excludes the mutable iPhone draft from assertion authority, labels iPhone override and XLSX assertion ledgers as unconnected, and keeps Drive disabled until those ledgers plus remote revision drift are ingested. The 2×3 Class Board persists only explicit current/next instructor pipeline choices, while Six Rail selection changes navigation focus without mutating that pipeline. This is executable local behavior, not proof of full calendar participation coverage, Drive readiness, confirmed educational evidence, or real-iPhone acceptance.

### Historical occurrence cross-surface evidence

A 2026-08-26 protected read unit bound two adjacent dated class occurrences through the current DayRecord date-navigation contract, then read already-created parent-report views and exact completed-prestudy, learning-result, DT/ZT-result, and textbook-progress queries. The durable sanitized evidence is `raw/transcripts/academy-occurrence-history-structure-2026-08-26.md`; names, IDs, scores, report prose, URLs, and raw bodies remain owner-only.

This unit established several source-model constraints:

- recurring schedule pattern and actual dated `ClassSession` occurrence are distinct;
- a parent report is a delivered administrative projection, not the underlying event/evidence store;
- one occurrence can contain several workbook, concept/unit, and DT/ZT attempts, while the single DayRecord DailyTest field can have different grain and must not overwrite those attempts;
- a source surface labeled pre-study can carry a timestamp during the actual class window, so route/menu labels do not determine instructional phase;
- clinic availability/status, generation controls, and actual clinic work remain different assertions;
- cross-surface grade/course labels may conflict and require source/time/conflict preservation;
- synthetic operational rows can coexist with real rows and require explicit fixture provenance.

The deployed occurrence-safe phone successor therefore lists recent/current/next occurrences explicitly, keeps prior occurrence drafts read-only with no automatic carry-forward, and permits only same-occurrence stale-snapshot cold start. This infrastructure is still source observation plus mutable-draft support; `Student Record Confirm`, correction/reinspection lineage, academy Action, and parent delivery remain separate lifecycles.

Scrapling HTTP successfully executed the selector Category GETs, exact list POST, and paper-info GETs with no synthesized referer. A task-specific `DynamicFetcher` attempt stopped before academy navigation because the Playwright Chromium executable is absent. This is a browser-runtime gap, not missing source content: the JavaScript request contract and live HTTP backend XML agreed and fully resolved the selector values used here.

## Source-to-ontology mapping discipline

Use the following progression:

```text
MENU_DISCOVERED
→ GET_SHAPE_VERIFIED
→ FIELD_AUTHORITY_CLASSIFIED
→ SOURCE_MAPPING_PROPOSED
→ USER_REVIEWED
→ CONTRACT_TESTED
```

For every source field retain:

- endpoint/path and routing operation;
- source field name and data class;
- direct identifier/PII classification;
- event/entity/observation/state interpretation;
- field-level authority;
- freshness and conflict behavior;
- local canonical target or explicit `NO_CANONICAL_MAPPING`;
- read/write method boundary.

## Immediate bounded mapping order

1. Harvest reusable route, field, authority, freshness, and effect findings from every real product slice into this map and the single automation roadmap; do not block useful product work on whole-site completeness.
2. Complete the user/profile/school/calendar lane far enough to support the attendance XLSX and iPhone calendar safely: current profile authority, stable student/source join, regular participation, planned move, absence, makeup participation, reason, and conflict behavior.
3. Resolve actual occurrence assignment and teacher-override semantics, then map assessment assignment → attempt → grading → correction/regrade at event grain rather than copying summary fields.
4. Map parent-facing delivery only after its payload, preview, recipient derivation, consent, acknowledgement, partial failure, retry/idempotency, and compensation boundaries are explicit.
5. Map book ordering, workbook creation, native print, download, and export as separate Actions; their shared menu location does not imply shared authorization.
6. Preserve “no current source row” as a source-observed absence at query time, not proof that no work or history exists. Keep downloaded/app/printed/QR locators noncanonical until edition-aware one-to-one evidence exists.
7. Reuse protected snapshots and exact read contracts whenever fresh enough; expand coverage with bounded static → HTTP → rendered-browser probes only when the next source question requires it.

## Governance drift

The account snapshot client has an exact origin, GET/HEAD plus proven-query-POST boundary, mutation-like GET rejection, response limits, request fingerprints, owner-only files, strict exact-origin manifest, and an explicit incomplete frontier. An old pre-remediation tuple retained provenance for two closed findings; a later async review also exposed a schema-valid `write_manifest` semantic-parity bypass for complete/frontier and aggregate counts. That F3 became a RED test and is now rejected before write. The current six-file successor is tracked by `validation/academy_preclass_routine_source_map_readonly_hashes.sha256`; final reviewer `deleg_71402b8c` returned PASS on manifest SHA-256 `e2f1c3d3d7847cf11a7c71c7decc990724170eb8d9ebdec857dfd630ca50ce6b`. The protected dynamic manifest, current governance manifest, and implementation manifest remain separate evidence owners.

This control remains smaller than the mapping work it governs. Progressive account understanding does not itself authorize comments, ratings, paper generation, native print, DayRecord fields outside the current core-five class, Alimtalk, app push, or parent delivery.

## Exclusions

This page contains no login ID, password, cookie, bearer/app key, student or school value, source student identifier value, displayed birth-date value, comment text, raw authenticated HTML, local roster, or student observation. Exact read-only query POSTs and one sanitized core-five reversible Action class are documented; no other comment, rating, generate, print, update, save, apply, report-link, app push, Alimtalk, or parent-delivery authorization is implied.
