# Daechi Whole-Lens Workspace: Agent Instructions

## Entry and ownership

- This is the shared entrypoint for coding agents. Read `docs/CODEX_CONTEXT.md` (historical filename) for user intent and authority, `docs/WHOLE_LENS_DECISION.md` for the current product direction, and `handoffs/2026-09-28-windows-antigravity.md` for the current phase. Revalidate time-sensitive claims.
- The repository contains Main Sheet code at the root, SPT source under `spt/`, and LMS automation source under `lms-automation/`. Read each directory's `AGENTS.md` before changing its files. A source snapshot in Git does not establish a running service or authorize a production effect.
- Support date-first whole-class preparation, then selected-student judgment. The LMS owns official lesson/DayRecord data; SPT D1/R2 owns classroom event/audio evidence; the Main Sheet owns teacher review and drafts; the official sender owns parent delivery.
- Preserve linked original media, append-only draft/correction history, and unknown evidence as unknown. UI labels, screenshots, page shells, and HTTP 200 do not establish student-level backend joins or delivery.
- Routine assigned local files, execution, and network work may proceed. Confirm deployment, sending, deletion, and account/access changes unless the exact action is already authorized. The user requests structural improvement, including related local SPT/runtime material, with concrete review before moving, retiring, or deleting operational material.

## Actual academy data and production writes

- Standing reads are allowed through verified read routes for the current task's students, dates, and necessary fields. Use synthetic records for general harness checks. Exclude credential extraction, unrelated data collection, bulk raw retention, and raw student/media output in logs or reports.
- Classify operations by their actual effect: GET can mutate and POST can render a read-only view. Start with `research/backend-map/README.md` and the exact operation in its canonical route registry. Parameterized reads are permitted when their contract and current task scope are verified; the existence of a page-shell route alone does not establish that permission.
- Prefer the reviewed `ganga.lms.session.LmsSession` contract for exact direct reads when an authorized ephemeral session is available. Never run automatic cookie or credential discovery. Keep session values in process memory and out of persistent artifacts/output.
- Use an authorized browser tool for named teacher-site UI and bounded passive request-shape inspection. Confirm the actual browser, tab, route, and authentication. In Codex, use its in-app Browser; in Antigravity, verify the actual browser capability before use. Saved sign-in may be reused for authorized reads; do not extract its JSESSIONID. Hand account input to the user when needed.
- Before changing production LMS records or the academy-owned Google Sheet, present the exact target, before/after values, and recovery method and obtain approval for that batch. All eight DayRecord fields require teacher-reviewed exact values and a verified target/wire contract. After saving, read back the same target before claiming success.
- Keep the academy-owned workbook separate from the owner-owned synthetic prototype. Refresh metadata and protections before a production batch. Synthetic writes are not production acceptance. The teacher retains final Kakao-send responsibility under the current product decision.

## Teacher and mobile workflow

- The 14:00 preparation reviews each date-scoped student's homework range, matching pre-study upload, app problem attempts/backend grading, and wrong-answer video/correction, followed by teacher visual judgment. Do not invent a waiting-time threshold.
- App/student/course/submission/grading joins remain unknown until verified. Preserve source timestamps and exact occurrence keys when projecting evidence.
- Paid Apple membership and TestFlight are withdrawn from the current release route. The documented first candidate is an iPhone web app; Android remains conditional on a confirmed classroom device. Keep physical-device and teacher acceptance distinct from synthetic tests.

## Local runtime, tests, and structure

- On Windows, use explicit absolute working directories and normal file/shell tools for source, Git, tests, and scripts. Use a dedicated Drive/Sheets connector when available for exact metadata, ranges, and approved writes; otherwise stop at the unverified boundary.
- `workbench_v2` uses Python 3.12 and the standard library. The focused gate is `python -B -m unittest discover -s workbench_v2/tests -v` with synthetic records and no network, LMS, or Sheet effect.
- The existing machine-local gate is `python -B harness/desktop_gate.py --profile core`; it expects the original Windows sibling checkouts and transition package, so a fresh clone cannot claim its pass. Read its current effect/reference map before changing it. Use `--profile live` only with that checkout's declared, installed, and locked optional reader environment. Do not install the live environment merely to run core checks. The portable source check is `python -B harness/tools/verify_source_imports.py`; the focused synthetic tests and backend-map validator are separate checks.
- Do not restore the retired saved-session client, cookie workflow, MCP server, or broad smoke/pipeline probes. Never use blanket test discovery as an environment check.
- `config/` and `data/` contain protected local material; do not read credential contents or bulk raw records, add them to Git, or include them in broad tool output. Purpose-specific verified reads follow the boundary above.
- Preserve dirty work and source locks. Keep immutable transition/snapshot/backend evidence at its verified paths unless the exact migration updates and validates every consumer. Consolidate mutable current guidance around one context map and dated handoff.
- The original SPT checkout and running service remain separate authorities from the `spt/` source import. Review each exact edit or move of operational material and preserve provenance. Local tests do not establish remote SPT parity, deployment, classroom audio transfer, or physical iPhone acceptance.
