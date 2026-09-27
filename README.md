# Daechi instructor workbench

This workspace is the local foundation for one instructor's Main Sheet workflow: select the lesson date and student, inspect the whole class and selected student's verified academy evidence, prepare classroom decisions, and review records through the step immediately before the instructor sends a parent message. Live classroom event and audio capture belongs to the separate SPT iOS worktree. The academy LMS, SPT server, Sheet, and official sender have distinct authority.

## Current state

- `workbench_v2/` is a pure Python projection core with invented-data tests. It does not connect to the LMS or Sheet.
- `research/main-sheet-v2/` records an owner-owned synthetic Google Sheets prototype. Its successful bot write does not prove a write to the academy-owned workbook.
- `research/backend-map/` is the bounded, privacy-reviewed backend map. App submission/grading joins and an independent parent-delivery receipt are still unverified.
- The saved-session client, its MCP server, smoke check, pipeline test, manual-session probe, and `ganga-read-client` skill were retired on 2026-09-27. The remaining `src/pdf_parser.py` and `src/sheets_bridge.py` are separate legacy utilities, not LMS access paths.

Read [AGENTS.md](AGENTS.md) for effect boundaries, [the current Desktop checkpoint](handoffs/2026-09-27-desktop-resume.md) for this session's evidence, and [the dated Main Sheet handoff](handoffs/2026-09-27-main-sheet-refactor.md) for settled decisions and open evidence gaps.

The [Desktop harness](harness/README.md) and its [context map](harness/context-map.md) provide a single safe local gate: `python -B harness/desktop_gate.py`. It checks pinned context and synthetic code without connecting to the academy or modifying SPT.

## Local environment

Use Python 3.12 from this directory. The current projection core has no third-party dependencies, so setup needs no package installation:

```powershell
python -B -m unittest discover -s workbench_v2/tests -v
```

The test data is invented. Keep `config/` credentials and `data/` student material out of logs and version control. This folder is currently not a Git checkout; `.gitignore` protects a future repository import but does not itself make local files private.

`workbench_v2/lms_read_adapter.py` now checks an explicit occurrence binding, a bounded DayRecord read, and an optional course-key relation using invented-data tests. Live joins remain unverified. Continue backend research with narrow, source-reviewed direct reads through an authorized ephemeral `ganga.lms.session.LmsSession`; use Browser for web UI questions, Computer Use for native Windows UI, and normal file tools for workspace edits. Preserve unknown app and delivery states until their selected-student read contracts are verified. Review a reversible Main-tab batch with the instructor before applying it; save any DayRecord fields only after teacher review and exact readback. The instructor performs the final Kakao send.
