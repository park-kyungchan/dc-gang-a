import { describe, expect, test } from 'bun:test';
import { buildEndpointCatalog, queryEndpoints } from '../../src/lms/endpointCatalog';
import { endpointCli } from '../../harness/endpoints';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseBackendSourceEvidence } from '../../src/lms/backendSourceEvidence';
import { getAllRoutes } from '../../src/lms/lmsRouteRegistry';

describe('complete static backend coverage projection', () => {
  test('the existing public query explains every catalog family without enabling execution', () => {
    const result = endpointCli(['--projection', 'coverage']) as any;
    expect(result.projection).toBe('coverage');
    expect(result.totalCatalog).toBe(buildEndpointCatalog().length);
    expect(result.coverage.families.reduce((sum: number, row: any) => sum + row.operations, 0)).toBe(result.totalCatalog);
    expect(result.coverage.families.map((row: any) => row.family)).toEqual([...new Set(buildEndpointCatalog().map(row => row.family))].sort());
    expect(result.coverage.executionEnabled).toBe(false);
    expect(result.coverage.physicalBackendCompletenessEstablished).toBe(false);
    expect(result.coverage.nativeAppCompletenessEstablished).toBe(false);
    expect(result.callable).toBe(0);
    expect(result.coverage.families.every((row: any) => row.callable === 0 && row.ownership === 'unverified' && row.pagination === 'unverified')).toBe(true);
  });
  test('exact endpoint reads consume deployed structure separately from live operation acceptance', () => {
    const result = endpointCli(['--id', 'study_schedule', '--projection', 'full']) as any;
    const source = result.rows[0].sourceStructure;
    expect(source).toBeDefined();
    expect(source.sourceRef).toBe('docs/academy-backend-source-survey-2026-10-02.json#documents/study_schedule');
    expect(source.state).toBe('source_structure_only');
    expect(source.forms.find((form: any) => form.name === 'form1').actionPath).toBeNull();
    expect(source.inputNames).toContain('student_no');
    expect(source.requestDeclarations.find((control: any) => control.functionName === 'onChangeClass').servletDeclarations)
      .toContain('/servlet/controller.admin.college.usermng.UserSearchServlet');
    expect(result.rows[0].callable).toBe(false);
    expect(result.rows[0].binding.ownership).toBe('unverified');
    expect(result.rows[0].binding.pagination).toBe('unverified');
  });
  test('rejects impossible coverage, operation execution and malformed shared source membership', () => {
    const fixture = () => JSON.parse(readFileSync(resolve(import.meta.dir, '../../docs/academy-backend-source-survey-2026-10-02.json'), 'utf8'));
    for (const mutate of [
      (data: any) => { data.summary.observedFixedDocuments--; },
      (data: any) => { data.documents.push(data.documents[0]); },
      (data: any) => { data.collection.discoveredOperationsInvoked = true; },
      (data: any) => { data.documents[0].requestDeclarations[0].invoked = true; },
      (data: any) => { data.sharedRequestDeclarations[0].documentIds = ['unobserved_document']; },
      (data: any) => { data.sharedRequestDeclarations[0].documentIds.push(data.sharedRequestDeclarations[0].documentIds[0]); },
    ]) {
      const data = fixture(); mutate(data);
      expect(() => { parseBackendSourceEvidence(data); }).toThrow('invalid_backend_source_evidence');
    }
  });
  test('exact operation lookup returns bound source declarations without a path/token cartesian join', () => {
    const result = endpointCli(['--operation', 'StudentGetList', '--projection', 'declarations']) as any;
    expect(result.projection).toBe('declarations');
    expect(result.shown).toBeGreaterThan(0);
    expect(result.rows.every((row: any) => row.operation === 'StudentGetList' && row.invoked === false && row.semanticEffectVerified === false)).toBe(true);
    expect(result.rows.every((row: any) => row.effect === 'unknown' && row.gate === 'blocked_effect')).toBe(true);
    expect(result.rows.some((row: any) => row.functionName === 'onChangeClass'
      && row.servletDeclarations.includes('/servlet/controller.admin.college.usermng.UserSearchServlet'))).toBe(true);
    expect(result.rows.some((row: any) => row.functionName === 'onChangeClass'
      && row.servletDeclarations.includes('/servlet/controller.coursemanage.CourseManageServlet'))).toBe(false);
    expect(() => endpointCli(['--operation', 'StudentGetList ', '--projection', 'declarations'])).toThrow('invalid_operation');
    expect(result.callable).toBe(0);
  });
  test('source observations cannot enrich a catalog entry with the same ID but a different destination', () => {
    const canonical = buildEndpointCatalog().find(entry => entry.id === 'study_schedule')!;
    for (const routeTemplate of ['/servlet/controller.first.RegAppServlet',
      'https://synthetic.invalid/servlet/controller.coursemanage.CourseManageServlet']) {
      const sourceRoutes = getAllRoutes().map(route => route.id === canonical.id ? { ...route, routeTemplate } : route);
      const altered = buildEndpointCatalog(sourceRoutes, []);
      expect(Boolean(altered.find(entry => entry.id === canonical.id)!.sourceStructure)).toBe(false);
    }
  });
});
