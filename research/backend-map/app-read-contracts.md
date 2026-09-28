# Student-level app and preclass READ contracts — 2026-09-21

Reviewed 2026-09-27, 16:22 KST. Scope: Park Gyeongchan's 2026-09-21 lesson, explanation-video readiness, and Gauss required-example/type-practice submission and automatic grading. This is a source and prior-live-evidence review. **No new academy request was sent in this pass.** No credential store, student record body, answer, media URL, or native-app data was opened or retained. The available computer-use inventory had no browser or authenticated tab; the local credential file was not inspected.

## Result

**No stable 2026-09-21 student-level READ join or submitted/auto-graded status schema was verified.** The current teacher site has reachable preparation page shells and candidate search fields, and historical source evidence describes a pre-study detail and a video/AI summary. None binds one Park DayRecord student and lesson to an exact pre-study/video submission. No reviewed academy operation binds that lesson's assigned Gauss required-example/type-practice items to an app submission, automatic-grade result, or correction/retry status. The two date-valid Gauss course rows in `assignment-live.md:10-16` are longitudinal course associations, not those preclass events.

| Needed fact | Best available evidence | Evidence grade and limit |
| --- | --- | --- |
| Park lesson identity | `assignment-live.md:18-22` records the exact read-only DayRecord and `StudyCourse` search operations and source student-key matching; two of three DayRecord students had a date-valid Gauss course. | Prior `live-value` for those course joins only. Third student's lesson-specific course is unknown. No pre-study or app ID was joined. |
| Explanation-video list | `app-live.md:10-12,49-51,59-69`: fixed `GET` shells for `WebUnPreStudy`, `WebCtPreStudy`, and `TeacherPrestudySummary` returned without a session-error marker. Current waiting/completed forms have `g_clg_no`, `g_mem_type`, `g_pri_no`, `reqCmd`, `student_name`; the summary form has `start_date`, `end_date`, `view_type`. Static labels include `영상`, `AI`, `점수`, and `평점`. | `live-structure` for the shells and form names, not selected-student rows. The labels do not define upload, analysis, rating, or auto-grade state transitions. |
| Video detail | Dated sanitized source map `../remote-2026-09-27/shared-llm-wiki/concepts/academy-source-system-structure-map.md:138-142` describes `WebPreStudy&prestudy_key=...` detail with pre-study, student, instructor, course, small-unit, version, status, score, video path/date, and teacher comment fields. | Historical source description (2026-08-26); exact deployed field names, status values, date binding, identity equality, and current read effect were not verified here. No detail key was acquired for the selected lesson. |
| Gauss app submission and grading | `preclass-evidence.md:20-28,43-50` defines the owner's required distinctions. `app-static.md:23-26` maps paper/item/Smartbook candidates. The local teacher-tool `student_submissions` model is not an academy API. | No academy submission/auto-grade read contract or enum. `lecture_key`, `testing_no`, `p_no`, `book_code`, local `student_id`, and DayRecord `stu_pri_no` remain distinct candidates until exact equality/cardinality is measured. |

## Operation-level safety review

The target project's `GEMINI.md:16-21,29-31` permits only state-neutral GET/HEAD and local analysis in this scope, and forbids unreviewed bulk or guessed probes. The automation repository's `AGENTS.md:56-76` requires its guarded `LmsSession` for any LMS call and treats HTTP 200 as insufficient. The site can also mutate through GET (`backend-map/README.md`, “Hard boundaries”); classification below is therefore by exact operation, not method.

| Exact operation | Current evidence | Decision for this pass |
| --- | --- | --- |
| Fixed `GET` `WebUnPreStudy`, `WebCtPreStudy`, `TeacherPrestudySummary` | Already observed as authenticated teacher page shells in `app-live.md:9-12,49-51`. | Classified shell reads; no new call needed. They do not yield a selected 2026-09-21 video status from the retained structural evidence. |
| Form `POST` `WebUnPreStudy` / `WebCtPreStudy` search | Current inline JS sets the respective `reqCmd` and submits fields listed above (`app-live.md:49-51,69`). The historical read-only `StudentNameSearch` is a **different** command (`app-static.md:63-76`). | Not called. Current server effect, teacher scoping, name uniqueness, pagination, and lesson/date binding remain unverified. The current read-only rules do not authorize treating this POST as a safe search by analogy. |
| `WebPreStudy&prestudy_key=...` detail | Historical detail description at sanitized source map `:140`; current `WebUnPreStudy` inline JS navigates to it (`app-live.md:37`). | Not called: no exact selected-lesson `prestudy_key`, current effect, or Park ownership proof. `WebSetPreStudyComment`, rating, `send_message`, and native push are separate effects (`:142`) and were excluded. |
| `POST` `getVideoLecture` on `RegAppCommandServlet` | Automation `ganga/lectures.py:212-237` parses `result`, `lecture_type`, and `lecture_url`; target `src/client.py:155-178` instead constructs a GET URL and inferred resource URLs. `app-static.md:24,46-48` flags the disagreement. | Not called. It is lecture metadata lookup, not a student video-upload or watch-history query. Its live effect and entitlement are unverified; the target's constructed URL is not playback proof. |
| `GET` `GetLectureList` / `UserByMain` / `GetExamDetail`, and Smartbook results | `src/client.py:124-216` and `app-static.md:23-26` declare item, paper, and attempt candidates. `app-live.md:21` confirms only a Smartbook result shell. | Not called. A verified selected student's paper/attempt/item key and exact source relation are absent. These routes cannot establish the Gauss preclass assignment or auto-grade state from their existence alone. |

## Exact barrier and next verification

1. Obtain an authenticated, authorized *read* channel without exposing or copying the session. In this pass the computer-use inventory exposed no browser/tab. Do not read a credential store or print session material to overcome that barrier.
2. Source-review the **current** `WebUnPreStudy`/`WebCtPreStudy` server effect or identify an exact current GET detail/list read. Then use an exact Park-owned source student/lesson/pre-study key; a name-only search or teacher field supplied by the client does not prove server-enforced scope. Capture only field names, status values, timestamps, pagination, and key equality/cardinality in memory. Do not persist student values or media.
3. Separately locate the lesson-specific Gauss assignment and the academy app's submission and automatic-grade read operations. Require source identifiers for course/edition/volume/unit/problem range, a submission or attempt ID, grading status and time, and a demonstrated join to the DayRecord student and 2026-09-21 occurrence. A course label, video score, paper catalog, or local SQLite row cannot substitute for this chain.

Until these checks pass, the Main Sheet should show `unknown` independently for required assignment, video uploaded/analyzed, Gauss submitted/auto-graded, correction, and teacher review (`preclass-evidence.md:18-28`; `app-live.md:71`).

## Whole-Lens source and DB re-review — 2026-09-27

Three bounded, independent source reviews revisited pre-study, app grading and
correction, and the available database schemas. Those reviews made no live
academy request, DB connection, credential read, or student-value read. The companion
automation checkout was observed at HEAD `e3d138bd9190f7fc5de3288b8bd790edaf207b00`;
its existing dirty files were left intact.

- The current waiting/completed pre-study forms submit `POST` with their own
  `WebUnPreStudy`/`WebCtPreStudy` operations and
  `g_clg_no,g_mem_type,g_pri_no,student_name`. Their effects and selected
  student/date/lesson scope remain unknown (`app-live.md:49-51,69`). The
  historical `StudentNameSearch` read cannot be substituted. The
  `TeacherPrestudySummary` shell has date fields but no classified submitted
  search or selected-student result schema (`app-live.md:12`).
- The historical sanitized source map describes a `WebPreStudy` detail keyed
  by `prestudy_key` with student, instructor, course, small-unit, version,
  status, score, video path/date, and comment concepts. The exact deployed
  field names, HTTP method/effect, ownership, pagination and relation to one
  DayRecord occurrence were not reverified. Registry entry
  `prestudy_historical_detail` records this **unsafe-to-probe candidate**
  without promoting it to a current read (`../remote-2026-09-27/shared-llm-wiki/concepts/academy-source-system-structure-map.md:140`).
- The copied Gang-A `core/curriculum_db.py:13-19,25-89` and
  `core/student_db.py:4,14-62` declare local SQLite paths and submission,
  answer, lecture, profile, and problem-log tables for the teacher tool.
  They are **not** the academy's production app/LMS database. The copied
  inventory explicitly says no live backend schema was inspected
  (`../remote-2026-09-27/inventory.md:7,29,36`). The shared-DB claim in
  `../../docs/system_architecture.md:4-22` remains an architectural claim,
  not introspection or an app protocol trace (`app-static.md:9-10`).

The current source set exposes no approved direct production-DB schema/read
interface. Further DB-level verification needs an owner-provided read-only
schema/interface or a source-reviewed current read contract. Do not inspect
local `data/`, copy authentication, infer app rows from local SQLite, or invoke
the current unknown-effect POSTs. The 14:00 checklist remains `unknown` for
all selected-student video, attempt, grade, and correction facts.

The Lead also restored the bundled Codex **in-app Browser** connection. It had
no open tab at the start of this pass. A fixed `GET WebUnPreStudy` navigation
rendered an empty body; the site home redirected to `/c_login.jsp` with login
inputs. This is an unauthenticated UI-state check only, not a selected-student
read or a new classification of the search/detail operations. The login tab was
shown for the owner to authenticate manually. No session value was inspected.

After the owner manually signed in, the same fixed `GET WebUnPreStudy` page
rendered two forms and one table, with no password input. The bounded form-name
read confirmed `reqCmd`, `g_clg_no`, `g_mem_type`, `g_pri_no`, and
`student_name` among the fields already recorded in `app-live.md`. In-app
Browser CDP observed the fixed document response as HTTP 200 and no XHR on
that page reload; only host, path, status, and resource-type counts were
emitted. This refreshes the **page-shell** evidence, not the current POST
search effect, selected-student rows, upload status, app grading, or database
schema. No search form was submitted and no raw response or session value was
retained.
