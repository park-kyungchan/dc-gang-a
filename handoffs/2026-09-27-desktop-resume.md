# Desktop continuation checkpoint — 2026-09-27

Phase: Windows Desktop harness v3 audit and isolated Main Sheet continuation. The saved local project is Git-backed, and its managed `codex/main-sheet-v2` worktree passed the core gate. One authenticated exact-date DayRecord aggregate read succeeded earlier; no academy write, production Sheet write, Sites, VPS, Apple, or Kakao effect occurred in this continuation.

## Objective and authority

The instructor's PC Main Sheet covers date-first preparation, selected-student review, and closeout through immediately before personal parent sending. SPT iOS is the separate live classroom capture worktree. The LMS owns official DayRecord values, SPT D1/R2 owns classroom events/audio, the Sheet owns teacher review and drafts, and the official sender owns delivery. Preserve unknown app joins and delivery receipts as unknown.

## Current task graph (planning only)

| ID | Task | Depends on | State and evidence |
| --- | --- | --- | --- |
| D0 | Load transition and two project handoffs | — | Done. The transition verifier rechecked 11 pinned files. SPT is still at pinned HEAD `fe3a44e`; the read-only remote academy source check found pinned HEAD `e91b4d7` and an empty status output. |
| D1 | Establish Desktop project and UI tool routing | D0 | The app attached this chat to the correct local project and later reported `isGitRepository=true`. Current-session inventory calls found Computer Use callable (41 apps, four targetable windows) and one in-app Browser provider. UI tools are reserved for UI; backend research uses direct reviewed reads. |
| D2 | Make the local development path safe and portable | D0 | Local Git `main` has curated commits `6ddb138`, `2d51ac7`, and environment fix `7dce930`, with no remote. A managed worktree on `codex/main-sheet-v2` is clean at `e42e258`. The `core` gate passes in primary and worktree; primary `live` passes, while worktree `live` fails only because its optional `.venv` is absent. The map and transition hashes remain pinned. Native top-bar actions are not configured. |
| D3 | Preserve and assess SPT dirty draft | D0 | Existing modified native-pairing files and untracked CI file remain. `git diff --check` passed; `python -B tests/backend-auth.test.py` on the current worktree passed 13/13 synthetic cases. Full Linux gate on this dirty draft remains unverified. |
| D4 | Bind exact 2026-09-21 LMS/course and app read evidence | D1, D2 | Local I/O-free `workbench_v2/lms_read_adapter.py` added with explicit occurrence-row, pagination, and course-key proof gates. `harness/academy_dayrecord_probe.py` pins the companion `ganga` reader and supports env or explicit one-time hidden input. A live direct read reverified teacher scope, five group options, three rows, and complete row keys for the exact date. The canonical map already records the date-valid course findings; current app search effect, exact occurrence/course relation, submission/grading, and receipt remain pending. |
| D5 | Review prototype and prepare reversible Main-tab batch | D4 | The separate synthetic Sheet still has one visible `박경찬` tab and two hidden support tabs; a bounded header read retained its synthetic banner/date. In the isolated worktree, `project_class_overview` now shows date/group preparation rows and gates out-of-context selected detail; 17 invented-data workbench tests passed. Instructor prototype review, live joins, current academy-owned workbook metadata, and any production batch remain pending. |
| D6 | Complete SPT native/static client and iPhone gates | D3 | Pending native audio route, private HTTPS service, exact Linux gate, physical iPhone, signing, and teacher acceptance. |

No callable native task dependency API was exposed in this session; this table is a workspace-local planning aid, not execution or acceptance authority.

## Environment evidence and limits

- Fresh Codex app `list_projects` and `list_threads` reads identified this chat `01a0e216-8990-74e2-9477-9974ed7b39fd` as attached to local project `66702fe6-cdc0-4583-aaf9-4e16cb744ff3`. After local Git initialization, `list_projects` returned `isGitRepository=true`. The prior `projectId=null` and non-Git notes were dated snapshots and are superseded.
- Effective session metadata reported `workspace-write` with this project and the visualization directory writable, plus automatic approval review. The shell confirmed the actual cwd. `/status` itself was not executable through the available tools; no claimed `/status` output exists.
- Windows toolchain observed: Python 3.12.10, Node 24.18.1, npm 12.0.2, Git 2.55.0. The pure projection core needs no package install or virtual environment. Optional live LMS dependencies were installed into this project's ignored `.venv` from `harness/requirements-live.txt`; 22 packages are pinned in `requirements-live.lock.txt`, `pip check` and the companion reader import passed. The environment used about 250.5 MiB on disk. Initial `ensurepip` and pip attempts failed under the sandbox's temp/network limits; narrow approved runs completed without changing user or machine settings, and the checked project temp folder was removed.
- The Browser plugin's `setupBrowserRuntime()` was initialized through its bundled browser client in the Node REPL. It exposed one Codex in-app browser. The user logged in there; fixed `GET WebUnPreStudy` and DayRecord page shells exposed form structure without a login input. This did not verify Park identity or a selected student's app state. No cookie value or media URL was printed or saved.
- SPT worktree branch `codex/spt-ios-refactor` remains at `fe3a44e` with modified `handoffs/2026-09-27-spt-ios.md`, `scripts/spt-backend.py`, and `tests/backend-auth.test.py`, plus untracked `.github/` and `docs/native-pairing-contract.md`. No file was overwritten or committed here.
- Source review of the dirty SPT draft found that `/api/audio-transfer/grant` still requires browser cookie and web Origin; upload/status also reject the Capacitor Origin. The native bearer path therefore does not yet cover the existing Voice Memos transfer flow. Treat this as a native feature contract gap, separate from the previously documented revoke/in-flight-write uncertainty. No change to the SPT draft was made.

## Continuation evidence

- Computer Use initialized `@oai/sky` and later controlled File Explorer for the owner-requested retirement of specific files. The owner clarified that normal file tools should handle workspace edits; subsequent edits used them. Browser read access was verified separately.
- One overly broad Browser snapshot filter emitted a student name in transient tool output while inspecting the pre-study page. No raw response or student record was written to a workspace file. The filter was not reused; subsequent browser outputs were limited to form structure, and backend work moved to the direct-read plan.
- The local adapter uses no LMS/Sheet client, sessions, network, or write path. It rejects unverified occurrence binding, wrong operation/date/student, incomplete page coverage, duplicate selected rows, multiple date-valid courses, and a foreign verified course relation. An unverified course relation or out-of-period course remains absent, so the projection reports `unknown`.
- The owner clarified the tool boundary: use Browser for academy web UI, Computer Use for native PC UI, and normal file tools for workspace files. The earlier attempt to control Notepad was rejected by automatic approval review and made no document change. The normal file tool then updated current workspace instructions and README.
- The owner then corrected the backend route: Browser and Computer Use are for UI tasks only. Resume the VS Code Codex direct-read method for academy backend research. The prior `ganga.lms.reader.read_day_record` uses a bounded `POST DayRecordServlet` read and `LmsSession` validates the authenticated response; its browser-cookie discovery must not be invoked silently. `GANGA_JSESSIONID` was checked for presence only and was unset in this shell. No current direct authenticated request has been made.
- The owner chose to retire the old workflow. Explorer moved `.agents/skills/ganga-read-client/`, `GEMINI.md`, `src/client.py`, `src/harness_check.py`, `src/mcp_server.py`, `tests/test_pipeline.py`, `research/lms_index_probe.py`, and `config/session.json` to the Recycle Bin without opening the session file. Exact-path `Test-Path` readback returned `False` for each. `config/service_account.json` remained present and unopened. Dated research citations to retired code remain historical evidence, not runnable instructions.
- The direct-read companion is the separate local automation repository at `C:/Users/packr/Desktop/강의하는아이들_대치점_자동화`, observed HEAD `e3d138b` with its existing dirty files preserved. `harness/academy_source_lock.json` pins only the `ganga/lms` session, reader, and endpoint source files. The opt-in probe accepts environment-only auth or an explicit hidden one-time prompt; neither stores the value or automatically reads browser cookies. The owner-supplied one-time session enabled the aggregate direct read recorded below, while this process environment still has no `GANGA_JSESSIONID`.
- The current remote academy source was read over existing strict-host-key Tailscale/SSH. The sandbox initially denied the Tailscale pipe; a narrow approved read succeeded. Git reported dubious ownership, so `safe.directory` was set only for each read command, not in global config. HEAD matched `e91b4d7d9f48013469cf823bec5693e5276c01e5` and `git status --short` was empty. Remote SPT source parity was not refreshed.
- One named SPT source file was checked without modifying the remote: remote `/docker/hermes-agent-2q3y/data/workspaces/spt/scripts/spt-backend.py` SHA-256 `E4EADF6F0B1A47F7F76E52AB578366F54BB4018822638CAC410AB0F8511DAFC4` matched the local sanitized snapshot copy. This does not establish parity for the rest of the remote SPT tree, deployed service, or dirty local draft.
- The owner supplied one temporary academy session for process-memory use. The first direct DayRecord probe failed with `ConnectionError` inside the network sandbox. A narrow approved non-sandboxed retry verified the expected teacher identity, the exact 2026-09-21 read-only `POST p_process=Main`, five group options including all groups, three rows, and four required row keys present on each row. No raw student value or response body was saved or printed by that probe.
- A redundant StudyCourse exploration was stopped after the owner pointed back to the canonical backend map. Its fixed GET form recheck found a POST search form with the previously recorded field names. Two selected search attempts were sent under the earlier `assignment-live.md` read contract, but the exploratory parser found zero candidate tables and established no new course relation. The one-off `academy_course_contract.py` file was removed after exact-path review; no result from it is used for a product claim. The canonical map remains pinned and unchanged.
- On the owner's correction, all 12 canonical backend-map documents (the 51-entry registry read in a bounded operational summary) were loaded into this continuation and `python -B research/validate_backend_map.py` still passed with manifest SHA-256 `11EA77F74251746CB7C2049F2B9F1862AF00AD97A8DD31A3AFB38B20D3579E7B`. The map already contains the two date-valid course findings and explicitly marks current pre-study search/app grading joins unknown. No new exploratory query is warranted from a page shell alone.

## Desktop harness v3 worktree checkpoint

- Canonical environment/context entry: `harness/context-map.md` SHA-256 `F7FD30AFB5CE1439BA444D33D50F10E1B89C0E9A415819073FF7EE230A4DB1F4`.
- Read-only local command: `python -B harness/desktop_gate.py`; source SHA-256 `BC7C3B8EBFC76F1DB3899234D589245D21A40B9E73D7CC4B7B2E5485811334ED`. `--profile core` excludes optional live dependencies and passes in the managed worktree (17 workbench and four harness policy tests); `--profile live` also checks the checkout-local 22-package lock and import, passes in the primary checkout, and fails as intended in the worktree without `.venv`. Both profiles exclude app association and authenticated LMS acceptance.
- Opt-in first direct academy read: `harness/academy_dayrecord_probe.py` SHA-256 `21AAE0DF75593DD89FDA69F721AC3B4B6F8C5E31023B16964D096B073D62FC86`, companion source lock SHA-256 `7D0B40782F9EF06DF96AF143639AF2D7A84766CEABECBC46AECFAE86E6F7070E`, dependency lock SHA-256 `E1C8973395D6AF7D8189DB4EBBC88D314017A7E179F0CAEAE4534779E8F5EA74`. The source lock is constrained to the three reviewed companion files. Offline and import-check modes made no network request; a separately authorized one-time prompt supported the aggregate live read.
- Worker status: no delegated worker in this harness phase. Lead verified the exact outputs and retains integration/acceptance responsibility.
- Desktop app check: this chat is attached to the saved local Git project. The app created and attached worktree `C:/Users/packr/.codex/worktrees/main-sheet-v2/강의하는아이들_대치점`; its branch is `codex/main-sheet-v2`, feature commit `e42e258aa49befd69940521708f7e82df89c4b5b`, and it contains no `config/` or `data/`. Native `.codex` top-bar actions/setup scripts are not configured; the core needs no install, so this does not block local tests.

## Next action

The Desktop harness is verified for the primary checkout and one isolated worktree. Continue local Main Sheet implementation on `codex/main-sheet-v2` and use the current synthetic prototype for instructor review before a reversible academy-owned Main-tab batch. Use the 12-file `research/backend-map/` as the canonical source before any new route probe. The earlier temporary authenticated read revalidated only the 2026-09-21 DayRecord aggregate; app submission/grading, exact course/occurrence keys, and an independent parent receipt remain unknown. Keep the eight DayRecord save fields behind teacher review and exact same-target readback; the instructor performs final Kakao send. SPT native/audio and iPhone gates remain in its separate worktree.

## Continuation checkpoint — 2026-09-27 20:04 KST

Phase: local Main Sheet read-model safety implementation on the existing `codex/main-sheet-v2` worktree. This checkpoint updates the D2/D5 local implementation evidence only. No LMS, Google Sheet, SPT, remote, or Kakao write was made. The earlier live academy read remains dated evidence and was not repeated.

| ID | Current result and exact evidence | Remaining gate |
| --- | --- | --- |
| D2 | Primary checkout `main` was at `dba2ebd9f8d2a2f3421c57bc767f231b7f279c1b` with pre-existing untracked `docs/`, `research/lms_day_record_structure_probe.py`, and `src/`. `git worktree list --porcelain` identified the clean starting worktree at `e42e258aa49befd69940521708f7e82df89c4b5b`, branch `codex/main-sheet-v2`. Codex app `list_projects` still identified the saved local project as Git-backed; this chat's `list_artifacts` returned no attachment, so Git's worktree record is the current checkout evidence. The primary `core` gate at 10:59:10 UTC passed with 14 synthetic workbench and four harness tests. The worktree `core` gate at 11:06:52 UTC passed with 17 synthetic workbench and four harness tests, 12 map files/51 operations, and the transition pins. | The worktree has no checkout-local optional `.venv`; its live import/dependency statuses are `unavailable`, while the core profile passed. Neither gate verifies current authentication, Desktop acceptance, or Sheet effects. |
| D5 | `workbench_v2/core.py` now requires a `DayRecordReadbackTarget` for a `VERIFIED_READBACK` effect and checks the selected lesson/student, exact `record_seq`, and field. It rejects a readback value whose Python type differs from the proposal even if equality would otherwise pass (`True == 1`). Invented-data tests cover missing/foreign targets and type mismatch. Source SHA-256 `F9CD76C37491D0540655539975A1907938C415AD18C94D9F7AAE46CBCC097FB2`; test SHA-256 `E3EC7C9FC4838A94D20F7F74FDDD60CBC924A6C969684E47712D461BDE27956C`. `git diff --check` passed. This is an I/O-free validation boundary, not evidence that a real LMS wire contract or reread has been verified. | Refresh the exact occurrence/course joins and per-field wire/readback contract before any reviewed LMS save. Review the owner-owned synthetic Main Sheet prototype with the instructor, then refresh academy-owned workbook metadata/protection and stage a reversible Main-tab batch. |
| D3 | A read-only `git status --short --branch` on `C:/Users/packr/Desktop/spt-ios-workbench/worktree` still showed `codex/spt-ios-refactor` with the same three modified paths and two untracked path groups recorded above. The core gate also matched the pinned SPT HEAD, branch, and dirty-path set; dirty file contents were not revalidated. | Preserve SPT's dirty draft and perform its separate Linux/native/audio/iPhone gates in its own worktree. |

The callable tool catalog exposed no native task dependency API. This table remains a planning aid. No worker was delegated in this continuation; the Lead owns integration and acceptance.

A fresh read through the dedicated Google Sheets connector confirmed the owner-owned synthetic prototype file ID `1Jyy4DkG4YjEU_rRe_sQuak4kcrpBBQsdFGSmPDgz5Jg`, visible `박경찬` tab ID `16346331` (96 × 16), and hidden `WB_LESSON`/`WB_PICKLIST` tabs. The bounded `박경찬!A1:H4` read retained the explicit synthetic/unconnected banner and date-first header. No student row, formula body, production workbook range, or permission/protection state was read in this pass. Instructor usability review is still pending; the connector read is structural evidence only.

Tool routing was placed in the Codex user runtime instructions at `C:/Users/packr/.codex/AGENTS.md` (readback SHA-256 `A9DECC5A39E541CA4B00255568A46AFC1AA8E686C6E1A19FF9DB59B520AD0253`) and the project `AGENTS.md` in both checkouts. Browser remains for named web UI work, Computer Use for native Windows UI, normal file/shell tools for code and files, and dedicated connectors for supported records. `config.toml` and `rules/*.rules` were not altered because they control tool registration and command approvals, respectively. File changes do not by themselves establish that a future session loaded the instructions.

## Whole-Lens/TestFlight correction — 2026-09-27 20:20 KST

The next decision pass covers the complete teacher workflow: 14:00 PC whole-class preparation and selected-student judgment (owner's first review priority), 15:00 iPhone SPT event/audio capture for six or more students, reviewed LMS DayRecord closeout, and the teacher's final Kakao send. Keep the authority boundaries above. The first end-to-end acceptance slice remains the 2026-09-21 lesson, stopping before the human send.

A direct Codex app `read_thread` of the VS Code chat `대치점 통합 리팩토링 인터뷰` (thread `01a0e0ff-b2f8-7661-92a6-c23bcbd4a872`) recovered the earlier TestFlight, individual Apple-account, cloud-macOS and classroom Tailscale decisions. The owner later declined paid membership and allowed web-app or Android directions (user `msg_01a0e2a2-cd61-7401-9a71-7b29e43bab03`, 2026-09-27 11:31:55Z). `C:/Users/packr/Desktop/spt-ios-workbench/apple-testflight-setup.md` and `cloud-build-decision.md` are superseded historical references. The current documented candidate is an iPhone web app; this is not direct user acceptance of every route choice. Do not queue Apple enrollment, signing or cloud-build setup from the old interview.

The SPT source is a separate sanitized worktree at `C:/Users/packr/Desktop/spt-ios-workbench/worktree`, branch `codex/spt-ios-refactor`, HEAD `fe3a44e6cbe45a430ac980ab56abba44fa1c25bb`. At that earlier checkpoint, read-only status had modified `handoffs/2026-09-27-spt-ios.md`, `scripts/spt-backend.py`, and `tests/backend-auth.test.py`, plus untracked `.github/workflows/spt-synthetic-gate.yml` and `docs/native-pairing-contract.md`. The draft contains active native pairing/session work and a synthetic CI proposal. That checkpoint described a loopback gateway and incomplete native audio transfer; refresh current source and service evidence before relying on it. The owner chose to **verify and integrate the active draft**, then delete only proven duplicate/retired material; do not discard these paths as generic dirty work. A prior isolated Linux gate applies to an earlier immutable source candidate, not automatically to this dirty draft or an iPhone app.

Cleanup inventory: the saved-cookie workflow is already retired. The primary Main Sheet checkout still has untracked `docs/`, `src/`, and `research/lms_day_record_structure_probe.py`; `harness/git-baseline-plan.md` deliberately excluded them as stale legacy. However, the tracked backend map still cites `docs/system_architecture.md` and `docs/endpoints.md` as historical source pointers, and an older handoff cites the probe. Before deleting any of those exact files, migrate or retire their citations, validate the 12-file map/manifest and local gate, and confirm no current consumer uses the utilities. This is a bounded cleanup dependency, not a reason to load their mixed or student-bearing contents into a zero-context agent prompt.

For the next session: read this handoff first, then the SPT handoff and the two Apple/build decision files, and use `research/backend-map/README.md` as a router to only task-relevant map files. Refresh each checkout and the relevant account/deployment state before claiming readiness. Interview only unresolved teacher acceptance and current Apple membership facts; do not reopen the four settled TestFlight decisions. Keep one canonical decision/DAG handoff and English technical artifacts, with Korean user reports.

## Canonical Whole-Lens checkpoint — 2026-09-27 20:49 KST

Phase: full PC/iPhone workflow decision, bounded legacy cleanup, and SPT local
native pairing/audio integration. This is the current checkpoint and supersedes
the earlier TestFlight route statements above. The canonical decision,
acceptance scenario and versioned execution DAG are in
`C:/Users/packr/Desktop/강의하는아이들_대치점/docs/WHOLE_LENS_DECISION.md`, SHA-256
`A39AB3F826986DA16FA5D2FE88AEFC832879804EFC3648C458528F700301602B`.
No native Task API supporting dependencies was callable; the document's DAG
is a workspace-local planning aid. No worker was delegated. The Lead owns
integration and acceptance.

### Updated owner decisions and authority

- The teacher declined the paid Apple Developer membership. TestFlight,
  personal membership enrollment and cloud macOS signing are **withdrawn from
  the active release path**. First pilot candidate: web app on the existing
  iPhone 14 Pro Max. The owner has an existing Android account, but an Android
  classroom device and distribution readiness are unverified. The historical
  Apple/build decision files remain byte-pinned for the transition manifest;
  use this checkpoint and the Whole-Lens document as current authority.
- The first teacher review is 14:00 whole-class preparation followed by
  selected-student judgment. For **each** date-scoped student, the checklist
  covers assigned homework range, corresponding pre-study video upload,
  in-range problem attempts and app-backend grading, wrong-problem video or
  correction completion, and the teacher's final visual confirmation. No
  response-time threshold was requested. The teacher has supplied checklist
  content but has not accepted a real PC screen or physical phone run.
- LMS owns official DayRecord, SPT D1/R2 owns classroom events/original audio,
  Main Sheet owns teacher review/drafts/corrections, and the teacher performs
  final Kakao sending. App submission/grading joins and independent delivered
  body/receipt remain **unknown**. No LMS, academy-owned workbook, Sites,
  remote SPT, Apple, Android store or Kakao effect occurred here.

### Completed evidence by DAG node

| ID | Result and exact evidence | Limit / next action |
| --- | --- | --- |
| WL-01 Main Sheet | Primary `main` checkout began at `dba2ebd` with pre-existing dirty `AGENTS.md`, this handoff, and untracked legacy folders. After the bounded cleanup and current SPT pin, `python -B harness/desktop_gate.py --profile core` passed at 11:45:43 UTC: 14 synthetic workbench tests, four harness policy tests, 12 map files/51 operations, and the 11-file historical transition verifier. Map manifest SHA-256 `11EA77F74251746CB7C2049F2B9F1862AF00AD97A8DD31A3AFB38B20D3579E7B`. | Local synthetic/source gate only. No live LMS, actual Sheet write or teacher acceptance. |
| WL-01 SPT | `codex/spt-ios-refactor` now has local commit `4c2f1e4352b02c79c9711b06532a526672ed5d61` for five native pairing/audio/CI files and `150cbc335558748e375d5616aa5fa90186883835` for web-first `AGENTS.md`. The pre-existing modified `handoffs/2026-09-27-spt-ios.md` remains untouched and dirty. A 273-file source archive SHA-256 `8EEEA6FC7A405352A1048024AA5D5DE51A7B335FB1B94B873033D92061774CBD` was byte-verified in isolated Ubuntu 24.04 at `/home/palantirkc/spt-ios-workbench/whole-lens-8eeea6fc/src`; install, build, lint, typecheck and full `npm test` exited zero. Current checkout and tested source differ in content only at `AGENTS.md` (release steering); the current 273-file manifest is `harness/spt-candidate-source-manifest.json`, SHA-256 `2270E98B4557784DADCE6315F0EBBA9605D07DC34C135AE3671B8B34F6D56731`. The Desktop core gate verified all 273 current file hashes plus HEAD, branch and dirty path through `harness/spt-candidate-pin.json`. | The GitHub manual workflow parsed structurally but was not pushed or run. This is not a running tailnet HTTPS service, browser acceptance, physical iPhone result or teacher acceptance. |
| WL-01 cleanup | Retired exact untracked `src/sheets_bridge.py`, `src/pdf_parser.py`, and `research/lms_day_record_structure_probe.py` after consumer/citation review and pre-delete SHA-256 checks. Exact-path readback found all three absent. `docs/cleanup-evidence.md` SHA-256 `3D0A4CB71C8CD0CE4B62BE37EF52E1BC967584D310C1BC49EA3AF69398CF5ABA` records each disposition. Map-cited `docs/system_architecture.md` and `docs/endpoints.md` were preserved; the ignored mixed `docs/cartography.md` and untracked decision ledger were not treated as disposable. | The historical pinned handoff retains its dated references; this checkpoint supersedes them. The 12-file map and 11-file transition manifest revalidated after cleanup. |
| WL-02/03/04 | Teacher checklist, exact app/LMS joins, and physical web-phone recovery are specified in the decision document. | Implementation and teacher/device evidence pending. Prioritize WL-03's exact source-reviewed reads alongside WL-02's PC screen, then WL-04 private route/phone checks. |

An intermediate Desktop aggregate gate failed as expected when edits temporarily
changed historical transition-pinned files and when the SPT dirty-path set
advanced. The historical files were restored to their exact pinned hashes;
the current SPT candidate received a separate local source-content pin. The
final transition verifier and core gate both passed. The initial WSL query was
blocked by the filesystem sandbox; the bounded WSL distro read and isolated
synthetic gate ran through narrow automatic review. No student original or
session value was saved or printed.

Next action: bind the selected-date LMS occurrence/course and app preparation,
grading and correction read contracts from the existing backend map, then
present the 14:00 per-student PC checklist for teacher review. In parallel only
where independent, plan the exact private web gateway and physical iPhone
recovery scenario. No official save until teacher-reviewed exact values,
verified target/wire contract and same-target readback; no parent send by an
agent.


## Harness authority alignment — 2026-09-27

The current user permits verified academy reads scoped to the task's students, dates, and necessary fields, with no credential extraction or bulk raw retention. Production LMS/Sheet writes require an exact target, before/after, recovery method and approved batch, followed by the same-target readback. Deployment, sending, deletion and account changes retain confirmation unless the exact action is already authorized.

Native Codex context is routed through `AGENTS.md`, `docs/CODEX_CONTEXT.md` and `harness/context-map.md`. Related local SPT structural improvement is included in the reviewed Harness scope; no remote mutation or release is inferred. Current-source manifests and actual archive hashes must be rebound after reviewed SPT instruction changes while preserving historical tested identities. This paragraph does not assert that a fresh session, live service, or device has accepted the changes.
