# Windows Antigravity continuation — 2026-09-28

Phase: private monorepo published for a second Windows Desktop PC. The
owner selected `park-kyungchan/dc-gang-a` as a private GitHub repository,
requested Main Sheet, SPT, and LMS automation code in one source tree, and
selected the 14:00 whole-class preparation screen as the first continued
task. This handoff carries code and decisions; it does not transfer live
authentication, student records, service state, or prior chat sessions.

## Task graph and state

| ID | Work | Depends on | Current gate |
| --- | --- | --- | --- |
| GH-01 | Curate and import three source trees | — | Main Sheet root preserved; SPT 270 and `ganga` 59 tracked source files copied from reviewed local checkouts. `docs/source-import-manifest.json` records every imported hash and original branch/HEAD. Original checkouts untouched. |
| GH-02 | Make context readable by different agents | GH-01 | Root and nested `AGENTS.md`, portable guide, this dated handoff, and explicit local versus portable gate distinction. Source and credential boundaries retained. |
| GH-03 | Verify portable code and source preflight | GH-01, GH-02 | Complete locally: focused 17-test workbench suite, 12-file/52-operation backend-map validator, 12-student review check, import hash verifier, and first-PC machine-local core gate passed on 2026-09-28. The final candidate scan found no high-confidence secret or forbidden path; staged paths and the scoped first-party whitespace check passed review. |
| GH-04 | Create and push private GitHub repository | GH-03 | Complete: `park-kyungchan/dc-gang-a` was created and read back as `PRIVATE`; `main` received baseline commit `41bde70151b45387118840958a2ab62db96c5b24`. GitHub API and local HEAD agreed. A new clone with `core.autocrlf=true` passed the portable checks. |
| WL-02 | Continue synthetic 14:00 whole-class screen | GH-04 | Candidate in `review/whole_lens_1400.html` and `workbench_v2/class_overview.py`; instructor PC acceptance pending. |
| WL-03 | Bind exact selected-student LMS and app read joins | WL-02 | Read-contract gaps remain in `docs/WHOLE_LENS_READ_CONTRACTS.md`; no live join is accepted. |

This table is the workspace planning aid. No user-visible worker chat or
subagent was assigned for this import; the lead owns integration and checks.

## Source and evidence boundaries

- Main Sheet local `main` began at `dba2ebd9f8d2a2f3421c57bc767f231b7f279c1b` with pre-existing modified and untracked work. The existing local
  `codex/main-sheet-v2` branch at `e42e258aa49befd69940521708f7e82df89c4b5b`
  supplied its `workbench_v2` class overview files and current uncommitted
  exact-readback model/tests without modifying the managed worktree. The
  initial incomplete copy failed imports; copying the matching `core.py` and
  `test_core.py` resolved it, and all 17 focused tests passed. Root `review/`
  contains an invented 12-student candidate.
- SPT source came from `C:/Users/packr/Desktop/spt-ios-workbench/worktree`,
  branch `codex/spt-ios-refactor`, HEAD
  `150cbc335558748e375d5616aa5fa90186883835`. The current dirty SPT
  handoff was included; the dirty, Codex-specific original `AGENTS.md` was
  not. The GitHub workflow and `.openai/hosting.json` were excluded.
- LMS source came from `C:/Users/packr/Desktop/강의하는아이들_대치점_자동화`,
  branch `main`, HEAD `e3d138b`. Only `ganga/`, `tests/`, and
  `requirements.txt` were imported. The source repository has tracked
  `data/` files and old instructions permitting student DB publication and
  automatic browser-cookie discovery. Those paths and its Git history were
  excluded. No source checkout was moved or deleted.
- The imported file hashes were verified locally with
  `python -B harness/tools/verify_source_imports.py`. A snapshot hash is
  provenance, not proof of current service parity or permission to run a
  live operation. The current root backend map and original transition
  evidence retain their prior dated limits.
- The bounded pre-push candidate scan covered 411 current tracked/untracked
  files at its first pass (4,388,962 bytes) and found zero high-confidence credential, phone,
  forbidden-path, or oversize matches. The local `main` history scan covered
  five commits and 69 unique blobs with zero such matches. These pattern
  scans do not prove that all prose is non-sensitive; staged paths and diff
  still need review.
- Final pre-commit inventory staged 373 paths, including 270 imported SPT
  snapshot files plus its new scoped `AGENTS.md`, and 59 imported LMS files
  plus three new local guidance/ignore files. No `config/`, `data/`, `.codex/`,
  `work/`, old decision ledger, or SPT hosting association was staged. The
  final candidate scanner covered 413 tracked/non-ignored files (4,392,952
  bytes) with zero selected findings. A scoped first-party whitespace check
  passed; historical and byte-pinned source files retain their original line
  endings and intentional whitespace. `.gitattributes` disables Git EOL
  conversion so their imported hashes survive a Windows clone.
- GitHub readback showed `nameWithOwner=park-kyungchan/dc-gang-a`,
  `visibility=PRIVATE`, `defaultBranch=main`, and remote `main` SHA
  `41bde70151b45387118840958a2ab62db96c5b24` after the baseline push.
  A fresh depth-one clone of that revision with `core.autocrlf=true` passed
  17 synthetic Main Sheet tests, the 12-file/52-operation backend-map
  validator, the 12-student review check, source-import hash verification,
  and the bounded pre-push scan. The actual second PC and its Antigravity
  CLI session have not been verified.

## Open risks and next action

The root machine-local `desktop_gate.py` requires first-PC sibling paths and
cannot certify the second Windows PC. The imported LMS test suite carries old
repository policy assumptions and is not yet a portable acceptance gate.
No academy or Sheet authentication was transferred. On the second PC, sign
in through approved channels and keep live effects behind their exact gates.

On the second PC, start at root `AGENTS.md`, this handoff, and
`docs/PORTABLE_WORKSPACE.md`. Verify Git HEAD, Python 3.12, the focused
synthetic tests, backend map, and imported source manifest. Then continue
WL-02 with invented data. Do not infer live LMS, SPT, Sheet, or iPhone
readiness from a successful clone.
