/** Local, source-grounded inventory of the servlet operations in the canonical map.
 * This module makes no network request and grants no permission to call a route.
 */
import { getAllRoutes, type LmsRouteDefinition } from './lmsRouteRegistry';

export type SiteReadState =
  | 'fixed_page_shell'
  | 'bounded_read_requires_session'
  | 'source_only_read'
  | 'historical_read_requires_current_binding'
  | 'read_contract_unverified'
  | 'effect_unknown'
  | 'effectful';

export type DispatchLocation = 'query' | 'form_body' | 'unverified';

export interface SiteOperationContract {
  readonly id: string;
  readonly path: string;
  readonly routeTemplate: string;
  readonly method: 'GET' | 'POST' | null;
  readonly operation: string;
  readonly dispatch: {
    readonly location: DispatchLocation;
    readonly key: 'p_process' | 'reqCmd' | null;
    readonly value: string | null;
  };
  readonly queryKeys: readonly string[];
  readonly templateParameters: readonly string[];
  /** Candidate join fields from evidence; these are not validated required wire fields. */
  readonly joinKeyCandidates: readonly string[];
  readonly semanticEffect: LmsRouteDefinition['semanticEffect'];
  readonly evidenceGrade: string;
  readonly evidenceDate: string;
  readonly sourceRefs: readonly string[];
  readonly registrySafeToProbe: boolean;
  /** Only a fixed, previously observed read shell qualifies. No student rows are implied. */
  readonly fixedShellReadCandidate: boolean;
  readonly readState: SiteReadState;
  readonly unresolved: readonly string[];
}

export interface SiteInventory {
  readonly servletOperations: readonly SiteOperationContract[];
  readonly outsideServlet: readonly { id: string; routeTemplate: string }[];
}

function templateParameters(template: string): string[] {
  return [...new Set([...template.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(m => m[1]))];
}

function classify(route: LmsRouteDefinition, fixedShell: boolean): SiteReadState {
  if (route.semanticEffect === 'write' || route.semanticEffect === 'send' || route.semanticEffect === 'open_send_screen') {
    return 'effectful';
  }
  if (route.semanticEffect !== 'read') return 'effect_unknown';
  if (route.id === 'day_record_read') return 'bounded_read_requires_session';
  if (route.evidenceGrade === 'source') return 'source_only_read';
  if (route.evidenceGrade.startsWith('historical')) return 'historical_read_requires_current_binding';
  if (fixedShell) return 'fixed_page_shell';
  return 'read_contract_unverified';
}

function unresolvedFor(route: LmsRouteDefinition, state: SiteReadState, dispatch: DispatchLocation): string[] {
  const gaps: string[] = [];
  if (route.httpMethod === null) gaps.push('HTTP method unverified');
  if (dispatch === 'unverified') gaps.push('operation selector placement unverified');
  if (state === 'fixed_page_shell') gaps.push('canonical identity, pagination, and joins unverified');
  if (state === 'bounded_read_requires_session') gaps.push('current teacher/session, date/group coverage, and lesson occurrence binding required');
  if (state === 'source_only_read') gaps.push('current server effect and response unverified');
  if (state === 'historical_read_requires_current_binding') gaps.push('current wire contract, effect, and target binding unverified');
  if (state === 'read_contract_unverified') gaps.push('current read eligibility or exact target contract unverified');
  if (state === 'effect_unknown') gaps.push('semantic effect unverified; do not probe as a read');
  if (state === 'effectful') gaps.push('write/send effect; excluded from read probing');
  return gaps;
}

function toContract(route: LmsRouteDefinition): SiteOperationContract {
  const [path, query = ''] = route.routeTemplate.split('?', 2);
  const queryParams = new URLSearchParams(query);
  const selectorKey = queryParams.has('p_process') ? 'p_process' : queryParams.has('reqCmd') ? 'reqCmd' : null;
  // The exact DayRecord POST body selector is documented separately from its bare path.
  const dayRecordBody = route.id === 'day_record_read';
  const dispatch: SiteOperationContract['dispatch'] = selectorKey
    ? { location: 'query', key: selectorKey, value: queryParams.get(selectorKey) }
    : dayRecordBody
      ? { location: 'form_body', key: 'p_process', value: 'Main' }
      : { location: 'unverified', key: null, value: null };
  const params = templateParameters(route.routeTemplate);
  const fixedShell = route.semanticEffect === 'read'
    && route.safeToProbe
    && route.httpMethod === 'GET'
    && params.length === 0
    && (route.evidenceGrade === 'live-route' || route.evidenceGrade === 'live-structure');
  const readState = classify(route, fixedShell);
  const sourceRefs = dayRecordBody
    ? [...route.sourceRefs, 'docs/WHOLE_LENS_READ_CONTRACTS.md:14']
    : [...route.sourceRefs];

  return {
    id: route.id,
    path,
    routeTemplate: route.routeTemplate,
    method: route.httpMethod,
    operation: route.operation,
    dispatch,
    queryKeys: [...queryParams.keys()],
    templateParameters: params,
    joinKeyCandidates: [...route.joinKeyNames],
    semanticEffect: route.semanticEffect,
    evidenceGrade: route.evidenceGrade,
    evidenceDate: route.evidenceDate,
    sourceRefs,
    registrySafeToProbe: route.safeToProbe,
    fixedShellReadCandidate: fixedShell,
    readState,
    unresolved: unresolvedFor(route, readState, dispatch.location),
  };
}

export function getSiteInventory(): SiteInventory {
  const servletOperations: SiteOperationContract[] = [];
  const outsideServlet: { id: string; routeTemplate: string }[] = [];
  for (const route of getAllRoutes()) {
    if (route.routeTemplate.startsWith('/servlet/')) servletOperations.push(toContract(route));
    else outsideServlet.push({ id: route.id, routeTemplate: route.routeTemplate });
  }
  return { servletOperations, outsideServlet };
}

export function getSiteOperation(id: string): SiteOperationContract {
  const matches = getSiteInventory().servletOperations.filter(op => op.id === id);
  if (matches.length !== 1) throw new Error(`Unknown /servlet operation ID: ${id}`);
  return matches[0];
}

export function validateSiteInventory(inventory = getSiteInventory()): string[] {
  const errors: string[] = [];
  const routes = getAllRoutes();
  const ids = new Set<string>();
  const outsideIds = new Set<string>();
  for (const operation of inventory.servletOperations) {
    if (ids.has(operation.id)) errors.push(`Duplicate operation ID: ${operation.id}`);
    ids.add(operation.id);
    if (!operation.path.startsWith('/servlet/')) errors.push(`Invalid servlet path: ${operation.id}`);
    if (operation.fixedShellReadCandidate && operation.readState !== 'fixed_page_shell') {
      errors.push(`Unsafe fixed-shell classification: ${operation.id}`);
    }
    if (operation.semanticEffect !== 'read' && operation.fixedShellReadCandidate) {
      errors.push(`Effectful operation classified as read: ${operation.id}`);
    }
  }
  for (const route of routes) {
    if (route.routeTemplate.startsWith('/servlet/') && !ids.has(route.id)) errors.push(`Missing servlet operation: ${route.id}`);
    if (!route.routeTemplate.startsWith('/servlet/') && !inventory.outsideServlet.some(item => item.id === route.id && item.routeTemplate === route.routeTemplate)) {
      errors.push(`Missing non-servlet entry: ${route.id}`);
    }
  }
  for (const item of inventory.outsideServlet) {
    if (outsideIds.has(item.id) || ids.has(item.id)) errors.push(`Duplicate operation ID: ${item.id}`);
    outsideIds.add(item.id);
  }
  if (inventory.servletOperations.length + inventory.outsideServlet.length !== routes.length) {
    errors.push('Inventory does not cover the full canonical route registry');
  }
  return errors;
}
