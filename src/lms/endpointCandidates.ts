/** Static source candidates only. Never a request allowlist; no credentials or student values. */
export interface SourceEndpointCandidate {
  id: string;
  family: string;
  operation: string;
  method: 'GET' | 'POST' | null;
  routeTemplate: string;
  semanticEffect: 'unknown' | 'write';
  candidateKeyNames: string[];
  sourceRefs: string[];
  caveat: string;
}

const endpointSource = 'lms-automation/ganga/lms/endpoints.py';
const source = (id: string, family: string, path: string, operation: string, line: string,
  keys: string[] = [], method: SourceEndpointCandidate['method'] = 'GET',
  effect: SourceEndpointCandidate['semanticEffect'] = 'unknown',
  caveat = 'Historical declaration; current method, effect, ownership, response binding and coverage unverified.',
): SourceEndpointCandidate => ({
  id: `candidate:${id}`, family, routeTemplate: path, operation, method, semanticEffect: effect,
  candidateKeyNames: keys, sourceRefs: [`${endpointSource}:${line}`], caveat,
});

/** Duplicate operations in different source families remain separate evidence, not aliases. */
export function sourceEndpointCandidates(): SourceEndpointCandidate[] {
  const cct = '/servlet/controller.cct.tutor';
  const base = '/servlet/controller.tutor.base';
  const cm = '/servlet/controller.coursemanage.CourseManageServlet';
  const rows: SourceEndpointCandidate[] = [
    ...['BaseManageIndex', 'DAIndex', 'FAIndex', 'NAIndex', 'TestPoolIndex', 'CommunityMainIndex'].map(op =>
      source(`menu_${op}`, 'navigation', `/servlet/controller.tutor.TutorMenuIndexServlet?p_process=${op}`, op, '50-59')),
    source('day_record_by_date', 'lesson', `${cct}.DayRecordServlet?p_process=DaysMain`, 'DaysMain', '80-83', ['date', 'teacherKey', 'groupKey']),
    source('course_members', 'enrollment', `${cct}.CourseMemberServlet?p_process=Main`, 'Main', '84-86', ['teacherKey', 'studentKey', 'courseKey']),
    source('counsel', 'counseling', '/counsel/csl_student_list.jsp', 'page', '90-92', ['teacherKey', 'studentKey']),
    source('learning_results', 'assessment', `${base}.TestPageListServlet?p_process=Main`, 'Main', '101-105', ['studentKey', 'paperKey', 'attemptKey']),
    source('course_lookup', 'curriculum', `${cm}?reqCmd=CourseStudyManager`, 'CourseStudyManager', '122', ['courseKey']),
    source('paper_history', 'paper', '/servlet/controller.tutor.etest.TestPoolServlet?reqCmd=LogViewList', 'LogViewList', '142-146', ['teacherKey', 'paperKey', 'page']),
    source('paper_create', 'paper', '/common/etest_pool.jsp', 'create', '145', [], 'GET', 'write', 'Creation screen; excluded from any read discovery/probe.'),
    source('roster_search', 'identity', `${base}.UserSearchServlet?p_process=Main`, 'Main', '224-230',
      ['grp_no', 'p_pageno', 'grade_no', 'cls_no', 'name', 'status', 'lecture_status', 'login_status'], 'POST', 'unknown',
      'Declared POST conflicts with legacy GET alias; historical reader fetches branch-wide records before filtering. Verify Park ownership before collection; 10-row sliding pagination.'),
    source('student_approval', 'identity', `${base}.UserClsManageServlet?p_process=Main`, 'Main', '232-233', [], 'GET', 'write', 'Approval/class-assignment screen; not a read contract.'),
    source('device_certificate', 'device', `${base}.UserSearchServlet?p_process=GetCertificateMain`, 'GetCertificateMain', '234-235', ['studentKey']),
    source('book_orders', 'book_order', '/servlet/controller.bookorder.tutor.PreOrderServlet?p_process=ClgMain', 'ClgMain', '236-238', ['teacherKey', 'studentKey', 'orderKey']),
  ];
  for (const kind of ['fa', 'na', 'da']) {
    const prefix = `/servlet/controller.tutor.${kind}`;
    rows.push(
      source(`${kind}_paper_list`, 'assessment', `${prefix}.${kind === 'na' ? 'TestPageListOurclgServlet' : 'TestPageListGrpServlet'}?p_process=Main`, 'Main', '168-182', ['paperKey', 'teacherKey', 'page']),
      source(`${kind}_exam_results`, 'assessment', `${prefix}.TestPageListServlet`, 'unverified', '183-184', ['paperKey', 'attemptKey', 'studentKey', 'page']),
      source(`${kind}_period_results`, 'assessment', `${prefix}.MarksResultDigestServlet?p_process=Main`, 'Main', '185-186', ['studentKey', 'fromDate', 'toDate', 'page']),
      source(`${kind}_paper_create`, 'assessment', `${prefix}.TestPageRegServlet?p_process=Auto`, 'Auto', '180-181', [], 'GET', 'write', 'Paper creation; never a read probe.'),
    );
  }
  rows.push(
    source('grading_helper', 'assessment', '/servlet/controller.tutor.na.TestPageRegServlet?p_process=NonePaper', 'NonePaper', '193-198', [], 'GET', 'write', 'Grade entry screen; excluded from reads.'),
    source('diagnostic_papers', 'assessment', '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestPaperList', 'TestPaperList', '199-203', ['paperKey', 'page']),
    source('diagnostic_results', 'assessment', '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestResultList', 'TestResultList', '204-207', ['studentKey', 'attemptKey', 'page']),
  );
  const legacy = (id: string, path: string, op: string, method: 'GET' | 'POST', symbol: string, effect: 'unknown' | 'write' = 'unknown') => ({
    ...source(id, 'assessment', path, op, '', ['studentKey', 'paperKey', 'attemptKey'], method, effect),
    // Symbol anchors survive validation helpers being inserted before this preserved map.
    sourceRefs: [`src/lms/lmsRouteRegistry.ts#legacyRoutes/${symbol}`],
    caveat: 'Preserved legacy candidate, excluded from canonical lookup and live requests; its former safe flag is not evidence.',
  });
  rows.push(
    legacy('assessment_search', `${base}.TestPageListServlet?p_process=UserBySearchTestResult`, 'UserBySearchTestResult', 'POST', 'FA_USER_SEARCH_RESULT'),
    legacy('fa_pupil_detail', '/servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch', 'PupilSearch', 'GET', 'FA_PUPIL_SEARCH'),
    legacy('na_pupil_detail', '/servlet/controller.tutor.na.TestPageListServlet?p_process=PupilSearch', 'PupilSearch', 'GET', 'NA_PUPIL_SEARCH'),
    legacy('typeset_single', '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingSingleUser', 'getStudyResultSingleTestingSingleUser', 'POST', 'TYPESET_STUDY_RESULT_SINGLE', 'write'),
    legacy('typeset_multi', '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingMultiUser', 'getStudyResultSingleTestingMultiUser', 'POST', 'TYPESET_STUDY_RESULT_MULTI', 'write'),
  );
  for (const [id, path, op, ref] of [
    ['exam_detail', 'unresolved:TestpageSelectExServlet?p_process=GetExamDetail&testing_no={attemptKey}', 'GetExamDetail', 'research/backend-map/app-static.md:23'],
    ['paper_lecture_codes', 'unresolved:TestPageListOurclgServlet?reqCmd=GetLectureCode&p_no={paperKey}', 'GetLectureCode', 'research/backend-map/learning-assessment.md:46'],
    ['paper_items', 'unresolved:TestpageSelectExServlet?p_process=getTestExamList&p_no={paperKey}', 'getTestExamList', 'research/backend-map/learning-assessment.md:46'],
    ['smartbook_by_name', '/servlet/controller.tutor.wb.WbTeachList1Servlet', 'SmartBookResultSearchByName', 'research/backend-map/app-static.md:59'],
  ]) rows.push({ ...source(id!, 'assessment', path!, op!, '', ['studentKey', 'paperKey', 'attemptKey'], null), sourceRefs: [ref!],
    caveat: 'Historical documentation/token only; selector placement, method, effect, identity and pagination unresolved.' });
  return rows;
}
