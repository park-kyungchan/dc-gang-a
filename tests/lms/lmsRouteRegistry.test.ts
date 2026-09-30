import { describe, it, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  LmsRouteRegistry,
  UnsafeMutatingOperationError,
  RouteLookupError,
  ROUTE_REGISTRY_PATH,
  getRoute,
  getAllRoutes,
  hasRoute,
  isSafeRead,
  assertSafeRead
} from '../../src/lms/lmsRouteRegistry';
import { resolveGaussSamplePdfUrl } from '../../src/lms/textbookSamplePdf';

describe('LmsRouteRegistry & Deterministic Endpoint Catalog', () => {
  // =========================================================================
  // RUB-02 & RUB-10: 54 Operations Schema Validation & Cwd Independence
  // =========================================================================
  it('RUB-10: resolves ROUTE_REGISTRY_PATH cwd-independently to physical file', () => {
    expect(existsSync(ROUTE_REGISTRY_PATH)).toBe(true);
    expect(ROUTE_REGISTRY_PATH).toContain('research');
    expect(ROUTE_REGISTRY_PATH).toContain('route-registry.json');
  });

  it('RUB-02: dynamically loads exactly 54 operations and validates schema', () => {
    const routes = getAllRoutes();
    expect(routes.length).toBe(54);

    const ids = new Set<string>();
    for (const r of routes) {
      expect(r.id).toBeDefined();
      expect(typeof r.id).toBe('string');
      expect(r.id.length).toBeGreaterThan(0);
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);

      expect(r.routeTemplate).toBeDefined();
      expect(typeof r.routeTemplate).toBe('string');
      expect(r.operation).toBeDefined();
      expect(typeof r.operation).toBe('string');
      expect(['read', 'write', 'send', 'open_send_screen', 'unknown']).toContain(r.semanticEffect);
      expect(typeof r.safeToProbe).toBe('boolean');
      expect(Array.isArray(r.joinKeyNames)).toBe(true);
      expect(Array.isArray(r.sourceRefs)).toBe(true);
      expect(typeof r.reason).toBe('string');

      // Parity check for snake_case aliases
      expect(r.route_template).toBe(r.routeTemplate);
      expect(r.http_method).toBe(r.httpMethod);
      expect(r.semantic_effect).toBe(r.semanticEffect);
      expect(r.safe_to_probe).toBe(r.safeToProbe);
      expect(r.join_key_names).toEqual(r.joinKeyNames);
      expect(r.source_refs).toEqual(r.sourceRefs);
    }

    expect(ids.size).toBe(54);
  });

  // =========================================================================
  // RUB-03: HTTP Method Safety Fallacy Guard (assertSafeRead & isSafeRead)
  // =========================================================================
  it('RUB-03: assertSafeRead strictly blocks mutating GET endpoints with UnsafeMutatingOperationError', () => {
    // 1. day_record_udtprg (GET, effect=write, safe=false, op=udtPrg)
    expect(() => assertSafeRead('day_record_udtprg')).toThrow(UnsafeMutatingOperationError);
    expect(() => assertSafeRead('udtPrg')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('day_record_udtprg')).toBe(false);
    expect(isSafeRead('udtPrg')).toBe(false);

    // 2. day_record_udthw (GET, effect=write, safe=false, op=udtHw)
    expect(() => assertSafeRead('day_record_udthw')).toThrow(UnsafeMutatingOperationError);
    expect(() => assertSafeRead('udtHw')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('day_record_udthw')).toBe(false);
    expect(isSafeRead('udtHw')).toBe(false);

    // 3. day_record_udtmemo (GET, effect=write, safe=false, op=udtMemo)
    expect(() => assertSafeRead('day_record_udtmemo')).toThrow(UnsafeMutatingOperationError);
    expect(() => assertSafeRead('udtMemo')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('day_record_udtmemo')).toBe(false);
    expect(isSafeRead('udtMemo')).toBe(false);

    // 4. day_record_udtattn (GET, effect=write, safe=false, op=udtAttn)
    expect(() => assertSafeRead('day_record_udtattn')).toThrow(UnsafeMutatingOperationError);
    expect(() => assertSafeRead('udtAttn')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('day_record_udtattn')).toBe(false);
    expect(isSafeRead('udtAttn')).toBe(false);

    // 5. similar_paper_create (native/None, effect=write, safe=false, op=incorrect.create)
    expect(() => assertSafeRead('similar_paper_create')).toThrow(UnsafeMutatingOperationError);
    expect(() => assertSafeRead('incorrect.create')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('similar_paper_create')).toBe(false);
    expect(isSafeRead('incorrect.create')).toBe(false);
  });

  it('RUB-03: assertSafeRead strictly blocks GET endpoints marked safe_to_probe: false', () => {
    // daily_report_preview has http_method=GET and semantic_effect=read, BUT safe_to_probe=false
    expect(() => assertSafeRead('daily_report_preview')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('daily_report_preview')).toBe(false);

    // dtzt_list has http_method=GET and semantic_effect=read, BUT safe_to_probe=false
    expect(() => assertSafeRead('dtzt_list')).toThrow(UnsafeMutatingOperationError);
    expect(isSafeRead('dtzt_list')).toBe(false);
  });

  it('RUB-03: allows pure read-only endpoints with safe_to_probe: true', () => {
    const safeRoutes = [
      'course_menu',
      'course_schedule',
      'course_group',
      'attendance_history',
      'alimtalk_history',
      'study_menu',
      'prestudy_waiting',
      'prestudy_completed',
      'prestudy_summary',
      'dtzt_result',
      'study_schedule',
      'study_progress',
      'study_overview',
      'study_course',
      'smartbook_menu',
      'workbook_catalog',
      'smartbook_result',
      'textbook_main',
      'textbook_answer_catalog'
    ];

    for (const routeId of safeRoutes) {
      expect(isSafeRead(routeId)).toBe(true);
      expect(() => assertSafeRead(routeId)).not.toThrow();
    }
  });

  it('records the observed fixed GaStudyAnswer catalog view without claiming a student assignment', () => {
    const route = getRoute('textbook_answer_catalog');
    expect(route.routeTemplate).toBe('/servlet/controller.coursemanage.CourseManageServlet?reqCmd=GaStudyAnswer');
    expect(route.httpMethod).toBe('GET');
    expect(route.semanticEffect).toBe('read');
    expect(route.evidenceGrade).toBe('live-structure');
    expect(route.evidenceDate).toBe('2026-09-29');
    expect(route.reason).toContain('student book assignment remain unverified');
    expect(route.safeToProbe).toBe(true);
    expect(route.joinKeyNames).toEqual([]);
    expect(isSafeRead('textbook_answer_catalog')).toBe(true);
    expect(() => assertSafeRead('textbook_answer_catalog')).not.toThrow();
  });

  it('records rows in the two fixed pre-study lists without asserting a canonical join', () => {
    for (const routeId of ['prestudy_waiting', 'prestudy_completed']) {
      const route = getRoute(routeId);
      expect(route.evidenceGrade).toBe('live-structure');
      expect(route.evidenceDate).toBe('2026-09-29');
      expect(route.reason).toContain('table with rows');
      expect(route.reason).toContain('Canonical student ID');
      expect(route.reason).toContain('lesson occurrence');
      expect(route.safeToProbe).toBe(true);
    }
  });

  it('separates DayRecord wire selectors from response join keys and blocks generic request building', () => {
    const route = getRoute('day_record_read');
    expect(route.requiredParams).toEqual(['std_ymd', 'grp_seq']);
    expect(route.joinKeyNames).toContain('record_seq');
    expect(route.joinKeyNames).toContain('stu_pri_no');
    expect(() => LmsRouteRegistry.buildRequest('day_record_read', {
      std_ymd: '20260930', grp_seq: '4',
    })).toThrow(/operation-specific adapter/);
    expect(() => LmsRouteRegistry.buildRequest('day_record_udtprg', {})).toThrow(/operation-specific adapter/);
  });

  it('resolves only the two catalog-observed Gauss sample PDFs', () => {
    const catalog = getRoute('textbook_sample_pdf');
    expect(catalog.evidenceGrade).toBe('live-structure');
    expect(catalog.semanticEffect).toBe('read');
    expect(catalog.safeToProbe).toBe(true);
    expect(resolveGaussSamplePdfUrl('g7_gauss_sample_1_1.pdf'))
      .toBe('https://storage.studyq.net/data/answer/mi/book/g7_gauss_sample_1_1.pdf');
    expect(resolveGaussSamplePdfUrl('g7_gauss_sample_2_3.pdf'))
      .toBe('https://storage.studyq.net/data/answer/mi/book/g7_gauss_sample_2_3.pdf');
    expect(() => resolveGaussSamplePdfUrl('g7_gauss_sample_2_2.pdf' as any)).toThrow();
    expect(() => resolveGaussSamplePdfUrl('../g7_gauss_sample_1_1.pdf' as any)).toThrow();
    expect(() => LmsRouteRegistry.buildRequest('textbook_sample_pdf', {})).toThrow();
  });

  // =========================================================================
  // Lookups & Parity
  // =========================================================================
  it('retrieves routes by canonical id and unique operation', () => {
    const r1 = getRoute('course_menu');
    expect(r1.id).toBe('course_menu');
    expect(r1.operation).toBe('CourseManageIndex');
    expect(r1.httpMethod).toBe('GET');

    const r2 = getRoute('udtPrg');
    expect(r2.id).toBe('day_record_udtprg');
    expect(r2.operation).toBe('udtPrg');

    expect(hasRoute('course_menu')).toBe(true);
    expect(hasRoute('udtPrg')).toBe(true);
    expect(hasRoute('non_existent_route_xyz')).toBe(false);
  });

  it('throws RouteLookupError for unknown routeId', () => {
    expect(() => getRoute('NON_EXISTENT_ROUTE')).toThrow(RouteLookupError);
    expect(isSafeRead('NON_EXISTENT_ROUTE')).toBe(false);
  });

  // =========================================================================
  // Historical legacy routes must never enter a read or request surface.
  // =========================================================================
  it('blocks every historical legacy candidate from all public route and request APIs', () => {
    const legacyRoutes = (LmsRouteRegistry as unknown as {
      legacyRoutes: Map<string, unknown>;
    }).legacyRoutes;
    expect(legacyRoutes.size).toBe(13);
    const visible = LmsRouteRegistry.listRoutes();
    expect(visible.length).toBe(54);
    for (const id of legacyRoutes.keys()) {
      expect(hasRoute(id)).toBe(false);
      expect(isSafeRead(id)).toBe(false);
      expect(() => getRoute(id)).toThrow(RouteLookupError);
      expect(() => assertSafeRead(id)).toThrow(RouteLookupError);
      expect(() => LmsRouteRegistry.buildRequest(id, { condition: '{"similar":{"create":1}}' }))
        .toThrow(RouteLookupError);
      expect(visible.some(route => route.id === id)).toBe(false);
    }
  });

  it('lists routes by category and filters by effect cleanly', () => {
    const faRoutes = LmsRouteRegistry.listRoutes({ category: 'FAIndex' });
    expect(faRoutes.length).toBeGreaterThanOrEqual(1);
    expect(faRoutes.every(route => getAllRoutes().some(canonical => canonical.id === route.id))).toBe(true);

    const readOnlyRoutes = LmsRouteRegistry.listRoutes({ effect: 'READ_ONLY' });
    expect(readOnlyRoutes.length).toBeGreaterThanOrEqual(18);
    for (const r of readOnlyRoutes) {
      expect(r.effect).not.toBe('MUTATING');
      expect(() => LmsRouteRegistry.assertSafeRead(r.routeId)).not.toThrow();
    }

    const mutatingRoutes = LmsRouteRegistry.listRoutes({ effect: 'MUTATING' });
    expect(mutatingRoutes.length).toBeGreaterThanOrEqual(30);
  });
});
