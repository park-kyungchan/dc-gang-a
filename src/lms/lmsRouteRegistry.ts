/**
 * LMS Full Route Tree Map & Endpoint Schema Registry.
 * 
 * Safety & Invariants (AGENTS.md & Phase 2 Harness Optimization Compliance):
 * 1. Single Source of Truth (SSoT): Dynamically loads and validates canonical
 *    LMS operations from research/backend-map/route-registry.json.
 * 2. Cwd-Independent Path Resolution: Anchored strictly via resolveModuleDir() / import.meta.dir.
 * 3. HTTP Method Safety Fallacy Guard (TRAP 1): NEVER rely on httpMethod === 'GET' for read safety!
 *    Mutating GET endpoints (day_record_udtprg, day_record_udthw, day_record_udtmemo,
 *    day_record_udtattn, similar_paper_create) are strictly blocked by assertSafeRead().
 * 4. Fail-Closed: assertSafeRead() throws UnsafeMutatingOperationError for any endpoint
 *    where semantic_effect !== 'read' or safe_to_probe !== true.
 * 5. Dual-Runtime Parity: 1:1 structural and behavioral parity with harness/routes.py.
 * 6. Legacy route declarations are historical source candidates only. Public lookup,
 *    safety checks, and request construction use the canonical registry exclusively.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export class UnsafeMutatingOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeMutatingOperationError';
    Object.setPrototypeOf(this, UnsafeMutatingOperationError.prototype);
  }
}

export class RouteLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RouteLookupError';
    Object.setPrototypeOf(this, RouteLookupError.prototype);
  }
}

export type LmsEndpointEffect =
  | 'READ_ONLY'
  | 'MUTATING'
  | 'TYPESET_READ'
  | 'read'
  | 'write'
  | 'send'
  | 'open_send_screen'
  | 'unknown';

export interface LmsRouteDefinition {
  // Canonical backend-map fields
  readonly id: string;
  readonly routeTemplate: string;
  readonly operation: string;
  readonly httpMethod: 'GET' | 'POST' | null;
  readonly semanticEffect: 'read' | 'write' | 'send' | 'open_send_screen' | 'unknown';
  readonly evidenceGrade: string;
  readonly evidenceDate: string;
  readonly joinKeyNames: readonly string[];
  readonly safeToProbe: boolean;
  readonly reason: string;
  readonly sourceRefs: readonly string[];

  // Snake_case aliases matching route-registry.json schema directly
  readonly route_template: string;
  readonly http_method: 'GET' | 'POST' | null;
  readonly semantic_effect: 'read' | 'write' | 'send' | 'open_send_screen' | 'unknown';
  readonly evidence_grade: string;
  readonly evidence_date: string;
  readonly join_key_names: readonly string[];
  readonly safe_to_probe: boolean;
  readonly source_refs: readonly string[];

  // Legacy helper and compatibility fields
  readonly routeId: string;
  readonly category: string;
  readonly servletPath: string;
  readonly processName: string;
  readonly effect: LmsEndpointEffect;
  readonly description: string;
  readonly requiredParams: readonly string[];
  readonly optionalParams: readonly string[];
  readonly responseFormat: 'HTML' | 'JSON' | 'EXTERN_DIALOG_HTML';
}

interface RawRegistryEntry {
  id: string;
  route_template: string;
  operation: string;
  http_method: string | null;
  semantic_effect: string;
  evidence_grade: string;
  evidence_date: string;
  join_key_names: string[];
  safe_to_probe: boolean;
  reason: string;
  source_refs: string[];
}

interface RawRegistryData {
  schema_version: string;
  as_of: string;
  scope: string;
  evidence_legend?: Record<string, string>;
  entries: RawRegistryEntry[];
}

/** Validate the entire catalog before populating lookup state. Cardinality is not a schema. */
export function validateCanonicalRegistry(raw: unknown): RawRegistryData {
  const value = raw as RawRegistryData | null;
  if (!value || !Array.isArray(value.entries) || value.entries.length === 0) {
    throw new Error('invalid_route_registry_entries');
  }
  const ids = new Set<string>();
  const text = (x: unknown): x is string => typeof x === 'string' && x.trim().length > 0;
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(text);
  for (const entry of value.entries) {
    if (!entry || !text(entry.id) || ids.has(entry.id)
      || !text(entry.operation) || !text(entry.route_template)
      || !['GET', 'POST', null].includes(entry.http_method)
      || !['read', 'write', 'send', 'open_send_screen', 'unknown'].includes(entry.semantic_effect)
      || typeof entry.safe_to_probe !== 'boolean'
      || (entry.safe_to_probe && entry.semantic_effect !== 'read')
      || !strings(entry.join_key_names) || !strings(entry.source_refs)
      || !text(entry.evidence_grade) || !text(entry.evidence_date) || !text(entry.reason)) {
      // Do not echo raw entries: future source metadata may contain sensitive values.
      throw new Error('invalid_or_duplicate_route_registry_entry');
    }
    ids.add(entry.id);
  }
  return structuredClone(value);
}

/**
 * Robust cross-runtime directory resolution.
 * Anchors paths to the physical file location, immune to process.cwd() drift.
 */
function resolveModuleDir(): string {
  if (typeof import.meta !== 'undefined' && import.meta.dir) {
    return import.meta.dir;
  }
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return dirname(fileURLToPath(import.meta.url));
  }
  return __dirname;
}

export const ROUTE_REGISTRY_PATH = resolve(
  resolveModuleDir(),
  '../../research/backend-map/route-registry.json'
);

export class LmsRouteRegistry {
  private static _initialized = false;
  private static readonly canonicalRoutes: LmsRouteDefinition[] = [];
  private static readonly routesById: Map<string, LmsRouteDefinition> = new Map();
  private static readonly routesByOperation: Map<string, LmsRouteDefinition> = new Map();

  // Historical source candidates. Never expose these through public route APIs.
  private static readonly legacyRoutes: Map<string, LmsRouteDefinition> = new Map([
    [
      'FA_USER_SEARCH_RESULT',
      {
        id: 'FA_USER_SEARCH_RESULT',
        routeId: 'FA_USER_SEARCH_RESULT',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.base.TestPageListServlet',
        processName: 'UserBySearchTestResult',
        httpMethod: 'POST',
        http_method: 'POST',
        routeTemplate: '/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult',
        route_template: '/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult',
        operation: 'UserBySearchTestResult',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '학생별 기간/단원 총괄평가 응시 결과 목록 조회 (EXTERN_DIALOG 반환)',
        reason: '학생별 기간/단원 총괄평가 응시 결과 목록 조회 (EXTERN_DIALOG 반환)',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['clg_no', 'cls_no', 'stu_name', 'sort_date1', 'sort_date2']),
        join_key_names: Object.freeze(['clg_no', 'cls_no', 'stu_name', 'sort_date1', 'sort_date2']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['clg_no', 'cls_no', 'stu_name', 'sort_date1', 'sort_date2'],
        optionalParams: ['check_fa_test', 'p_pageno', 'checkAllPage'],
        responseFormat: 'EXTERN_DIALOG_HTML'
      }
    ],
    [
      'FA_PUPIL_SEARCH',
      {
        id: 'FA_PUPIL_SEARCH',
        routeId: 'FA_PUPIL_SEARCH',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.fa.TestPageListServlet',
        processName: 'PupilSearch',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch',
        route_template: '/servlet/controller.tutor.fa.TestPageListServlet?p_process=PupilSearch',
        operation: 'PupilSearch',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '시험지 문항별 채점 결과 및 학생 답안 상세 조회',
        reason: '시험지 문항별 채점 결과 및 학생 답안 상세 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['testing_no', 'p_no', 'o_questions']),
        join_key_names: Object.freeze(['testing_no', 'p_no', 'o_questions']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['testing_no', 'p_no', 'o_questions'],
        optionalParams: ['apply_flg', 'no_apply_flg', 'paper_type', 'testing_name', 'grade_name', 'subject_name', 'hang_date', 'use_term'],
        responseFormat: 'HTML'
      }
    ],
    [
      'TYPESET_STUDY_RESULT_SINGLE',
      {
        id: 'TYPESET_STUDY_RESULT_SINGLE',
        routeId: 'TYPESET_STUDY_RESULT_SINGLE',
        category: 'FAIndex',
        servletPath: '/servlet/controller.common.TestpageSelectExServlet',
        processName: 'getStudyResultSingleTestingSingleUser',
        httpMethod: 'POST',
        http_method: 'POST',
        routeTemplate: '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingSingleUser',
        route_template: '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingSingleUser',
        operation: 'getStudyResultSingleTestingSingleUser',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'TYPESET_READ',
        description: '오답 클리닉지 및 유형별 유사문제 클리닉지 조판/인쇄 데이터 생성',
        reason: '오답 클리닉지 및 유형별 유사문제 클리닉지 조판/인쇄 데이터 생성',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['condition']),
        join_key_names: Object.freeze(['condition']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['condition'],
        optionalParams: [],
        responseFormat: 'JSON'
      }
    ],
    [
      'TYPESET_STUDY_RESULT_MULTI',
      {
        id: 'TYPESET_STUDY_RESULT_MULTI',
        routeId: 'TYPESET_STUDY_RESULT_MULTI',
        category: 'FAIndex',
        servletPath: '/servlet/controller.common.TestpageSelectExServlet',
        processName: 'getStudyResultSingleTestingMultiUser',
        httpMethod: 'POST',
        http_method: 'POST',
        routeTemplate: '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingMultiUser',
        route_template: '/servlet/controller.common.TestpageSelectExServlet?p_process=getStudyResultSingleTestingMultiUser',
        operation: 'getStudyResultSingleTestingMultiUser',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'TYPESET_READ',
        description: '다중 학생 일괄 오답/유사문제 클리닉지 조판 데이터 생성',
        reason: '다중 학생 일괄 오답/유사문제 클리닉지 조판 데이터 생성',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['condition']),
        join_key_names: Object.freeze(['condition']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['condition'],
        optionalParams: [],
        responseFormat: 'JSON'
      }
    ],
    [
      'FA_TEST_PAPER_LIST_GRP',
      {
        id: 'FA_TEST_PAPER_LIST_GRP',
        routeId: 'FA_TEST_PAPER_LIST_GRP',
        category: 'FAIndex',
        servletPath: '/servlet/controller.tutor.fa.TestPageListGrpServlet',
        processName: 'Main',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.fa.TestPageListGrpServlet?p_process=Main',
        route_template: '/servlet/controller.tutor.fa.TestPageListGrpServlet?p_process=Main',
        operation: 'Main',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '형성평가 시험지 목록 및 출제 현황 조회',
        reason: '형성평가 시험지 목록 및 출제 현황 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze([]),
        join_key_names: Object.freeze([]),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: [],
        optionalParams: ['p_pageno', 'grade_no', 'term_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'NA_USER_SEARCH_RESULT',
      {
        id: 'NA_USER_SEARCH_RESULT',
        routeId: 'NA_USER_SEARCH_RESULT',
        category: 'NAIndex',
        servletPath: '/servlet/controller.tutor.base.TestPageListServlet',
        processName: 'UserBySearchTestResult&ass_no=1002',
        httpMethod: 'POST',
        http_method: 'POST',
        routeTemplate: '/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1002',
        route_template: '/servlet/controller.tutor.base.TestPageListServlet?p_process=UserBySearchTestResult&ass_no=1002',
        operation: 'UserBySearchTestResult',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '수시평가(Daily Test / Zero Test) 학생별 응시 결과 목록 조회',
        reason: '수시평가(Daily Test / Zero Test) 학생별 응시 결과 목록 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['clg_no', 'stu_name', 'sort_date1', 'sort_date2']),
        join_key_names: Object.freeze(['clg_no', 'stu_name', 'sort_date1', 'sort_date2']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['clg_no', 'stu_name', 'sort_date1', 'sort_date2'],
        optionalParams: ['p_pageno', 'checkAllPage'],
        responseFormat: 'EXTERN_DIALOG_HTML'
      }
    ],
    [
      'NA_PUPIL_SEARCH',
      {
        id: 'NA_PUPIL_SEARCH',
        routeId: 'NA_PUPIL_SEARCH',
        category: 'NAIndex',
        servletPath: '/servlet/controller.tutor.na.TestPageListServlet',
        processName: 'PupilSearch',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.na.TestPageListServlet?p_process=PupilSearch',
        route_template: '/servlet/controller.tutor.na.TestPageListServlet?p_process=PupilSearch',
        operation: 'PupilSearch',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '수시평가 문항별 상세 채점 결과 조회',
        reason: '수시평가 문항별 상세 채점 결과 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['testing_no', 'p_no', 'test_no']),
        join_key_names: Object.freeze(['testing_no', 'p_no', 'test_no']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['testing_no', 'p_no', 'test_no'],
        optionalParams: ['paper_type', 'testing_name'],
        responseFormat: 'HTML'
      }
    ],
    [
      'DA_DIAGNOST_LIST',
      {
        id: 'DA_DIAGNOST_LIST',
        routeId: 'DA_DIAGNOST_LIST',
        category: 'DAIndex',
        servletPath: '/servlet/controller.tutor.diag.DiagnostManageServlet',
        processName: 'TestPaperList',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestPaperList',
        route_template: '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestPaperList',
        operation: 'TestPaperList',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '진단평가 시험지 목록 조회',
        reason: '진단평가 시험지 목록 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['reqCmd']),
        join_key_names: Object.freeze(['reqCmd']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['reqCmd'],
        optionalParams: ['grade_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'DA_DIAGNOST_RESULT_LIST',
      {
        id: 'DA_DIAGNOST_RESULT_LIST',
        routeId: 'DA_DIAGNOST_RESULT_LIST',
        category: 'DAIndex',
        servletPath: '/servlet/controller.tutor.diag.DiagnostManageServlet',
        processName: 'TestResultList',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestResultList',
        route_template: '/servlet/controller.tutor.diag.DiagnostManageServlet?reqCmd=TestResultList',
        operation: 'TestResultList',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '진단평가 응시 결과 목록 조회',
        reason: '진단평가 응시 결과 목록 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze(['reqCmd']),
        join_key_names: Object.freeze(['reqCmd']),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: ['reqCmd'],
        optionalParams: ['student_name', 'date'],
        responseFormat: 'HTML'
      }
    ],
    [
      'BASE_USER_SEARCH',
      {
        id: 'BASE_USER_SEARCH',
        routeId: 'BASE_USER_SEARCH',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserSearchServlet',
        processName: 'Main',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.base.UserSearchServlet?p_process=Main',
        route_template: '/servlet/controller.tutor.base.UserSearchServlet?p_process=Main',
        operation: 'Main',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '원생 목록 및 상세 정보 검색',
        reason: '원생 목록 및 상세 정보 검색',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze([]),
        join_key_names: Object.freeze([]),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: [],
        optionalParams: ['stu_name', 'grade_no', 'cls_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'BASE_USER_CLS_MANAGE',
      {
        id: 'BASE_USER_CLS_MANAGE',
        routeId: 'BASE_USER_CLS_MANAGE',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserClsManageServlet',
        processName: 'Main',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.base.UserClsManageServlet?p_process=Main',
        route_template: '/servlet/controller.tutor.base.UserClsManageServlet?p_process=Main',
        operation: 'Main',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '학생 승인 및 반편성 현황 조회',
        reason: '학생 승인 및 반편성 현황 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze([]),
        join_key_names: Object.freeze([]),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: [],
        optionalParams: ['cls_no'],
        responseFormat: 'HTML'
      }
    ],
    [
      'BASE_PAD_CERTIFICATE',
      {
        id: 'BASE_PAD_CERTIFICATE',
        routeId: 'BASE_PAD_CERTIFICATE',
        category: 'BaseManageIndex',
        servletPath: '/servlet/controller.tutor.base.UserSearchServlet',
        processName: 'GetCertificateMain',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.base.UserSearchServlet?p_process=GetCertificateMain',
        route_template: '/servlet/controller.tutor.base.UserSearchServlet?p_process=GetCertificateMain',
        operation: 'GetCertificateMain',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '학원 학습패드(태블릿) 등록 및 인증 기기 현황 조회',
        reason: '학원 학습패드(태블릿) 등록 및 인증 기기 현황 조회',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze([]),
        join_key_names: Object.freeze([]),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: [],
        optionalParams: [],
        responseFormat: 'HTML'
      }
    ],
    [
      'COURSE_MAIN_INDEX',
      {
        id: 'COURSE_MAIN_INDEX',
        routeId: 'COURSE_MAIN_INDEX',
        category: 'CourseMainIndex',
        servletPath: '/servlet/controller.tutor.TutorMenuIndexServlet',
        processName: 'CourseMainIndex',
        httpMethod: 'GET',
        http_method: 'GET',
        routeTemplate: '/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseMainIndex',
        route_template: '/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseMainIndex',
        operation: 'CourseMainIndex',
        semanticEffect: 'read',
        semantic_effect: 'read',
        effect: 'READ_ONLY',
        description: '학습관리 메인 대시보드 및 학습일지 진입 라우트',
        reason: '학습관리 메인 대시보드 및 학습일지 진입 라우트',
        evidenceGrade: 'live-route',
        evidence_grade: 'live-route',
        evidenceDate: '2026-09-27',
        evidence_date: '2026-09-27',
        joinKeyNames: Object.freeze([]),
        join_key_names: Object.freeze([]),
        sourceRefs: Object.freeze([]),
        source_refs: Object.freeze([]),
        safeToProbe: true,
        safe_to_probe: true,
        requiredParams: [],
        optionalParams: [],
        responseFormat: 'HTML'
      }
    ]
  ]);

  /**
   * Initializes the registry after validating every canonical operation.
   */
  private static ensureInitialized(): void {
    if (this._initialized) {
      return;
    }

    if (!existsSync(ROUTE_REGISTRY_PATH)) {
      throw new Error(`[LmsRouteRegistry] Canonical route registry not found at: '${ROUTE_REGISTRY_PATH}'`);
    }

    const rawContent = readFileSync(ROUTE_REGISTRY_PATH, 'utf-8');
    let parsed: RawRegistryData;
    try {
      parsed = validateCanonicalRegistry(JSON.parse(rawContent));
    } catch (err) {
      throw new Error(
        `[LmsRouteRegistry] Failed to parse route-registry.json at '${ROUTE_REGISTRY_PATH}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }

    if (!parsed || !Array.isArray(parsed.entries)) {
      throw new Error(`[LmsRouteRegistry] Invalid route-registry.json format: 'entries' array missing`);
    }

    // The dated baseline contains 54 operations; reviewed additions need no count override.

    // Count operations to resolve non-unique names safely
    const opCounts = new Map<string, number>();
    for (const entry of parsed.entries) {
      const op = entry.operation || '';
      opCounts.set(op, (opCounts.get(op) || 0) + 1);
    }

    for (const entry of parsed.entries) {
      // Validate entry schema
      if (!entry.id || typeof entry.id !== 'string') {
        throw new Error(`[LmsRouteRegistry] Route entry missing valid 'id': ${JSON.stringify(entry)}`);
      }
      if (!entry.operation || typeof entry.operation !== 'string') {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid 'operation'`);
      }
      if (typeof entry.route_template !== 'string') {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid 'route_template'`);
      }
      if (typeof entry.semantic_effect !== 'string') {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid 'semantic_effect'`);
      }
      if (typeof entry.safe_to_probe !== 'boolean') {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid boolean 'safe_to_probe'`);
      }
      if (!Array.isArray(entry.join_key_names)) {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid array 'join_key_names'`);
      }
      if (!Array.isArray(entry.source_refs)) {
        throw new Error(`[LmsRouteRegistry] Route entry '${entry.id}' missing valid array 'source_refs'`);
      }

      // Extract servlet path and process name from route template
      let servletPath = entry.route_template;
      let processName = entry.operation;
      if (entry.route_template.startsWith('native:')) {
        servletPath = entry.route_template;
      } else if (entry.route_template.includes('?')) {
        const [pathPart, queryPart] = entry.route_template.split('?');
        servletPath = pathPart;
        const searchParams = new URLSearchParams(queryPart);
        processName = searchParams.get('p_process') || searchParams.get('reqCmd') || entry.operation;
      }

      // Determine category from servlet path or entry properties
      let category = 'BackendMap';
      if (servletPath.includes('tutor.fa') || entry.id.startsWith('fa_')) {
        category = 'FAIndex';
      } else if (servletPath.includes('tutor.na') || entry.id.startsWith('dtzt_')) {
        category = 'NAIndex';
      } else if (servletPath.includes('tutor.diag')) {
        category = 'DAIndex';
      } else if (servletPath.includes('tutor.base') || entry.id.startsWith('base_') || entry.id.startsWith('attendance_')) {
        category = 'BaseManageIndex';
      } else if (servletPath.includes('tutor.wb') || entry.id.startsWith('smartbook_') || entry.id.startsWith('workbook_')) {
        category = 'SmartBookIndex';
      } else if (servletPath.includes('coursemanage') || entry.id.startsWith('study_') || entry.id.startsWith('prestudy_')) {
        category = 'CourseManageIndex';
      } else if (servletPath.includes('DayRecordServlet') || entry.id.startsWith('day_record_') || entry.id.startsWith('course_')) {
        category = 'CourseMainIndex';
      }

      // Semantic effect to legacy LmsEndpointEffect
      const isPureRead = entry.semantic_effect === 'read' && entry.safe_to_probe === true;
      const effect: LmsEndpointEffect = isPureRead ? 'READ_ONLY' : 'MUTATING';

      const method = entry.http_method === 'GET' || entry.http_method === 'POST' ? entry.http_method : null;

      const def: LmsRouteDefinition = Object.freeze({
        id: entry.id,
        routeId: entry.id,
        routeTemplate: entry.route_template,
        route_template: entry.route_template,
        operation: entry.operation,
        httpMethod: method,
        http_method: method,
        semanticEffect: entry.semantic_effect as any,
        semantic_effect: entry.semantic_effect as any,
        evidenceGrade: entry.evidence_grade,
        evidence_grade: entry.evidence_grade,
        evidenceDate: entry.evidence_date,
        evidence_date: entry.evidence_date,
        joinKeyNames: Object.freeze([...entry.join_key_names]),
        join_key_names: Object.freeze([...entry.join_key_names]),
        safeToProbe: entry.safe_to_probe,
        safe_to_probe: entry.safe_to_probe,
        reason: entry.reason,
        description: entry.reason,
        sourceRefs: Object.freeze([...entry.source_refs]),
        source_refs: Object.freeze([...entry.source_refs]),
        category,
        servletPath,
        processName,
        effect,
        // The registry's join keys describe response binding, not request wire inputs.
        // Only the reviewed DayRecord read has a verified bounded selector here.
        requiredParams: Object.freeze(entry.id === 'day_record_read' ? ['std_ymd', 'grp_seq'] : []),
        optionalParams: Object.freeze([]),
        responseFormat: 'HTML'
      });

      this.canonicalRoutes.push(def);
      this.routesById.set(entry.id, def);

      // Only register operation name if it is unique across all entries (avoids collisions like 'Main')
      if (opCounts.get(entry.operation) === 1) {
        this.routesByOperation.set(entry.operation, def);
      }
    }

    this._initialized = true;
  }

  /**
   * Retrieves a canonical route by ID or unique operation name.
   */
  public static getRoute(routeIdOrOperation: string): LmsRouteDefinition {
    this.ensureInitialized();
    const route = this.routesById.get(routeIdOrOperation)
      || this.routesByOperation.get(routeIdOrOperation);

    if (!route) {
      throw new RouteLookupError(`[LmsRouteRegistry] Unknown routeId: ${routeIdOrOperation}`);
    }
    return { ...route };
  }

  /**
   * Checks whether a canonical route exists by ID or unique operation.
   */
  public static hasRoute(routeIdOrOperation: string): boolean {
    this.ensureInitialized();
    return this.routesById.has(routeIdOrOperation)
      || this.routesByOperation.has(routeIdOrOperation);
  }

  /**
   * Returns every validated canonical operation from route-registry.json.
   * The original 54-entry evidence remains unchanged; additions require valid metadata.
   */
  public static getAllRoutes(): LmsRouteDefinition[] {
    this.ensureInitialized();
    return this.canonicalRoutes.map(r => ({ ...r }));
  }

  /**
   * Lists canonical routes, optionally filtered by category or effect.
   */
  public static listRoutes(filter?: { category?: string; effect?: LmsEndpointEffect }): LmsRouteDefinition[] {
    this.ensureInitialized();
    let filtered = this.canonicalRoutes;
    if (filter?.category) {
      filtered = filtered.filter(r => r.category === filter.category);
    }
    if (filter?.effect) {
      filtered = filtered.filter(r => r.effect === filter.effect);
    }
    return filtered.map(r => ({ ...r }));
  }

  /**
   * The generic request builder is deliberately disabled. Each operation requires
   * a reviewed effect, selector, and response-binding adapter.
   */
  public static buildRequest(routeId: string, params: Record<string, string | number>, baseUrl: string = 'https://dc.gang-a.kr'): {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
    body?: string;
  } {
    const route = this.getRoute(routeId);
    void params;
    void baseUrl;
    if (route.id === 'textbook_sample_pdf') {
      throw new Error('[LmsRouteRegistry] Use resolveGaussSamplePdfUrl for catalog-scoped PDF URLs');
    }
    throw new Error('[LmsRouteRegistry] Canonical routes require a reviewed operation-specific adapter');
  }

  /**
   * Fail-Closed Safe Read Check.
   * Returns true ONLY if the operation is strictly a read operation AND safe to probe.
   * NEVER uses http_method === 'GET' to determine safety!
   */
  public static isSafeRead(routeIdOrOperation: string): boolean {
    this.ensureInitialized();
    if (!this.hasRoute(routeIdOrOperation)) {
      return false;
    }
    try {
      const route = this.getRoute(routeIdOrOperation);
      return route.semanticEffect === 'read' && route.safeToProbe === true;
    } catch {
      return false;
    }
  }

  /**
   * Fail-Closed Safe Read Assertion (RUB-03 Compliance).
   *
   * TRAP 1: HTTP Method Safety Fallacy!
   * day_record_udtprg, day_record_udthw, day_record_udtmemo, day_record_udtattn,
   * similar_paper_create use http_method: "GET" (or native) but have semantic_effect: "write"
   * or safe_to_probe: false.
   *
   * Strictly throws UnsafeMutatingOperationError if semantic_effect !== "read" or safe_to_probe !== true.
   */
  public static assertSafeRead(routeIdOrOperation: string): void {
    this.ensureInitialized();
    const route = this.getRoute(routeIdOrOperation);

    if (!this.isSafeRead(routeIdOrOperation)) {
      throw new UnsafeMutatingOperationError(
        `[LmsRouteRegistry: SAFETY VIOLATION] Attempted to invoke unsafe/mutating route "${routeIdOrOperation}" ` +
        `(id: ${route.id}, op: ${route.operation}, method: ${route.httpMethod}, semantic_effect: ${route.semanticEffect}, safe_to_probe: ${route.safeToProbe}) in read-only harness.`
      );
    }
  }
}

// Standalone functional exports for ergonomic parity
export function getRoute(routeIdOrOperation: string): LmsRouteDefinition {
  return LmsRouteRegistry.getRoute(routeIdOrOperation);
}

export function getAllRoutes(): LmsRouteDefinition[] {
  return LmsRouteRegistry.getAllRoutes();
}

export function hasRoute(routeIdOrOperation: string): boolean {
  return LmsRouteRegistry.hasRoute(routeIdOrOperation);
}

export function isSafeRead(routeIdOrOperation: string): boolean {
  return LmsRouteRegistry.isSafeRead(routeIdOrOperation);
}

export function assertSafeRead(routeIdOrOperation: string): void {
  LmsRouteRegistry.assertSafeRead(routeIdOrOperation);
}
