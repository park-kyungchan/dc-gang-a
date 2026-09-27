# Main Sheet student workspace — interview candidate

Version: 2026-09-27. Status: design proposal; a separate [synthetic Google Sheets prototype](../main-sheet-v2/prototype-readback.md) and keyless GCP project/bot now exist. The academy-owned Main tab, LMS, and parent-send state have not been changed by this proposal. Read [backend-map README](README.md) first for evidence levels, current access, and operation boundaries.

## Goal and design decision

The owner wants one Main Sheet tab to support a teacher's whole work cycle and one student's relevant academy site/app picture. Use **one work surface over source-labelled, keyed data**. The visible tab should display student-level detail as the owner requested. Keep normalized events and mapping keys in bounded support tables; a collapsed row or column is a presentation mechanism, not a dependable relational database or access boundary. Use Drive API for large artifacts or a separately owned store only when measured joins, latency, retention, or maintenance justify it.

Do not mirror the entire academy database. Read narrow subject/date slices and keep the academy as the source for current official facts. The Main Sheet owns teacher notes, reviews, drafts, and workflow state only where explicitly chosen. Every displayed imported fact needs `source`, `observed_at`, `subject/occurrence key`, and `verified/unknown/stale` status.

## Proposed Main Sheet layout

| Area | What the teacher sees and does | Source/evidence boundary |
| --- | --- | --- |
| Pinned context bar | Lesson date, optional class/group, selected student, current lesson occurrence, sync time and error state. | On 2026-09-21, the LMS all-groups DayRecord view had three rows and group filters partitioned them 1/2/0/0. Group is a secondary filter, not an assumed required selector. |
| Mode ribbon | `14:00 Prepare`, `15:00 Teach`, and `Close out` change which panel is visually prominent while preserving the same date/student context. | The owner confirmed arrival and class start times for the representative day, but activity order after arrival is dynamic; the ribbon is a navigation aid, not a forced state machine. |
| Whole-class attention rail | Students in today's selected occurrence, their current activity, who needs the teacher now, who is preparing, unresolved checks, and next action. | Teacher-observed activity is distinct from official attendance or completion. Several activities can coexist for one student. Source: [lifecycle map](lifecycle-entities.md). |
| Student header | Academy identity, group/course/book edition, next lesson and due work, last verified progress, preparation state, and exceptions. | Join by academy keys and effective date. Do not infer course assignment from a resource catalog or name match. |
| 14:00 preparation gate | For each selected student, explanation-video upload, assigned Gauss required-example/type-practice work, app submission, automatic grading, teacher follow-up, missing materials, and remaining unknown checks. | The owner confirmed the 14:00→15:00 preclass priority. Submitted is not graded; graded is not teacher-reviewed. Other required items await sample-book/source evidence. |
| Student work cycle | **Prepare → teach/inspect → assess/clinic → close out** sections with expandable event history and source links. | Separate planned, assigned, attempted, student-declared done, teacher-checked, graded, corrected, and mastered states. App-only/watch/handwriting fields remain unknown until a read source is verified. |
| Assessment and materials | DT/ZT, FA/NA/DA, Smartbook, textbook, paper pool, item errors and explanations. Show candidate paper, assigned paper, attempt, result and clinic need separately. | The paper pool is branch-wide; a paper catalog is not a student attempt. Avoid fixed example fallbacks. Sources: [learning/assessment map](learning-assessment.md). |
| Review and parent handoff | Side-by-side teacher/LLM draft, current LMS DayRecord fields, currently rendered Study Report, row sent-labelled UI state, and independent delivery receipt when found. | These are separate effects. Current `DailyReport` did not reproduce all source fields verbatim in one bounded read. The exact immutable sent body and receipt are still unknown. Source: [course/delivery map](course-delivery.md). |
| Action strip | Save a reviewed, explicitly allowed DayRecord field with exact readback; open the official Kakao send screen for the teacher's final click; open LMS paper/counseling screens where write automation is not authorized. | Never equate opening the send screen with sending. Mutating `GET` and read-only `POST` exist, so action policy uses fixed operations, not HTTP verb alone. |

The single tab can use protected display/input ranges, grouped detail sections, and allowed Apps Script dialogs for longer entry. These choices need a viewport prototype before changing the shared workbook. A 72-row, 16-column current Main Sheet has student/date selection and three sync/cache formula dependencies but is not yet a complete student life-cycle view. See [sheet topology](sheet-topology.json).

### PC preparation and phone classroom input

The owner uses a PC for the 14:00 preparation check and a phone during class after 15:00. The PC view can show a dense readiness matrix and full student detail. The phone view should prioritize a short attention queue, large one-tap activity/status capture, and the selected student's next action; it should not require navigating a wide spreadsheet grid while teaching.

Google documents that clicking a Sheet image/drawing assigned to an Apps Script function **does not execute the script on mobile** ([Apps Script menus guide](https://developers.google.com/apps-script/guides/menus)). The owner subsequently selected a large refactor of the existing SPT web app toward an iOS TestFlight app for phone classroom input. Main Sheet remains the PC preparation and reviewed closeout surface. SPT's D1 classroom event ledger and the Sheet's workbench records have distinct authority; the phone app must show exact sync/receipt states and be tested on an actual iPhone.

## Evidence-to-UX proposals

| Observed friction or source gap | Proposed change | Acceptance question |
| --- | --- | --- |
| Progress, preparation, DT/ZT and assessment lists live on separate LMS routes; exact navigation time was not measured. | Keep one student context while changing sections, and link to the authoritative source screen from each card. | Can the teacher decide the next action without losing date/student context? |
| DayRecord is date-scoped and exposes an optional group filter; a student's official fields, report preview and Kakao send state are different screens/effects. | Put the current official values beside draft and preview, with a visible state ladder: `captured → reviewed → saved/readback → report rendered → send UI state → receipt`. | Does each state have a separate timestamp and source, and can the teacher see what is still unknown? |
| The LMS page uses field-level updates, some triggered by leaving an input. The legacy writer used HTTP 200 without persisted-value readback. | A reviewed-save dialog shows exact target student/date/field, before and proposed value, then rereads that field before marking saved. | Can an ambiguous/failed save be retried without overwriting a newer value? |
| The branch-wide paper pool mixes other teachers' artifacts; result views differ from catalogs. | Default to Park-owned and selected-student assigned material. Keep branch resources as a separate search. | Are assigned, attempted, graded and clinic-needed states distinguishable? |
| The DayRecord DailyTest field and measured DT/ZT attempts have different grain in the dated academy/teacher source map. | Show the teacher's diary judgment and each measured attempt separately; do not derive one automatically from the other. | Can a teacher see a disagreement without one value silently overwriting the other? |
| A pre-study comment path can save a comment and then trigger student/parent push actions in the dated source map. | Keep teacher note capture, comment review, comment save, and any app/parent notification as explicit separate actions. | Can the teacher write an internal note without accidentally notifying a family? |
| Source code has separate teacher observations, queue and item attempts; no verified one-screen LMS/app student overview was found in the bounded audit. | Provide an attention rail and student event timeline without collapsing independent facts into one completion badge. | Can the teacher rotate among students and resume an unresolved check? |
| The current Main Sheet includes fixed narrative/fallback text. | Render unknown/stale as such; never substitute a plausible student, score, textbook or status when a read fails. | Does each shown value point to a fresh source or explicitly say unknown? |
| The instructor arrives at 14:00, one hour before the 2026-09-21 class, and must check explanation-video upload plus Gauss problem submission/automatic grading student by student. | Make the preparation gate the first selected-student panel and a whole-class readiness summary; distinguish uploaded, attempted, auto-graded, and teacher-follow-up states. | Can the instructor identify missing/uncertain preparation before 15:00 without opening multiple LMS/app screens? |
| Eleven app-adjacent teacher site views responded live, but their date/student/course/workbook selectors differ and student-level app joins remain unverified. | Normalize one Main Sheet context into source-specific read adapters only after exact search effects and keys are verified; otherwise show an explicit gap and an official-site link. | Can the teacher see what was actually loaded versus only an available screen or catalog? |

## Storage and refresh candidate

| Record class | Candidate location | Refresh/validation approach |
| --- | --- | --- |
| Official current LMS roster, schedule, attendance, course/progress, assessment and DayRecord | LMS remains authoritative; selected summary may be cached in keyed support tables for the Main Sheet. | Read by selected student/date/occurrence, preserve source timestamp and pagination/completeness. Refresh after teacher action or source change. |
| Teacher observation, checklist, and exception events | Versioned workbench table, with owner-approved fields visible in Main Sheet. | Append/correct with author, observed time, reason and revision. Do not overwrite later observations. |
| LLM draft and instructor review | Versioned draft/review table, rendered in Main Sheet. | Store source references and exact reviewed version. Editing a reviewed value clears its prior approval. |
| Reviewed LMS DayRecord save | Official LMS write for the specifically authorized fields only; local audit of before/after and readback. | One gated operation, exact-target reread, explicit failure/unknown state; final parent send remains manual. |
| Kakao send and report | Academy subsystem remains authoritative. Main Sheet shows current preview, sent-labelled UI state, and receipt only if a separate read route is verified. | Do not label the preview as immutable delivered text or the sent image as recipient receipt. |
| PDFs, images, video and large source artifacts | Link to the official or a separately permissioned Drive location when authorized; avoid embedding raw binary in cells. | Check source identity and access before showing or caching links. |

The workbook currently has `anyone: writer` sharing and one verified sheet-wide Main-tab protection. The owner explicitly chose student detail and text records (teacher observations, LLM drafts, parent wording) in shared cells after being told link holders can read them; original media should appear as links. The new bot is listed on the protection and its `requestingUserCanEdit` is true, while an actual cell write is untested. The owner selected indefinite retention for teacher notes, drafts, reviews, and corrections; versioning and backup remain to be implemented.

## Owner-selected first acceptance slice

Use the owner-selected 2026-09-21 lesson occurrence to walk through: 14:00 date/student selection and pre-study verification → 15:00 dynamic whole-class attention/teacher checks → show official current fields and teacher observations with provenance → prepare and review a draft → save the owner-authorized DayRecord fields after explicit teacher review → reread each exact field → open the official Kakao send screen for the teacher. The owner authorized all eight identified DayRecord fields; current wire behavior and readback still need validation before any live write. The slice ends immediately before the teacher's final send. The design review itself does **not** require a live write or message send. Assessment and app cards can initially show source-linked unknowns until their student-level joins are verified; they remain in the complete information architecture.

Acceptance must check the whole-class attention view, one student's cross-domain view, independent effects and status labels, source freshness, failure handling, and both desktop/mobile usability. No published change should claim the exact delivered body until a stable source or receipt has been identified.

## Interview decisions still needed

1. How should the owner-selected indefinite text-record retention be backed up and queried after Sheet capacity or latency becomes limiting? Linked original media remains at its source, with its own retention to verify.
2. The owner authorized all eight DayRecord fields; which exact current wire values and readbacks pass the field-by-field preflight before implementation?
3. What teacher decisions must be visible at a glance during a real class rotation, and which should open a dialog or official LMS screen?
4. The selected Google Cloud project and keyless bot are configured with billing disabled. What latency/freshness can the exact LMS/app reads sustain on desktop and phone, and which fields need a manual refresh control?
5. Which app-only screens and student-level state can the teacher actually access? The bounded current audit has not verified complete app coverage.
