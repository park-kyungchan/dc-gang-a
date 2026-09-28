# Whole-Lens 14:00 read-contract decision — 2026-09-27

Scope: WL-03 source review for the PC preparation checklist. This document uses
the existing 12-file backend map and its now 52-entry operation registry. The
source review made no authenticated academy data request and records no student
value or session material. A later fixed-page in-app Browser check reached the
academy login screen only.
The map is dated evidence, not a current student read or an effect grant.

## Exact operations and current use

| Needed evidence | Registry operation and existing contract | Current decision |
| --- | --- | --- |
| Date/group DayRecord rows | `day_record_read`: `POST /servlet/controller.cct.tutor.DayRecordServlet`, `p_process=Main`, `std_ymd=YYYYMMDD`, one `grp_seq` per selected group. The prior bounded 2026-09-21 read found three unique rows across four group choices. The row keys are `course_seq`, `stu_pri_no`, `record_seq`, and `cm_seq`. | Semantically read-only for this exact operation. A fresh authorized read may supply date/group rows only after teacher identity, all group choices, complete page/row coverage, and unique row keys are verified. The historical three rows are not a current roster. Do not issue a live request without an authorized transient session. |
| Selected lesson occurrence | The same DayRecord row plus the exact date, group, teacher, and a separately verified lesson occurrence relation. `workbench_v2/lms_read_adapter.py` requires an `OccurrenceBinding` to the exact `record_seq`. | Binding remains unverified. Date, student name, or a date-valid course alone cannot manufacture an occurrence ID. Keep selected lesson facts unknown until this relation is checked. |
| Course and homework range | `study_course` is a fixed `GET StudyCourse` page shell in the registry. `assignment-live.md` separately records a bounded `POST reqCmd=StudyCourse` search for the historical date and two date-valid course periods. | The dated course periods do not identify the lesson's assigned homework pages/problems. Current selected-student search effect, page coverage, source course key relation to DayRecord `course_seq`, edition, unit, and assigned range need proof before use. The third historical student's date-valid course remains unknown. |
| Matching pre-study video | `prestudy_waiting` and `prestudy_completed` are fixed `GET` teacher-site shells. `prestudy_waiting_search` and `prestudy_completed_search` are `POST` forms whose semantic effect is **unknown**; the historical `StudentNameSearch` is a different operation. `prestudy_historical_detail` is a source-only `WebPreStudy&prestudy_key=...` candidate with unknown effect. | Do not call a search or detail from a guessed name/key. Require source-reviewed current read effect, Park-owned app student ID, exact lesson/range relation, media/submission ID, upload status/time, complete pages, and original media link. Upload, watch, analysis, and teacher check are separate facts. |
| In-range attempts and app-backend grade | `item_metadata` (`GetLectureList`) is source-declared item metadata; `smartbook_result` is a fixed page shell; `smartbook_result_search` and `video_lookup` lack a verified current read effect or student join. The historical `textbook_progress_search` is name-scoped, and `fa_student_results` is a separate FA/NA/DA candidate. | None is a selected-student Gauss app submission or automatic-grade contract. Require exact assigned problem IDs/range, app student-to-LMS student mapping, attempt/submission IDs, server grade status/result/time, retry chronology, and full pagination. `lecture_key`, `testing_no`, `p_no`, `book_code`, and `stu_pri_no` are distinct until verified. |
| Wrong-problem video/correction and final teacher check | No selected-student correction/video path or teacher visual-review read contract is verified in the map. | Keep wrong item, correction, resolution video, and teacher visual check independent and `unknown`. A media label, grade, or absence of a row cannot set `complete`, `missing`, or `not assigned`. Teacher review needs its own dated, attributable action after the original evidence is visible. |

## Admissibility for the PC view

1. Start with the selected lesson date, then read every relevant group and page.
   Compare unique source row keys and counts across the all-group and group
   views. Record the source observation time and coverage proof. A partial
   response can show only observed rows with coverage `unknown`.
2. Select a student by opaque source key and verify the exact teacher, group,
   occurrence, `stu_pri_no`, `course_seq`, `record_seq`, and `cm_seq`. Reject a
   name-only, stale, duplicate, or foreign match. Verify source course-key
   equality and effective period before showing a course assignment.
3. Bind each preparation fact to that same student, occurrence, assigned range,
   app submission/attempt/media ID and source timestamp. Do not promote a
   teacher-site shell or longitudinal course label into an app result.
4. Render each field with its own state and source time. `unknown` and stale
   fields block a complete readiness judgment. A teacher visual check is a
   separate recorded decision; the synthetic preview cannot record one.

The only currently reusable academy **read operation** for an exact date/group
is `day_record_read` under its existing bounded contract. Its selected
occurrence and course joins still need fresh proof. No current app submission,
grading, or correction operation is admitted for live use. No Sheet/LMS save or
parent send is part of WL-03.

Sources: `research/backend-map/README.md`, `route-registry.json` entries named
above, `course-delivery.md`, `assignment-live.md`, `app-read-contracts.md`,
`preclass-evidence.md`, and `workbench_v2/lms_read_adapter.py`.
