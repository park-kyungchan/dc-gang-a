---
name: codex-cloud-start
description: Start dc-gang-a by request scope; handle Git-only operations directly and recover pinned runtime and scoped context for engineering or product continuation.
---

Read root AGENTS.md and classify the current request first. Use the existing `/workspace/dc-gang-a` checkout; create a Git worktree only when explicitly requested. Do not search app projects or unrelated directories when this checkout exists.

## Git-only requests

For pull, fetch, status, log or diff, follow the root Git-only sequence: inspect status, branch/upstream and remotes together; perform the requested operation; verify the resulting commit and worktree state. Pull uses `--ff-only` and the configured upstream, or a verified explicit remote/default branch when no upstream exists. Preserve dirty work; stop on divergence or an overwrite risk. Do not reset, clean or automatically stash.

Finish without Bun, cloud:start, workflow:context, model configuration, dependency installation, product-document reads, tests or context-recovery subagents. If engineering is also requested, perform its scoped startup after Git synchronization. Re-read changed startup instructions before subsequent engineering work.

## Engineering or product continuation

1. Reuse Bun 1.4.2. If absent from PATH, prepend `/workspace/.cloud-tools/bun-1.4.2/node_modules/@oven/bun-linux-x64/bin` for the current command and verify its version. Missing PATH is not a missing installation. Use TypeScript 7.0.2; do not install Python for Cloud convenience.
2. Read `harness/cloud-environment.json` and `handoffs/cloud-current-state.json`, then run `bun run cloud:start` once before dependent development. No service needs to start. Reuse dependencies; run `bun run cloud:install` before dependency-consuming commands only if the lockfile changed or required dependencies are missing.
3. Run `bun run workflow:context` with the required purpose: continuation, interview, dependencies, main_sheet, google_integration, academy_local or spt_mobile. Read every required source in that selected route, including durable purpose and current confirmed answers, before dependent work, interviews or subagent dispatch. Keep unrelated purpose routes unopened. The command emits routing metadata and hashes, not source contents or proof of understanding.
4. Reuse the already-read scope on subsequent turns and dispatches. After compaction recover the scoped context; after relevant source changes recover affected guidance. Repeat cloud:start only after relevant Cloud configuration/checkpoint or dependency changes. Do not repeat setup, model writes or full checks merely because a session resumed.

The Lead gives subagents the recovered scope, explicit ownership and verification contract. Read subtree AGENTS.md before SPT or LMS edits. Preserve confirmed answers and unresolved questions in the canonical engineering checkpoint; interview missing requirements before dependent implementation. Git branches, commits and PRs carry source continuity.

## Initial setup and validation

During initial environment setup, run `bun run cloud:install`, apply requested repository-native settings with `bun run codex:model-config --apply`, then verify with `bun run codex:model-config --check`. Reapply settings only for an explicit configuration repair. The ignored repository TOML preserves unrelated values; it does not establish the managed model's effective capacity or change Windows/global host settings.

Choose focused checks for the changed scope. Run `bun run cloud:check` before claiming full Cloud readiness or preparing reusable setup; a Git update does not require it. Review actual results before authorized Publish/Republish. Use current Cloud's Install script and Start skill fields from `harness/cloud-environment.json`. In the fixed managed layout, cloud:install maintains the generated `/workspace/AGENTS.md` discovery bridge while preserving user-authored guidance; it installs no hooks or per-turn injection.

Use TypeScript/Bun and structured .ts/.json for new work products; Markdown is limited to native instruction filenames. Preserve Python references and dual-runtime roster/routes/verify compatibility.

## Evidence and production boundaries

The September 29 academy checkpoint remains dated evidence. cloud:start validates archival integrity and reports expiry; it never certifies current academy facts. Local academy continuation keeps its fail-closed resume gate. Actual roster, authentication and original media stay local; synthetic tests do not establish live access, deployment or physical-device acceptance.

Preserve unknown joins and original evidence. Exact production effects remain subject to root AGENTS.md and existing session authorization. Do not start local Chrome MCPs, copy Windows profiles or invoke the historical full-access installer for source checks. Revalidate browser capabilities through current official sources only when needed.
