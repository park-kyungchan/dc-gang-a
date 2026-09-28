# SPT Source: Agent Instructions

Read the repository root `AGENTS.md`, `docs/WHOLE_LENS_DECISION.md`, and
`handoffs/2026-09-28-windows-antigravity.md` first. This directory is a
source snapshot imported from a separate SPT checkout. Its dated
`handoffs/2026-09-27-spt-ios.md` is historical evidence, not an active task
queue or proof of a running service.

- SPT D1 owns classroom events and R2 owns original audio. The academy LMS
  owns official lesson records; the Main Sheet owns teacher review and drafts.
- Keep the viewed student separate from the recording student and preserve
  original request, event, capture, audio import, chunk, and receipt IDs.
- Missing evidence stays unknown. Preserve the device outbox and original
  recording until the exact server receipt is read back.
- Use synthetic data for local tests. Keep private fixtures, student data,
  credentials, `.env` files, and original audio out of Git and tool output.
- Local build and tests do not prove tailnet routing, remote deployment,
  physical iPhone behavior, or teacher acceptance. Do not deploy or change
  authentication or account access without an exact target and approval.
- The current product candidate is an iPhone Home Screen web app. Paid Apple
  membership and TestFlight are outside the active release path.
- `npm run build`, lint, typecheck, and tests use the declared Node runtime
  and package lock. Some scripts require Bash/Linux; document the actual
  environment and do not present a Windows-only run as Linux verification.

The source import manifest at `../docs/source-import-manifest.json` records
the imported files and original commit. A code change after import is normal
development; update the active handoff with the changed revision and tests.
