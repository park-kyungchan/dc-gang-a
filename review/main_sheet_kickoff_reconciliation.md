# Main Sheet kickoff: adversarial reconciliation

Checked 2026-09-29 against the user-supplied `main_sheet_redesign_kickoff.md` in the Antigravity CLI brain directory, the current workspace, and the teacher's answers in this session. This file records decisions and gaps; it is not a live LMS or academy Sheet acceptance result.

| Kickoff claim or instruction | Current evidence and treatment |
| --- | --- |
| Three separate screens/tabs for preparation, class and closeout | The teacher explicitly selected **one visible `박경찬` tab with those sections vertically ordered**. The native A/teal sample implements this layout. |
| A personal Park workbook | The teacher confirmed the academy-owned `대치강아 학생진도현황` / `박경찬` tab as final target. The owner-owned workbook is only for invented-data rehearsal. |
| Five current students | `python -B harness/cli.py roster --all --json` now resolves five cohort entries plus a separate test account. Do not copy a fixed count or list into the runtime prompt; query the harness for each task. |
| Current branch and PR #3 merge state | The working branch is `feat/lms-harness-route-map-and-sheet-db-grouping` at `7139f0f`, one local commit beyond local `main`. Remote `main` is `d10ea7b`, while local `main` is `8d0aa8b`; no remote `feature` branch appeared in a read-only check. Merge status requires a fresh diff review. Dirty work is preserved; no merge was done. |
| Request a new cookie and persist a full LMS snapshot in `data/snapshots/` | A session value was already supplied in conversation. Current project rules allow task-bounded verified reads with an ephemeral session and prohibit automatic credential discovery, bulk raw retention, and raw student output. No cookie use, snapshot file, or academy read was performed in this design pass. |
| `assertSafeRead()` as a universal read gate | Generic probe safety and a reviewed parameterized read are different. `day_record_read` is a read-only POST but generic probe-unsafe; mutating GET routes remain blocked. A bounded read requires the named route's wire contract, exact keys and coverage proof. |
| LMS results, app status and future substitute plan described in the kickoff | These are dated handoff statements. Current student-level app joins and future schedule details remain unverified for the selected lesson. The synthetic sample displays unknown rather than importing those claims. |
| Concept test range equals the prior homework range | Kept as a domain rule with a stricter join: use the **verified previous occurrence and each textbook assignment**, including holiday/absence gaps. The local `concept_scope` projection rejects missing and mixed-source assignments. |
| Audit trail and one-action buffer task | The selected sample now exposes per-book inspection queue, buffer task, task cancellation context, before/after correction, and a fixed teacher input area. Backend persistence and mobile action wiring remain to be implemented and reviewed. |

The current acceptance sequence is: verify exact LMS/app reads, rehearse the chosen design and commit path on invented data, review a precise academy Sheet migration batch, then separately review any official LMS field save. Parent delivery remains the teacher's action.
