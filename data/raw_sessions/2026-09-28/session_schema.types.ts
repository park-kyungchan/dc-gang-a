/**
 * 2026-09-28 15:00 수업 실무 관찰 세션 Typed 스키마 정의
 * Prose Drift(자연어 표류) 방지를 위한 엄격한 타입 모델
 */

export type StudentId = string & {};
export type ClassGroupId = '1' | '2' | '3' | '4'; // 1: 화목2부, 2: 월수1부, 3: 월금1부, 4: 수금2부

export type PhysicalPossession = 'teacher' | 'student' | 'unconfirmed';
export type InspectionStatus = 'pending' | 'in_progress' | 'completed_100%' | 'incomplete' | 'holding_by_student';

export interface BookTaskState {
  bookTitle: string;
  bookRole: 'primary' | 'secondary' | 'supplementary';
  assignedRange: string;
  physicalPossession: PhysicalPossession;
  inspectionStatus: InspectionStatus;
  completionRatePercent: number | null;
  note?: string;
}

export interface BufferTask {
  assignedAt: string; // ISO or HH:mm
  bookTitle: string;
  scope: string;
  purpose: 'homework_inspection_waiting' | 'uncompleted_homework_makeup' | 'regular_curriculum';
  status: 'assigned' | 'in_progress' | 'completed';
}

export interface AttendanceRecord {
  scheduledTime: string; // '15:00'
  actualArrivalTime: string | null; // e.g. '15:15'
  status: 'present_on_time' | 'late_notified' | 'late_unnotified' | 'absent';
  delayMinutes: number;
  reason?: string;
  advanceNotificationReceived: boolean;
}

export interface AbsenceMakeupChain {
  absenceDate: string; // YYYY-MM-DD
  absenceReason: string;
  makeupDate: string; // YYYY-MM-DD
  originalTeacher: string;
  substituteTeacher: string | null; // e.g. '김예원T'
  status: 'scheduled' | 'completed' | 'cancelled';
  handoffNotes: string[];
}

export interface ConceptBlankTestState {
  bookTitle: string;
  scope: string;
  sourceHomeworkDate: string; // 도메인 불변 규칙: 직전 숙제 일자
  status: 'idle' | 'preparing' | 'testing' | 'passed' | 're_test';
}

export interface TimedAssessmentState {
  assessmentName: string;
  bookTitle: string;
  scope: string;
  timeLimitMinutes: number;
  scheduledStartTime: string;
  scheduledEndTime?: string;
  status: 'scheduled_in_5_min' | 'in_progress' | 'completed' | 'graded';
  origin?: string;
  syncGroup?: string;
  physicalPossession: PhysicalPossession;
  score?: number | null;
  totalQuestions?: number | null;
}

export interface CancelledTaskState {
  bookTitle: string;
  scope: string;
  cancelledAt: string;
  reason: string;
}

export interface StudentSessionState {
  studentId: StudentId;
  name: string;
  schoolGrade: string;
  enrolledGroup: string;
  courseSeq: string;
  cmSeq: string;
  attendance: AttendanceRecord;
  books: Record<string, BookTaskState>;
  currentBufferTask?: BufferTask;
  activeTimedAssessment?: TimedAssessmentState;
  cancelledTask?: CancelledTaskState;
  conceptTest?: ConceptBlankTestState;
  makeupChains: AbsenceMakeupChain[];
}

export interface AuditTrailLog {
  timestamp: string;
  author: string;
  targetStudentId: StudentId;
  targetDate: string;
  field: string;
  previousValue: any;
  overriddenValue: any;
  reason: string;
}

export interface SessionStateSnapshot {
  sessionDate: '2026-09-28';
  classStartTime: '15:00';
  lastUpdatedAt: string;
  teacher: {
    teacherId: string;
    name: string;
  };
  students: Record<StudentId, StudentSessionState>;
  auditTrail: AuditTrailLog[];
}
