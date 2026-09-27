# Synthetic Google Sheets prototype — 2026-09-27

Workbook: https://docs.google.com/spreadsheets/d/1Jyy4DkG4YjEU_rRe_sQuak4kcrpBBQsdFGSmPDgz5Jg/edit#gid=16346331

Owner: `packr0723@gmail.com`. This is a separate, owner-created prototype with invented student labels only. The academy-owned workbook `1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg` and its `박경찬` tab were not modified by this prototype work.

## Verified structure and interactions

- The Google Sheets batch completed 52 requests. Exact metadata readback: visible `박경찬` sheet ID `16346331`, 96 rows × 16 columns, first four rows frozen, gridlines hidden; hidden `WB_LESSON` ID `210001` (100 × 12) and `WB_PICKLIST` ID `210002` (100 × 3).
- Main view includes date → optional group → student controls, a synthetic six-student preparation matrix, selected-student context, classroom attention placeholders, eight DayRecord rows, and a separate draft/LMS/report/send-status panel. A banner says synthetic data and unconnected sources. No LMS save or Kakao send control exists.
- Formatted readback of `A1:P16` showed six synthetic students for `2026-09-21`, and student 01's course/video values from the hidden table. This proves formula evaluation in this prototype, not an academy join.
- Selector exercise: changing the date to `2026-09-23` reduced the matrix to two synthetic students and showed that date's `미확인` video; restoring `2026-09-21` and selecting student 02 changed the course to the synthetic Gauss 2권 row; restoring student 01 returned the original Gauss 1권/video values. The final controls were read back as `2026-09-21` and `가상 학생 01 (S001)`.
- Group exercise: changing the group to `가상 B반` filtered the matrix to synthetic students 04–06 and warned `선택 학생은 현재 학반 밖` because student 01 remained selected. Restoring `전체` returned the six-student matrix and `선택 유효`. The picker formula now applies both date and group. This is a visible stale-selection flag, not an automatic student substitution.
- A follow-up gate prevented stale detail from showing through that warning: while student 01 was outside `가상 B반`, group/grade/course cells read `미확인 · 학생 재선택`; after restoring `전체`, the same cells read the selected synthetic student's original values. This checks display behavior only; no effectful controls exist in the prototype.
- The prototype was shared with the keyless GCP bot as Writer. A sheet-wide enforced protection on its visible Main tab (range ID `2036450716`) lists `packr0723@gmail.com` and the bot. `research/gcp/probe_bot_write.py` minted a short-lived impersonated Sheets token, verified the bot's protected-tab edit metadata, wrote a random marker to previously empty `A65`, read the exact marker back, cleared the cell, and read it back empty. No token or marker value was printed. This proves a reversible protected-cell write in the **synthetic prototype only**.
- Seven conditional-format rules were applied and read back on the visible tab. Unknown, correction/attention, verified submission/grade, and out-of-context selection receive distinct visual cues; the text remains explicit so color is not the sole signal.

## Current gaps before cutover

1. The prototype's support table is synthetic and has no authorized live roster, selected-student app submission/grade read adapter, or SPT receipt adapter. The exact delivered Kakao body and independent receipt remain unverified.
2. Date, group and student controls are proven with synthetic formulas and dropdowns. The out-of-context selection is flagged, but production must disable effectful controls until the teacher selects an in-context student and a current LMS occurrence is verified.
3. The prototype is not an iPhone classroom screen, nor a test of the academy-owned workbook's actual protected-cell write, formula latency, concurrent edits, or accessibility. Those checks belong to the cutover and SPT phone gates.
4. The hidden tables demonstrate a normalized Sheet store. They are not a privacy boundary. The owner chose indefinite retention for teacher text and correction history; production needs versioned append records and a measured capacity/backup path before storing it.

The local layout/data contract is [schema-and-layout.md](schema-and-layout.md). No real student names, IDs, answers, media or session credentials were copied into this prototype.
