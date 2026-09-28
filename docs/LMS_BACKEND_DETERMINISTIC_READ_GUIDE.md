# LMS assessment read contract status — 2026-09-28

Status: source-level contract model only. No student-level app grading or exam result read is verified by this repository. This document supersedes the earlier guide at this path, which mixed illustrative student values with claimed live evidence. Its prior bytes remain recoverable in Git history; do not use them as current production facts.

## Admitted read

The canonical backend map admits one exact reusable date/group DayRecord operation: POST /servlet/controller.cct.tutor.DayRecordServlet with p_process=Main, std_ymd=YYYYMMDD, and a reviewed grp_seq. It is semantically read-only for that operation. Current teacher identity, all relevant groups/pages, row keys, and coverage still need fresh proof before a student-level conclusion.

The TypeScript LMS_VERIFIED_READ_ENDPOINTS constant contains only this operation. Its path is not an exam-score API.

## Assessment result boundary

A fixed GET UserByMain assessment page shell was observed with an authenticated ephemeral site session. Its current search form submits POST UserBySearchTestResult. That exact search operation is not in the reviewed read-effect registry; the server implementation is not present in this checkout. A page shell, route name, and HTTP 200 cannot establish a student attempt or prove the POST has no side effect. Do not invoke it as a read until its exact server effect and request/response contract are verified.

The site session authenticates servlet requests. It is not a database connection or permission to query the academy's SQL backend directly. Do not extract or persist a JSESSIONID.

## Key spine

Keep these keys distinct until equality and cardinality are demonstrated by an exact source read:

1. stu_pri_no: academy student identity.
2. course_seq and cm_seq: course and enrollment/lesson context.
3. p_no/pNo: exam paper identity.
4. testing_no: student attempt identity.
5. lecture_key: item/explanation identity.

A name, book title, paper catalog, local SQLite row, or model-generated fixture cannot substitute for this chain. Preserve source timestamps and separate submitted, auto-graded, corrected, and teacher-reviewed states.

## Current TypeScript/Bun code

- src/lms/lmsBackendContracts.ts defines candidate data shapes and the single admitted DayRecord read operation.
- src/lms/lmsDeterministicReadRepository.ts is a local synthetic evidence cache. It performs no HTTP or database read, starts empty, rejects claimed live/verified paper registration, and cannot turn caller-supplied answers into a verified grade.
- src/assessment/testPaperAdapter.ts requires a consistent verified paper/attempt relation and an exact attempt key before preparing a ledger input. It does not authenticate source objects.
- src/assessment/studentAssessmentLedger.ts defaults missing proof to unknown and keeps teacher correction review separate. No Main Sheet cell is written by these modules.
- tests/lms/deterministicReadRepository.test.ts uses invented records only.

The imported Antigravity conversation included a score table without an intervening backend read, followed by a user correction of a paper identifier. That table is unverified. Never backfill those values from the earlier guide or test fixtures.

## Required acceptance before live integration

Source-review the exact assessment search effect and payload, prove task-scoped student and attempt rows with pagination and source time, bind pNo/testing_no to the same student/course/lesson, and perform a same-target readback. Only then may a live read adapter produce verification evidence. A teacher visual check and any production LMS or academy-owned Main Sheet write remain separate gated actions.