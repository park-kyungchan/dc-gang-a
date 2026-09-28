# Daechi instructor workbench

This repository holds the Main Sheet workbench, a source snapshot of SPT, and the LMS automation package for one instructor's date-first workflow. The running SPT service, academy LMS, Sheet, and official sender remain separate authorities. The teacher performs the final parent send.

## Start on another Windows PC

Clone the private repository, open its root in a coding agent, and read [AGENTS.md](AGENTS.md), the [portable workspace guide](docs/PORTABLE_WORKSPACE.md), and the [active handoff](handoffs/2026-09-28-windows-antigravity.md). Antigravity CLI reads root `AGENTS.md`; no model-specific conversation export is needed. Authentication, student records, and local runtime installations are not carried by Git.

```powershell
python --version
python -B -m unittest discover -s workbench_v2/tests -v
python -B research/validate_backend_map.py
python -B harness/tools/verify_source_imports.py
```

The first continuation task is the synthetic 14:00 whole-class preparation screen in `review/` and `workbench_v2/class_overview.py`. The imported `spt/` and `lms-automation/` directories have their own `AGENTS.md` files.

## Current state

- `workbench_v2/` is a pure Python projection core with invented-data tests. It does not connect to the LMS or Sheet.
- `research/main-sheet-v2/` records an owner-owned synthetic Google Sheets prototype. Its successful bot write does not prove a write to the academy-owned workbook.
- `research/backend-map/` is the bounded, privacy-reviewed backend map. App submission/grading joins and an independent parent-delivery receipt are still unverified.
- `spt/` contains 270 source files from the reviewed SPT checkout. `lms-automation/` contains 59 selected `ganga` code, test, and dependency files. Their source commits and file hashes are in `docs/source-import-manifest.json`.
- The saved-session client, its MCP server, smoke check, pipeline test, manual-session probe, and `ganga-read-client` skill were retired on 2026-09-27. The unused legacy PDF parser and Sheets bridge were also retired after their sole source dependency was found to be the removed MCP server. See [cleanup evidence](docs/cleanup-evidence.md).

Read [AGENTS.md](AGENTS.md) for effect boundaries, [the Whole-Lens decision](docs/WHOLE_LENS_DECISION.md) for current priorities and the web-first mobile route, [the active handoff](handoffs/2026-09-28-windows-antigravity.md) for continuation, and [the older Desktop checkpoint](handoffs/2026-09-27-desktop-resume.md) for historical evidence.

The [Desktop harness](harness/README.md) and its [context map](harness/context-map.md) describe the original machine-local gate. It depends on sibling checkouts and an external transition package, so use the focused tests above on a fresh clone. A machine-local gate pass is not production acceptance.

## Local environment

Use Python 3.12 from this directory. The current projection core has no third-party dependencies, so setup needs no package installation:

```powershell
python -B -m unittest discover -s workbench_v2/tests -v
```

The test data is invented. Keep `config/` credentials and `data/` student material out of logs and version control. The imported LMS repository's old student databases and Git history were deliberately excluded. `.gitignore` is not a confidentiality boundary; review every staged path and diff before pushing.

`workbench_v2/lms_read_adapter.py` now checks an explicit occurrence binding, a bounded DayRecord read, and an optional course-key relation using invented-data tests. Live joins remain unverified. Continue backend research with narrow, source-reviewed direct reads through an authorized ephemeral `ganga.lms.session.LmsSession`; use Browser for web UI questions, Computer Use for native Windows UI, and normal file tools for workspace edits. Preserve unknown app and delivery states until their selected-student read contracts are verified. Review a reversible Main-tab batch with the instructor before applying it; save any DayRecord fields only after teacher review and exact readback. The instructor performs the final Kakao send.
