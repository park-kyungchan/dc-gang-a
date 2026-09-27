# Daechi Main Sheet workbench

## Purpose and source boundaries

- This workspace supports one instructor's PC preparation and reviewed closeout in the `박경찬` Main Sheet. The separate SPT iOS worktree owns live classroom capture. The academy LMS remains authoritative for official lesson records, SPT D1 for classroom events, the Sheet for teacher review and drafts, and the official sender for actual parent delivery.
- Start with `handoffs/2026-09-27-desktop-resume.md`, then the earlier Main Sheet handoff and verified Desktop transition pack it cites. Use `research/backend-map/README.md` only for a specific backend question. Treat handoff claims as dated until refreshed.
- Preserve date-first, then student selection; whole-class preparation beside selected-student detail; unknown evidence as unknown; linked original media; append-only draft and correction history.

## Safe local setup

- Use Windows Python 3.12 from this project root. `workbench_v2` and its tests use only the standard library; no virtual environment or package installation is needed for that slice.
- The safe local gate is `python -B -m unittest discover -s workbench_v2/tests -v`. It uses invented records and has no network, Sheet, or LMS effect.
- `python -B harness/desktop_gate.py` is the broader local environment gate. Its pass state is limited to the local checks it names; Desktop app association, live LMS reads, production Sheet effects, and teacher acceptance require separate evidence.
- The former session-file client, MCP server, smoke check, pipeline test, and manual-session probe were retired on 2026-09-27. Do not restore or run a saved-cookie workflow or use blanket test discovery as an environment check.
- Never read or print credential contents from `config/`, credential stores, or raw student data from `data/`. Do not add them to Git, logs, prompts, or broad tool output.

## Desktop interaction

- Use normal file tools for workspace files and source review. Use Browser only when web UI inspection or interaction is needed and Computer Use only for native Windows UI work.
- For academy backend research, prefer exact, source-reviewed, bounded direct reads through the existing `ganga.lms.session.LmsSession` contract when an authorized ephemeral session is available. Do not run its automatic browser-cookie or manual credential discovery without separate authorization. Never save or print session values. A page shell proves route access only; verify exact selected-student and lesson joins before displaying facts.
- Start from `research/backend-map/README.md` and the exact `route-registry.json` operation before adding a probe. Reuse the existing 12-file, hash-pinned map; do not repeat settled route discovery or promote historical evidence to current student facts.

## Tool routing

- Workspace files, source searches, Git, local tests, and safe scripts: use file/shell tools with an explicit absolute Windows workdir. Use `rg` for search. Do not use Browser or Computer Use to edit files or run terminal commands.
- Academy LMS backend data: use the reviewed `ganga.lms.session.LmsSession` route with an exact operation, subject/date bound, transient authentication, and aggregate or redacted output. The Browser login is not a license to extract its cookie or substitute UI clicks for a backend contract.
- `@Browser`: use only for a named web UI question, visual check, or interaction that a direct connector cannot answer. Confirm the actual tab and route. A page shell, DOM label, or screenshot is weaker than an exact backend read.
- `@Computer`: use only for native Windows app UI when no dedicated app tool exists. Follow its window-selection and confirmation rules; never automate a terminal, the Codex app, credential UI, or routine file edits through it.
- Google Drive/Sheets: use the dedicated connector for exact file metadata, bounded ranges, and reviewed writes; use Browser only for visual usability checks. Preserve the academy-owned workbook versus synthetic prototype boundary.
- Codex project/chat management: use the Codex app tools. Remote SSH: use the named host and strict host-key checks for a bounded read, keeping source paths distinct from local snapshots. SPT implementation and Linux gates stay in the separate SPT worktree.

## Effect gates

- Classify each academy operation by its actual effect; GET can mutate and a POST can render a read-only view. Use only source-reviewed, bounded read contracts for backend research. Do not infer app submission, grading, video status, parent-delivered body, or receipt from page shells or labels.
- All eight DayRecord fields require teacher-reviewed exact values, a verified target and wire contract, and exact same-target readback before any save. The teacher performs the final Kakao send.
- The academy-owned workbook and owner-owned synthetic prototype are distinct. Do not treat prototype bot writes as production acceptance. Check current metadata and protection before a reversible production batch.
- Keep SPT's dirty native-pairing and CI files intact. Do not assume the local worktree equals the remote SPT service, Sites deployment, signed app, or physical iPhone.
