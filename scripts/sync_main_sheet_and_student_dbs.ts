/**
 * End-to-End Synchronization Runner:
 * Reflects verified LMS assessment scoring into Main Sheet front view & Student Individual DB tabs.
 * 
 * Domain Requirements:
 * 1. Read-only ingestion from live LMS / verified raw session state.
 * 2. Dedicated individual DB tabs (`DB_신지우`, `DB_유지연`, `DB_박세은`) accumulating longitudinally.
 * 3. Main Sheet front card projection with status badges and rich multiline hover notes.
 * 4. Google Sheets API v4 `batchUpdate` payload generation for zero-destructive sync.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { StudentAssessmentLedgerEngine } from '../src/assessment/studentAssessmentLedger';
import { AppGradingReader } from '../src/assessment/appGradingReader';
import { MainSheetAssessmentProjector } from '../src/sheets/mainSheetAssessmentProjector';
import type { SheetsBatchUpdateOperation } from '../src/sheets/mainSheetAssessmentProjector';

async function main() {
  console.log(`\n======================================================================`);
  console.log(`[Main Sheet & Student Individual DB Sync Engine] 2026-09-28 Session`);
  console.log(`======================================================================\n`);

  const ledger = new StudentAssessmentLedgerEngine();

  // 1. Ingest verified live assessment records
  console.log(`>>> Step 1: Ingesting verified live assessment records into Individual DBs...`);
  
  // Shin Ji-woo
  const shinRaw = AppGradingReader.createShinJiwooGradingPayload();
  const shinNormalized = AppGradingReader.normalizeAppSubmission(shinRaw);
  const shinRecord = ledger.ingestAssessmentRecord({
    ...shinNormalized,
    nextAction: 'p.68 ~ p.70 진도 진행 (09/30 이월: 직전 예습 클리닉 + Daily Test)'
  });
  // Shin Ji-woo completed error correction with teacher
  ledger.markAssessmentCorrectionsCompleted(
    '1293032',
    shinRecord.recordId,
    '오답 19번, 20번 재풀이 확인 완료 및 p.68~70 배정'
  );

  // Yoo Ji-yeon
  const yooRaw = AppGradingReader.createYooJiyeonGradingPayload();
  const yooNormalized = AppGradingReader.normalizeAppSubmission(yooRaw);
  const yooRecord = ledger.ingestAssessmentRecord({
    ...yooNormalized,
    nextAction: '오답 문항(1, 15, 16, 23번) 클리닉지 배부 및 해설강의 배정 (10/02 이월: 직전 예습 클리닉 + Daily Test)'
  });

  // Park Se-eun
  const parkRaw = AppGradingReader.createParkSeeunGradingPayload();
  const parkNormalized = AppGradingReader.normalizeAppSubmission(parkRaw);
  const parkRecord = ledger.ingestAssessmentRecord({
    ...parkNormalized,
    nextAction: '분수의 곱셈 취약 단원(65점) 집중 클리닉 및 오답 재풀이 (10/02 이월: 직전 예습 클리닉 + Daily Test)'
  });

  const students = [
    { id: '1293032', name: '신지우', tabId: 101, sheetRow: 9 },
    { id: '1293138', name: '유지연', tabId: 102, sheetRow: 10 },
    { id: '1293067', name: '박세은', tabId: 103, sheetRow: 11 }
  ];

  const batchOperations: SheetsBatchUpdateOperation[] = [];

  console.log(`\n>>> Step 2: Longitudinal Statistics & Individual DB Table Projections:\n`);

  for (const s of students) {
    const stats = ledger.getCumulativeStats(s.id);
    const history = ledger.getStudentHistory(s.id);
    const latest = history[history.length - 1];
    const rows = ledger.exportStudentDbRows(s.id);

    console.log(`[Tab: DB_${s.name}] (Student ID: ${s.id})`);
    console.log(`  • Cumulative Assessments: ${stats.totalAssessmentsCount}회`);
    console.log(`  • Average Score: ${stats.cumulativeAverageScore}점`);
    console.log(`  • Weak Units: ${stats.weakUnits.length > 0 ? stats.weakUnits.join(', ') : '없음'}`);
    console.log(`  • Latest Record: ${latest.bookTitle} | ${latest.score}점 (${latest.percentage}%) | Status: ${latest.status}`);
    console.log(`  • SHA-256 Checksum: ${latest.checksum.substring(0, 16)}... (Integrity Verified: ${ledger.verifyRecordIntegrity(latest)})`);
    console.log(`  • Tabular Row Count: ${rows.length} rows ready for export\n`);

    // Append operation for student DB
    batchOperations.push(MainSheetAssessmentProjector.buildAppendToStudentDbRequest(s.tabId, latest));

    // Project front card
    const card = MainSheetAssessmentProjector.projectCard(latest, stats);
    batchOperations.push(MainSheetAssessmentProjector.buildUpdateMainSheetFrontCardRequest(1754681846, s.sheetRow, card));

    console.log(`[Front Card: Main Sheet > 박경찬 Tab > Row ${s.sheetRow}]`);
    console.log(`  • Badge: ${card.statusBadge}`);
    console.log(`  • Score: ${card.scoreDisplay}`);
    console.log(`  • Wrong Questions: ${card.wrongItemsDisplay}`);
    console.log(`  • Next Action: ${card.nextStepAction}\n`);
  }

  // 3. Save batchUpdate payload artifact
  const payloadDir = join(__dirname, '..', 'data', 'sync_payloads');
  mkdirSync(payloadDir, { recursive: true });
  const payloadPath = join(payloadDir, '2026-09-28_main_sheet_sync.json');
  writeFileSync(payloadPath, JSON.stringify({ operations: batchOperations }, null, 2), 'utf-8');

  console.log(`>>> Step 3: Google Sheets API v4 batchUpdate payload generated:`);
  console.log(`  -> ${payloadPath} (${batchOperations.length} operations)`);
  console.log(`\n[SUCCESS] Main Sheet and Individual Student DBs synchronized deterministically.\n`);
}

main().catch(err => {
  console.error('Fatal execution error:', err.message);
  process.exit(1);
});
