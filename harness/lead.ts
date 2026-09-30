#!/usr/bin/env bun
/** Date-scoped, read-only lead routing. This module never calls the academy or a Sheet. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getGroup, getStudentById } from '../src/canonical/canonicalEntities';
import { getRoute } from '../src/lms/lmsRouteRegistry';
import { getSiteInventory } from '../src/lms/siteReadContracts';

export type Fact = keyof typeof FACT_ROUTES;
const FACT_ROUTES = {
  class_schedule: ['course_schedule'],
  day_record: ['day_record_read'],
  previous_homework: ['course_schedule', 'day_record_read'],
  prestudy_upload: ['prestudy_waiting_search', 'prestudy_completed_search'],
  problem_attempts: ['smartbook_result_search'],
  automatic_grading: ['smartbook_result_search'],
  assessment_results: ['fa_student_results'],
  wrong_answer_video: ['video_lookup'],
  textbook_samples: ['textbook_main', 'textbook_answer_catalog', 'textbook_sample_pdf'],
  page_progress: ['day_record_read'],
  weekly_plan: ['course_schedule', 'day_record_read', 'textbook_main', 'smartbook_result_search'],
  report_preview: ['daily_report_preview'],
} as const;

const FACT_BLOCKERS: Partial<Record<Fact, string>> = {
  class_schedule: 'schedule_date_status_and_coverage_join_unverified',
  previous_homework: 'previous_occurrence_and_book_assignment_join_unverified',
  prestudy_upload: 'student_submission_join_and_read_effect_unverified',
  problem_attempts: 'app_attempt_join_and_read_effect_unverified',
  automatic_grading: 'attempt_grading_join_unverified',
  assessment_results: 'assessment_student_paper_attempt_join_unverified',
  wrong_answer_video: 'video_lookup_effect_and_correction_join_unverified',
  textbook_samples: 'student_book_assignment_unverified',
  page_progress: 'teacher_page_events_and_question_coverage_unverified',
  weekly_plan: 'calendar_edition_page_audit_and_personal_pace_unverified',
  report_preview: 'report_occurrence_join_unverified',
};

type Investigation = { surface: string; action: string; stopCondition: string };
const NEXT_INVESTIGATION: Record<Fact, Investigation> = {
  class_schedule: { surface: 'teacher_web_LMS', action: 'Verify the date/group schedule and cancellation coverage through a reviewed read contract.', stopCondition: 'No complete date/status/pagination binding.' },
  day_record: { surface: 'existing_scoped_reader', action: 'Use only the existing verified reader with an explicit ephemeral session and exact target; retain observed_row status.', stopCondition: 'No session, response scope, or occurrence binding.' },
  previous_homework: { surface: 'teacher_web_LMS', action: 'Bind the teacher-confirmed prior date to the exact held occurrence, book assignment and DayRecord row.', stopCondition: 'An observed row alone does not prove the previous occurrence or book range.' },
  prestudy_upload: { surface: 'teacher_web_Chrome_DevTools', action: 'Observe the normal teacher UI and bounded passive request shape, then classify effect and student/submission join before any direct read.', stopCondition: 'Unknown-effect route must not be probed.' },
  problem_attempts: { surface: 'teacher_web_Chrome_DevTools', action: 'Observe the normal teacher UI and bounded passive request shape, then verify student/course/attempt and pagination joins.', stopCondition: 'Unknown-effect route must not be probed.' },
  automatic_grading: { surface: 'teacher_web_Chrome_DevTools', action: 'Trace the exact attempt to backend grading result after a reviewed read contract exists.', stopCondition: 'No student/attempt/grading join.' },
  assessment_results: { surface: 'teacher_web_Chrome_DevTools', action: 'Observe the normal result view and bind canonical student, paper and testing attempt before classifying a bounded read.', stopCondition: 'The legacy name-only route is not a reviewed current read contract.' },
  wrong_answer_video: { surface: 'teacher_web_Chrome_DevTools', action: 'Observe the normal video/correction UI and classify the exact request effect before binding media to an attempt.', stopCondition: 'Unknown effect or correction join.' },
  textbook_samples: { surface: 'teacher_web_LMS', action: 'Verify this student’s assigned edition before interpreting the already reviewed sample TOC.', stopCondition: 'No exact student-book assignment or full page/question map.' },
  page_progress: { surface: 'teacher_review', action: 'Capture exact student/book/page observations as append-only input and bind them to an occurrence.', stopCondition: 'No teacher page event or wrong-answer inspection proof.' },
  weekly_plan: { surface: 'teacher_review', action: 'Verify held calendar, edition, complete page audit and personal pace before a review interval.', stopCondition: 'Any prerequisite join remains unknown.' },
  report_preview: { surface: 'teacher_web_LMS', action: 'Bind the exact report and occurrence through a reviewed read contract; leave delivery unknown.', stopCondition: 'A preview or send-labelled UI is not delivery evidence.' },
};

type ConfirmedStudent = {
  studentId: string;
  name: string;
  groupId: string;
  previousHeldLessonDate?: string;
  previousHeldLessonStatus?: string;
  firstAttendanceDate?: string;
  homeworkTeacherDescription?: string;
  homeworkExactPageQuestionRange?: string;
};

export type PilotScope = {
  schemaVersion: 1;
  date: string;
  teacherConfirmedGroupIds: string[];
  teacherConfirmedStudents: ConfirmedStudent[];
  appJoinState: string;
  sourceTimestampPolicy: string;
  teacherCorrections: {
    priorHeldLessonForIruhan: string;
    leeHyunseungFirstAttendance: string;
    leeHyunseungHomework: string;
    preclassEvidenceSurface: string;
  };
};

export class LeadRoutingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'LeadRoutingError';
  }
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Independent invariant for the teacher-confirmed 2026-09-30 pilot. The scope
// handoff repeats these facts for routing, but cannot delete both copies and
// silently turn a confirmed answer back into an unknown.
const CONFIRMED_PILOT = Object.freeze({
  date: '2026-09-30',
  priorHeldLessonDate: '2026-09-23',
  firstAttendanceDate: '2026-09-30',
  homeworkDescription: '가우스 1-1-1 첫 소단원만; 정확한 쪽·문항 범위는 미검증',
});

export function validatePilotScope(raw: unknown): PilotScope {
  if (!raw || typeof raw !== 'object') throw new LeadRoutingError('invalid_pilot_scope');
  const scope = raw as PilotScope;
  if (scope.schemaVersion !== 1 || !isDate(scope.date)
      || !Array.isArray(scope.teacherConfirmedGroupIds)
      || !Array.isArray(scope.teacherConfirmedStudents)
      || scope.teacherConfirmedStudents.length === 0
      || scope.appJoinState !== 'unknown') throw new LeadRoutingError('invalid_pilot_scope');

  const groups = new Set<string>();
  for (const id of scope.teacherConfirmedGroupIds) {
    if (typeof id !== 'string' || groups.has(id)) throw new LeadRoutingError('invalid_pilot_groups');
    getGroup(id);
    groups.add(id);
  }
  const students = new Set<string>();
  const coveredGroups = new Set<string>();
  for (const item of scope.teacherConfirmedStudents) {
    if (!item || typeof item.studentId !== 'string' || typeof item.name !== 'string'
        || typeof item.groupId !== 'string' || students.has(item.studentId)) {
      throw new LeadRoutingError('invalid_pilot_students');
    }
    const canonical = getStudentById(item.studentId);
    if (canonical.isTest || canonical.name !== item.name || canonical.groupId !== item.groupId
        || !groups.has(item.groupId)) throw new LeadRoutingError('pilot_roster_drift');
    if (item.previousHeldLessonDate && (!isDate(item.previousHeldLessonDate)
        || item.previousHeldLessonDate >= scope.date
        || item.previousHeldLessonStatus !== 'teacher_confirmed_date_occurrence_unverified')) {
      throw new LeadRoutingError('invalid_previous_lesson_claim');
    }
    if (item.firstAttendanceDate && item.firstAttendanceDate !== scope.date) {
      throw new LeadRoutingError('invalid_first_attendance_claim');
    }
    if (item.homeworkTeacherDescription
        && item.homeworkExactPageQuestionRange !== 'unverified') {
      throw new LeadRoutingError('homework_range_misclassified');
    }
    students.add(item.studentId);
    coveredGroups.add(item.groupId);
  }
  if (coveredGroups.size !== groups.size) throw new LeadRoutingError('pilot_group_without_student');
  const corrections = scope.teacherCorrections;
  const prior = scope.teacherConfirmedStudents.find(item => item.name === '이루한');
  const entrant = scope.teacherConfirmedStudents.find(item => item.name === '이현승');
  if (scope.date !== CONFIRMED_PILOT.date
      || !corrections || !prior || !entrant
      || prior.previousHeldLessonDate !== CONFIRMED_PILOT.priorHeldLessonDate
      || prior.previousHeldLessonStatus !== 'teacher_confirmed_date_occurrence_unverified'
      || entrant.firstAttendanceDate !== CONFIRMED_PILOT.firstAttendanceDate
      || entrant.homeworkTeacherDescription !== CONFIRMED_PILOT.homeworkDescription
      || corrections.priorHeldLessonForIruhan !== prior.previousHeldLessonDate
      || corrections.leeHyunseungFirstAttendance !== entrant.firstAttendanceDate
      || corrections.leeHyunseungHomework !== entrant.homeworkTeacherDescription
      || corrections.preclassEvidenceSurface !== '교사 웹 LMS 읽기 전용 조회를 Main Sheet에 시점별 스냅샷으로 표시') {
    throw new LeadRoutingError('teacher_correction_drift');
  }
  return scope;
}

export function loadPilotScope(): PilotScope {
  const workspace = resolve(import.meta.dir, '..');
  const index = JSON.parse(readFileSync(resolve(workspace, 'handoffs/current-state.json'), 'utf8')) as {
    teacherConfirmedNextClassScope?: { path?: string; date?: string; groupIds?: string[] };
  };
  const pointer = index.teacherConfirmedNextClassScope;
  if (pointer?.path !== 'handoffs/2026-09-30-class-scope.json') {
    throw new LeadRoutingError('pilot_scope_pointer_drift');
  }
  const scope = validatePilotScope(JSON.parse(readFileSync(resolve(workspace, pointer.path), 'utf8')) as unknown);
  if (pointer.date !== scope.date
      || JSON.stringify(pointer.groupIds) !== JSON.stringify(scope.teacherConfirmedGroupIds)) {
    throw new LeadRoutingError('pilot_scope_index_drift');
  }
  return scope;
}

export function pilotBrief(scope = loadPilotScope()) {
  validatePilotScope(scope);
  return {
    date: scope.date,
    source: 'teacher_confirmed_handoff_checked_against_canonical_roster',
    coverage: 'teacher_confirmed_scope_lms_completeness_unverified',
    students: scope.teacherConfirmedStudents.map(item => ({
      studentId: item.studentId,
      name: item.name,
      groupId: item.groupId,
      ...(item.previousHeldLessonDate ? {
        previousHeldLessonDate: item.previousHeldLessonDate,
        previousHeldLessonStatus: item.previousHeldLessonStatus,
      } : {}),
      ...(item.firstAttendanceDate ? { firstAttendanceDate: item.firstAttendanceDate } : {}),
      ...(item.homeworkTeacherDescription ? {
        homeworkTeacherDescription: item.homeworkTeacherDescription,
        homeworkExactPageQuestionRange: item.homeworkExactPageQuestionRange,
      } : {}),
    })),
    evidenceSurface: 'teacher_web_LMS_read_only_as_timestamped_Main_Sheet_snapshot',
    appStudentSubmissionGradingCorrectionJoin: 'unknown',
  };
}

export function planFact(fact: string, studentId: string, date: string, scope = loadPilotScope()) {
  validatePilotScope(scope);
  if (!Object.hasOwn(FACT_ROUTES, fact)) throw new LeadRoutingError('unknown_fact');
  if (!isDate(date)) throw new LeadRoutingError('invalid_date');
  const student = scope.teacherConfirmedStudents.find(item => item.studentId === studentId);
  if (!student) throw new LeadRoutingError('student_outside_confirmed_pilot');
  const typedFact = fact as Fact;
  const historicalDayRecord = typedFact === 'day_record' && date === student.previousHeldLessonDate;
  if (date !== scope.date && !historicalDayRecord) throw new LeadRoutingError('date_scope_unverified');
  const routes = FACT_ROUTES[typedFact].map(id => getRoute(id));
  const dayRecord = routes.find(route => route.id === 'day_record_read');
  if (dayRecord && (dayRecord.semanticEffect !== 'read' || dayRecord.httpMethod !== 'POST'
      || dayRecord.operation !== 'Main'
      || dayRecord.servletPath !== '/servlet/controller.cct.tutor.DayRecordServlet')) {
    throw new LeadRoutingError('day_record_route_drift');
  }
  const readState = typedFact === 'day_record'
    ? 'reviewed_bounded_read_existing_reader_only'
    : FACT_BLOCKERS[typedFact];
  return {
    status: typedFact === 'day_record' ? 'read_contract_available' : 'blocked',
    fact: typedFact,
    scope: { studentId, date, groupId: student.groupId },
    routeIds: routes.map(route => route.id),
    routeEffects: routes.map(route => ({ id: route.id, semanticEffect: route.semanticEffect,
      safeToProbe: route.safeToProbe })),
    readState,
    nextSafeInvestigation: NEXT_INVESTIGATION[typedFact],
    readAdapter: typedFact === 'day_record' ? 'existing_scoped_Python_reader_exception' : null,
    occurrenceBinding: 'unverified',
    historicalGroupBinding: historicalDayRecord ? 'unverified' : 'current_roster_only',
    teacherClaim: typedFact === 'previous_homework' && student.previousHeldLessonDate
      ? { previousHeldLessonDate: student.previousHeldLessonDate,
        status: student.previousHeldLessonStatus } : null,
    execution: 'none',
  };
}

export function readCoverageSummary(scope = loadPilotScope()) {
  validatePilotScope(scope);
  const sample = scope.teacherConfirmedStudents[0];
  const facts = Object.keys(FACT_ROUTES).map(fact => planFact(fact, sample.studentId, scope.date, scope));
  const inventory = getSiteInventory();
  const readStateCounts = Object.fromEntries(
    [...new Set(inventory.servletOperations.map(route => route.readState))].sort()
      .map(state => [state, inventory.servletOperations.filter(route => route.readState === state).length]),
  );
  return {
    scopeDate: scope.date,
    namedFactCount: facts.length,
    boundedStudentReadContracts: facts.filter(fact => fact.status === 'read_contract_available').map(fact => fact.fact),
    blockedFacts: facts.filter(fact => fact.status === 'blocked').map(fact => ({ fact: fact.fact, reason: fact.readState })),
    canonicalOperations: inventory.servletOperations.length + inventory.outsideServlet.length,
    servletReadStateCounts: readStateCounts,
    nativeAppStudentReadContract: 'unverified',
    directProductionDatabaseReader: 'unverified',
    excludedLegacyPaths: ['scripts/query_lms_student_assessment.ts', 'src/lms/lmsLiveQueryService.ts'],
    conclusion: 'not_sufficient_for_arbitrary_student_site_or_app_read',
  };
}

export function runLeadCli(args = process.argv.slice(2)): number {
  try {
    const [command, ...rest] = args;
    if (!['pilot', 'plan', 'coverage'].includes(command ?? '')) throw new LeadRoutingError('invalid_command');
    const flags = new Map<string, string>();
    for (let index = 0; index < rest.length; index++) {
      const flag = rest[index];
      if (flag === '--json') { flags.set('json', 'true'); continue; }
      if (!['--date', '--fact', '--student-id'].includes(flag) || !rest[index + 1]
          || rest[index + 1].startsWith('--') || flags.has(flag.slice(2))) {
        throw new LeadRoutingError('invalid_arguments');
      }
      flags.set(flag.slice(2), rest[++index]);
    }
    const scope = loadPilotScope();
    const date = flags.get('date') ?? scope.date;
    if ((command === 'pilot' || command === 'coverage') && (flags.has('fact') || flags.has('student-id'))) {
      throw new LeadRoutingError('invalid_arguments');
    }
    if (command !== 'plan' && date !== scope.date) throw new LeadRoutingError('date_scope_unverified');
    if (command === 'plan' && (!flags.has('fact') || !flags.has('student-id'))) {
      throw new LeadRoutingError('invalid_arguments');
    }
    const result = command === 'pilot' ? pilotBrief(scope)
      : command === 'coverage' ? readCoverageSummary(scope)
      : planFact(flags.get('fact')!, flags.get('student-id')!, date, scope);
    process.stdout.write(JSON.stringify(result, null, flags.has('json') ? 0 : 2) + '\n');
    return 0;
  } catch (error) {
    const code = error instanceof LeadRoutingError ? error.code : 'scope_or_route_validation_failed';
    process.stderr.write(JSON.stringify({ ok: false, code }) + '\n');
    return 1;
  }
}

if (import.meta.main) process.exit(runLeadCli());
