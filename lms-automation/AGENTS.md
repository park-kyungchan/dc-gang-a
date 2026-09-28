# LMS Automation Source: Agent Instructions

Read the repository root `AGENTS.md`, `research/backend-map/README.md`, and
`handoffs/2026-09-28-windows-antigravity.md` first. `ganga/` is an imported
source snapshot. The old repository's agent instructions and README were not
imported because they describe retired cookie discovery and a different
student-data retention decision.

- This directory contains code, tests, and its dependency declaration only.
  Do not add student databases, raw exports, session cookies, credentials,
  local browser profiles, or old Git history to this repository.
- Do not invoke `LmsSession` with automatic cookie discovery. Use only a
  reviewed explicit ephemeral authentication channel when an exact authorized
  read requires it. Never print or persist the session value.
- Review the exact operation in the canonical backend route registry before
  contacting the academy. HTTP method does not establish whether an operation
  reads or writes. Limit authorized reads to the task's student, date, and
  necessary fields.
- Production DayRecord or Sheet writes require the exact target, reviewed
  before and after values, verified wire contract, recovery plan, approval
  for that batch, and same-target readback. Do not send parent messages.
- Existing source and tests may encode older privacy or runtime assumptions.
  Treat those as code to assess, not as current authority. General local
  checks use synthetic records and make no academy or Sheet request.

The imported file hashes and original commit are recorded in
`../docs/source-import-manifest.json`. Keep future source changes and their
tests in this directory, with current decisions in the root handoff.
