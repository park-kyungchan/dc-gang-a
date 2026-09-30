---
name: codex-cloud-start
description: Prepare or resume dc-gang-a in current Codex Cloud using pinned Bun, synthetic checks, and the repository checkpoint; use for this project's Cloud setup or continuation.
---

Read root AGENTS.md and harness/cloud-environment.json. Use current Cloud's Install script and Start skill fields. Legacy setup/maintenance-script instructions describe a different product.

Use Bun 1.4.2 and TypeScript 7.0.2. During setup run bun run cloud:install, then bun run cloud:check. Review actual results before publishing. On task startup run bun run cloud:start and read handoffs/cloud-current-state.json. No service needs to start for this domain-library workflow.

Repository refresh preserves dependency caches without rerunning setup. If cloud:start reports a changed lockfile, run cloud:install before checks and republish reusable setup when appropriate.

The September 29 checkpoint remains dated evidence. cloud:start validates archival integrity and reports expiry; it never certifies current academy facts. Actual roster, authentication, browser state, and original media stay local. Default tests work without them; test:local-roster is separate.

Current Cloud documentation does not support browser/computer use. Do not start local Chrome MCPs, copy Windows profiles, or apply the Windows full-access template. Academy authentication cannot be moved into Cloud network secrets under current project policy.

Use TypeScript/Bun for new work. Preserve Python references and dual-runtime roster/routes/verify compatibility; invoke Python only for an unavoidable existing gate or unique verified reader. Read subtree AGENTS.md before SPT or LMS source work.

Official sources and copyable prompts are in harness/cloud-environment.json. Production gates remain in root AGENTS.md.
