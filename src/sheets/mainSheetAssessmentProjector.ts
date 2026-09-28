/**
 * Main Sheet Assessment Projector & Google Sheets API Sync Payload Builder.
 * 
 * Domain Rules:
 * 1. Projects individual student assessment history onto the front-facing Main Sheet.
 * 2. Generates Google Sheets API v4 `batchUpdate` requests for:
 *    - Student Individual DB tabs (`DB_신지우`, `DB_유지연`, `DB_박세은`).
 *    - Main Sheet (`박경찬` tab) Assessment Attention Rail & Status Cards.
 * 3. Enforces clean status badges:
 *    - 🟢 채점완료 (score >= 90 or all correct)
 *    - 🟡 풀이완료(클리닉요망) (score < 90)
 *    - 🔵 응시중
 * 4. Injects rich multiline hover notes with wrong question numbers and clinic lecture keys.
 */

import type {
  StudentAssessmentRecord,
  MainSheetAssessmentCardProjection,
  StudentCumulativeStats
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

export interface SheetsBatchUpdateOperation {
  updateCells?: {
    range: {
      sheetId?: number;
      startRowIndex: number;
      endRowIndex: number;
      startColumnIndex: number;
      endColumnIndex: number;
    };
    rows: Array<{
      values: Array<{
        userEnteredValue?: { stringValue?: string; numberValue?: number; formulaValue?: string };
        note?: string;
        userEnteredFormat?: Record<string, any>;
      }>;
    }>;
    fields: string;
  };
  appendCells?: {
    sheetId?: number;
    rows: Array<{
      values: Array<{
        userEnteredValue?: { stringValue?: string; numberValue?: number; formulaValue?: string };
        note?: string;
      }>;
    }>;
    fields: string;
  };
}

export class MainSheetAssessmentProjector {
  /**
   * Projects a single student assessment record into a Main Sheet front card.
   */
  public static projectCard(
    record: StudentAssessmentRecord,
    stats?: StudentCumulativeStats
  ): MainSheetAssessmentCardProjection {
    const statusBadge = (record.status === 'clinic_completed' || record.status === 'mastered')
      ? '🟢 오답검사완료'
      : record.wrongCount === 0 
        ? '🟢 채점완료' 
        : record.score >= 90 
          ? '🟢 채점완료' 
          : '🟡 풀이완료(채점중)';

    const scoreDisplay = `${record.score}점 (${record.correctCount}/${record.totalQuestions})`;
    const wrongItemsDisplay = record.wrongItemNumbers.length > 0 
      ? `${record.wrongItemNumbers.join('번, ')}번` 
      : '오답 없음 (100%)';

    const deviceNote = record.deviceInfo ? ` (${record.deviceInfo})` : '';

    // Build rich multiline hover note
    const lines: string[] = [
      `[대단원 총괄평가 채점 리포트]`,
      `• 평가명: ${record.assessmentCategory} (${record.unitName})`,
      `• 교재/범위: ${record.bookTitle} ${record.scope}`,
      `• 응시 소요시간: ${record.timeSpentMinutes}분 / 제한 ${record.timeLimitMinutes}분`,
      `• 제출방식: ${record.submissionMethod === 'academy_app' ? '학원 앱 실시간 자동채점' : '서면'}${deviceNote}`,
      `• 최종득점: ${record.score}점 (정답률 ${record.percentage}%)`
    ];

    if (record.wrongItemNumbers.length > 0) {
      lines.push(`• 오답 문항 분석:`);
      for (const item of record.itemOutcomes.filter(i => !i.isCorrect)) {
        lines.push(`  - [${item.itemNo}번] 학생답안: ${item.studentAnswer} | 정답: ${item.correctAnswer} (${item.topicDescription || '유형 오답'})`);
        if (item.lectureKey) {
          lines.push(`    ➔ 해설강의 Key: ${item.lectureKey}`);
        }
      }
    } else {
      lines.push(`• 전 문항 정답 완벽 마스터!`);
    }

    if (stats) {
      lines.push(`----------------------------------------`);
      lines.push(`[누적 학습 통계 (${record.studentName})]`);
      lines.push(`• 누적 응시 횟수: ${stats.totalAssessmentsCount}회`);
      lines.push(`• 평균 정답 점수: ${stats.cumulativeAverageScore}점`);
      if (stats.weakUnits.length > 0) {
        lines.push(`• 취약 단원 경고: ${stats.weakUnits.join(', ')}`);
      }
    }

    lines.push(`• 다음 강사 조치: ${record.nextAction || '오답 클리닉지 배부'}`);

    const hoverNote = lines.join('\n');

    const sheetRowValues: (string | number)[] = [
      record.studentName,
      record.enrolledGroup,
      record.assessmentCategory,
      record.bookTitle,
      record.scope,
      statusBadge,
      scoreDisplay,
      wrongItemsDisplay,
      record.nextAction || '',
      record.submittedAt
    ];

    return {
      studentId: record.studentId,
      studentName: record.studentName,
      latestAssessmentTitle: `${record.assessmentCategory} (${record.unitName})`,
      scope: record.scope,
      statusBadge,
      scoreDisplay,
      wrongItemsDisplay,
      nextStepAction: record.nextAction || '',
      sheetRowValues,
      hoverNote
    };
  }

  /**
   * Generates Google Sheets API v4 appendCells request to append an assessment row to student individual DB.
   */
  public static buildAppendToStudentDbRequest(
    sheetId: number,
    record: StudentAssessmentRecord
  ): SheetsBatchUpdateOperation {
    const values = [
      { userEnteredValue: { stringValue: record.sessionDate } },
      { userEnteredValue: { stringValue: record.enrolledGroup } },
      { userEnteredValue: { stringValue: record.assessmentCategory } },
      { userEnteredValue: { stringValue: record.bookTitle } },
      { userEnteredValue: { stringValue: record.unitName } },
      { userEnteredValue: { stringValue: record.scope } },
      { userEnteredValue: { numberValue: record.timeLimitMinutes } },
      { userEnteredValue: { numberValue: record.timeSpentMinutes } },
      { userEnteredValue: { numberValue: record.totalQuestions } },
      { userEnteredValue: { numberValue: record.correctCount } },
      { userEnteredValue: { numberValue: record.wrongCount } },
      { userEnteredValue: { numberValue: record.score } },
      { userEnteredValue: { stringValue: `${record.percentage}%` } },
      { 
        userEnteredValue: { 
          stringValue: record.wrongItemNumbers.length > 0 
            ? record.wrongItemNumbers.join(', ') 
            : '없음' 
        },
        note: record.wrongItemNumbers.length > 0
          ? record.itemOutcomes
              .filter(i => !i.isCorrect)
              .map(i => `${i.itemNo}번: 학생답 ${i.studentAnswer} / 정답 ${i.correctAnswer} (${i.topicDescription || ''})`)
              .join('\n')
          : undefined
      },
      { userEnteredValue: { stringValue: record.status } },
      { userEnteredValue: { stringValue: record.nextAction || '' } },
      { userEnteredValue: { stringValue: record.checksum.substring(0, 12) } }
    ];

    return {
      appendCells: {
        sheetId,
        rows: [{ values }],
        fields: 'userEnteredValue,note'
      }
    };
  }

  /**
   * Generates Google Sheets API v4 updateCells request for Main Sheet front view student card.
   */
  public static buildUpdateMainSheetFrontCardRequest(
    sheetId: number,
    rowIndex: number,
    projection: MainSheetAssessmentCardProjection
  ): SheetsBatchUpdateOperation {
    const values = [
      { userEnteredValue: { stringValue: projection.studentName } },
      { userEnteredValue: { stringValue: projection.latestAssessmentTitle } },
      { userEnteredValue: { stringValue: projection.scope } },
      { userEnteredValue: { stringValue: projection.statusBadge } },
      { 
        userEnteredValue: { stringValue: projection.scoreDisplay },
        note: projection.hoverNote
      },
      { userEnteredValue: { stringValue: projection.wrongItemsDisplay } },
      { userEnteredValue: { stringValue: projection.nextStepAction } }
    ];

    return {
      updateCells: {
        range: {
          sheetId,
          startRowIndex: rowIndex,
          endRowIndex: rowIndex + 1,
          startColumnIndex: 1, // Column B
          endColumnIndex: 1 + values.length
        },
        rows: [{ values }],
        fields: 'userEnteredValue,note'
      }
    };
  }
}
