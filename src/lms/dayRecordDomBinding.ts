/**
 * Passive DayRecord row binding from caller-supplied, sanitized DOM metadata.
 * No browser, HTML loader, network, authentication, storage, or handler execution.
 * A resolved tuple is source/DOM identity evidence, not an occurrence or ownership proof.
 */

export const DAY_RECORD_HANDLER_SIGNATURES = Object.freeze({
  onAttn: Object.freeze(['i', 'course_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const),
  onFoPrg: Object.freeze(['i', 'course_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const),
  onFoHw: Object.freeze(['i', 'course_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const),
  onFoMm: Object.freeze(['i', 'course_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const),
  onFoStuMemo: Object.freeze(['i', 'stu_pri_no', 'course_seq'] as const),
  onOpenDaysMain: Object.freeze(['student_pri_no'] as const),
  onDailyReport: Object.freeze(['report_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const),
  setDailyTest: Object.freeze(['record_seq', 'cm_seq', 'count'] as const),
  openHomeWorkRate: Object.freeze(['record_seq', 'cm_seq', 'count'] as const),
});

export type DayRecordHandler = keyof typeof DAY_RECORD_HANDLER_SIGNATURES;
export type DayRecordEvent = 'onchange' | 'onfocusout' | 'onclick';
export type DayRecordColumnGroup = 'current_progress' | 'previous_progress' | 'identity' | 'unknown';

const CORE_HANDLERS = ['onAttn', 'onFoPrg', 'onFoHw', 'onFoMm'] as const;
const IDENTITY_KEYS = ['i', 'course_seq', 'stu_pri_no', 'record_seq', 'cm_seq'] as const;
const EVENTS: Readonly<Record<DayRecordHandler, DayRecordEvent>> = Object.freeze({
  onAttn: 'onchange', onFoPrg: 'onfocusout', onFoHw: 'onfocusout', onFoMm: 'onfocusout',
  onFoStuMemo: 'onfocusout', onOpenDaysMain: 'onclick', onDailyReport: 'onclick',
  setDailyTest: 'onclick', openHomeWorkRate: 'onclick',
});
const GROUPS: Readonly<Record<DayRecordHandler, DayRecordColumnGroup>> = Object.freeze({
  onAttn: 'current_progress', onFoPrg: 'current_progress', onFoHw: 'current_progress',
  onFoMm: 'current_progress', onDailyReport: 'current_progress', setDailyTest: 'current_progress',
  onFoStuMemo: 'identity', onOpenDaysMain: 'identity', openHomeWorkRate: 'previous_progress',
});
const SOURCE_LIMIT = 4096;
const LITERAL_LIMIT = 128;

export interface DayRecordEventAttribute {
  event: DayRecordEvent;
  /** One event-attribute call, not an entire script, HTML document, or runtime object. */
  source: string;
  /** Supplied by the DOM collector from the actual header/column layout. */
  columnGroup: DayRecordColumnGroup;
}

export interface DayRecordSourceSignature {
  handler: DayRecordHandler;
  /** Current inline-source parameter names; callers must not silently substitute a dated signature. */
  parameterNames: readonly string[];
}

export type DayRecordIssueCode =
  | 'invalid_input' | 'source_too_long' | 'unsupported_statement' | 'unknown_handler'
  | 'unsupported_literal' | 'argument_count_mismatch' | 'event_handler_mismatch'
  | 'handler_column_mismatch' | 'duplicate_handler' | 'missing_handler'
  | 'missing_source_signature' | 'duplicate_source_signature' | 'source_signature_mismatch'
  | 'nonpositive_identity' | 'conflicting_identity' | 'conflicting_corroboration';

export interface DayRecordIssue {
  code: DayRecordIssueCode;
  /** Only allowlisted names are returned; diagnostics never echo raw source or identifiers. */
  handler?: DayRecordHandler;
  field?: typeof IDENTITY_KEYS[number];
}

export type DayRecordHandlerParse =
  | { status: 'parsed'; handler: DayRecordHandler; event: DayRecordEvent;
      columnGroup: DayRecordColumnGroup; statementPrefix: 'none' | 'return' | 'javascript_label';
      literalArguments: string[]; bindings: Record<string, string> }
  | { status: 'unresolved'; issue: DayRecordIssue };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isHandler = (value: unknown): value is DayRecordHandler =>
  typeof value === 'string' && Object.hasOwn(DAY_RECORD_HANDLER_SIGNATURES, value);
const positiveDecimal = (value: string | undefined) =>
  typeof value === 'string' && /^\d+$/.test(value) && /[1-9]/.test(value);
const unresolved = (code: DayRecordIssueCode, handler?: DayRecordHandler): DayRecordHandlerParse =>
  ({ status: 'unresolved', issue: { code, ...(handler ? { handler } : {}) } });

/**
 * Intentionally smaller than JavaScript: only an allowlisted single call and decimal
 * literals, optionally single/double quoted, are accepted. No escapes, templates,
 * comments, expressions, names, booleans, signs, exponents, or extra statements.
 * Exactly one observed javascript: statement label is accepted in an HTML event
 * body. It is never interpreted as an href/URL and cannot be nested or encoded.
 * Quoted decimal IDs remain opaque strings, including leading zeroes and large IDs.
 * Unquoted numbers must be canonical safe integers so lexical extraction agrees
 * with the value JavaScript would pass (no legacy octal or numeric rounding).
 */
export function parseDayRecordHandlerAttribute(input: DayRecordEventAttribute): DayRecordHandlerParse {
  if (!isRecord(input) || typeof input.source !== 'string') return unresolved('invalid_input');
  if (input.source.length > SOURCE_LIMIT) return unresolved('source_too_long');
  // A line break after return changes JavaScript semantics via automatic semicolon insertion.
  const call = /^\s*(?:(javascript:)[ \t]*|(return)[ \t]+)?([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/.exec(input.source);
  if (!call) return unresolved('unsupported_statement');
  const handler = call[3];
  if (!isHandler(handler)) return unresolved('unknown_handler');
  if (input.event !== EVENTS[handler]) return unresolved('event_handler_mismatch', handler);
  if (input.columnGroup !== GROUPS[handler]) return unresolved('handler_column_mismatch', handler);
  const tokens = call[4].trim() === '' ? [] : call[4].split(',');
  const signature = DAY_RECORD_HANDLER_SIGNATURES[handler];
  if (tokens.length !== signature.length) return unresolved('argument_count_mismatch', handler);
  const literalArguments: string[] = [];
  for (const token of tokens) {
    const literal = /^\s*(?:([0-9]+)|'([0-9]+)'|"([0-9]+)")\s*$/.exec(token);
    const value = literal?.[1] ?? literal?.[2] ?? literal?.[3];
    if (!value || value.length > LITERAL_LIMIT) return unresolved('unsupported_literal', handler);
    if (literal?.[1] !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(value)
      || value.length > 16 || (value.length === 16 && value > '9007199254740991'))) {
      return unresolved('unsupported_literal', handler);
    }
    literalArguments.push(value);
  }
  return {
    status: 'parsed', handler, event: EVENTS[handler], columnGroup: GROUPS[handler],
    statementPrefix: call[1] ? 'javascript_label' : call[2] ? 'return' : 'none', literalArguments,
    bindings: Object.fromEntries(signature.map((name, index) => [name, literalArguments[index]])),
  };
}

export interface DayRecordDomRowInput {
  attributes: readonly DayRecordEventAttribute[];
  sourceSignatures: readonly DayRecordSourceSignature[];
}

/** All fields are opaque strings. i is a UI-row index, never a student/occurrence identifier. */
export interface DayRecordDomIdentity {
  i: string;
  course_seq: string;
  stu_pri_no: string;
  record_seq: string;
  cm_seq: string;
}

export interface DayRecordReportBinding {
  report_seq: string;
  stu_pri_no: string;
  record_seq: string;
  cm_seq: string;
  relationship: 'same_current_student_record_and_membership';
  /** Even a nonzero report identifier is not a sent/delivered receipt. */
  deliveryEvidence: 'not_established';
}

export interface DayRecordPreviousProgressBinding {
  record_seq: string;
  cm_seq: string;
  count: string;
  sourceHandler: 'openHomeWorkRate';
  columnGroup: 'previous_progress';
  sameRecordAsCurrent: boolean;
  sameMembershipAsCurrent: boolean;
  relationship: 'separate_previous_column_binding';
  occurrenceDateEvidence: 'not_established';
}

export type DayRecordDomBindingResult =
  | { status: 'unresolved'; issues: DayRecordIssue[]; identity: null }
  | { status: 'resolved'; evidence: 'passive_dom_literals_and_matching_source_signatures';
      identity: DayRecordDomIdentity; corroboratingHandlers: DayRecordHandler[];
      report: DayRecordReportBinding | null; previousProgress: DayRecordPreviousProgressBinding | null;
      instructorProof: 'not_established_by_row'; occurrenceDateProof: 'not_established_by_row' };

/**
 * Resolve one row only when all four independently rendered current-progress
 * handlers and their current source signatures agree. No fallback to a name,
 * form-wide course_seq, a previous-progress record, or one surviving handler.
 */
export function bindDayRecordDomRow(input: DayRecordDomRowInput): DayRecordDomBindingResult {
  const fail = (issues: DayRecordIssue[]): DayRecordDomBindingResult => ({ status: 'unresolved', identity: null, issues });
  if (!isRecord(input) || !Array.isArray(input.attributes) || !Array.isArray(input.sourceSignatures)
    || input.attributes.length > 32 || input.sourceSignatures.length > 32) return fail([{ code: 'invalid_input' }]);
  const issues: DayRecordIssue[] = [];
  const signatures = new Map<DayRecordHandler, readonly string[]>();
  for (const signature of input.sourceSignatures) {
    if (!isRecord(signature) || !isHandler(signature.handler) || !Array.isArray(signature.parameterNames)
      || !signature.parameterNames.every(name => typeof name === 'string')) return fail([{ code: 'invalid_input' }]);
    if (signatures.has(signature.handler)) issues.push({ code: 'duplicate_source_signature', handler: signature.handler });
    signatures.set(signature.handler, signature.parameterNames);
  }
  const calls = new Map<DayRecordHandler, Extract<DayRecordHandlerParse, { status: 'parsed' }>>();
  for (const attribute of input.attributes) {
    const parsed = parseDayRecordHandlerAttribute(attribute);
    if (parsed.status === 'unresolved') { issues.push(parsed.issue); continue; }
    if (calls.has(parsed.handler)) issues.push({ code: 'duplicate_handler', handler: parsed.handler });
    calls.set(parsed.handler, parsed);
    const actualSignature = signatures.get(parsed.handler);
    const expectedSignature = DAY_RECORD_HANDLER_SIGNATURES[parsed.handler];
    if (!actualSignature) issues.push({ code: 'missing_source_signature', handler: parsed.handler });
    else if (actualSignature.length !== expectedSignature.length
      || actualSignature.some((name, index) => name !== expectedSignature[index])) {
      issues.push({ code: 'source_signature_mismatch', handler: parsed.handler });
    }
  }
  for (const handler of CORE_HANDLERS) if (!calls.has(handler)) issues.push({ code: 'missing_handler', handler });
  if (issues.length) return fail(issues);

  const canonical = calls.get('onAttn')!.bindings;
  for (const handler of CORE_HANDLERS) {
    const bindings = calls.get(handler)!.bindings;
    for (const field of IDENTITY_KEYS) {
      if (bindings[field] !== canonical[field]) issues.push({ code: 'conflicting_identity', handler, field });
      if (field !== 'i' && !positiveDecimal(bindings[field])) issues.push({ code: 'nonpositive_identity', handler, field });
    }
  }
  const corroboration: ReadonlyArray<[DayRecordHandler, ReadonlyArray<[string, keyof DayRecordDomIdentity]>]> = [
    ['onFoStuMemo', [['i', 'i'], ['course_seq', 'course_seq'], ['stu_pri_no', 'stu_pri_no']]],
    ['onOpenDaysMain', [['student_pri_no', 'stu_pri_no']]],
    ['onDailyReport', [['stu_pri_no', 'stu_pri_no'], ['record_seq', 'record_seq'], ['cm_seq', 'cm_seq']]],
    ['setDailyTest', [['record_seq', 'record_seq'], ['cm_seq', 'cm_seq']]],
  ];
  const corroboratingHandlers: DayRecordHandler[] = [];
  for (const [handler, fields] of corroboration) {
    const call = calls.get(handler);
    if (!call) continue;
    for (const [argument, field] of fields) if (call.bindings[argument] !== canonical[field]) {
      issues.push({ code: 'conflicting_corroboration', handler, field });
    }
    corroboratingHandlers.push(handler);
  }
  const previous = calls.get('openHomeWorkRate')?.bindings;
  if (previous && (!positiveDecimal(previous.record_seq) || !positiveDecimal(previous.cm_seq))) {
    issues.push({ code: 'nonpositive_identity', handler: 'openHomeWorkRate' });
  }
  if (issues.length) return fail(issues);

  const identity: DayRecordDomIdentity = {
    i: canonical.i, course_seq: canonical.course_seq, stu_pri_no: canonical.stu_pri_no,
    record_seq: canonical.record_seq, cm_seq: canonical.cm_seq,
  };
  const report = calls.get('onDailyReport')?.bindings;
  return {
    status: 'resolved', evidence: 'passive_dom_literals_and_matching_source_signatures', identity,
    corroboratingHandlers,
    report: report ? {
      report_seq: report.report_seq, stu_pri_no: report.stu_pri_no, record_seq: report.record_seq,
      cm_seq: report.cm_seq, relationship: 'same_current_student_record_and_membership', deliveryEvidence: 'not_established',
    } : null,
    previousProgress: previous ? {
      record_seq: previous.record_seq, cm_seq: previous.cm_seq, count: previous.count,
      sourceHandler: 'openHomeWorkRate', columnGroup: 'previous_progress',
      sameRecordAsCurrent: previous.record_seq === identity.record_seq,
      sameMembershipAsCurrent: previous.cm_seq === identity.cm_seq,
      relationship: 'separate_previous_column_binding', occurrenceDateEvidence: 'not_established',
    } : null,
    instructorProof: 'not_established_by_row', occurrenceDateProof: 'not_established_by_row',
  };
}

/** Caller-classified metadata: never pass arbitrary hidden field contents as dates. */
export type DayRecordDateFieldMetadata =
  | { classification: 'valid_date'; normalizedIsoDate: string }
  | { classification: 'missing' | 'empty' | 'non_date' | 'unknown' };

export interface DayRecordInstructorMetadata {
  instructorFieldPresent: boolean;
  instructorFieldNonempty: boolean;
  principalFieldPresent: boolean;
  /** A same-page comparison result only; no teacher/principal identifier belongs here. */
  equalsPrincipal: boolean | null;
}

export type DayRecordSelectionState = 'choose_placeholder' | 'specific' | 'all' | 'absent' | 'unknown';
export interface DayRecordDomViewInput {
  rows: readonly DayRecordDomRowInput[];
  dateFields?: { std_date?: DayRecordDateFieldMetadata; std_ymd?: DayRecordDateFieldMetadata };
  instructor?: DayRecordInstructorMetadata;
  selections?: { group: DayRecordSelectionState; student: DayRecordSelectionState };
}

type DateClassification = DayRecordDateFieldMetadata['classification'] | 'invalid_metadata';
function dateMetadata(input: unknown): { classification: DateClassification; iso: string | null } {
  if (input === undefined) return { classification: 'missing', iso: null };
  if (!isRecord(input)) return { classification: 'invalid_metadata', iso: null };
  if (['missing', 'empty', 'non_date', 'unknown'].includes(input.classification as string)) {
    return input.normalizedIsoDate === undefined
      ? { classification: input.classification as DateClassification, iso: null }
      : { classification: 'invalid_metadata', iso: null };
  }
  if (input.classification !== 'valid_date' || typeof input.normalizedIsoDate !== 'string') {
    return { classification: 'invalid_metadata', iso: null };
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.normalizedIsoDate);
  if (!match) return { classification: 'invalid_metadata', iso: null };
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
    return { classification: 'invalid_metadata', iso: null };
  }
  return { classification: 'valid_date', iso: input.normalizedIsoDate };
}

function instructorStatus(input: unknown): 'dom_principal_match' | 'dom_principal_mismatch' | 'unavailable' | 'invalid_metadata' {
  if (input === undefined) return 'unavailable';
  if (!isRecord(input) || !['instructorFieldPresent', 'instructorFieldNonempty', 'principalFieldPresent']
    .every(name => typeof input[name] === 'boolean')
    || !(input.equalsPrincipal === null || typeof input.equalsPrincipal === 'boolean')) return 'invalid_metadata';
  if ((!input.instructorFieldPresent && input.instructorFieldNonempty)
    || (input.equalsPrincipal !== null && (!input.instructorFieldPresent || !input.instructorFieldNonempty || !input.principalFieldPresent))) {
    return 'invalid_metadata';
  }
  return input.equalsPrincipal === true ? 'dom_principal_match'
    : input.equalsPrincipal === false ? 'dom_principal_mismatch' : 'unavailable';
}

export interface DayRecordDomViewSummary {
  status: 'rows_present' | 'empty_placeholder_view' | 'empty_rendered_table_unproven' | 'invalid_view_input';
  rowCounts: { supplied: number; resolved: number; unresolved: number };
  viewDate: { fieldName: 'std_date'; classification: DateClassification };
  hiddenField: { fieldName: 'std_ymd'; classification: DateClassification };
  dateRelationship: 'matching_valid_dates' | 'conflicting_valid_dates' | 'not_comparable';
  instructorComparison: ReturnType<typeof instructorStatus>;
  independentOccurrenceDate: 'requires_separate_evidence';
  teacherOwnership: 'not_proven_by_dom';
  recordAbsenceForOccurrence: 'not_proven_by_dom';
}

/** Metadata-only aggregate: a header-only/placeholder view never becomes “no records.” */
export function summarizeDayRecordDomView(input: DayRecordDomViewInput): DayRecordDomViewSummary {
  const validInput = isRecord(input) && Array.isArray(input.rows) && input.rows.length <= 1000;
  const fields = validInput && isRecord(input.dateFields) ? input.dateFields : {};
  const view = dateMetadata(fields.std_date);
  const hidden = dateMetadata(fields.std_ymd);
  const allowedSelections: readonly string[] = ['choose_placeholder', 'specific', 'all', 'absent', 'unknown'];
  const selections = validInput ? input.selections : undefined;
  const validSelections = selections === undefined || (isRecord(selections)
    && allowedSelections.includes(selections.group as string) && allowedSelections.includes(selections.student as string));
  const rows = validInput ? input.rows.map(bindDayRecordDomRow) : [];
  const placeholder = selections?.group === 'choose_placeholder' || selections?.student === 'choose_placeholder';
  return {
    status: !validInput || !validSelections ? 'invalid_view_input'
      : rows.length ? 'rows_present' : placeholder ? 'empty_placeholder_view' : 'empty_rendered_table_unproven',
    rowCounts: { supplied: rows.length, resolved: rows.filter(row => row.status === 'resolved').length,
      unresolved: rows.filter(row => row.status === 'unresolved').length },
    viewDate: { fieldName: 'std_date', classification: view.classification },
    hiddenField: { fieldName: 'std_ymd', classification: hidden.classification },
    dateRelationship: view.iso && hidden.iso
      ? view.iso === hidden.iso ? 'matching_valid_dates' : 'conflicting_valid_dates' : 'not_comparable',
    instructorComparison: instructorStatus(validInput ? input.instructor : undefined),
    independentOccurrenceDate: 'requires_separate_evidence', teacherOwnership: 'not_proven_by_dom',
    recordAbsenceForOccurrence: 'not_proven_by_dom',
  };
}
