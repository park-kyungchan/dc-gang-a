# Agent runtime status

This directory is a typed description of a proposed agent workflow. Importing
it does not install native Codex or Antigravity agents, hooks, command guards,
or approval gates. The repository's root and nested `AGENTS.md` files remain
the active project instructions.

The three hook commands in `data/hooks.json` are placeholders: their handler
scripts are absent from this checkout, so the records are disabled. A future
adapter must map semantic events to the host's actual hook schema, provide the
handlers, and verify that they execute before enabling them. Do not copy this
JSON into a native hook config as if it were an installed guard.

`isToolBlocked` decides only from a tool name. It cannot inspect command
arguments or file contents, so it cannot enforce the zero-grep rule inside a
shell command, cookie non-persistence, approval, or the teacher's send boundary.
Use the project instructions and exact effect review for those decisions.

The pacing and agent manifests record an earlier Antigravity workflow. Their
fixed call budget, subagent sequence, and per-phase approval language are not
Codex policy and do not override the current task, project instructions, or
runtime permissions. Codex already reads the root `AGENTS.md`; no duplicate
project policy or unverified hooks are installed under `.codex/` or `.agents/`.

Run the focused runtime check from the repository root with `bun test` and
explicit test paths, or use the `test:agent-runtime` package script.
`bun run typecheck:agent-runtime` checks the TypeScript surface after installing
the declared development dependencies. Node 24 can also import the `.ts`
entrypoint with built-in type stripping; this does not register it as a native
Codex extension.
