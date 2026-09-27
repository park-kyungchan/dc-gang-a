# Local Git baseline

The owner authorized a local Git repository on 2026-09-27. This baseline is local only: no remote, push, publication, or academy/Sheet/SPT/VPS effect.

The first curated commit is `6ddb1385b4166210c029e7d1c41bf6abebf25878` (34 text files). The second is `2d51ac7be2d956d676ceb425a92aaf4fd750b8c6` (24 vetted context files). The environment fix is `7dce930a923315af692552201f1ca9a40f53931f`. The Codex app then reported `isGitRepository=true` for this saved project and created a managed worktree at `C:/Users/packr/.codex/worktrees/main-sheet-v2/강의하는아이들_대치점`. It was moved from its initial detached HEAD to local branch `codex/main-sheet-v2` at the environment fix, and the first isolated feature commit is `e42e258aa49befd69940521708f7e82df89c4b5b`. The worktree excludes the ignored credential/student directories.

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
- The second commit added the separately hash-verified remote structural copy, GCP/prototype records, and two dated handoffs. Remaining `docs/`, `src/`, and `research/lms_day_record_structure_probe.py` files stay visibly untracked because they contain stale or broken legacy assumptions; do not hide them merely to make `git status` look clean. The obsolete `.agents` hook was removed. The sibling automation and SPT repositories remain separate.

App recognition and managed worktree creation have exact readback. Review-pane behavior and native local-environment actions have not been verified or configured.
