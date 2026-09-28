/**
 * LMS Backend Deterministic Read Contracts & Schema Specifications.
 * 
 * Safety & Architecture Rules (AGENTS.md Invariant Compliance):
 * 1. ZERO-HALLUCINATION INVARIANT:
 *    - No agent may manufacture synthetic scores and present them as verified live data.
 *    - Every data point carries explicit `dataSource` and `verificationStatus`.
 *    - Unverified or pending data MUST have `isVerifiedLive: false` and `score: null` or explicit pending status.
 * 
 * 2. 5-TIER JOIN KEY SPINE:
 *    - stu_pri_no (Student Primary Key)
 *    - course_seq / cm_seq (Course Enrollment Key)
 *    - p_no / pNo (LMS Exam Paper Key, e.g. "6343283")
 *    - testing_no (Student Attempt Session Key)
 *    - lecture_key (Item, Solution Video & Topic Key)
 * 
 * 3. STRICT READ-ONLY WHITELIST:
 *    - Only verified read routes are accessible. Any mutation route (udt*, create*) is strictly prohibited.
 */

import type { StudentId, ClassGroupId } from '../../data/raw_sessions/2026-09-28/main_sheet_v2.types';

// ============================================================================
// 1. Core Data Source & Provenance Types
// ============================================================================

export type LmsDataSource = 
  | 'LIVE_LMS'            // Read directly from live LMS session in process memory
  | 'VERIFIED_SNAPSHOT'   // Read from cryptographically verified immutable snapshot
  | 'SYNTHETIC_HARNESS';  // Synthetic fixture strictly for offline unit testing

export type VerificationStatus = 
  | 'verified_live'        // Confirmed against live LMS response
  | 'verified_snapshot'    // Confirmed against immutable local snapshot
  | 'pending_verification' // Paper/attempt exists, but student results pending verification
  | 'unverified_synthetic'; // Mock data for testing only; NEVER show as actual result

// ============================================================================
// 2. LMS Endpoint Safety Registry
// ============================================================================

export interface LmsEndpointMetadata {
  operationName: string;
  path: string;
  httpMethod: 'GET' | 'POST';
  semanticEffect: 'READ_ONLY' | 'MUTATION_FORBIDDEN';
  category: 'attendance' | 'course' | 'prestudy' | 'assessment' | 'lecture' | 'report';
  description: string;
}

export const LMS_VERIFIED_READ_ENDPOINTS: Record<string, LmsEndpointMetadata> = {
  DAY_RECORD_MAIN: {
    operationName: 'DayRecordServlet?p_process=Main',
    path: '/servlet/controller.dayrecord.DayRecordServlet?p_process=Main',
    httpMethod: 'POST',
    semanticEffect: 'READ_ONLY',
    category: 'attendance',
    description: '공식 8대 일지 필드(출결, 진도, 숙제, 메모 등) 일자별/학반별 조회'
  },
  COURSE_STUDY: {
    operationName: 'CourseManageServlet?reqCmd=StudyCourse',
    path: '/servlet/controller.coursemanage.CourseManageServlet?reqCmd=StudyCourse',
    httpMethod: 'POST',
    semanticEffect: 'READ_ONLY',
    category: 'course',
    description: '학생별 배정된 정규 교재, 과정(course_seq) 및 유효기간 조회'
  },
  PRESTUDY_SUMMARY: {
    operationName: 'CourseManageServlet?reqCmd=TeacherPrestudySummary',
    path: '/servlet/controller.coursemanage.CourseManageServlet?reqCmd=TeacherPrestudySummary',
    httpMethod: 'GET',
    semanticEffect: 'READ_ONLY',
    category: 'prestudy',
    description: '학생별 집에서 촬영/업로드한 예습 영상 제출 여부 사전 확인'
  },
  TEST_PAGE_LIST_FA: {
    operationName: 'TestPageListServlet?p_process=UserByMain&ass_no=1001',
    path: '/servlet/controller.tutor.base.TestPageListServlet?p_process=UserByMain&ass_no=1001',
    httpMethod: 'GET',
    semanticEffect: 'READ_ONLY',
    category: 'assessment',
    description: '총괄평가/형성평가(FA) 시험지 카탈로그 및 학생 응시 목록 조회'
  },
  TEST_PAGE_SHOW_EX: {
    operationName: 'TestPageShowExServlet?p_process=GetLectureList',
    path: '/servlet/controller.common.TestPageShowExServlet?p_process=GetLectureList',
    httpMethod: 'GET',
    semanticEffect: 'READ_ONLY',
    category: 'assessment',
    description: '시험지(p_no)에 포함된 문항별 lecture_key, 정답, 배점 메타데이터 조회'
  },
  DAILY_REPORT_PREVIEW: {
    operationName: 'DailyReportServlet?p_process=Preview',
    path: '/servlet/controller.dailyreport.DailyReportServlet?p_process=Preview',
    httpMethod: 'GET',
    semanticEffect: 'READ_ONLY',
    category: 'report',
    description: '학부모 발송 전 당일 수업 리포트 렌더링 미리보기'
  }
};

// ============================================================================
// 3. Test Paper Contract (p_no 중심 1급 시민)
// ============================================================================

export interface LmsTestPaperItem {
  itemNo: number;
  lectureKey: string;
  points: number;
  correctAnswer: string;
  topicDescription: string;
  difficulty?: 'basic' | 'standard' | 'advanced';
}

export interface LmsTestPaperContract {
  pNo: string; // LMS Exam Paper Unique ID (e.g. "6343283")
  assNo: '1000' | '1001' | '1002'; // 1000: DA, 1001: FA(총괄평가), 1002: NA
  categoryName: string; // e.g. "대단원총괄평가"
  title: string;        // e.g. "가우스 1-1 대단원 총괄평가 (정수와 유리수)"
  bookTitle: string;    // e.g. "가우스 1-1"
  unitName: string;     // e.g. "2. 정수와 유리수"
  scope: string;        // e.g. "p.176 ~ p.179"
  totalQuestions: number;
  timeLimitMinutes: number; // e.g. 60
  items: LmsTestPaperItem[];
  provenance: LmsDataSource;
  registeredAt: string;
  checksum: string;
}

// ============================================================================
// 4. Student Assessment Attempt Contract (testing_no 중심)
// ============================================================================

export interface LmsItemAttemptOutcome {
  itemNo: number;
  lectureKey: string;
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  score: number;
  maxScore: number;
  topicDescription: string;
}

export interface LmsStudentAttemptContract {
  attemptId: string;              // e.g. "att_20260928_6343283_1293138"
  testingNo?: string;             // LMS Attempt Session ID (from app submission)
  pNo: string;                    // Foreign Key -> LmsTestPaperContract.pNo (e.g. "6343283")
  studentId: StudentId;
  studentName: string;
  enrolledGroup: ClassGroupId;
  sessionDate: string;            // YYYY-MM-DD
  submittedAt: string;            // ISO 8601
  timeSpentMinutes: number;
  submissionMethod: 'academy_app' | 'paper_omr' | 'teacher_direct';
  
  // Verification flags
  isVerifiedLive: boolean;        // FALSE if synthetic or pending teacher confirmation
  verificationStatus: VerificationStatus;
  dataSource: LmsDataSource;

  // Score data (Strictly nullable if pending verification)
  score: number | null;
  totalQuestions: number;
  correctCount: number | null;
  wrongCount: number | null;
  percentage: number | null;
  wrongItemNumbers: number[];
  itemOutcomes: LmsItemAttemptOutcome[];

  deviceInfo?: string;
  teacherNotes?: string;
  checksum: string;
}

// ============================================================================
// 5. Prestudy Video Contract
// ============================================================================

export interface LmsPrestudyVideoContract {
  studentId: StudentId;
  studentName: string;
  courseSeq: string;
  baselineDate: string;           // Resolved homework date (e.g. "2026-09-25")
  homeworkScope: string;          // e.g. "가우스플러스 p.71~p.89"
  videoRequired: boolean;
  uploadStatus: 'uploaded' | 'missing' | 'unverified' | 'exempt';
  uploadedAt?: string;
  videoTitle?: string;
  qualityStatus?: 'approved' | 'needs_reupload' | 'pending_review';
  provenance: LmsDataSource;
  isVerifiedLive: boolean;
}
