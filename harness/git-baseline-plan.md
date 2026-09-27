# Local Git baseline

The owner authorized a local Git repository on 2026-09-27. This baseline is local only: no remote, push, publication, or academy/Sheet/SPT/VPS effect.

## Proposed first commit

Stage only the following reviewed paths, 34 text files totaling about 292 KB at the 2026-09-27 staged preflight:

- `.gitignore`, `AGENTS.md`, `README.md`
- `harness/` excluding generated caches and the ignored `.venv/`
- `workbench_v2/` excluding `__pycache__/` and bytecode
- `research/backend-map/` and `research/validate_backend_map.py`
- `handoffs/2026-09-27-desktop-resume.md`

The preflight searched these candidates for common private-key, API-key, and inline `JSESSIONID` assignment patterns and returned no filename match. This is a bounded scan, not a guarantee that every text line is non-sensitive. Review the staged file list and diff before committing. Keep the first commit local and private.

The existing canonical backend map includes CRLF files and one Markdown hard-line break with two trailing spaces. Preserve its byte hashes; interpret that one `git diff --check` warning as intentional rather than rewriting the hash-pinned source.

## Deliberate exclusions

- `config/`, `data/`, `.venv/`, generated caches, and root `1.png` are ignored.
- `docs/cartography.md` contains mixed student examples and is ignored.
- Other `docs/`, `src/`, `tests/`, `research/`, and older handoffs remain unstaged and visibly untracked until separately reviewed. Do not hide those sources merely to make `git status` look clean. The sibling automation and SPT repositories remain separate.

The first commit records only the curated baseline. App registration of the repository, review pane behavior, managed worktree creation, and native local-environment actions need separate readback; a `.git` directory alone does not prove those app features are active.
