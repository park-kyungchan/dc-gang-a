# Daechi Whole-Lens decision — v1, 2026-09-27

**Decision:** Start with an iPhone web app pilot on the teacher's iPhone 14 Pro
Max, alongside the PC Main Sheet. The owner will not enroll in a paid Apple
Developer membership, so TestFlight and cloud macOS signing are removed from
the active release path. An existing Android account is an option if an Android
classroom device and its distribution requirements are later confirmed. No
mobile deployment or academy write is implied by this choice.

## 1. Priority and evidence boundary

| Priority | Teacher decision and surface | Source of truth | Current evidence and stop condition |
| --- | --- | --- | --- |
| P0 | At 14:00, inspect the complete date-scoped class and decide what each selected student needs before class. | LMS for official schedule, assigned course and DayRecord; verified app backend rows for submissions and grades. Main Sheet is the review surface. | Main Sheet has a synthetic date-first/whole-class projection and local gate. The live 2026-09-21 DayRecord read covered three rows, not a current roster. Two course periods matched that date; one assignment remained unknown. App submission, grade, video and correction joins are unverified. Unknown must remain visible. |
| P1 | During class, handle six or more students by one-handed iPhone actions and retain events/audio despite interruptions. | SPT D1 events, R2 original audio, and the device outbox until exact receipt. | Sanitized source and the current native pairing/audio draft passed an isolated synthetic Linux gate. The gateway still binds loopback; no durable iPhone URL, browser device acceptance, or physical phone result exists. |
| P2 | Review after-class progress, homework and parent wording, then save only exact approved official fields. | LMS owns DayRecord; Main Sheet owns teacher review, drafts and corrections. | Eight fields are authorized for a *future* teacher-reviewed save. Field-specific wire/readback and current student/lesson bindings remain unverified; no save is admitted yet. |
| P3 | Hand off the final message to the teacher for Kakao sending. | Official sender and an independently joined receipt, once verified. | A report preview, sent-labelled icon and send screen are distinct. The delivered body and receipt are unknown; opening the screen is not sending. |

The first teacher review must evaluate **every student** on the selected lesson
date, then the selected student's judgment. The owner did not set a wait-time
threshold. For each student the checklist must show the assigned homework
range, whether the matching pre-study video was uploaded, whether problems in
that range were solved and grading reached the app backend, and whether wrong
problems had a video/correction path or were marked complete. The teacher must
visually verify the wrong-problem resolution. A UI shell, LMS label or missing
row cannot prove any of these states. See
[preclass evidence](../research/backend-map/preclass-evidence.md),
[assignment joins](../research/backend-map/assignment-live.md), and
[app read gaps](../research/backend-map/app-read-contracts.md).

## 2. Authority, joins and PC/iPhone boundary

| Record | Identity that must be bound before display/write | Boundary |
| --- | --- | --- |
| LMS lesson occurrence and DayRecord | Exact teacher, `std_ymd`, `grp_seq`, `stu_pri_no`, `course_seq`, `record_seq`, `cm_seq`; verify the row, effective course period and selected student, not a name-only match. | Official current fields and field-specific readback belong to LMS. `POST p_process=Main` is a read; some GET operations mutate. |
| App preparation and grading | Verified app student identity mapped to the LMS student; assigned course/lesson and homework range; submission/media ID, grading attempt and correction status with pagination and source timestamp. | These joins are **unverified**. Do not infer an upload, grade, video watch or correction from a reachable teacher-site page. |
| SPT classroom event/audio | SPT owner + `student_id` + `class_date`; original event/request ID, capture/session ID, audio `importId`, chunk sequence/hash and exact server receipt. | The viewed student is separate from the recording student. D1/R2 records are classroom evidence, not official LMS fields. Mapping SPT students to LMS `stu_pri_no` requires a verified, protected lookup. |
| Main Sheet review | Lesson date then stable student mapping and source timestamps; draft/review/correction revision and exact source references. | PC owns 14:00 preparation and reviewed closeout. The academy-owned workbook and owner-owned synthetic prototype are different targets. Original media stays linked, not embedded. |
| Parent delivery | Exact report target and sender message/recipient receipt key, once independently sourced. | Teacher performs the final send. Preview, send-labelled icon and send screen do not establish delivery or the actual delivered body. |

The existing [course/delivery map](../research/backend-map/course-delivery.md)
and [lifecycle map](../research/backend-map/lifecycle-entities.md) supply the
bounded source contracts. Open the exact operation in the operation registry
before any new backend read; the map is dated evidence, not live state.

## 3. Mobile release choice

| Route | Fit for the current iPhone | Added cost and maintenance | Release gate |
| --- | --- | --- | --- |
| **iPhone Home Screen web app (selected first)** | Runs on the existing iPhone without an Apple membership. Reuse the browser device-approval path and a reviewed private HTTPS tailnet gateway. | No new app-store subscription. Existing hosting, D1/R2, tailnet, data transfer and support cost must be measured; free or included capacity is not assumed. Maintain an offline shell, outbox and explicit recovery UI. | Actual iPhone 14 Pro Max Safari/Home Screen, Tailscale identity, TLS/private route, gateway lifecycle, six-student usability, offline/relaunch and exact D1/R2 receipts. The present loopback process is not this route. |
| Android app using the owner's existing account | Requires a classroom Android device, which is not yet confirmed. Could use a web app or a packaged client after the same backend and offline gates. | Account entitlement, device, build/signing and store policy are unverified; do not assume zero marginal cost. | Physical Android device, account access, signed build/distribution and same classroom acceptance. |
| TestFlight via individual Apple Developer membership (withdrawn) | Technically fits iPhone but conflicts with the owner's no-paid-membership decision. | Apple currently lists USD 99 per membership year; private GitHub macOS runner use may consume included minutes or be billed (published standard rate USD 0.062/min beyond quota). | Only if the owner reopens this route: active membership, App Store Connect app/team, bundle ID, macOS/Xcode signed build, processed TestFlight build, tester group/invitation, and physical-device result. External testing may require review; builds expire after up to 90 days. None is currently established. |

WebKit documents iPhone Home Screen web apps and service-worker offline support,
but also storage eviction under pressure or inactivity. Therefore IndexedDB is
an outbox, not the only durable original for audio. On the physical phone,
measure persistent-storage status, quota/eviction, app relaunch, interrupted
upload and how Voice Memos originals enter the browser flow; retain the source
recording until exact R2 readback. The drafted native bearer pairing remains a
verified local candidate for a later packaged client, not a prerequisite for
the selected first web pilot. Its browser cookie path must keep passing tests.

External sources checked 2026-09-27:
[WebKit Home Screen web apps](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/),
[WebKit storage policy](https://webkit.org/blog/14403/updates-to-storage-policy/),
[Apple enrollment](https://developer.apple.com/programs/enroll/),
[TestFlight overview](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/),
[GitHub Actions billing](https://docs.github.com/en/actions/concepts/billing-and-usage), and
[runner prices](https://docs.github.com/en/enterprise-cloud@latest/billing/reference/actions-runner-pricing).

## 4. Offline, failure recovery, retention and cost

| Failure or cost | Required behavior and evidence |
| --- | --- |
| Tailnet/API loss during class | Keep the event/request ID and subject in the device outbox; show pending state. On reconnect verify the owner and exact server record before replay. A 409 or missing/late acknowledgment is not success or permission to mint a new event ID. |
| Audio interruption or storage pressure | Preserve the Voice Memos or device original, import ID and local capture sequence. Compare server chunk hash/size and final stored receipt before treating R2 as retained. No silent loss, automatic replacement or auto-delete. |
| Revocation or uncertain write | New requests stop. An in-flight Worker write may commit before a gateway 403; reauthenticate and read back the exact original request ID before retry. |
| Stale/partial LMS or app data | Mark the student's checklist `unknown` with source and timestamp. Do not convert missing evidence into "not done" or "complete". Do not save any of the eight DayRecord fields until teacher review, exact target/wire contract and same-target readback are implemented. |
| Shared Sheet exposure | The owner accepted student-level text in shared Main Sheet cells after link-wide visibility was explained. Keep credentials and raw original media out; hidden tabs and collapsed rows are not confidentiality controls. Preserve append-only notes, drafts, reviews and corrections as previously selected. |
| Growing storage and provider spend | D1/R2 audio volume, transfer, hosting, provider transcription and retention periods need measured usage and a source-owner policy before broad capture. Do not infer a zero bill from included quotas. Current SPT synthetic tests do not invoke paid transcription. |

## 5. First acceptance scenario and stop rules

**Scenario WL-A1: one date, all students, then one selected student, ending
before the human send.** Use invented records for rehearsal; use the
2026-09-21 historical lesson only through a separately authorized bounded
live read. It had three DayRecord rows in the dated evidence and is not a
complete current roster. No raw student text, session value or media URL goes
into a test artifact.

1. At 14:00 the teacher selects the date. The PC shows every verified student
   occurrence for that date, group and source freshness, with a per-student
   preparation checklist. Unknown joins remain unknown. The teacher confirms
   that no date-scoped student is hidden by group or pagination.
2. For **each** student, compare the assigned homework range with actual
   pre-study video submission, problem attempts and app-backend grading, then
   wrong-problem video/correction status. The teacher visually checks the
   wrong-problem result and records review or correction separately. A missing
   app contract blocks this step rather than yielding a false pass.
3. Select one student and confirm the same lesson, student and course keys on
   the detail view. Show official LMS facts, SPT facts and teacher draft in
   distinct sections with original media links and source timestamps. No
   SPT-to-LMS mapping is inferred from a name.
4. In a separate six-student synthetic classroom rehearsal, interrupt network
   and audio, relaunch the iPhone web app, resolve a 409/lost acknowledgment
   using the original IDs, and verify exact D1/R2 readbacks. The physical
   iPhone gate is required before calling this classroom-ready.
5. Review proposed DayRecord fields and parent wording. Any LMS save waits for
   the eight exact wire/readback gates. The teacher opens the final send
   context and performs Kakao delivery personally; this scenario stops before
   sending. Receipt and delivered-body status stay unknown until joined to an
   authoritative sender record.

**Acceptance is pending teacher review.** The owner supplied checklist
content but has not reviewed a real PC screen or physical phone run. No
numeric response-time threshold was requested. A synthetic pass, current core
gate, page shell, sent icon or prior Linux build is not acceptance.

## 6. Execution DAG v1 (workspace planning aid)

No callable native Task API with dependencies was exposed in this session.
Each node below names its prerequisite and completion evidence. The Lead owns
integration and acceptance; this table is not runtime task authority.

| ID / order | Work | Depends on | Completion gate / current state |
| --- | --- | --- | --- |
| WL-01 / complete locally | Preserve current Main Sheet/SPT source, run core and exact isolated SPT Linux gate, verify map and cleanup citations. | — | Tested SPT source: 273-file archive/hash parity; install/build/lint/typecheck/full test passed. The current SPT worktree differs from that tested source only in `AGENTS.md` release steering. The 12-file map, historical 11-file transition manifest and Desktop core gate passed with a separate 273-file current candidate pin. Cleanup is documented. |
| WL-02 / P0 | Implement and review the 14:00 all-student checklist and selected-student judgment. | WL-01 | Invented six/12-student tests plus teacher PC review; date/group/pagination and unknown states visible. App submission/grading fields cannot be called complete until WL-03. |
| WL-03 / P0 | Bind exact LMS occurrence/course and app submission/grade/correction read contracts. | WL-01 | Source-reviewed registry operations; bounded authenticated reads with transient session, verified IDs, pages and timestamps; no raw-output artifact. No route rediscovery. |
| WL-04 / P1 | Prove iPhone web app private route, browser approval and offline event/audio recovery. | WL-01 | Reviewed tailnet-only HTTPS target/service, physical iPhone 14 Pro Max, six-student interruption/relaunch, original media and D1/R2 exact readback. No external change before exact target/effect review. |
| WL-05 / P2 | Stage reversible Main Sheet review and eight-field LMS closeout. | WL-02, WL-03 | Teacher-approved values, current academy-owned workbook metadata/protection, exact target/wire contract and per-field same-target readback. No save authorized merely by this plan. |
| WL-06 / P3 | Verify report preview versus independent delivery record and human handoff. | WL-05 | Exact report/message/recipient key and sender receipt semantics; teacher sends. Unknown until verified. |
| WL-07 / conditional | Reconsider Android packaging if the owner has an Android classroom device and web constraints fail a measured requirement. | WL-04 | Account/device/build cost and physical Android acceptance. TestFlight remains withdrawn under the no-paid-membership decision. |

The canonical continuation and exact gate evidence live in
[the Desktop handoff](../handoffs/2026-09-27-desktop-resume.md). Technical
native pairing and audio details remain in the separate SPT worktree's
`docs/native-pairing-contract.md`.
