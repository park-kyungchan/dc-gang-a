# Bounded legacy cleanup — 2026-09-27

Scope: this project's untracked legacy code only. No credential, student-data,
academy, Sheet, or remote source path was opened or changed for this cleanup.

| Exact path | SHA-256 before retirement | Consumer and citation check | Disposition |
| --- | --- | --- | --- |
| `src/sheets_bridge.py` | `93B1F785B44D23610CFF79D274972B7FA2A19EF21A0E320C39CFD77276C32149` | No current import or test. The file imports the retired `src.mcp_server`; only the root README and dated Main Sheet handoff referenced it. | Retire the broken legacy bridge; preserve the historical handoff as a dated observation. |
| `src/pdf_parser.py` | `4C982A8D423DAEEE660144C7BCD5BF3FF13E6A2D8229C0DC75F8D495F0F502BC` | Its only repository consumer was the bridge above; the root README named it. The pure `workbench_v2` and current core gate do not import it. | Retire with its sole consumer. |
| `research/lms_day_record_structure_probe.py` | `2A99F2D8CDB1E3F3FEDE885736C7D1773AB626F3EFCA73835AAA74E3B481C4AE` | Only the dated Main Sheet and Desktop handoffs and first-baseline plan referenced it. The canonical map records its bounded historical result; `harness/academy_dayrecord_probe.py` is the current opt-in exact-date path. | Retire the one-off probe and retain the dated result, not the former runnable path. |

The exact-reference search covered tracked and untracked workspace text with
`rg -l`, and source inspection was limited to imports, definitions, and entry
points. The root README was updated before file removal. The dated Main Sheet
handoff remains byte-pinned by the Desktop transition pack, so its citations
are retained as historical text and superseded by this disposition. The old
Desktop handoff's cleanup inventory also remains historical; the new Whole-Lens
checkpoint records the final readback.

`docs/system_architecture.md` and `docs/endpoints.md` are **retained**: the
12-file backend map cites their precise historical source lines. The ignored
`docs/cartography.md` is mixed historical material and was not reviewed or
deleted. `docs/decision_ledger.json` remains untracked pending separate
provenance review; absence of a consumer alone is not proof it is disposable.
