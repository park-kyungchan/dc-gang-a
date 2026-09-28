/**
 * Single-Tab Row-Grouped Folding DB Synchronization Runner.
 * 
 * Implements:
 * 1. Main Sheet ("박경찬" Tab) Single-Tab Multi-Student DB Architecture.
 * 2. Uses Google Sheets API v4 `dimensionGroup` (AddDimensionGroupRequest + UpdateDimensionGroupRequest)
 *    to fold historical rows under each student's main status card.
 * 3. Default state is collapsed (`[-]` fold), expandable on-demand by clicking `[+]`.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { StudentAssessmentLedgerEngine } from '../src/assessment/studentAssessmentLedger';
import { AppGradingReader } from '../src/assessment/appGradingReader';
import { MainSheetAssessmentProjector } from '../src/sheets/mainSheetAssessmentProjector';
import type { SheetsBatchUpdateOperation } from '../src/sheets/mainSheetAssessmentProjector';

const MAIN_SHEET_TAB_ID = 1754681846; // "박경찬" Teacher Tab

async function main() {
  console.log(`\n======================================================================`);
  console.log(`[Row-Grouped Folding DB Sync Engine] Main Sheet Single-Tab Architecture`);
  console.log(`======================================================================\n`);

  const ledger = new StudentAssessmentLedgerEngine();

  // Ingest live verified student attempts
  const shinRaw = AppGradingReader.createShinJiwooGradingPayload();
  const shinRecord = ledger.ingestAssessmentRecord({
    ...AppGradingReader.normalizeAppSubmission(shinRaw),
    nextAction: 'p.68 ~ p.70 진도 진행 (09/30 이월: 직전 예습 클리닉 + Daily Test)'
  });
  ledger.markAssessmentCorrectionsCompleted('1293032', shinRecord.recordId, '오답 19, 20번 대면 검사 완료');

  const yooRaw = AppGradingReader.createYooJiyeonGradingPayload();
  ledger.ingestAssessmentRecord({
    ...AppGradingReader.normalizeAppSubmission(yooRaw),
    nextAction: '오답 클리닉지 배부 및 해설강의 배정 (10/02 이월: 직전 예습 클리닉 + Daily Test)'
  });

  const parkRaw = AppGradingReader.createParkSeeunGradingPayload();
  ledger.ingestAssessmentRecord({
    ...AppGradingReader.normalizeAppSubmission(parkRaw),
    nextAction: '분수의 곱셈 취약 단원 집중 클리닉 (10/02 이월: 직전 예습 클리닉 + Daily Test)'
  });

  const students = [
    { id: '1293032', name: '신지우', mainRow: 8 },
    { id: '1293138', name: '유지연', mainRow: 14 },
    { id: '1293067', name: '박세은', mainRow: 20 }
  ];

  const batchOperations: SheetsBatchUpdateOperation[] = [];

  console.log(`>>> Building Single-Tab Row-Grouped Layout:\n`);

  for (const s of students) {
    const history = ledger.getStudentHistory(s.id);
    const stats = ledger.getCumulativeStats(s.id);
    const latest = history[history.length - 1];

    // 1. Main Front Card (Row s.mainRow)
    const card = MainSheetAssessmentProjector.projectCard(latest, stats);
    batchOperations.push(
      MainSheetAssessmentProjector.buildUpdateMainSheetFrontCardRequest(MAIN_SHEET_TAB_ID, s.mainRow, card)
    );

    // 2. Expandable History Block under Main Card (Rows s.mainRow + 1 to s.mainRow + 1 + history.length)
    const histStart = s.mainRow + 1;
    const histEnd = histStart + history.length;

    // Add History Cells (Indented)
    batchOperations.push(
      MainSheetAssessmentProjector.buildRowGroupedHistoryCells(MAIN_SHEET_TAB_ID, histStart, history)
    );

    // Add Dimension Group (Row fold, default collapsed: true)
    const foldOps = MainSheetAssessmentProjector.buildAddRowGroupRequest(MAIN_SHEET_TAB_ID, histStart, histEnd, true);
    batchOperations.push(...foldOps);

    console.log(`[Student: ${s.name}]`);
    console.log(`  • Main Card Row: ${s.mainRow + 1} (Row index: ${s.mainRow}) ➔ Badge: ${card.statusBadge} | Score: ${card.scoreDisplay}`);
    console.log(`  • Folded DB Block: Rows ${histStart + 1}~${histEnd} (Range [${histStart}, ${histEnd})) ➔ Depth: 1, Collapsed: TRUE`);
    console.log(`  • History Items: ${history.length} records embedded`);
    console.log(`  • Next Action: ${latest.nextAction}\n`);
  }

  // Save payload
  const payloadDir = join(__dirname, '..', 'data', 'sync_payloads');
  mkdirSync(payloadDir, { recursive: true });
  const payloadPath = join(payloadDir, '2026-09-28_row_grouped_main_sheet_sync.json');
  writeFileSync(payloadPath, JSON.stringify({ operations: batchOperations }, null, 2), 'utf-8');

  console.log(`>>> Google Sheets API v4 batchUpdate Payload Generated:`);
  console.log(`  -> ${payloadPath} (${batchOperations.length} operations)`);
  console.log(`\n[SUCCESS] Single-Tab Row-Grouped Folding DB synchronizer completed.\n`);
}

if (import.meta.main) {
  main().catch(err => {
    console.error('Fatal execution error:', err.message);
    process.exit(1);
  });
}
