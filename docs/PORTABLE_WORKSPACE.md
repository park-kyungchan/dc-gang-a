# Portable Whole-Lens Workspace

Reviewed 2026-09-28. Current continuation uses TypeScript/Bun as the active
Main Sheet implementation and verification path. The older Python commands
below are historical parity references, not the acceptance gate for new work.
This guide is for a fresh Windows Desktop checkout in
Antigravity CLI or another coding agent. The repository files, rather than a
vendor conversation or global memory, carry the durable project context.

## Read order

1. Root `AGENTS.md`: current authority, data, and effect boundaries.
2. `handoffs/2026-09-28-antigravity-session-recovery.md`: active phase, exact
   evidence, open work, and next action. The earlier Windows handoff is the
   publication checkpoint.
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
| `src/wholeLens/`, `src/assessment/`, `src/preclass/`, `src/sheets/` | Active TypeScript domain models and Main Sheet projections | Bun synthetic tests; no live LMS or Sheet connection |
| `workbench_v2/`, `review/` | Historical Python projection and static 14:00 teacher screen candidate | Parity reference; no LMS or Sheet connection |
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

The active Main Sheet path uses Bun and pinned TypeScript development
dependencies. Run these separately from the repository root:

```powershell
bun install --frozen-lockfile
bun run typecheck
bun run test:synthetic
```

The following older Python commands belong to the pre-migration reference
checkout and do not establish current TS/Bun acceptance:

```powershell
python -B -m unittest discover -s workbench_v2/tests -v
python -B research/validate_backend_map.py
python -B harness/tools/verify_source_imports.py
```

Before any future push, inspect the exact staged paths and diff. The old
Python pre-push scanner is a parity reference and needs a TS/Bun replacement
before claiming an automated current pre-push gate.

The historical `review/whole_lens_1400.test.js` checks the old static
candidate. It is not the current TS/Bun gate. The old import verifier checks
snapshot hashes and may report intentional source changes; record new
revisions in the dated handoff rather than rewriting original provenance.

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
until an exact source join is verified. Use `src/wholeLens/domain.ts` for the
active synthetic class projection; `review/whole_lens_1400.html` and
`workbench_v2/class_overview.py` remain parity references. Teacher PC review
and the selected-student live app joins remain
pending. No production LMS/Sheet write or parent send is part of this task.
