import { describe, expect, test } from 'bun:test';
import {
  LeadRoutingError,
  loadPilotScope,
  pilotBrief,
  planFact,
  readCoverageSummary,
  validatePilotScope,
} from '../../harness/lead';

describe('date-scoped lead routing', () => {
  const scope = loadPilotScope();

  test('consumes teacher-confirmed pilot facts without promoting LMS coverage', () => {
    const brief = pilotBrief(scope);
    expect(brief.students.map(student => student.groupId)).toEqual(['4', '5']);
    expect(brief.students[0].previousHeldLessonDate).toBe('2026-09-23');
    expect(brief.students[1].homeworkExactPageQuestionRange).toBe('unverified');
    expect(brief.coverage).toBe('teacher_confirmed_scope_lms_completeness_unverified');
  });

  test('allows only the reviewed current or teacher-confirmed historical DayRecord scope', () => {
    const current = planFact('day_record', '1294174', '2026-09-30', scope);
    expect(current.routeEffects).toEqual([{
      id: 'day_record_read', semanticEffect: 'read', safeToProbe: false,
    }]);
    expect(current.execution).toBe('none');
    const historical = planFact('day_record', '1294174', '2026-09-23', scope);
    expect(historical.historicalGroupBinding).toBe('unverified');
    expect(() => planFact('day_record', '1294575', '2026-09-23', scope)).toThrow(LeadRoutingError);
  });

  test('blocks unknown-effect app facts and out-of-scope subjects', () => {
    const plan = planFact('prestudy_upload', '1294575', '2026-09-30', scope);
    expect(plan.status).toBe('blocked');
    expect(plan.routeEffects.every(route => route.semanticEffect === 'unknown')).toBe(true);
    expect(plan.execution).toBe('none');
    expect(plan.nextSafeInvestigation.surface).toBe('teacher_web_Chrome_DevTools');
    expect(plan.nextSafeInvestigation.stopCondition).toContain('must not be probed');
    const assessment = planFact('assessment_results', '1294174', '2026-09-30', scope);
    expect(assessment.status).toBe('blocked');
    expect(assessment.routeIds).toEqual(['fa_student_results']);
    expect(() => planFact('prestudy_upload', '1294174', '2026-09-23', scope)).toThrow(LeadRoutingError);
    expect(() => planFact('day_record', '1293032', '2026-09-30', scope)).toThrow(LeadRoutingError);
    expect(() => planFact('not_a_fact', '1294174', '2026-09-30', scope)).toThrow(LeadRoutingError);
  });

  test('fails closed on roster drift or an upgraded homework claim', () => {
    const drift = structuredClone(scope);
    drift.teacherConfirmedStudents[0].groupId = '5';
    expect(() => validatePilotScope(drift)).toThrow(LeadRoutingError);
    const falsePrecision = structuredClone(scope);
    falsePrecision.teacherConfirmedStudents[1].homeworkExactPageQuestionRange = 'verified';
    expect(() => validatePilotScope(falsePrecision)).toThrow(LeadRoutingError);
    const contradicted = structuredClone(scope);
    contradicted.teacherCorrections.priorHeldLessonForIruhan = '2026-09-25';
    expect(() => validatePilotScope(contradicted)).toThrow(LeadRoutingError);
    const swapped = structuredClone(scope);
    swapped.teacherConfirmedStudents[0].previousHeldLessonDate = undefined;
    swapped.teacherConfirmedStudents[1].previousHeldLessonDate = '2026-09-23';
    expect(() => validatePilotScope(swapped)).toThrow(LeadRoutingError);
  });

  test('rejects coordinated omission of teacher-confirmed pilot facts', () => {
    const priorOmission = structuredClone(scope);
    Reflect.deleteProperty(priorOmission.teacherConfirmedStudents[0], 'previousHeldLessonDate');
    Reflect.deleteProperty(priorOmission.teacherConfirmedStudents[0], 'previousHeldLessonStatus');
    Reflect.deleteProperty(priorOmission.teacherCorrections, 'priorHeldLessonForIruhan');
    expect(() => validatePilotScope(priorOmission)).toThrow(LeadRoutingError);

    const entrantOmission = structuredClone(scope);
    Reflect.deleteProperty(entrantOmission.teacherConfirmedStudents[1], 'firstAttendanceDate');
    Reflect.deleteProperty(entrantOmission.teacherConfirmedStudents[1], 'homeworkTeacherDescription');
    Reflect.deleteProperty(entrantOmission.teacherCorrections, 'leeHyunseungFirstAttendance');
    Reflect.deleteProperty(entrantOmission.teacherCorrections, 'leeHyunseungHomework');
    expect(() => validatePilotScope(entrantOmission)).toThrow(LeadRoutingError);
  });

  test('reports actual bounded read coverage without counting site shells as student adapters', () => {
    const coverage = readCoverageSummary(scope);
    expect(coverage.canonicalOperations).toBe(54);
    expect(coverage.boundedStudentReadContracts).toEqual(['day_record']);
    expect(coverage.servletReadStateCounts.fixed_page_shell).toBe(19);
    expect(coverage.nativeAppStudentReadContract).toBe('unverified');
  });
});
