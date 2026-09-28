/**
 * LMS Full Route Tree Map & Endpoint Schema Registry.
 * 
 * Safety & Invariants (AGENTS.md Compliance):
 * 1. Categorizes all known endpoints into READ_ONLY (safe) vs MUTATING (requires approval).
 * 2. Provides deterministic URL and parameter builders for all 7 major tutor menus:
 *    - BaseManageIndex: User / Pad / Class Group Management
 *    - FAIndex: Formation Assessment (대단원 총괄평가, 단원평가, 클리닉 조판)
 *    - NAIndex: Ad-hoc Assessment (Daily Test, Zero Test)
 *    - DAIndex: Diagnostic Assessment (학력인증평가, 진단평가)
 *    - TestPoolIndex: Question Pool & Paper Generator
 *    - CourseMainIndex: Lesson Logs & Student Progress
 *    - CourseManageIndex: Classroom & Course Schedule Management
 * 3. Fail-Closed: Blocks uncataloged or mutating requests unless explicitly flagged.
 */

export type LmsEndpointEffect = 'READ_ONLY' | 'MUTATING' | 'TYPESET_READ';

export interface LmsRouteDefinition {
  routeId: string;
  category: string;
  servletPath: string;
  processName: string;
  httpMethod: 'GET' | 'POST';
  effect: LmsEndpointEffect;
  description: string;
  requiredParams: string[];
  optionalParams: string[];
  responseFormat: 'HTML' | 'JSON' | 'EXTERN_DIALOG_HTML';
}

export class LmsRouteRegistry {
  private static readonly routes: Map<string, LmsRouteDefinition> = new Map([
    // =========================================================================
    // 1. FAIndex: 형성평가 (Grand Chapter / Unit Assessment / Clinic)
    // =========================================================================
    [
      'FA_USER_SEARCH_RESULT',
      {
        routeId: 'FA_USER_SEARCH_RESULT',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.base.TestPageListServlet',
        processName: 'UserBySearchTestResult',
        httpMethod: 'POST',
        effect: 'READ_ONLY',
        description: '학생별 기간/단원 총괄평가 응시 결과 목록 조회 (EXTERN_DIALOG 반환)',
        requiredParams: ['clg_no', 'cls_no', 'stu_name', 'sort_date1', 'sort_date2'],
        optionalParams: ['check_fa_test', 'p_pageno', 'checkAllPage'],
        responseFormat: 'EXTERN_DIALOG_HTML'
      }
    ],
    [
      'FA_PUPIL_SEARCH',
      {
        routeId: 'FA_PUPIL_SEARCH',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.fa.TestPageListServlet',
        processName: 'PupilSearch',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '시험지 문항별 채점 결과 및 학생 답안 상세 조회',
        requiredParams: ['testing_no', 'p_no', 'o_questions'],
        optionalParams: ['apply_flg', 'no_apply_flg', 'paper_type', 'testing_name', 'grade_name', 'subject_name', 'hang_date', 'use_term'],
        responseFormat: 'HTML'
      }
    ],
    [
      'TYPESET_STUDY_RESULT_SINGLE',
      {
        routeId: 'TYPESET_STUDY_RESULT_SINGLE',
        category: 'FAIndex',
        servletPath: '/servlet/controller.common.TestpageSelectExServlet',
        processName: 'getStudyResultSingleTestingSingleUser',
        httpMethod: 'POST',
        effect: 'TYPESET_READ',
        description: '오답 클리닉지 및 유형별 유사문제 클리닉지 조판/인쇄 데이터 생성',
        requiredParams: ['condition'],
        optionalParams: [],
        responseFormat: 'JSON'
      }
    ],
    [
      'TYPESET_STUDY_RESULT_MULTI',
      {
        routeId: 'TYPESET_STUDY_RESULT_MULTI',
        category: 'FAIndex',
        servletPath: '/servlet/controller.common.TestpageSelectExServlet',
        processName: 'getStudyResultSingleTestingMultiUser',
        httpMethod: 'POST',
        effect: 'TYPESET_READ',
        description: '다중 학생 일괄 오답/유사문제 클리닉지 조판 데이터 생성',
        requiredParams: ['condition'],
        optionalParams: [],
        responseFormat: 'JSON'
      }
    ],
    [
      'FA_TEST_PAPER_LIST_GRP',
      {
        routeId: 'FA_TEST_PAPER_LIST_GRP',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.fa.TestPageListGrpServlet',
        processName: 'Main',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '형성평가 시험지 목록 및 출제 현황 조회',
        requiredParams: [],
        optionalParams: ['p_pageno', 'grade_no', 'term_no'],
        responseFormat: 'HTML'
      }
    ],

    // =========================================================================
    // 2. NAIndex: 수시평가 (Daily Test, Zero Test)
    // =========================================================================
    [
      'NA_USER_SEARCH_RESULT',
      {
        routeId: 'NA_USER_SEARCH_RESULT',
        category: 'NAIndex',
        servletPath: '/servlet/controller.tutor.base.TestPageListServlet',
        processName: 'UserBySearchTestResult&ass_no=1002',
        httpMethod: 'POST',
        effect: 'READ_ONLY',
        description: '수시평가(Daily Test / Zero Test) 학생별 응시 결과 목록 조회',
        requiredParams: ['clg_no', 'stu_name', 'sort_date1', 'sort_date2'],
        optionalParams: ['p_pageno', 'checkAllPage'],
        responseFormat: 'EXTERN_DIALOG_HTML'
      }
    ],
    [
      'NA_PUPIL_SEARCH',
      {
        routeId: 'NA_PUPIL_SEARCH',
        category: 'NAIndex',
        servletPath: '/servlet/controller.tutor.na.TestPageListServlet',
        processName: 'PupilSearch',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '수시평가 문항별 상세 채점 결과 조회',
        requiredParams: ['testing_no', 'p_no', 'test_no'],
        optionalParams: ['paper_type', 'testing_name'],
        responseFormat: 'HTML'
      }
    ],

    // =========================================================================
    // 3. DAIndex: 학력인증평가 / 진단평가
    // =========================================================================
    [
      'DA_DIAGNOST_LIST',
      {
        routeId: 'DA_DIAGNOST_LIST',
        category: 'DAIndex',
        servletPath: '/servlet/controller.tutor.diag.DiagnostManageServlet',
        processName: 'TestPaperList',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '진단평가 시험지 목록 조회',
        requiredParams: ['reqCmd'],
        optionalParams: ['grade_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'DA_DIAGNOST_RESULT_LIST',
      {
        routeId: 'DA_DIAGNOST_RESULT_LIST',
        category: 'DAIndex',
        servletPath: '/servlet/controller.tutor.diag.DiagnostManageServlet',
        processName: 'TestResultList',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '진단평가 응시 결과 목록 조회',
        requiredParams: ['reqCmd'],
        optionalParams: ['student_name', 'date'],
        responseFormat: 'HTML'
      }
    ],

    // =========================================================================
    // 4. BaseManageIndex: 사용자 / 반 / 태블릿 관리
    // =========================================================================
    [
      'BASE_USER_SEARCH',
      {
        routeId: 'BASE_USER_SEARCH',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserSearchServlet',
        processName: 'Main',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '원생 목록 및 상세 정보 검색',
        requiredParams: [],
        optionalParams: ['stu_name', 'grade_no', 'cls_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'BASE_USER_CLS_MANAGE',
      {
        routeId: 'BASE_USER_CLS_MANAGE',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserClsManageServlet',
        processName: 'Main',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '학생 승인 및 반편성 현황 조회',
        requiredParams: [],
        optionalParams: ['cls_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'BASE_PAD_CERTIFICATE',
      {
        routeId: 'BASE_PAD_CERTIFICATE',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserSearchServlet',
        processName: 'GetCertificateMain',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '학원 학습패드(태블릿) 등록 및 인증 기기 현황 조회',
        requiredParams: [],
        optionalParams: [],
        responseFormat: 'HTML'
      }
    ],

    // =========================================================================
    // 5. CourseMainIndex: 학습일지 및 학생 출석/진도
    // =========================================================================
    [
      'COURSE_MAIN_INDEX',
      {
        routeId: 'COURSE_MAIN_INDEX',
        category: 'CourseMainIndex',
        servletPath: '/servlet/controller.tutor.TutorMenuIndexServlet',
        processName: 'CourseMainIndex',
        httpMethod: 'GET',
        effect: 'READ_ONLY',
        description: '학습관리 메인 대시보드 및 학습일지 진입 라우트',
        requiredParams: [],
        optionalParams: [],
        responseFormat: 'HTML'
      }
    ]
  ]);

  /**
   * Retrieves route definition by canonical route ID.
   */
  public static getRoute(routeId: string): LmsRouteDefinition {
    const route = this.routes.get(routeId);
    if (!route) {
      throw new Error(`[LmsRouteRegistry] Unknown routeId: ${routeId}`);
    }
    return { ...route };
  }

  /**
   * Lists all cataloged routes, optionally filtered by category or effect.
   */
  public static listRoutes(filter?: { category?: string; effect?: LmsEndpointEffect }): LmsRouteDefinition[] {
    let all = Array.from(this.routes.values());
    if (filter?.category) {
      all = all.filter(r => r.category === filter.category);
    }
    if (filter?.effect) {
      all = all.filter(r => r.effect === filter.effect);
    }
    return all.map(r => ({ ...r }));
  }

  /**
   * Builds full URL and request body for a route, validating required parameters.
   */
  public static buildRequest(routeId: string, params: Record<string, string | number>, baseUrl: string = 'https://dc.gang-a.kr'): {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
  } {
    const route = this.getRoute(routeId);

    // Validate required parameters
    for (const req of route.requiredParams) {
      if (params[req] === undefined || params[req] === null || String(params[req]).trim() === '') {
        throw new Error(`[LmsRouteRegistry] Missing required parameter "${req}" for route "${routeId}"`);
      }
    }

    if (route.httpMethod === 'GET') {
      const queryParams = new URLSearchParams();
      if (route.processName) {
        queryParams.set('p_process', route.processName);
      }
      for (const [k, v] of Object.entries(params)) {
        queryParams.set(k, String(v));
      }
      const url = `${baseUrl}${route.servletPath}?${queryParams.toString()}`;
      return {
        url,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      };
    } else {
      const url = route.processName 
        ? `${baseUrl}${route.servletPath}?p_process=${route.processName}`
        : `${baseUrl}${route.servletPath}`;

      const formBody = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        formBody.set(k, String(v));
      }

      return {
        url,
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formBody.toString()
      };
    }
  }

  /**
   * Safety Guard: Throws error if an endpoint is marked as MUTATING in pure read mode.
   */
  public static assertSafeRead(routeId: string): void {
    const route = this.getRoute(routeId);
    if (route.effect === 'MUTATING') {
      throw new Error(`[LmsRouteRegistry: SAFETY VIOLATION] Attempted to invoke MUTATING route "${routeId}" in read-only harness.`);
    }
  }
}
