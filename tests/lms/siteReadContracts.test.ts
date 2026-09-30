import { describe, expect, it } from 'bun:test';
import { getAllRoutes } from '../../src/lms/lmsRouteRegistry';
import { getSiteInventory, getSiteOperation, validateSiteInventory } from '../../src/lms/siteReadContracts';

describe('offline servlet read-contract inventory', () => {
  it('covers every canonical servlet operation once and exposes non-servlet entries', () => {
    const inventory = getSiteInventory();
    const sourceServletIds = getAllRoutes()
      .filter(route => route.routeTemplate.startsWith('/servlet/'))
      .map(route => route.id).sort();
    expect(inventory.servletOperations.map(op => op.id).sort()).toEqual(sourceServletIds);
    expect(inventory.servletOperations.length + inventory.outsideServlet.length).toBe(getAllRoutes().length);
    expect(validateSiteInventory(inventory)).toEqual([]);
  });

  it('preserves the POST DayRecord read contract and blocks mutating GETs from read classification', () => {
    const dayRecord = getSiteOperation('day_record_read');
    expect(dayRecord.method).toBe('POST');
    expect(dayRecord.dispatch).toEqual({ location: 'form_body', key: 'p_process', value: 'Main' });
    expect(dayRecord.readState).toBe('bounded_read_requires_session');
    for (const id of ['day_record_udtprg', 'day_record_udthw', 'day_record_udtmemo', 'day_record_udtattn']) {
      const mutation = getSiteOperation(id);
      expect(mutation.method).toBe('GET');
      expect(mutation.readState).toBe('effectful');
      expect(mutation.fixedShellReadCandidate).toBe(false);
    }
  });

  it('uses the catalog live observation while keeping unknown-effect searches out of fixed read shells', () => {
    expect(getSiteOperation('textbook_answer_catalog').readState).toBe('fixed_page_shell');
    expect(getSiteOperation('textbook_answer_catalog').fixedShellReadCandidate).toBe(true);
    expect(getSiteOperation('prestudy_waiting_search').readState).toBe('effect_unknown');
    expect(getSiteOperation('prestudy_waiting_search').fixedShellReadCandidate).toBe(false);
    expect(getSiteOperation('prestudy_waiting').readState).toBe('fixed_page_shell');
    expect(getSiteOperation('prestudy_waiting').unresolved).toContain('canonical identity, pagination, and joins unverified');
    expect(() => getSiteOperation('not_a_route')).toThrow();
  });
});
