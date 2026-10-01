/** Deterministic, metadata-only endpoint discovery. This module has no network executor. */
import { getAllRoutes, type LmsRouteDefinition } from './lmsRouteRegistry';
import { sourceEndpointCandidates, type SourceEndpointCandidate } from './endpointCandidates';

export type EndpointOrigin = 'canonical' | 'source_candidate';
export type RequestGate = 'blocked_effect' | 'unreviewed_candidate' | 'reviewed_adapter_and_scope_required';
export interface EndpointCatalogEntry {
  id: string;
  family: string;
  origin: EndpointOrigin;
  operation: string;
  method: 'GET' | 'POST' | null;
  routeTemplate: string;
  semanticEffect: LmsRouteDefinition['semanticEffect'];
  registrySafeToProbe: boolean;
  evidence: { grade: string; date: string | null; sourceRefs: string[]; limitation: string };
  binding: {
    /** Response identifiers are never silently promoted to required wire parameters. */
    joinKeyCandidates: string[];
    requestFieldNames: string[];
    requestContract: 'bounded_dayrecord_reference' | 'unverified';
    ownership: 'unverified';
    occurrence: 'unverified';
    pagination: 'unverified';
  };
  callable: false;
  requestGate: RequestGate;
}

function gate(effect: EndpointCatalogEntry['semanticEffect'], origin: EndpointOrigin): RequestGate {
  if (effect !== 'read') return 'blocked_effect';
  return origin === 'source_candidate' ? 'unreviewed_candidate' : 'reviewed_adapter_and_scope_required';
}

function canonicalEntry(route: LmsRouteDefinition): EndpointCatalogEntry {
  return {
    id: route.id, family: route.category, origin: 'canonical', operation: route.operation,
    method: route.httpMethod, routeTemplate: route.routeTemplate,
    semanticEffect: route.semanticEffect, registrySafeToProbe: route.safeToProbe,
    evidence: { grade: route.evidenceGrade, date: route.evidenceDate, sourceRefs: [...route.sourceRefs], limitation: route.reason },
    binding: { joinKeyCandidates: [...route.joinKeyNames], requestFieldNames: [...route.requiredParams],
      requestContract: route.id === 'day_record_read' ? 'bounded_dayrecord_reference' : 'unverified',
      ownership: 'unverified', occurrence: 'unverified', pagination: 'unverified' },
    callable: false, requestGate: gate(route.semanticEffect, 'canonical'),
  };
}

function candidateEntry(source: SourceEndpointCandidate): EndpointCatalogEntry {
  return {
    id: source.id, family: source.family, origin: 'source_candidate', operation: source.operation,
    method: source.method, routeTemplate: source.routeTemplate,
    semanticEffect: source.semanticEffect, registrySafeToProbe: false,
    evidence: { grade: 'source_candidate_not_live_verified', date: null, sourceRefs: [...source.sourceRefs], limitation: source.caveat },
    binding: { joinKeyCandidates: [...source.candidateKeyNames], requestFieldNames: [], requestContract: 'unverified',
      ownership: 'unverified', occurrence: 'unverified', pagination: 'unverified' },
    callable: false, requestGate: gate(source.semanticEffect, 'source_candidate'),
  };
}

/** Injectable fixtures allow extension tests without touching the canonical evidence file. */
export function buildEndpointCatalog(
  canonical = getAllRoutes(), candidates = sourceEndpointCandidates(),
): EndpointCatalogEntry[] {
  const entries = [...canonical.map(canonicalEntry), ...candidates.map(candidateEntry)];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.id.trim() || ids.has(entry.id)) throw new Error('duplicate_catalog_id');
    ids.add(entry.id);
  }
  return entries.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface EndpointQuery {
  id?: string;
  family?: string;
  origin?: EndpointOrigin;
  effect?: EndpointCatalogEntry['semanticEffect'];
  callableOnly?: boolean;
  projection?: 'compact' | 'full' | 'summary';
  limit?: number;
}

export interface CompactEndpoint {
  id: string;
  family: string;
  origin: EndpointOrigin;
  effect: EndpointCatalogEntry['semanticEffect'];
  gate: RequestGate;
}

export function queryEndpoints(query: EndpointQuery = {}, entries = buildEndpointCatalog()) {
  if (query.origin && !['canonical', 'source_candidate'].includes(query.origin)) throw new Error('invalid_origin');
  if (query.effect && !['read', 'write', 'send', 'open_send_screen', 'unknown'].includes(query.effect)) throw new Error('invalid_effect');
  if (query.projection && !['compact', 'full', 'summary'].includes(query.projection)) throw new Error('invalid_projection');
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 500)) throw new Error('invalid_limit');
  if (query.id && !entries.some(e => e.id === query.id)) throw new Error('unknown_endpoint_id');
  const sorted = [...entries].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const matched = sorted.filter(e => (!query.id || e.id === query.id)
    && (!query.family || e.family === query.family) && (!query.origin || e.origin === query.origin)
    && (!query.effect || e.semanticEffect === query.effect) && (!query.callableOnly || e.callable));
  const projection = query.projection ?? 'compact';
  const selected = matched.slice(0, query.limit ?? 500);
  const rows: Array<CompactEndpoint | EndpointCatalogEntry> = projection === 'summary' ? []
    : projection === 'full' ? structuredClone(selected) : selected.map(e => ({
      id: e.id, family: e.family, origin: e.origin, effect: e.semanticEffect, gate: e.requestGate,
    }));
  return {
    schemaVersion: 1 as const, scope: 'accessible_static_sources_not_deployed_backend_completeness',
    projection, totalCatalog: entries.length, matched: matched.length, shown: rows.length,
    truncated: projection !== 'summary' && selected.length < matched.length,
    callable: 0, rows,
  };
}

/** Deliberately always empty. Safe-to-probe metadata is not a live execution capability. */
export function callableEndpoints(): readonly never[] { return []; }

export function requireCallableEndpoint(_id: string): never {
  throw new Error('no_live_adapter_activated');
}

/** Byte measurements of the same exact query, not tokenizer estimates or live latency claims. */
export function endpointOutputMetrics(query: Omit<EndpointQuery, 'projection'> = {}, entries = buildEndpointCatalog()) {
  const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x)).byteLength;
  const fullBytes = bytes(queryEndpoints({ ...query, projection: 'full' }, entries));
  const compactBytes = bytes(queryEndpoints({ ...query, projection: 'compact' }, entries));
  const summaryBytes = bytes(queryEndpoints({ ...query, projection: 'summary' }, entries));
  return { metric: 'utf8_json_bytes_same_query' as const, fullBytes, compactBytes, summaryBytes,
    compactReductionFraction: 1 - compactBytes / fullBytes,
    summaryReductionFraction: 1 - summaryBytes / fullBytes, tokenizerMeasured: false, liveLatencyMeasured: false };
}

/** Required evidence for a future bounded reader. Validating evidence never enables a request. */
export interface ReaderEvidenceEnvelope {
  operationId: string;
  adapterRevision: string;
  observedAt: string;
  authentication: 'explicit_scoped_channel';
  ownershipProofRef: string;
  selectorProofRef: string;
  binding: {
    teacherKey: string;
    studentKey: string;
    lessonDate: string;
    courseKey: string;
    recordKey: string;
    curriculumKey: string;
    occurrenceKey: string;
    proofRef: string;
  };
  pagination: {
    mode: 'page' | 'cursor' | 'verified_single_page';
    pagesRead: number;
    exhausted: boolean;
    duplicateKeys: number;
    expectedRows: number | null;
    observedRows: number;
    completeness: 'complete' | 'partial' | 'unknown';
    proofRef: string;
  };
}

export function validateReaderEvidence(e: ReaderEvidenceEnvelope): void {
  const nonblank = (x: unknown) => typeof x === 'string' && x.trim().length > 0;
  const requiredBindings = ['teacherKey', 'studentKey', 'lessonDate', 'courseKey', 'recordKey',
    'curriculumKey', 'occurrenceKey', 'proofRef'] as const;
  if (!e || !e.binding || !e.pagination || ![
    e.operationId, e.adapterRevision, e.ownershipProofRef, e.selectorProofRef,
    ...requiredBindings.map(key => e.binding[key]), e.pagination.proofRef,
  ].every(nonblank) || e.authentication !== 'explicit_scoped_channel') throw new Error('incomplete_reader_provenance');
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const timestamp = typeof e.observedAt === 'string'
    ? /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(e.observedAt) : null;
  if (!timestamp || !validDate(timestamp[1]!) || !Number.isFinite(Date.parse(e.observedAt))
    || !validDate(e.binding.lessonDate)) throw new Error('invalid_reader_timestamp');
  const p = e.pagination;
  if (!['page', 'cursor', 'verified_single_page'].includes(p.mode)
    || !['complete', 'partial', 'unknown'].includes(p.completeness)
    || typeof p.exhausted !== 'boolean'
    || ![p.pagesRead, p.duplicateKeys, p.observedRows].every(n => Number.isSafeInteger(n) && n >= 0)
    || (p.expectedRows !== null && (!Number.isSafeInteger(p.expectedRows) || p.expectedRows < 0))) throw new Error('invalid_pagination_evidence');
  if (p.completeness === 'complete' && (!p.exhausted || p.pagesRead < 1 || p.duplicateKeys !== 0
    || p.expectedRows === null || p.expectedRows !== p.observedRows
    || (p.mode === 'verified_single_page' && p.pagesRead !== 1))) throw new Error('unproven_complete_read');
}
