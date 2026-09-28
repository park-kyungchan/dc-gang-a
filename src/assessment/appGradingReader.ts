/**
 * Read-Only Academy App Grading Reader & Normalizer.
 * 
 * Safety Rules (AGENTS.md Compliance):
 * 1. Read-only semantics: Never issues mutating requests (POST/PUT/DELETE) against LMS.
 * 2. Ingests raw student submission JSON payloads submitted from the academy mobile/tablet app.
 * 3. Normalizes student answers and produces structured `AssessmentItemOutcome[]`.
 * 4. Preserves lecture keys and video solution IDs for automated clinic linkage.
 */

import type {
  AssessmentCategory,
  AssessmentItemOutcome,
  StudentId,
  ClassGroupId
} from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';
import type { IngestAssessmentInput } from './studentAssessmentLedger';

export interface RawAppQuestionSubmission {
  questionNo: number;
  submittedAnswer: string;
  correctAnswer: string;
  points: number;
  lectureKey?: string;
  topic?: string;
}

export interface RawAppAssessmentSubmission {
  studentId: StudentId;
  studentName: string;
  enrolledGroup: ClassGroupId;
  sessionDate: string; // YYYY-MM-DD
  assessmentCategory: AssessmentCategory;
  bookTitle: string;
  unitName: string;
  scope: string;
  timeLimitMinutes: number;
  timeSpentMinutes: number;
  submittedAt: string; // ISO 8601
  deviceInfo?: string;
  questions: RawAppQuestionSubmission[];
}

export class AppGradingReader {
  /**
   * Pure read-only normalization function.
   * Converts raw app submission into verified `IngestAssessmentInput`.
   */
  public static normalizeAppSubmission(raw: RawAppAssessmentSubmission): IngestAssessmentInput {
    if (!raw.questions || raw.questions.length === 0) {
      throw new Error(`Empty app submission received for student ${raw.studentId}.`);
    }

    const itemOutcomes: AssessmentItemOutcome[] = raw.questions.map(q => {
      const isCorrect = String(q.submittedAnswer).trim() === String(q.correctAnswer).trim();
      return {
        itemNo: q.questionNo,
        studentAnswer: String(q.submittedAnswer).trim(),
        correctAnswer: String(q.correctAnswer).trim(),
        isCorrect,
        score: isCorrect ? q.points : 0,
        maxScore: q.points,
        lectureKey: q.lectureKey,
        topicDescription: q.topic
      };
    });

    return {
      studentId: raw.studentId,
      studentName: raw.studentName,
      enrolledGroup: raw.enrolledGroup,
      sessionDate: raw.sessionDate,
      assessmentCategory: raw.assessmentCategory,
      bookTitle: raw.bookTitle,
      unitName: raw.unitName,
      scope: raw.scope,
      timeLimitMinutes: raw.timeLimitMinutes,
      timeSpentMinutes: raw.timeSpentMinutes,
      submittedAt: raw.submittedAt,
      submissionMethod: 'academy_app',
      deviceInfo: raw.deviceInfo,
      itemOutcomes
    };
  }

  /**
   * Generates synthetic live app grading payload for 2026-09-28 Shin Ji-woo (`1293032`).
   * 20 questions total, 18 correct (90 pts), wrong: #7 and #14.
   */
  public static createShinJiwooGradingPayload(): RawAppAssessmentSubmission {
    const questions: RawAppQuestionSubmission[] = [];
    for (let i = 1; i <= 20; i++) {
      if (i === 7) {
        // Wrong question 7 (소수의 곱셈 문장제)
        questions.push({
          questionNo: 7,
          submittedAnswer: '3',
          correctAnswer: '5',
          points: 5,
          lectureKey: 'LEC_G5_2_CH1_P72_Q07',
          topic: '소수의 곱셈 문장제 응용'
        });
      } else if (i === 14) {
        // Wrong question 14 (소수의 곱셈 자릿수 판별)
        questions.push({
          questionNo: 14,
          submittedAnswer: '2',
          correctAnswer: '4',
          points: 5,
          lectureKey: 'LEC_G5_2_CH1_P73_Q14',
          topic: '소수점 위치 규칙 및 소수 자릿수'
        });
      } else {
        questions.push({
          questionNo: i,
          submittedAnswer: '1',
          correctAnswer: '1',
          points: 5,
          lectureKey: `LEC_G5_2_CH1_Q${String(i).padStart(2, '0')}`,
          topic: '소수의 곱셈 연산'
        });
      }
    }

    return {
      studentId: '1293032',
      studentName: '신지우',
      enrolledGroup: '월수1부',
      sessionDate: '2026-09-28',
      assessmentCategory: '대단원총괄평가',
      bookTitle: '초5-2 가우스 2권',
      unitName: '1. 소수의 곱셈',
      scope: 'p.71 ~ p.73',
      timeLimitMinutes: 60,
      timeSpentMinutes: 58,
      submittedAt: '2026-09-28T16:35:10+09:00',
      deviceInfo: 'Galaxy Tab A9 (학원 비치용 태블릿)',
      questions
    };
  }

  /**
   * Generates synthetic live app grading payload for 2026-09-28 Yoo Ji-yeon (`1293138`).
   * 20 questions total, 19 correct (95 pts), wrong: #12.
   */
  public static createYooJiyeonGradingPayload(): RawAppAssessmentSubmission {
    const questions: RawAppQuestionSubmission[] = [];
    for (let i = 1; i <= 20; i++) {
      if (i === 12) {
        // Wrong question 12 (유리수의 곱셈 부호 판별)
        questions.push({
          questionNo: 12,
          submittedAnswer: '-12',
          correctAnswer: '12',
          points: 5,
          lectureKey: 'LEC_G7_1_CH2_P178_Q12',
          topic: '음수 곱셈 부호 판별 실수'
        });
      } else {
        questions.push({
          questionNo: i,
          submittedAnswer: '2',
          correctAnswer: '2',
          points: 5,
          lectureKey: `LEC_G7_1_CH2_Q${String(i).padStart(2, '0')}`,
          topic: '중1-1 정수와 유리수 총괄'
        });
      }
    }

    return {
      studentId: '1293138',
      studentName: '유지연',
      enrolledGroup: '월금1부',
      sessionDate: '2026-09-28',
      assessmentCategory: '대단원총괄평가',
      bookTitle: '가우스 1-1',
      unitName: '대단원 총괄평가 (중1-1)',
      scope: 'p.176 ~ p.179',
      timeLimitMinutes: 60,
      timeSpentMinutes: 55,
      submittedAt: '2026-09-28T16:35:25+09:00',
      deviceInfo: 'iPad 10th Gen (학생 개인 지참 스마트 기기)',
      questions
    };
  }

  /**
   * Generates synthetic live app grading payload for 2026-09-28 Park Se-eun (`1293067`).
   * 20 questions total, 17 correct (85 pts), wrong: #5, #11, #19.
   */
  public static createParkSeeunGradingPayload(): RawAppAssessmentSubmission {
    const questions: RawAppQuestionSubmission[] = [];
    for (let i = 1; i <= 20; i++) {
      if (i === 5) {
        questions.push({
          questionNo: 5,
          submittedAnswer: '4',
          correctAnswer: '2',
          points: 5,
          lectureKey: 'LEC_G5_2_CH2_P135_Q05',
          topic: '직육면체의 꼭짓점과 모서리 관계'
        });
      } else if (i === 11) {
        questions.push({
          questionNo: 11,
          submittedAnswer: '3',
          correctAnswer: '1',
          points: 5,
          lectureKey: 'LEC_G5_2_CH2_P136_Q11',
          topic: '직육면체의 겨냥도 그리기 및 평행 모서리'
        });
      } else if (i === 19) {
        questions.push({
          questionNo: 19,
          submittedAnswer: '5',
          correctAnswer: '3',
          points: 5,
          lectureKey: 'LEC_G5_2_CH2_P138_Q19',
          topic: '직육면체의 전개도 접었을 때 마주보는 면'
        });
      } else {
        questions.push({
          questionNo: i,
          submittedAnswer: '1',
          correctAnswer: '1',
          points: 5,
          lectureKey: `LEC_G5_2_CH2_Q${String(i).padStart(2, '0')}`,
          topic: '직육면체의 성질'
        });
      }
    }

    return {
      studentId: '1293067',
      studentName: '박세은',
      enrolledGroup: '월금1부',
      sessionDate: '2026-09-28',
      assessmentCategory: '대단원총괄평가',
      bookTitle: '초5-2 가우스 2권',
      unitName: '2. 직육면체 및 직육면체의 성질',
      scope: 'p.134 ~ p.138',
      timeLimitMinutes: 60,
      timeSpentMinutes: 59,
      submittedAt: '2026-09-28T16:47:30+09:00',
      deviceInfo: 'Galaxy Tab S8 (학원 태블릿)',
      questions
    };
  }
}

