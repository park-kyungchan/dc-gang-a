import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  DAY_RECORD_HANDLER_SIGNATURES, bindDayRecordDomRow, parseDayRecordHandlerAttribute,
  summarizeDayRecordDomView, type DayRecordDomRowInput, type DayRecordEventAttribute,
  type DayRecordHandler, type DayRecordSourceSignature, type DayRecordDomViewInput,
} from '../../src/lms/dayRecordDomBinding';

// Invented identifiers and dates only. These fixtures are not academy records.
const synthetic = { i: '0', course: '880010001', student: '880020002', record: '880030003', cm: '880040004' };
const core = ['onAttn', 'onFoPrg', 'onFoHw', 'onFoMm'] as const;
const sourceSignatures = (handlers: readonly DayRecordHandler[]): DayRecordSourceSignature[] =>
  handlers.map(handler => ({ handler, parameterNames: [...DAY_RECORD_HANDLER_SIGNATURES[handler]] }));

function attribute(handler: DayRecordHandler, arguments_: readonly string[], quote: 'single' | 'double' | 'bare' = 'single'): DayRecordEventAttribute {
  const render = (value: string) => quote === 'bare' ? value : quote === 'double' ? `"${value}"` : `'${value}'`;
  return {
    event: handler === 'onAttn' ? 'onchange'
      : ['onFoPrg', 'onFoHw', 'onFoMm', 'onFoStuMemo'].includes(handler) ? 'onfocusout' : 'onclick',
    columnGroup: handler === 'openHomeWorkRate' ? 'previous_progress'
      : ['onOpenDaysMain', 'onFoStuMemo'].includes(handler) ? 'identity' : 'current_progress',
    source: `${handler}(${arguments_.map(render).join(',')});`,
  };
}

function row(values = synthetic): DayRecordDomRowInput {
  const args = [values.i, values.course, values.student, values.record, values.cm];
  return { attributes: core.map(handler => attribute(handler, args)), sourceSignatures: sourceSignatures(core) };
}
function withExtra(input: DayRecordDomRowInput, handler: DayRecordHandler, arguments_: readonly string[]): DayRecordDomRowInput {
  return { attributes: [...input.attributes, attribute(handler, arguments_)],
    sourceSignatures: [...input.sourceSignatures, ...sourceSignatures([handler])] };
}
const issues = (input: DayRecordDomRowInput) => {
  const result = bindDayRecordDomRow(input);
  expect(result.status).toBe('unresolved');
  if (result.status !== 'unresolved') throw new Error('expected unresolved fixture');
  expect(result.identity).toBeNull();
  return result.issues;
};
const selectedView = (rows: DayRecordDomRowInput[] = [row()]): DayRecordDomViewInput => ({
  rows, selections: { group: 'specific', student: 'specific' },
  dateFields: { std_date: { classification: 'valid_date', normalizedIsoDate: '2034-04-12' },
    std_ymd: { classification: 'valid_date', normalizedIsoDate: '2034-04-12' } },
  instructor: { instructorFieldPresent: true, instructorFieldNonempty: true,
    principalFieldPresent: true, equalsPrincipal: true },
});

describe('single-call literal grammar without JavaScript execution', () => {
  test.each([...core])('accepts exactly the observed javascript: event-statement label for %s', handler => {
    const input = attribute(handler, [synthetic.i, synthetic.course, synthetic.student, synthetic.record, synthetic.cm]);
    input.source = `javascript: ${input.source}`;
    expect(parseDayRecordHandlerAttribute(input)).toMatchObject({ status: 'parsed', handler,
      statementPrefix: 'javascript_label', bindings: { record_seq: synthetic.record } });
  });

  test('prefixed current-row handlers resolve independently of absent popup principal metadata', () => {
    const fixture = row();
    fixture.attributes = fixture.attributes.map(a => ({ ...a, source: `javascript:${a.source}` }));
    expect(bindDayRecordDomRow(fixture)).toMatchObject({ status: 'resolved', identity: { record_seq: synthetic.record }, instructorProof: 'not_established_by_row' });
    const view = selectedView([fixture]);
    view.selections = { group: 'choose_placeholder', student: 'absent' };
    view.instructor = { instructorFieldPresent: true, instructorFieldNonempty: true, principalFieldPresent: false, equalsPrincipal: null };
    expect(summarizeDayRecordDomView(view)).toMatchObject({ status: 'rows_present', rowCounts: { resolved: 1 },
      instructorComparison: 'unavailable', teacherOwnership: 'not_proven_by_dom' });
  });

  test('rejects unknown, nested, encoded, combined-return labels and href context', () => {
    const call = attribute('onAttn', [synthetic.i, synthetic.course, synthetic.student, synthetic.record, synthetic.cm]);
    for (const prefix of ['other:', 'JavaScript:', 'javaScript:', 'javascript:javascript:', 'javascript:other:',
      'java%73cript:', 'javascript%3A', 'javascript&#58;', 'java\\u0073cript:', 'java\u200bscript:',
      'javascript: return ', 'return javascript:', 'javascript:;']) {
      expect(parseDayRecordHandlerAttribute({ ...call, source: prefix + call.source }).status).toBe('unresolved');
    }
    expect(parseDayRecordHandlerAttribute({ ...call, source: 'javascript:' + call.source, event: 'href' } as never).status).toBe('unresolved');
    expect(parseDayRecordHandlerAttribute({ ...call, source: 'javascript:' + call.source + 'save();' }).status).toBe('unresolved');
  });

  test('the observed label does not weaken safe integer, literal, signature or extra-statement rules', () => {
    for (const source of [
      "javascript:onAttn('0','1','2',010,'4')",
      "javascript:onAttn('0','1','2',9007199254740993,'4')",
      "javascript:onAttn('0','1','2',this.value,'4')",
      "javascript:onAttn('0','1','2','3','4');return false;",
      "javascript:onAttn('0','1','2','3','4'),save()",
      "javascript:return\nonAttn('0','1','2','3','4')",
    ]) expect(parseDayRecordHandlerAttribute({ event: 'onchange', columnGroup: 'current_progress', source }).status).toBe('unresolved');
  });

  test('accepts observed quoted and bare decimal lexemes and optional return/semicolon', () => {
    for (const quote of ['single', 'double', 'bare'] as const) {
      const input = attribute('onAttn', ['0', '880010001', '880020002', '880030003', '880040004'], quote);
      input.source = `  return ${input.source}  `;
      const parsed = parseDayRecordHandlerAttribute(input);
      expect(parsed.status).toBe('parsed');
      if (parsed.status === 'parsed') expect(parsed.bindings.record_seq).toBe('880030003');
    }
  });

  test('preserves leading zeroes and integers beyond safe numeric precision', () => {
    const large = '000900719925474099312345678901';
    const fixture = row({ ...synthetic, course: '000880010001', student: large });
    const result = bindDayRecordDomRow(fixture);
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.identity.course_seq).toBe('000880010001');
      expect(result.identity.stu_pri_no).toBe(large);
    }
  });

  test.each(['010', '9007199254740993'])('rejects ambiguous unquoted %s while preserving its quoted identifier', value => {
    const args = ['0', synthetic.course, synthetic.student, value, synthetic.cm];
    expect(parseDayRecordHandlerAttribute(attribute('onAttn', args, 'bare')))
      .toMatchObject({ status: 'unresolved', issue: { code: 'unsupported_literal' } });
    for (const quote of ['single', 'double'] as const) {
      const parsed = parseDayRecordHandlerAttribute(attribute('onAttn', args, quote));
      expect(parsed.status).toBe('parsed');
      if (parsed.status === 'parsed') expect(parsed.bindings.record_seq).toBe(value);
    }
    const bound = bindDayRecordDomRow(row({ ...synthetic, record: value }));
    expect(bound).toMatchObject({ status: 'resolved', identity: { record_seq: value } });
  });

  test('unquoted safe-integer boundary is exact and never numerically coerces identifiers', () => {
    const boundary = parseDayRecordHandlerAttribute(attribute('onAttn', ['0', '1', '2', '9007199254740991', '4'], 'bare'));
    expect(boundary).toMatchObject({ status: 'parsed', bindings: { record_seq: '9007199254740991' } });
    for (const value of ['00', '08', '9007199254740992', '99999999999999999']) {
      expect(parseDayRecordHandlerAttribute(attribute('onAttn', ['0', '1', '2', value, '4'], 'bare')).status).toBe('unresolved');
    }
  });

  test.each([
    "onAttn('0','880010001','880020002',document.cookie,'880040004')",
    "onAttn('0','880010001','880020002',fetch('https://example.invalid'),'880040004')",
    "onAttn('0','880010001','880020002',(globalThis.syntheticMarker=1),'880040004')",
    "onAttn('0','880010001','880020002',`${880030003}`,'880040004')",
    "onAttn('0','880010001','880020002','88\\0030003','880040004')",
    "onAttn('0','880010001','880020002','880030003\\\'','880040004')",
    "onAttn('0','880010001','880020002','880030003\"','880040004')",
    "onAttn('0','880010001','880020002',null,'880040004')",
    "onAttn('0','880010001','880020002',-1,'880040004')",
    "onAttn('0','880010001','880020002',8.8,'880040004')",
    "onAttn('0','880010001','880020002',88e7,'880040004')",
    "onAttn('0','880010001','880020002',0x123,'880040004')",
    "onAttn('0','880010001','880020002',88/*comment*/,'880040004')",
    "onAttn('0','880010001','880020002',['880030003'],'880040004')",
    "onAttn('0','880010001','880020002',true,'880040004')",
    "onAttn('0','880010001','880020002','880030003','880040004');save()",
    "javascript:javascript:onAttn('0','880010001','880020002','880030003','880040004')",
    "onAttn.call(null,'0','880010001','880020002','880030003','880040004')",
    "return\nonAttn('0','880010001','880020002','880030003','880040004')",
    "return\r\nonAttn('0','880010001','880020002','880030003','880040004')",
    "return\u2028onAttn('0','880010001','880020002','880030003','880040004')",
  ])('rejects an unsupported or malicious event source: %#', source => {
    expect(parseDayRecordHandlerAttribute({ event: 'onchange', columnGroup: 'current_progress', source }).status).toBe('unresolved');
  });

  test('rejects unknown/prototype names, incomplete calls and additional arguments', () => {
    for (const source of ["save('1')", "constructor('1')", "__proto__('1')", "onAttn()", "onAttn('1','2')", "onAttn('0','1','2','3','4','5')"]) {
      expect(parseDayRecordHandlerAttribute({ event: 'onchange', columnGroup: 'current_progress', source }).status).toBe('unresolved');
    }
  });

  test('checks event and column ownership rather than accepting any matching function name', () => {
    const valid = attribute('onAttn', ['0', '1', '2', '3', '4']);
    expect(parseDayRecordHandlerAttribute({ ...valid, event: 'onclick' })).toMatchObject({ status: 'unresolved', issue: { code: 'event_handler_mismatch' } });
    expect(parseDayRecordHandlerAttribute({ ...valid, columnGroup: 'previous_progress' })).toMatchObject({ status: 'unresolved', issue: { code: 'handler_column_mismatch' } });
    expect(parseDayRecordHandlerAttribute({ ...valid, columnGroup: 'unknown' })).toMatchObject({ status: 'unresolved', issue: { code: 'handler_column_mismatch' } });
  });

  test('bounds inputs and never echoes raw source or rejected values', () => {
    const marker = 'synthetic-private-marker';
    const invalid = parseDayRecordHandlerAttribute({ event: 'onchange', columnGroup: 'current_progress', source: `onAttn('0','1','2','${marker}','4')` });
    expect(JSON.stringify(invalid)).not.toContain(marker);
    expect(parseDayRecordHandlerAttribute({ event: 'onchange', columnGroup: 'current_progress', source: 'x'.repeat(4097) }))
      .toMatchObject({ status: 'unresolved', issue: { code: 'source_too_long' } });
    expect(parseDayRecordHandlerAttribute(attribute('onAttn', ['0', '1', '2', '9'.repeat(129), '4'])).status).toBe('unresolved');
    for (const input of [null, undefined, {}, { source: 1 }]) expect(parseDayRecordHandlerAttribute(input as never).status).toBe('unresolved');
  });

  test('the module contains no execution or transport mechanism', () => {
    const source = readFileSync(new URL('../../src/lms/dayRecordDomBinding.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\beval\s*\(|\bnew\s+Function\s*\(|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/);
    expect(source).not.toMatch(/^import /m);
  });
});

describe('current row identity consistency and source-signature provenance', () => {
  test('resolves all five lexemes only when four current-row attributes agree', () => {
    const result = bindDayRecordDomRow(row());
    expect(result).toMatchObject({ status: 'resolved', identity: { i: '0', course_seq: synthetic.course,
      stu_pri_no: synthetic.student, record_seq: synthetic.record, cm_seq: synthetic.cm },
    instructorProof: 'not_established_by_row', occurrenceDateProof: 'not_established_by_row' });
  });

  test.each([...core])('a missing %s handler never falls back to remaining handlers or form fields', handler => {
    const fixture = row();
    fixture.attributes = fixture.attributes.filter(a => !a.source.startsWith(handler + '('));
    expect(issues(fixture)).toContainEqual({ code: 'missing_handler', handler });
  });

  test('conflicting identifier and row-index lexemes fail closed without values in diagnostics', () => {
    for (let index = 0; index < 5; index++) {
      const fixture = row();
      const args = [synthetic.i, synthetic.course, synthetic.student, synthetic.record, synthetic.cm];
      args[index] = '777777777';
      fixture.attributes = [...fixture.attributes.slice(0, 3), attribute('onFoMm', args)];
      const result = bindDayRecordDomRow(fixture);
      expect(result.status).toBe('unresolved');
      expect(JSON.stringify(result)).not.toContain('777777777');
      expect(JSON.stringify(result)).not.toContain(synthetic.student);
    }
  });

  test('leading-zero differences are conflicts rather than numeric normalization', () => {
    const fixture = row();
    fixture.attributes = [...fixture.attributes.slice(0, 3), attribute('onFoMm', [synthetic.i, `0${synthetic.course}`, synthetic.student, synthetic.record, synthetic.cm])];
    expect(issues(fixture)).toContainEqual({ code: 'conflicting_identity', handler: 'onFoMm', field: 'course_seq' });
  });

  test('zero-only identifiers are placeholders, while row index zero is allowed', () => {
    expect(bindDayRecordDomRow(row()).status).toBe('resolved');
    expect(issues(row({ ...synthetic, record: '000' }))).toContainEqual({ code: 'nonpositive_identity', handler: 'onAttn', field: 'record_seq' });
  });

  test('missing, changed and duplicate source signatures fail closed', () => {
    const missing = row(); missing.sourceSignatures = missing.sourceSignatures.slice(1);
    expect(issues(missing)).toContainEqual({ code: 'missing_source_signature', handler: 'onAttn' });
    const changed = row(); changed.sourceSignatures = [{ handler: 'onAttn', parameterNames: ['i', 'stu_pri_no', 'course_seq', 'record_seq', 'cm_seq'] }, ...changed.sourceSignatures.slice(1)];
    expect(issues(changed)).toContainEqual({ code: 'source_signature_mismatch', handler: 'onAttn' });
    const duplicate = row(); duplicate.sourceSignatures = [...duplicate.sourceSignatures, duplicate.sourceSignatures[0]];
    expect(issues(duplicate)).toContainEqual({ code: 'duplicate_source_signature', handler: 'onAttn' });
  });

  test('duplicate handlers and malformed row inputs are unresolved', () => {
    const duplicate = row(); duplicate.attributes = [...duplicate.attributes, duplicate.attributes[0]];
    expect(issues(duplicate)).toContainEqual({ code: 'duplicate_handler', handler: 'onAttn' });
    for (const fixture of [null, undefined, {}, { attributes: [], sourceSignatures: null }, { attributes: Array(33).fill({}), sourceSignatures: [] }]) {
      expect(bindDayRecordDomRow(fixture as never)).toMatchObject({ status: 'unresolved', identity: null });
    }
  });

  test('results are detached, deterministic, and independent of attribute order', () => {
    const fixture = row();
    const original = JSON.stringify(fixture);
    expect(bindDayRecordDomRow({ ...fixture, attributes: [...fixture.attributes].reverse() })).toEqual(bindDayRecordDomRow(fixture));
    const result = bindDayRecordDomRow(fixture);
    if (result.status === 'resolved') result.identity.record_seq = '999999999';
    expect(JSON.stringify(fixture)).toBe(original);
    expect(bindDayRecordDomRow(fixture)).toMatchObject({ identity: { record_seq: synthetic.record } });
  });
});

describe('current report and previous-progress identities are distinct domains', () => {
  test('report ID remains distinct from current record ID and is not delivery proof', () => {
    const result = bindDayRecordDomRow(withExtra(row(), 'onDailyReport', ['990050005', synthetic.student, synthetic.record, synthetic.cm]));
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.identity.record_seq).toBe(synthetic.record);
      expect(result.report).toMatchObject({ report_seq: '990050005', record_seq: synthetic.record, deliveryEvidence: 'not_established' });
      expect(result.report?.report_seq).not.toBe(result.identity.record_seq);
    }
  });

  test('a zero report identifier never becomes a positive receipt/existence assertion', () => {
    const result = bindDayRecordDomRow(withExtra(row(), 'onDailyReport', ['0', synthetic.student, synthetic.record, synthetic.cm]));
    expect(result).toMatchObject({ status: 'resolved', report: { report_seq: '0', deliveryEvidence: 'not_established' } });
  });

  test('conflicting report, student detail or daily-test identity cannot corroborate a current row', () => {
    expect(issues(withExtra(row(), 'onDailyReport', ['990050005', '990020002', synthetic.record, synthetic.cm])))
      .toContainEqual({ code: 'conflicting_corroboration', handler: 'onDailyReport', field: 'stu_pri_no' });
    expect(issues(withExtra(row(), 'onOpenDaysMain', ['990020002'])))
      .toContainEqual({ code: 'conflicting_corroboration', handler: 'onOpenDaysMain', field: 'stu_pri_no' });
    expect(issues(withExtra(row(), 'setDailyTest', ['990030003', synthetic.cm, '0'])))
      .toContainEqual({ code: 'conflicting_corroboration', handler: 'setDailyTest', field: 'record_seq' });
  });

  test('all matching optional current handlers are retained as corroboration, not extra rows', () => {
    let fixture = withExtra(row(), 'onFoStuMemo', [synthetic.i, synthetic.student, synthetic.course]);
    fixture = withExtra(fixture, 'onOpenDaysMain', [synthetic.student]);
    fixture = withExtra(fixture, 'setDailyTest', [synthetic.record, synthetic.cm, '0']);
    const result = bindDayRecordDomRow(fixture);
    expect(result).toMatchObject({ status: 'resolved', corroboratingHandlers: ['onFoStuMemo', 'onOpenDaysMain', 'setDailyTest'] });
  });

  test('previous homework can carry a different record with the same membership without current-row conflict', () => {
    const result = bindDayRecordDomRow(withExtra(row(), 'openHomeWorkRate', ['770030003', synthetic.cm, '0']));
    expect(result.status).toBe('resolved');
    if (result.status === 'resolved') {
      expect(result.identity.record_seq).toBe(synthetic.record);
      expect(result.previousProgress).toMatchObject({ record_seq: '770030003', cm_seq: synthetic.cm,
        sameRecordAsCurrent: false, sameMembershipAsCurrent: true, relationship: 'separate_previous_column_binding', occurrenceDateEvidence: 'not_established' });
    }
  });

  test('previous progress never repairs missing current handlers or masquerades as a current column', () => {
    const missing = withExtra(row(), 'openHomeWorkRate', ['770030003', synthetic.cm, '0']);
    missing.attributes = missing.attributes.filter(a => !a.source.startsWith('onAttn('));
    expect(issues(missing)).toContainEqual({ code: 'missing_handler', handler: 'onAttn' });
    const wrongColumn = withExtra(row(), 'openHomeWorkRate', ['770030003', synthetic.cm, '0']);
    wrongColumn.attributes = wrongColumn.attributes.map(a => a.source.startsWith('openHomeWorkRate(') ? { ...a, columnGroup: 'current_progress' } : a);
    expect(issues(wrongColumn)).toContainEqual({ code: 'handler_column_mismatch', handler: 'openHomeWorkRate' });
  });
});

describe('view date, instructor comparison and empty-state summaries remain separate', () => {
  test('matching valid view/hidden dates and principal equality still do not prove an occurrence or ownership', () => {
    expect(summarizeDayRecordDomView(selectedView())).toMatchObject({ status: 'rows_present',
      rowCounts: { supplied: 1, resolved: 1, unresolved: 0 }, dateRelationship: 'matching_valid_dates',
      instructorComparison: 'dom_principal_match', independentOccurrenceDate: 'requires_separate_evidence',
      teacherOwnership: 'not_proven_by_dom', recordAbsenceForOccurrence: 'not_proven_by_dom' });
  });

  test('a non-date hidden std_ymd is not a conflicting valid date', () => {
    const fixture = selectedView(); fixture.dateFields!.std_ymd = { classification: 'non_date' };
    expect(summarizeDayRecordDomView(fixture)).toMatchObject({ hiddenField: { fieldName: 'std_ymd', classification: 'non_date' }, dateRelationship: 'not_comparable', rowCounts: { resolved: 1 } });
  });

  test('two different valid dates are a context conflict without corrupting a consistent row tuple', () => {
    const fixture = selectedView(); fixture.dateFields!.std_ymd = { classification: 'valid_date', normalizedIsoDate: '2034-04-13' };
    expect(summarizeDayRecordDomView(fixture)).toMatchObject({ dateRelationship: 'conflicting_valid_dates', rowCounts: { resolved: 1 }, independentOccurrenceDate: 'requires_separate_evidence' });
  });

  test.each(['2034-02-29', '2034-04-31', '0000-01-01', '2034-4-12', '2034-04-12T00:00:00Z'])('rejects unsupported normalized date metadata: %s', normalizedIsoDate => {
    const fixture = selectedView(); fixture.dateFields!.std_date = { classification: 'valid_date', normalizedIsoDate };
    expect(summarizeDayRecordDomView(fixture)).toMatchObject({ viewDate: { classification: 'invalid_metadata' }, dateRelationship: 'not_comparable' });
  });

  test('empty placeholders are distinguished from selected-but-unproven empty results', () => {
    const placeholder = selectedView([]); placeholder.selections = { group: 'choose_placeholder', student: 'choose_placeholder' };
    expect(summarizeDayRecordDomView(placeholder)).toMatchObject({ status: 'empty_placeholder_view', recordAbsenceForOccurrence: 'not_proven_by_dom' });
    expect(summarizeDayRecordDomView(selectedView([]))).toMatchObject({ status: 'empty_rendered_table_unproven', recordAbsenceForOccurrence: 'not_proven_by_dom' });
    expect(summarizeDayRecordDomView({ rows: [] })).toMatchObject({ status: 'empty_rendered_table_unproven', dateRelationship: 'not_comparable' });
  });

  test('invalid row evidence is counted rather than hidden or converted into no records', () => {
    const missing = row(); missing.attributes = missing.attributes.slice(1);
    expect(summarizeDayRecordDomView(selectedView([row(), missing]))).toMatchObject({ status: 'rows_present', rowCounts: { supplied: 2, resolved: 1, unresolved: 1 } });
  });

  test('principal mismatch, missing principal and inconsistent equality metadata stay explicit', () => {
    const fixture = selectedView(); fixture.instructor!.equalsPrincipal = false;
    expect(summarizeDayRecordDomView(fixture).instructorComparison).toBe('dom_principal_mismatch');
    fixture.instructor = { instructorFieldPresent: true, instructorFieldNonempty: true, principalFieldPresent: false, equalsPrincipal: null };
    expect(summarizeDayRecordDomView(fixture).instructorComparison).toBe('unavailable');
    fixture.instructor.equalsPrincipal = true;
    expect(summarizeDayRecordDomView(fixture).instructorComparison).toBe('invalid_metadata');
  });

  test('invalid view inputs fail closed without raw values in summary output', () => {
    for (const fixture of [null, {}, { rows: 'synthetic-secret' }, { rows: [], selections: { group: 'synthetic-secret', student: 'specific' } }]) {
      const summary = summarizeDayRecordDomView(fixture as never);
      expect(summary.status).toBe('invalid_view_input');
      expect(JSON.stringify(summary)).not.toContain('synthetic-secret');
    }
    expect(JSON.stringify(summarizeDayRecordDomView(selectedView()))).not.toContain(synthetic.student);
  });
});
