# Textbook page audit: first classroom pilot

Prepared 2026-09-29 for the teacher's requested 2026-09-30 이루한 pilot. Expansion to the other students is planned for Friday, 2026-10-02, after the first student's page history has been checked in actual class use. No real page status or academy write is asserted here.

## Current catalog and source status

- `data/curriculum_catalog/textbook_curriculum_toc.json` v1.0 contains four **partial** textbook entries, with chapter and some subsection page ranges. It is not a page-by-page completion ledger.
- The canonical roster currently names 이루한's primary textbook as middle-school Gauss volume 3 and secondary textbook as middle-school Davinci volume 1. Neither edition appears in that catalog. The exact physical edition and table of contents need teacher/source confirmation before chapter names can be auto-mapped. Missing TOC does **not** prevent recording a verified book edition and page numbers.
- The LMS DayRecord and course/schedule routes can provide official lesson and homework context only after a fresh, exact student/occurrence read. A homework range is evidence of **assignment**, never evidence that those pages were finished or checked. Current app submission and grading joins remain unknown.
- The academy textbook resource catalog and two exact sample PDF reads are now registered. Both Gauss sample TOCs were visually checked on 2026-09-29 and recorded with PDF hashes in `research/textbooks/book-catalog.json`. Their printed page starts do not establish this student's assigned edition, full page/question map, or homework binding. Keep the original PDF linked and the local TOC explicitly derived.

## Pilot record

The teacher confirmed five visible page states for the 2026-09-30 pilot: **teacher-inspected complete**, **student-reported complete but uninspected**, **unfinished**, **unknown**, and **partial progress**. Partial progress retains the exact known problem subset and does not count as whole-page completion. Teacher-inspected complete requires the teacher to check the wrong-answer correction; do not auto-promote an app grade or student report to that state.

For each book and page interval, append one event with: event ID, exact lesson occurrence/student, verified book edition, first and last page, optional exact problem subset, event kind, occurred and received time, teacher or official source, source row/reference, and an optional superseded event/reason. The visible page view has separate `배정`, `학생 완료 보고`, `강사 검사`, `미완료/남은 문제`, and `근거·시각` states. A teacher correction appends a new event and preserves the earlier value.

`workbench_v2/page_progress.py` implements the local synthetic projection. It retains every requested page as `unknown` until a source event exists; teacher verification of only some problems on a page does not mark the entire page complete. `V3_BOOK_EDITION` and `V3_PAGE_EVENT` are hidden **schema-only** tabs in the owner-owned sample workbook. The first visible `시안 A · 청록 강조` tab has an invented-data page audit section for review.

## 2026-09-30 read and class cycle

1. Resolve the student's current group, course and book candidates through `harness roster`. Use `harness routes` for the named `course_schedule` and `day_record_read` operations. Verify their current request/response contract, authentication, exact occurrence keys and page coverage before any scoped academy read. Do not infer the previous lesson from a calendar date alone.
2. Read only the relevant current and prior lesson/DayRecord rows and capture source operation, read time, exact occurrence and book binding. If a homework text cannot be split reliably by edition and page range, show it for teacher resolution and keep page assignment unknown.
3. At class start, the teacher identifies the actual book edition and reports the pages done, not done, or partly done; include problem numbers where a page is partial. Enter each observation through the fixed `기록` action or the same chat event path. Record inspection separately from student self-report.
4. During class, show the page gaps beside the existing per-book inspection queue, current task, elapsed time, and next buffer task. A correction must show old value, new value, author, time, and reason.
5. Before the next homework is finalized, compare all verified assigned books with their page/inspection state and ask about any unresolved book. Keep the official LMS DayRecord proposal separate until the teacher reviews it.

The declared optional reader packages are installed in this checkout's local `.venv`. On 2026-09-29, a bounded authenticated read of the 2026-09-30 pilot student's DayRecord observed one row on the response page after the response's date, selected group, teacher identity, student and course keys were checked. Attendance, progress and homework fields were empty at that read time. The row-to-occurrence relation is still unverified; the gateway labels this `observed_row`, not a verified lesson fact. The teacher corrected an initial 2026-09-21 prior-lesson hint to 2026-09-23 after checking the `수금2부` class. Bounded 2026-09-23 DayRecord observation shows attendance `Y` plus progress and homework text; the 2026-09-25 row has those fields empty. The `check-prior` gateway independently flags the 2026-09-21 hint as conflicting with later 2026-09-23 attendance, while leaving 2026-09-25 unknown. The 2026-09-23 homework yields page candidate 119–134 on a line mentioning the primary series; book edition and assignment binding still need verification before the page ledger marks it assigned. The imported parser echoes request date/group, so the gateway separately checks the response. The existing aggregate probe still points at the first PC's companion source lock and fails closed here.

## Friday expansion gate

Apply the same page model to the other students only after the teacher confirms that the first pilot distinguished assignment, partial work, student report and teacher verification correctly; both Ruhan textbook editions are identified; corrections and unknown pages remain visible; and the source/read path did not confuse a different student or lesson. Add missing TOC entries from an actual edition source rather than extrapolating from another volume.
