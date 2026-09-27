# Remote structural inventory — 2026-09-27

## Verified source boundary

- SSH target: `srv1873899`, with strict host-key checking and the existing Tailscale SSH proxy.
- Remote deployment root: `/docker/hermes-agent-2q3y`. The running `hermes-agent-2q3y-hermes-agent-1` container binds `/docker/hermes-agent-2q3y/data` to `/opt/data`.
- The relevant source tree is `/docker/hermes-agent-2q3y/data/gang-a`. This is source and historical documentation, not the live academy database. Git HEAD was `e91b4d7d9f48013469cf823bec5693e5276c01e5` with a clean working tree at inventory time. No LMS request was made, and no remote file was changed.
- Twelve allowlisted structural files (100,205 bytes total) were copied under `gang-a/`. `manifest.json` records each remote path, remote byte size, both SHA-256 values, rationale, and exclusions. Every copied file matched its remote hash and byte size.

## Instructor-work coverage in these sources

| Area | Documented surfaces | Evidence |
| --- | --- | --- |
| Before class | Schedule, groups and assigned students, prior DayRecord, attendance and makeup context, curriculum/material preparation | `docs/LMS_SITEMAP.md`, `docs/강사_실무운영_핸드북.md` |
| During class | Pre-study and video submission, DT/ZT, concept and textbook progress, student work and feedback | Same documents; `core/student_db.py`, `core/curriculum_db.py` |
| After class | DayRecord progress, homework, memo, DT score, homework rate, attendance; counseling and parent delivery context | `core/day_record_sync.py`, `core/llm_report_generator.py` |
| Periodic work | Assessment results, test paper pool, workbook, monthly analysis and counseling | `docs/LMS_SITEMAP.md`, `docs/강사_실무운영_핸드북.md` |

The site map groups LMS functions into course management, study management, and test creation. It is dated 2026-08-19 and requires live verification before implementation. Its `GET/POST` method column is not a reliable read-only classifier.

## DayRecord write boundary found in legacy code

`core/day_record_sync.py` maps six fields: `prg_txt`, `hw_txt`, `memo_txt`, `daily_test_radio`, `homework_rate_no`, and `attn_yn`. It sends `udtPrg`, `udtHw`, `udtMemo`, and `udtAttn` as **GET requests that change state** (lines 105–118, 120–133, 135–148, 176–189); DT and homework-rate updates use POST (lines 150–174). The function returns `OK` for HTTP 200 without exact-target field readback. The copied adversarial test checks encoding, score bounds, and length limits; it does not verify authorization, persisted values, or parent delivery. None of this code was executed.

`core/llm_report_generator.py` maps draft fields to the same DayRecord payload, but its default values can produce a perfect score or attendance `Y` when underlying work logs are empty. Treat the code as a legacy proposal, not as validated LMS behavior.

## Storage implication for Main Sheet

The source tree models student problem submissions, feedback, drawing strokes, and curriculum/lecture items as separate local SQLite entities. The LMS site map adds schedule, group membership, attendance, pre-study, assessments, counseling, and DayRecord/communication. A date-by-student screen can join summaries of these sources, but a single folded row or column area has no demonstrated ability to serve as a complete backend model. This is a structural inference from source code and historical docs; no live backend schema was inspected.

## Deliberate exclusions and limits

- `gang-a/data/**`, `/docker/hermes-agent-2q3y/data/강의하는_아이들/**`, generated HTML, reports, snapshots, and exports: may contain actual student-level records.
- `gang-a/config/**`, session files, credential stores, runtime state, and unrelated Hermes workspaces: outside this source transfer.
- Training transcripts and quizzes: omitted because the copied site map and handbook are sufficient for a first structural inventory. Their titles were observed, but content coverage was not audited.
- Live LMS tables, actual student records, parent-delivery history, and Park Gyeongchan's precise assignment set remain unverified. These sources do not prove current production capability.
## Bounded completeness pass

An additional path-and-size inventory of the `gang-a` tree, excluding `.git`, `data`, and `config`, found 128 files:

| Category | Files | Bytes | Disposition |
| --- | ---: | ---: | --- |
| Root | 12 | 9,820,408 | `README.md` and `main.py` copied; 8 generated/embedded HTML files and minor launch/configuration files excluded |
| `core/` | 36 | 637,713 | Five schema/workflow sources copied; other curriculum/PDF/UI builders excluded |
| `docs/` | 49 | 909,205 | All 4 top-level structural Markdown files copied; 22 training transcripts (758,501 bytes) and 23 quizzes (102,698 bytes) excluded |
| `scripts/` | 28 | 31,819 | Ad hoc LMS/CDN probing and asset scripts excluded |
| `tests/` | 3 | 35,650 | DayRecord payload test copied; two math/PDF tests excluded |

`main.py` adds a legacy CLI map for class, study, test, and training-reference lookup. It contains an interactive session-update function and was copied only as source; it was never executed. `core/lecture_cache.py` adds lecture metadata/cache boundaries and was also not executed.

`core/engine.py` contains a hardcoded session cookie and was **not copied**. A safe function-name-only review showed methods for schedule, student list, DayRecord, attendance, DT/ZT lists and results, progress, pre-study, test pool, formative assessment, and workbook. This is a historical endpoint map, not live service verification. The cookie value was not added to the package or this report.

The remaining `core/` sources largely build curriculum/PDF pipelines or generate dashboards that can embed student records at runtime. Their original files were not copied. Training transcripts and quizzes describe teaching practices but add no further backend schema in this bounded inventory. A targeted scan of the twelve copied files found no hardcoded credential assignment matching the checked patterns; that check is not a comprehensive secret audit.

## Named site-and-app source follow-up

The `/opt/data` to `/docker/hermes-agent-2q3y/data` bind was reverified before examining two named files. The complete [shared Wiki source map](shared-llm-wiki/concepts/academy-source-system-structure-map.md) was copied after a bounded review; it expressly excludes login, cookie, raw student and school values, authenticated HTML, roster, and observations. Its own `as_of` date is 2026-08-26. The [SPT structural extraction](summaries/workspaces/spt/classroom-product-direction-structural.md) replaces the original direction file because that original contains a real-use observation section; its original remote path, size, and hash are recorded in `manifest.json` as excluded source.

The dated Wiki map separates source lanes for student profile/counseling, dated class occurrence and membership, per-student course plan/progression, pre-study/video analysis, material editions, assessments/clinics, DayRecord, and parent delivery. Joins need source student keys plus local opaque identity, occurrence identity distinct from recurring group, `course_key`/`user_course_key` for longitudinal plans, and separate material, paper, and lecture locators. `lecture_key`, page, and QR are candidates, not proven canonical item identity. School/grade authority is fragmented across profile and dated report history; conflicts must not be silently resolved.

A student app backend remains a documented gap: tutor-web `LecturePlay` and `CreateWorkBook` are native-command bridges, not evidence of direct student-app backend access or a complete app textbook/item corpus. Pre-study comment plus student/parent push is a compound external effect, not a read. The local SPT phone source cache and Calendar Command are separate projections; the dated map labels iPhone override, XLSX assertion ledgers, and Drive revision integration as incomplete. These states must be refreshed before implementation.

The source map distinguishes academy DayRecord save, student-report save, Alimtalk sender/list, recipient resolution, delivery acknowledgement, retry and cancellation. It documents a narrow historical core-five Action contract but no general write permission or delivery automation. Legacy GET routes can mutate, while some exact POSTs are read-only; classify route plus operation and effect, then verify exact persisted fields. The previous signed-off progress/homework readback is evidence for that dated row and two fields only.