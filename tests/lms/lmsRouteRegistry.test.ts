import { describe, it, expect } from 'bun:test';
import { LmsRouteRegistry } from '../../src/lms/lmsRouteRegistry';

describe('LmsRouteRegistry & Deterministic Endpoint Catalog', () => {
  it('retrieves FAIndex routes and verifies required parameter enforcement', () => {
    const route = LmsRouteRegistry.getRoute('FA_USER_SEARCH_RESULT');
    expect(route.routeId).toBe('FA_USER_SEARCH_RESULT');
    expect(route.category).toBe('FAIndex');
    expect(route.effect).toBe('READ_ONLY');
    expect(route.requiredParams).toContain('clg_no');
    expect(route.requiredParams).toContain('stu_name');

    // Throws error when missing required parameter
    expect(() => LmsRouteRegistry.buildRequest('FA_USER_SEARCH_RESULT', {
      clg_no: '14581'
      // missing stu_name, sort_date1, sort_date2
    })).toThrow(/Missing required parameter/);
  });

  it('builds complete POST request for TYPESET_STUDY_RESULT_SINGLE clinic endpoint', () => {
    const conditionStr = JSON.stringify({
      testing_no: 20549621,
      pri_no: 1293138,
      student_name: '유지연',
      score: { create: 0 },
      incorrect: { create: 1 },
      similar: { create: 1, mode: 1, exam_cnt: 1 }
    });

    const req = LmsRouteRegistry.buildRequest('TYPESET_STUDY_RESULT_SINGLE', {
      condition: conditionStr
    });

    expect(req.method).toBe('POST');
    expect(req.url).toContain('/servlet/controller.common.TestpageSelectExServlet');
    expect(req.body).toContain('condition=');
    expect(req.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });

  it('lists routes by category and ensures all routes are safe read/typeset effect', () => {
    const faRoutes = LmsRouteRegistry.listRoutes({ category: 'FAIndex' });
    expect(faRoutes.length).toBeGreaterThanOrEqual(4);

    const allRoutes = LmsRouteRegistry.listRoutes();
    for (const r of allRoutes) {
      // Must not be MUTATING in our read catalog
      expect(r.effect).not.toBe('MUTATING');
      expect(() => LmsRouteRegistry.assertSafeRead(r.routeId)).not.toThrow();
    }
  });

  it('throws error for unknown routeId', () => {
    expect(() => LmsRouteRegistry.getRoute('NON_EXISTENT_ROUTE')).toThrow(/Unknown routeId/);
  });
});
