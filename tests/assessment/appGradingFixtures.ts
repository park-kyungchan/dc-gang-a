import type { RawAppAssessmentSubmission, RawAppQuestionSubmission } from '../../src/assessment/appGradingReader';

type FixtureLabel = 'ALPHA' | 'BETA' | 'GAMMA';

const wrongQuestionNumbers: Record<FixtureLabel, number[]> = {
  ALPHA: [7, 14],
  BETA: [12],
  GAMMA: [5, 11, 19]
};

/** Synthetic-only input for normalizer and ledger tests. Never represents a live read. */
function createSyntheticGradingPayload(label: FixtureLabel): RawAppAssessmentSubmission {
  const wrongQuestions = new Set(wrongQuestionNumbers[label]);
  const questions: RawAppQuestionSubmission[] = Array.from({ length: 20 }, (_, index) => {
    const questionNo = index + 1;
    const isWrong = wrongQuestions.has(questionNo);
    return {
      questionNo,
      submittedAnswer: isWrong ? `synthetic-wrong-${questionNo}` : `synthetic-answer-${questionNo}`,
      correctAnswer: isWrong ? `synthetic-correct-${questionNo}` : `synthetic-answer-${questionNo}`,
      points: 5,
      lectureKey: `TEST_LEC_${label}_Q${String(questionNo).padStart(2, '0')}`,
      topic: `Synthetic topic ${questionNo}`
    };
  });

  return {
    pNo: `TEST-PAPER-${label}`,
    studentId: `TEST-STUDENT-${label}`,
    sourceRecordId: `TEST-SOURCE-${label}`,
    studentName: `Synthetic Student ${label}`,
    enrolledGroup: label === 'ALPHA' ? '2' : '3',
    sessionDate: '2099-01-01',
    assessmentCategory: '대단원총괄평가',
    bookTitle: 'Synthetic Workbook',
    unitName: 'Synthetic Unit',
    scope: 'Synthetic questions 1-20',
    timeLimitMinutes: 60,
    timeSpentMinutes: 45,
    submittedAt: '2099-01-01T10:00:00+09:00',
    gradeVerification: 'verified',
    verificationEvidence: {
      studentId: `TEST-STUDENT-${label}`,
      pNo: `TEST-PAPER-${label}`,
      sourceRecordId: `TEST-SOURCE-${label}`,
      sourceAttemptId: `TEST-ATTEMPT-${label}`,
      sourceTimestamp: '2099-01-01T10:00:00+09:00'
    },
    deviceInfo: 'synthetic-test-device',
    questions
  };
}

export const syntheticAlphaGradingPayload = createSyntheticGradingPayload('ALPHA');
export const syntheticBetaGradingPayload = createSyntheticGradingPayload('BETA');
export const syntheticGammaGradingPayload = createSyntheticGradingPayload('GAMMA');
