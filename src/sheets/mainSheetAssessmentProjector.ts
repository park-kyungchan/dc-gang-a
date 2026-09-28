/**
 * Pure assessment row projection and caller-targeted request builder.
 * 
 * Domain Rules:
 * 1. Projects assessment history into a row for the instructor's existing Main tab.
 * 2. Builds one bounded updateCells request from an explicit caller-provided block target.
 * 3. Status badges distinguish unknown grades, teacher review, clinic assignment, and recorded completion.
 * 4. Hover notes contain topic and source-key presence, not answer text or device details.
 */

import type {
  StudentAssessmentRecord,
  MainSheetAssessmentRowProjection,
  MainSheetAssessmentTarget,
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
}

export interface MainSheetAssessmentWritePlan {
  target: Pick<MainSheetAssessmentTarget, 'spreadsheetId' | 'sheetId' | 'tabName'>;
  operation: SheetsBatchUpdateOperation;
}

export class MainSheetAssessmentProjector {
  /**
   * Projects a single student assessment record into a Main Sheet front card.
   */
  public static projectRow(
    record: StudentAssessmentRecord,
    stats?: StudentCumulativeStats
  ): MainSheetAssessmentRowProjection {
    const statusBadge = record.status === 'unverified'
      ? '⚪ 성적미확인'
      : record.status === 'clinic_completed'
        ? '🟢 오답검사완료'
        : record.status === 'clinic_assigned'
          ? '🟡 클리닉배정'
          : '🟡 강사확인필요';

    const scoreDisplay = record.score === null || record.correctCount === null || record.totalQuestions === null
      ? '성적 미확인'
      : `${record.score}점 (${record.correctCount}/${record.totalQuestions})`;
    const wrongItemsDisplay = record.wrongItemNumbers === null
      ? '미확인'
      : record.wrongItemNumbers.length > 0
        ? `${record.wrongItemNumbers.join('번, ')}번`
        : '오답 없음 (100%)';

    // Build rich multiline hover note
    const lines: string[] = [
      `[평가 결과 검토]`,
      `• 평가 유형: ${record.assessmentCategory} (${record.unitName})`,
      `• 시험지 pNo: ${record.pNo || '미확인'} (출처 연결 별도 확인)`,
      `• 교재/범위: ${record.bookTitle} ${record.scope}`,
      `• 응시 소요시간: ${record.timeSpentMinutes}분 / 제한 ${record.timeLimitMinutes}분`,
      `• 제출 방식: ${record.submissionMethod === 'academy_app' ? '학원 앱' : '서면'}`,
      `• 최종득점: ${record.score === null || record.percentage === null ? '미확인' : `${record.score}점 (정답률 ${record.percentage}%)`}`
    ];

    if (record.wrongItemNumbers === null || record.itemOutcomes === null) {
      lines.push('• 채점 원본 검증 전: 점수와 오답 문항 미확인');
    } else if (record.wrongItemNumbers.length > 0) {
      lines.push(`• 오답 문항 분석:`);
      for (const item of record.itemOutcomes.filter(i => !i.isCorrect)) {
        const sourceKeyMarker = item.lectureKey ? ' (해설 키 연결됨)' : '';
        lines.push(`  - [${item.itemNo}번] ${item.topicDescription || '유형 정보 미확인'}${sourceKeyMarker}`);
      }
    } else {
      lines.push('• 자동채점 오답 없음; 강사 확인 필요');
    }

    if (stats) {
      lines.push(`----------------------------------------`);
      lines.push(`[누적 학습 통계 (${record.studentName})]`);
      lines.push(`• 누적 응시 횟수: ${stats.totalAssessmentsCount}회`);
      lines.push(`• 검증된 누적 응시: ${stats.verifiedAssessmentsCount}회`);
      lines.push(`• 평균 정답 점수: ${stats.cumulativeAverageScore === null ? '미확인' : `${stats.cumulativeAverageScore}점`}`);
      if (stats.weakUnits && stats.weakUnits.length > 0) {
        lines.push(`• 취약 단원 경고: ${stats.weakUnits.join(', ')}`);
      }
    }

    lines.push(`• 다음 강사 조치: ${record.nextAction || '강사 확인 필요'}`);

    const hoverNote = lines.join('\n');

    const sheetRowValues: (string | number)[] = [
      record.studentId,
      record.recordId,
      record.sourceRecordId || '',
      record.studentName,
      record.enrolledGroup,
      record.sessionDate,
      `${record.assessmentCategory} (${record.unitName})`,
      record.bookTitle,
      record.scope,
      record.submittedAt,
      statusBadge,
      scoreDisplay,
      wrongItemsDisplay,
      record.nextAction || '',
      record.checksum
    ];

    return {
      recordId: record.recordId,
      sourceRecordId: record.sourceRecordId ?? null,
      pNo: record.pNo,
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
   * Builds one bounded row update for the existing instructor Main tab.
   * This is a pure request builder; it does not call Google Sheets or create tabs.
   */
  public static buildMainSheetAssessmentRowRequest(
    target: MainSheetAssessmentTarget,
    projection: MainSheetAssessmentRowProjection
  ): MainSheetAssessmentWritePlan {
    const { block } = target;
    if (target.tabName !== '박경찬') {
      throw new Error('Assessment rows can only target the caller-identified 박경찬 Main tab.');
    }
    if (!target.spreadsheetId.trim() || !Number.isInteger(target.sheetId) || target.sheetId < 0) {
      throw new Error('Main sheet target must include caller-provided spreadsheetId and sheetId values.');
    }
    if (
      !Number.isInteger(block.startRowIndex) ||
      !Number.isInteger(block.endRowIndex) ||
      !Number.isInteger(block.nextRowIndex) ||
      !Number.isInteger(block.startColumnIndex) ||
      !Number.isInteger(block.endColumnIndex) ||
      block.startRowIndex < 0 ||
      block.startColumnIndex < 0 ||
      block.endRowIndex <= block.startRowIndex ||
      block.nextRowIndex < block.startRowIndex ||
      block.nextRowIndex >= block.endRowIndex
    ) {
      throw new Error('Assessment block offsets are invalid or the block has no remaining row capacity.');
    }

    if (
      projection.sheetRowValues.length !== 15 ||
      projection.sheetRowValues[0] !== projection.studentId ||
      projection.sheetRowValues[1] !== projection.recordId ||
      projection.sheetRowValues[2] !== (projection.sourceRecordId ?? '')
    ) {
      throw new Error('Assessment row must contain exactly 15 columns with the expected student and source record keys.');
    }
    const values: Array<{
      userEnteredValue: { stringValue: string };
      note?: string;
    }> = projection.sheetRowValues.map(value => ({
      userEnteredValue: { stringValue: String(value) }
    }));
    if (block.endColumnIndex - block.startColumnIndex !== values.length) {
      throw new Error(`Assessment block must provide exactly ${values.length} columns.`);
    }
    const scoreColumnOffset = 11;
    values[scoreColumnOffset].note = projection.hoverNote;

    return {
      target: {
        spreadsheetId: target.spreadsheetId,
        sheetId: target.sheetId,
        tabName: target.tabName
      },
      operation: {
        updateCells: {
          range: {
            sheetId: target.sheetId,
            startRowIndex: block.nextRowIndex,
            endRowIndex: block.nextRowIndex + 1,
            startColumnIndex: block.startColumnIndex,
            endColumnIndex: block.endColumnIndex
          },
          rows: [{ values }],
          fields: 'userEnteredValue,note'
        },
      }
    };
  }
}
