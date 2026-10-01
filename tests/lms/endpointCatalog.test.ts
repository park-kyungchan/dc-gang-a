import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getAllRoutes, LmsRouteRegistry, validateCanonicalRegistry } from '../../src/lms/lmsRouteRegistry';
import { sourceEndpointCandidates } from '../../src/lms/endpointCandidates';
import {
  buildEndpointCatalog, callableEndpoints, endpointOutputMetrics, queryEndpoints,
  requireCallableEndpoint, validateReaderEvidence, type ReaderEvidenceEnvelope,
} from '../../src/lms/endpointCatalog';
import { endpointCli } from '../../harness/endpoints';

const root = resolve(import.meta.dir, '../..');
const raw = () => JSON.parse(readFileSync(resolve(root, 'research/backend-map/route-registry.json'), 'utf8'));
const envelope = (): ReaderEvidenceEnvelope => ({
  operationId: 'day_record_read', adapterRevision: 'synthetic-adapter-v1', observedAt: '2026-10-01T04:30:00Z',
  authentication: 'explicit_scoped_channel', ownershipProofRef: 'synthetic:ownership', selectorProofRef: 'synthetic:selector',
  binding: { teacherKey: 'synthetic-teacher', studentKey: 'synthetic-student', lessonDate: '2026-10-01',
    courseKey: 'synthetic-course', recordKey: 'synthetic-record', curriculumKey: 'synthetic-curriculum',
    occurrenceKey: 'synthetic-occurrence', proofRef: 'synthetic:binding' },
  pagination: { mode: 'page', pagesRead: 2, exhausted: true, duplicateKeys: 0, expectedRows: 2,
    observedRows: 2, completeness: 'complete', proofRef: 'synthetic:pagination' },
});

describe('extensible canonical schema without source promotion', () => {
  test('preserves every canonical evidence field and the dated baseline', () => {
    const canonical = getAllRoutes();
    const catalog = buildEndpointCatalog();
    expect(canonical.length).toBe(54); // Baseline observation, not the loader schema.
    for (const route of canonical) {
      const entry = catalog.find(e => e.id === route.id)!;
      expect(entry.origin).toBe('canonical');
      expect(entry.semanticEffect).toBe(route.semanticEffect);
      expect(entry.registrySafeToProbe).toBe(route.safeToProbe);
      expect(entry.evidence.grade).toBe(route.evidenceGrade);
      expect(entry.evidence.sourceRefs).toEqual([...route.sourceRefs]);
      expect(entry.binding.joinKeyCandidates).toEqual([...route.joinKeyNames]);
    }
    expect(catalog.filter(e => e.origin === 'canonical')).toHaveLength(canonical.length);
  });

  test('accepts schema-valid additions and a smaller fixture without editing evidence files', () => {
    const fixture = raw();
    fixture.entries.push({ ...fixture.entries[0], id: 'synthetic_extension', operation: 'SyntheticOperation',
      semantic_effect: 'unknown', safe_to_probe: false });
    expect(validateCanonicalRegistry(fixture).entries).toHaveLength(55);
    expect(validateCanonicalRegistry({ ...fixture, entries: [fixture.entries[0]] }).entries).toHaveLength(1);
    expect(() => validateCanonicalRegistry({ ...fixture, entries: [] })).toThrow();
    expect(getAllRoutes()).toHaveLength(54);
  });

  test('rejects duplicate IDs, malformed arrays/methods/effects and contradictory safety', () => {
    for (const change of [
      { id: '' }, { http_method: 'DELETE' }, { semantic_effect: 'READ_ONLY' },
      { semantic_effect: 'write', safe_to_probe: true }, { source_refs: [42] },
      { join_key_names: null }, { evidence_grade: '' },
    ]) {
      const fixture = raw(); fixture.entries[0] = { ...fixture.entries[0], ...change };
      expect(() => validateCanonicalRegistry(fixture)).toThrow();
    }
    const duplicate = raw(); duplicate.entries.push(duplicate.entries[0]);
    expect(() => validateCanonicalRegistry(duplicate)).toThrow();
  });

  test('validation returns an independent copy and does not echo raw metadata on error', () => {
    const fixture = raw(); const validated = validateCanonicalRegistry(fixture);
    validated.entries[0]!.source_refs.push('synthetic:new');
    expect(fixture.entries[0].source_refs).not.toContain('synthetic:new');
    fixture.entries[0] = { id: 'sensitive-test-marker' };
    try { validateCanonicalRegistry(fixture); throw new Error('expected failure'); }
    catch (error) { expect(String(error)).not.toContain('sensitive-test-marker'); }
  });
});

describe('deterministic metadata query and fail-closed execution', () => {
  test('source candidates stay distinct and have no live-safe declarations', () => {
    const candidates = buildEndpointCatalog().filter(e => e.origin === 'source_candidate');
    expect(candidates.length).toBeGreaterThan(30);
    expect(new Set(candidates.map(e => e.id)).size).toBe(candidates.length);
    for (const entry of candidates) {
      expect(entry.id.startsWith('candidate:')).toBe(true);
      expect(entry.callable).toBe(false);
      expect(entry.registrySafeToProbe).toBe(false);
      expect(entry.evidence.sourceRefs.length).toBeGreaterThan(0);
      expect(entry.binding.requestContract).toBe('unverified');
    }
  });

  test('mutable legacy-source references use resolvable symbol anchors with matching metadata', () => {
    const legacy = (LmsRouteRegistry as unknown as { legacyRoutes: Map<string, {
      operation: string; httpMethod: string; routeTemplate: string;
    }> }).legacyRoutes;
    const anchored = sourceEndpointCandidates().filter(candidate => candidate.sourceRefs.some(ref => ref.includes('#legacyRoutes/')));
    expect(anchored).toHaveLength(5);
    for (const candidate of anchored) {
      const ref = candidate.sourceRefs[0]!;
      const [path, symbol] = ref.split('#legacyRoutes/');
      expect(path).toBe('src/lms/lmsRouteRegistry.ts');
      const target = legacy.get(symbol!)!;
      expect(target).toBeDefined();
      expect(target.operation).toBe(candidate.operation);
      expect(target.httpMethod === candidate.method).toBe(true);
      expect(target.routeTemplate).toBe(candidate.routeTemplate);
    }
    expect(sourceEndpointCandidates().flatMap(candidate => candidate.sourceRefs).some(ref => /^src\/lms\/lmsRouteRegistry\.ts:\d/.test(ref))).toBe(false);
  });

  test('all effects including safe-looking GETs remain noncallable', () => {
    expect(callableEndpoints()).toEqual([]);
    expect(queryEndpoints({ callableOnly: true }).matched).toBe(0);
    for (const entry of buildEndpointCatalog()) expect(() => requireCallableEndpoint(entry.id)).toThrow('no_live_adapter_activated');
    expect(queryEndpoints({ id: 'course_menu', projection: 'full' }).rows[0]).toMatchObject({
      registrySafeToProbe: true, callable: false, requestGate: 'reviewed_adapter_and_scope_required',
    });
    expect(() => LmsRouteRegistry.buildRequest('course_menu', {})).toThrow();
  });

  test('no mutation/send/unknown endpoint receives an executable classification', () => {
    for (const entry of buildEndpointCatalog().filter(e => e.semanticEffect !== 'read')) {
      expect(entry.requestGate).toBe('blocked_effect');
      expect(entry.callable).toBe(false);
    }
  });

  test('sort/filter output is deterministic and limits are explicit', () => {
    const entries = buildEndpointCatalog();
    const q = { origin: 'source_candidate', family: 'assessment', limit: 3 } as const;
    expect(queryEndpoints(q, entries)).toEqual(queryEndpoints(q, [...entries].reverse()));
    const result = queryEndpoints(q);
    expect(result.shown).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.matched).toBeGreaterThan(result.shown);
    expect(queryEndpoints({ id: 'day_record_read' }).matched).toBe(1);
  });

  test('projections are detached and unknown selectors fail closed', () => {
    const entries = buildEndpointCatalog();
    const result = queryEndpoints({ projection: 'full' }, entries);
    result.rows[0]!.id = 'modified';
    expect(entries[0]!.id).not.toBe('modified');
    expect(() => queryEndpoints({ id: 'missing' })).toThrow('unknown_endpoint_id');
    expect(() => queryEndpoints({ effect: 'DELETE' as any })).toThrow();
    expect(() => queryEndpoints({ limit: 0 })).toThrow();
    expect(() => buildEndpointCatalog(getAllRoutes(), [...sourceEndpointCandidates(), sourceEndpointCandidates()[0]!])).toThrow('duplicate_catalog_id');
  });

  test('compact and summary byte savings are measured on identical selected data', () => {
    const metrics = endpointOutputMetrics();
    expect(metrics.fullBytes).toBeGreaterThan(metrics.compactBytes);
    expect(metrics.compactReductionFraction).toBeGreaterThan(0.5);
    expect(metrics.summaryBytes).toBeLessThan(metrics.compactBytes);
    expect(metrics.tokenizerMeasured).toBe(false);
    expect(metrics.liveLatencyMeasured).toBe(false);
    const full = queryEndpoints({ origin: 'canonical', projection: 'full' });
    const compact = queryEndpoints({ origin: 'canonical', projection: 'compact' });
    expect(compact.rows.map(e => e.id)).toEqual(full.rows.map(e => e.id));
    expect(queryEndpoints({ projection: 'summary' }).shown).toBe(0);
  });

  test('CLI is strict, importable, and returns compact metadata by default', () => {
    expect(endpointCli(['--id', 'day_record_read'])).toMatchObject({ projection: 'compact', matched: 1 });
    expect(endpointCli(['--callable-only'])).toMatchObject({ matched: 0, callable: 0 });
    expect(endpointCli(['--metrics', '--projection', 'summary'])).toHaveProperty('metrics');
    for (const args of [['--id'], ['--cookie', 'synthetic'], ['--id', 'x', '--id', 'y'],
      ['--limit', '-1'], ['--limit', 'NaN'], ['--origin', 'bad'], ['--projection', 'bad', '--metrics'], ['--execute']]) {
      expect(() => endpointCli(args)).toThrow();
    }
  });
});

describe('future reader provenance and completeness contract', () => {
  test('validates synthetic complete evidence without granting request permission', () => {
    expect(() => validateReaderEvidence(envelope())).not.toThrow();
    expect(callableEndpoints()).toEqual([]);
  });
  test('requires exact ownership, selector and occurrence provenance', () => {
    for (const key of ['teacherKey', 'studentKey', 'courseKey', 'recordKey', 'curriculumKey', 'occurrenceKey', 'proofRef'] as const) {
      const e = envelope(); e.binding[key] = '';
      expect(() => validateReaderEvidence(e)).toThrow();
    }
    const e = envelope(); e.ownershipProofRef = '';
    expect(() => validateReaderEvidence(e)).toThrow();
  });
  test('rejects missing runtime keys, nonboolean exhaustion and normalized impossible dates', () => {
    const missing = envelope();
    delete (missing.binding as Partial<ReaderEvidenceEnvelope['binding']>).teacherKey;
    expect(() => validateReaderEvidence(missing)).toThrow('incomplete_reader_provenance');
    const badBoolean = envelope();
    (badBoolean.pagination as unknown as { exhausted: string }).exhausted = 'true';
    expect(() => validateReaderEvidence(badBoolean)).toThrow('invalid_pagination_evidence');
    for (const observedAt of ['2026-02-30T04:30:00Z', '2026-10-01T24:00:00Z', '2026-10-01T04:30:00', 'today']) {
      const e = envelope(); e.observedAt = observedAt;
      expect(() => validateReaderEvidence(e)).toThrow('invalid_reader_timestamp');
    }
  });
  test('rejects invalid times, coverage mismatch, duplicates, unexhausted and missing totals', () => {
    for (const change of [{ exhausted: false }, { expectedRows: null }, { expectedRows: 3 },
      { duplicateKeys: 1 }, { pagesRead: 0 }, { mode: 'verified_single_page' as const }]) {
      const e = envelope(); Object.assign(e.pagination, change);
      expect(() => validateReaderEvidence(e)).toThrow();
    }
    const e = envelope(); e.binding.lessonDate = '2026-02-30';
    expect(() => validateReaderEvidence(e)).toThrow('invalid_reader_timestamp');
  });
  test('preserves partial/unknown coverage rather than converting emptiness into absence', () => {
    for (const completeness of ['partial', 'unknown'] as const) {
      const e = envelope(); Object.assign(e.pagination, { completeness, exhausted: false, expectedRows: null, observedRows: 0 });
      expect(() => validateReaderEvidence(e)).not.toThrow();
      expect(e.pagination.completeness).toBe(completeness);
    }
  });
});

describe('authenticated DOM-source evidence remains separate from transport proof', () => {
  const evidence = () => JSON.parse(readFileSync(resolve(root, 'docs/academy-dom-source-evidence.json'), 'utf8'));
  test('records six POST declarations without claiming submitted or captured requests', () => {
    const data = evidence();
    expect(data.shells).toHaveLength(6);
    expect(data.collection.formSubmission).toBe(false);
    expect(data.collection.networkCapture).toBe(false);
    expect(data.collection.hiddenFieldValuesRead).toBe(false);
    expect(data.collection.credentialValuesReadOrExported).toBe(false);
    expect(data.interpretation.callableEntriesActivated).toBe(0);
    for (const shell of data.shells) {
      expect(shell.form.name).toBe('form1');
      expect(shell.form.declaredMethod).toBe('POST');
      expect(shell.requestObserved).toBe(false);
      expect(shell.scopeVerified).toBe(false);
      expect(buildEndpointCatalog().some(entry => entry.id === shell.catalogId)).toBe(true);
    }
    expect(data.shells.filter((shell: { hiddenTeacherFieldName: string }) => shell.hiddenTeacherFieldName === 'tutor_pri_no')).toHaveLength(5);
    expect(data.shells.find((shell: { id: string }) => shell.id === 'day_record_main').hiddenTeacherFieldName).toBe('teacher_pri_no');
  });
  test('keeps new source tokens and write-associated controls noncallable', () => {
    const data = evidence();
    expect(data.additionalOperationCandidates).toHaveLength(7);
    for (const candidate of data.additionalOperationCandidates) {
      expect(candidate.method).toBeNull();
      expect(candidate.effect).toBe('unverified');
      expect(candidate.callable).toBe(false);
    }
    for (const excluded of data.writeAssociatedExclusions) expect(excluded.callable).toBe(false);
    expect(callableEndpoints()).toEqual([]);
    expect(queryEndpoints({ callableOnly: true }).matched).toBe(0);
  });
});
