---
name: codex-cloud-start
description: Prepare or resume dc-gang-a in current Codex Cloud using pinned Bun, synthetic checks, and the repository checkpoint; use for this project's Cloud setup or continuation.
---

Read root AGENTS.md and harness/cloud-environment.json. Use current Cloud's Install script and Start skill fields. Legacy setup/maintenance-script instructions describe a different product.

Each Cloud task already has an isolated environment. Use its existing checkout; create a Git worktree only when the user explicitly requests one. Activate the retained pinned Bun installation if it is outside PATH.

Apply the requested repository-native model settings with bun run codex:model-config --apply, then verify with bun run codex:model-config --check. The typed policy requests a 1,050,000-token context window and compaction at 787,500 (75%). The helper changes only those two root TOML values in ignored .codex/config.toml, preserving other settings. It does not modify Windows or global host files, or establish effective managed model capacity. Do not invoke the historical full-access configuration installer.

Use Bun 1.4.2 and TypeScript 7.0.2. During setup run bun run cloud:install, then bun run cloud:check. Review actual results before publishing. On task startup run bun run cloud:start and read handoffs/cloud-current-state.json. No service needs to start for this domain-library workflow.

Repository refresh preserves dependency caches without rerunning setup. If cloud:start reports a changed lockfile, run cloud:install before checks and republish reusable setup when appropriate.

Run bun run workflow:context and read the typed engineering context in handoffs/workflow-current-state.json on task resumption, after compaction and before subagent dispatch. The Lead preserves confirmed interview answers, unresolved questions, ownership and verification evidence in that canonical checkpoint. Git branches, commits and PRs carry source continuity. The CLI reports metadata only; native per-turn injection and effective model capacity are not established by it.

Use TypeScript/Bun and structured .ts/.json for new work products. Markdown is limited to native instruction files such as AGENTS.md and SKILL.md. Current priorities are development/test feedback, continuity/governance, then Google API integration. The Lead selects focused checks by changed scope and risk, and runs cloud:check before claiming Cloud readiness. Interview missing requirements before implementing a dependent direction; never infer an answer or impose a numeric ambiguity threshold.

The September 29 checkpoint remains dated evidence. cloud:start validates archival integrity and reports expiry; it never certifies current academy facts. Actual roster, authentication, browser state, and original media stay local. Default tests work without them; test:local-roster is separate.

This source-only Cloud workflow does not require browser/computer use. Revalidate product capabilities through current official sources when they are needed. Do not start local Chrome MCPs, copy Windows profiles, or apply the Windows full-access template for source checks. Academy authentication remains in local verified read paths under current project policy.

Use TypeScript/Bun for new work. Preserve Python references and dual-runtime roster/routes/verify compatibility; invoke Python only for an unavoidable existing gate or unique verified reader. Read subtree AGENTS.md before SPT or LMS source work.

Official sources and copyable prompts are in harness/cloud-environment.json. Production gates remain in root AGENTS.md.
