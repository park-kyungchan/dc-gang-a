# Portable Whole-Lens Workspace

Reviewed 2026-09-28. This guide is for a fresh Windows Desktop checkout in
Antigravity CLI or another coding agent. The repository files, rather than a
vendor conversation or global memory, carry the durable project context.

## Read order

1. Root `AGENTS.md`: current authority, data, and effect boundaries.
2. `handoffs/2026-09-28-windows-antigravity.md`: active phase, exact evidence,
   open work, and next action.
3. `docs/CODEX_CONTEXT.md` (historical filename): user intent and provenance.
4. `docs/WHOLE_LENS_DECISION.md`: date-first product direction and acceptance.
5. Only the task-relevant part of `research/backend-map/README.md` and its
   operation registry before any academy read.
6. `spt/AGENTS.md` or `lms-automation/AGENTS.md` before work in those trees.

Antigravity CLI's [workspace rules](https://antigravity.google/docs/rules/)
load `AGENTS.md` at the repository root and in relevant subdirectories. Other
agents should be directed to the same files. Do not create divergent copies
of the project policy in model-specific instruction files.

## Repository layout and provenance

| Directory | Purpose | Runtime authority |
| --- | --- | --- |
| `workbench_v2/`, `review/` | Synthetic Main Sheet projection and 14:00 teacher screen candidate | Main Sheet review; no LMS or Sheet connection |
| `research/backend-map/` | Dated, bounded academy operation evidence | Registry contracts, not a live login or current student state |
| `spt/` | Imported SPT classroom client/server source | D1/R2 runtime remains separate and needs fresh service/device proof |
| `lms-automation/` | Imported `ganga` source, tests, dependencies | LMS owns official records; source alone grants no live effect |
| `docs/source-import-manifest.json` | File hashes and source Git revisions at import | Provenance, not a permanent development lock |

The source imports are snapshots, not nested Git repositories or submodules.
The old SPT and LMS working directories were left untouched. Importing their
old Git history would carry known credential and student-data exposure risks,
so this repository records source commits and file hashes instead. The LMS
import omits `data/`, `config/`, legacy runtime folders, quiz transcripts,
old agent instructions, and browser/session material. The SPT import omits
its original agent instructions, hosting association, and inactive workflow.
Root `.gitattributes` preserves original file bytes across Windows checkouts
so the dated SHA-256 evidence is not changed by Git line-ending conversion.

## Fresh Windows checkout

Use an authorized GitHub sign-in to clone the private repository:

```powershell
git clone https://github.com/park-kyungchan/dc-gang-a.git
Set-Location .\dc-gang-a
agy
```

Start Antigravity CLI from the repository root so it loads root `AGENTS.md`; verify
the active context in the CLI before any write or live read. Authentication
for GitHub is separate from academy, Google Sheet, SPT, and Tailscale access.
Never copy a browser profile, session cookie, credential directory, student
database, or original audio through Git.

The Main Sheet projection needs Python 3.12 and only the standard library.
Run these separately from the repository root:

```powershell
python --version
python -B -m unittest discover -s workbench_v2/tests -v
python -B research/validate_backend_map.py
python -B harness/tools/verify_source_imports.py
```

Before any future push, run `python -B harness/tools/prepush_audit.py` and
inspect the exact staged path list and diff. The scanner catches selected
credential patterns and forbidden paths but cannot prove that all prose is
free of private information.

If Node is already installed, `node review/whole_lens_1400.test.js` checks the
invented 12-student review candidate. The focused tests and source validator
make no academy, Sheet, or remote service request. The import verifier checks
the original snapshot hashes; it will report drift after intentional edits
to imported files. Record new revisions in the dated handoff rather than
rewriting the original import provenance.

The published `main` at baseline commit `41bde70151b45387118840958a2ab62db96c5b24`
was cloned with Git EOL conversion enabled and passed the focused 17 tests,
backend-map validation, 12-student review check, and import-hash verifier.
This is a second checkout on the first PC, not a physical second-PC session.

The original `harness/desktop_gate.py --profile core` requires the first PC's
SPT checkout and Desktop transition package at fixed sibling paths. Its
failure on a fresh clone means those local evidence owners are unavailable,
not that the portable Main Sheet tests failed. Do not install the optional
live reader environment merely to satisfy that gate.

SPT declares Node `>=22.13.0` and a lockfile. Its build/test scripts invoke
Bash and some Linux facilities; use a compatible environment and record that
environment when the SPT task begins. The LMS automation dependency file is
`lms-automation/requirements.txt`; install it only when working on that
package. Its historical test suite includes assumptions about the old
repository's private student DB and instruction files, so review and adapt
those tests before calling the whole suite a monorepo gate.

## First continuation task

Continue WL-02: review and improve the 14:00 date-first whole-class screen
using synthetic 6- and 12-student states. Preserve all relevant groups and
pages, make each student's homework, pre-study, attempts/backend grade,
wrong-answer correction, and teacher visual check separate, and show unknown
until an exact source join is verified. Use `review/whole_lens_1400.html` for
the current static candidate and `workbench_v2/class_overview.py` for the
projection. Teacher PC review and the selected-student live app joins remain
pending. No production LMS/Sheet write or parent send is part of this task.
