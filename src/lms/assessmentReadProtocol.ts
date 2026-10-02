/** Credential-free capture analysis and explicitly admitted manual same-origin result reads. */
import { encodePaperCode, PAPER_CODE_ALPHABET } from './printedPaperCode';
const ORIGIN = 'https://dc.gang-a.kr';
const DETAIL_PATH = '/servlet/controller.common.TestpageSelectExServlet';
const DETAIL_COMMAND = 'getStudyResultSingleTestingSingleUser';
export function prepareAssessmentRead(captures: unknown[], teacherLabel: string, scoreViewAdmission: boolean) {
  if (captures.length === 0 || captures.length > 2) throw new Error('invalid_capture_batch');
  const targets = new Map<string, AssessmentReadTarget>();
  let capturedViewCount = 0;
  for (const capture of captures) {
    const observations = inspectAssessmentCapture(capture);
    capturedViewCount += observations.length;
    for (const observation of observations) {
      const { studentKey, attemptKey, studentName } = observation;
      const key = JSON.stringify([studentKey, attemptKey]);
      if (targets.has(key) && targets.get(key)!.studentName !== studentName) throw new Error('capture_identity_conflict');
      renderKey(studentKey); renderKey(attemptKey);
      targets.set(key, { studentKey, attemptKey, studentName });
    }
  }
  if (targets.size === 0 || targets.size > 2) throw new Error('invalid_manual_batch_scope');
  return { expression: buildBrowserAssessmentRead([...targets.values()], teacherLabel, scoreViewAdmission),
    summary: { sourceCaptureCount: captures.length, capturedViewCount, targetCount: targets.size, requestsExecuted: 0 } };
}

export interface AssessmentReadTarget {
  studentKey: string;
  attemptKey: string;
  studentName: string;
}
/** Native browser tool evaluates only this owned code; page scripts and HAR requests are never replayed. */
export function buildBrowserAssessmentRead(targets: AssessmentReadTarget[], teacherLabel: string, scoreViewAdmission?: boolean): string {
  if (scoreViewAdmission !== true) throw new Error('score_view_admission_required');
  name(teacherLabel);
  return `(() => {
    const ORIGIN = ${JSON.stringify(ORIGIN)};
    const DETAIL_PATH = ${JSON.stringify(DETAIL_PATH)};
    const DETAIL_COMMAND = ${JSON.stringify(DETAIL_COMMAND)};
    const PAPER_CODE_ALPHABET = ${JSON.stringify(PAPER_CODE_ALPHABET)};
    ${encodePaperCode.toString()}
    ${object.toString()}
    ${sourceKey.toString()}
    ${renderKey.toString()}
    ${name.toString()}
    ${decodeSingleQuotedString.toString()}
    ${parseAssessmentSearch.toString()}
    ${parseScoreView.toString()}
    ${readAssessmentBatch.toString()}
    return readAssessmentBatch(${JSON.stringify(targets)}, {
      origin: location.origin,
      authenticatedTeacherVisible: !document.querySelector('input[type=password]')
        && !!document.body?.innerText.includes(${JSON.stringify(teacherLabel + '- [로그아웃]')}),
      scoreViewAdmission: true,
      fetcher: (url, init) => fetch(url, init)
    });
  })()`;
}

export interface AssessmentReadEnvironment {
  origin: string;
  authenticatedTeacherVisible: boolean;
  /** Explicit admission of score rendering, never arbitrary create flags. */
  scoreViewAdmission: boolean;
  fetcher: (url: string, init: RequestInit) => Promise<Response>;
}
export interface AssessmentObservation extends AssessmentReadTarget {
  status: 'observed';
  paperKey: string;
  /** Derived display representation; null preserves unsupported source representations without repair. */
  paperCode: string | null;
  score: number;
  itemCount: number;
  correctCount: number;
  wrongCount: number;
  observedAt: string;
  durationMs: number;
  sourceTimestamp: null;
  lessonOccurrence: 'unverified';
  authenticationMode: 'browser_managed_manual';
}
export interface BlockedAssessmentRead extends AssessmentReadTarget {
  status: 'blocked';
  reason: 'transport_failed' | 'authentication_required' | 'contract_rejected';
  observedAt: string;
}
export type AssessmentReadResult = AssessmentObservation | BlockedAssessmentRead;

export async function readAssessmentBatch(
  targets: AssessmentReadTarget[], environment: AssessmentReadEnvironment,
): Promise<AssessmentReadResult[]> {
  if (environment.origin !== ORIGIN || !environment.authenticatedTeacherVisible) throw new Error('authentication_required');
  if (environment.scoreViewAdmission !== true) throw new Error('score_view_admission_required');
  if (targets.length === 0 || targets.length > 2) throw new Error('invalid_manual_batch_scope');
  const seen = new Set<string>();
  for (const target of targets) {
    renderKey(target.studentKey); renderKey(target.attemptKey); name(target.studentName);
    const key = JSON.stringify([target.studentKey, target.attemptKey]);
    if (seen.has(key)) throw new Error('duplicate_read_target');
    seen.add(key);
  }
  return Promise.all(targets.map(async (target): Promise<AssessmentReadResult> => {
    const start = performance.now();
    try {
      const post = async (url: string, fields: Record<string, string>): Promise<string> => {
        const response = await environment.fetcher(url, {
          method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
          body: new URLSearchParams(fields).toString(), signal: AbortSignal.timeout(20_000),
        });
        if (!response.ok || response.redirected) throw new Error('assessment_transport_failed');
        const text = await response.text();
        if (text.length > 2_000_000) throw new Error('assessment_response_too_large');
        return text;
      };
      const html = await post('/servlet/controller.dailyzerotest.DailyZeroTestServlet?reqCmd=DtResultSearch',
        { sort_date: '1', stu_name: target.studentName });
      const matches = parseAssessmentSearch(html).filter(row => row.studentKey === target.studentKey
        && row.attemptKey === target.attemptKey && row.studentName === target.studentName);
      if (matches.length !== 1) throw new Error('exact_attempt_not_observed');
      const row = matches[0]!;
      const condition = { testing_no: renderKey(target.attemptKey), pri_no: renderKey(target.studentKey), student_name: target.studentName,
        score: { create: 1 }, incorrect: { create: 0 }, similar: { create: 0 }, advance: { create: 0 }, report: { create: 0 } };
      const detailText = await post(DETAIL_PATH, { p_process: DETAIL_COMMAND, condition: JSON.stringify(condition) });
      const detail = parseScoreView(JSON.parse(detailText), target);
      if (detail.score !== row.score) throw new Error('search_detail_score_conflict');
      const paperCode = /^[1-9][0-9]{0,15}$/.test(row.paperKey) && BigInt(row.paperKey) <= BigInt(Number.MAX_SAFE_INTEGER)
        ? encodePaperCode(row.paperKey) : null;
      return { ...target, ...detail, status: 'observed', paperKey: row.paperKey, paperCode,
        observedAt: new Date().toISOString(), durationMs: performance.now() - start,
        sourceTimestamp: null, lessonOccurrence: 'unverified', authenticationMode: 'browser_managed_manual' };
    } catch (error) {
      const reason = error instanceof Error && error.message === 'authentication_required' ? 'authentication_required'
        : error instanceof Error && (error.message === 'assessment_transport_failed'
          || ['AbortError', 'TimeoutError', 'TypeError'].includes(error.name)) ? 'transport_failed' : 'contract_rejected';
      return { ...target, status: 'blocked', reason, observedAt: new Date().toISOString() };
    }
  }));
}

export interface CapturedAssessment {
  studentKey: string;
  attemptKey: string;
  studentName: string;
  score: number;
  itemCount: number;
  correctCount: number;
  wrongCount: number;
  capturedAt: string;
  entryIndex: number;
  detailReplay: 'blocked_rendering_effect_unverified';
}

type ObjectValue = Record<string, unknown>;
export interface AssessmentSearchRow {
  paperKey: string;
  score: number;
  attemptKey: string;
  studentKey: string;
  studentName: string;
}

/** Decode a string literal, never evaluate a page script. */
function decodeSingleQuotedString(source: string): string {
  let decoded = '';
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char !== '\\') { decoded += char; continue; }
    const escape = source[++i];
    const escapes: Record<string, string> = { "'": "'", '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '/': '/' };
    if (escape && Object.hasOwn(escapes, escape)) { decoded += escapes[escape]; continue; }
    if (escape === 'u' || escape === 'x') {
      const width = escape === 'u' ? 4 : 2;
      const hex = source.slice(i + 1, i + 1 + width);
      if (hex.length !== width || !/^[0-9a-fA-F]+$/.test(hex)) throw new Error('invalid_embedded_escape');
      decoded += String.fromCharCode(Number.parseInt(hex, 16));
      i += width;
      continue;
    }
    throw new Error('invalid_embedded_escape');
  }
  return decoded;
}

export function parseAssessmentSearch(html: string): AssessmentSearchRow[] {
  if (/<input\b[^>]*\btype\s*=\s*["']password["']/i.test(html)) throw new Error('authentication_required');
  const matches = [...html.matchAll(/\btestResultList\s*:\s*JSON\.parse\(\s*'((?:\\.|[^'\\])*)'\s*\)/g)];
  if (matches.length !== 1) throw new Error('result_list_missing_or_ambiguous');
  const rows: unknown = JSON.parse(decodeSingleQuotedString(matches[0]![1]!));
  if (!Array.isArray(rows)) throw new Error('invalid_result_list');
  const seen = new Set<string>();
  return rows.map(raw => {
    const row = object(raw);
    const studentKey = sourceKey(row.priNo);
    const attemptKey = sourceKey(row.testingNo);
    const paperKey = sourceKey(row.pNo);
    const studentName = name(row.userName);
    if (typeof row.score !== 'number' || !Number.isFinite(row.score) || row.score < 0 || row.score > 100) {
      throw new Error('invalid_search_score');
    }
    const key = JSON.stringify([studentKey, attemptKey, paperKey]);
    if (seen.has(key)) throw new Error('duplicate_search_row');
    seen.add(key);
    return { studentKey, attemptKey, paperKey, studentName, score: row.score };
  });
}

function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_capture_shape');
  return value as ObjectValue;
}
function sourceKey(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[0-9]+$/.test(value) && !/^0+$/.test(value)) return value;
  throw new Error('invalid_source_key');
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('invalid_student_name');
  return value;
}

/** This rendering endpoint requires numeric JSON keys. Never repair a noncanonical or unsafe key. */
function renderKey(value: string): number {
  sourceKey(value);
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric <= 0 || String(numeric) !== value) throw new Error('unsupported_render_key');
  return numeric;
}

function parseScoreView(value: unknown, target: AssessmentReadTarget) {
  const result = object(value);
  if (result.result !== 'OK' || !Array.isArray(result.print_list) || result.print_list.length !== 1) {
    throw new Error('ambiguous_captured_result');
  }
  const paper = object(result.print_list[0]);
  if (sourceKey(paper.pri_no) !== target.studentKey || name(paper.student_name) !== target.studentName) {
    throw new Error('captured_subject_mismatch');
  }
  if (typeof paper.score !== 'number' || !Number.isFinite(paper.score) || paper.score < 0 || paper.score > 100) {
    throw new Error('invalid_captured_score');
  }
  if (!Array.isArray(paper.exam_list) || paper.exam_list.length === 0) throw new Error('captured_items_missing');
  const seen = new Set<string>();
  let correctCount = 0;
  let wrongCount = 0;
  for (const rawItem of paper.exam_list) {
    const item = object(rawItem);
    const key = sourceKey(item.exam_no);
    if (seen.has(key)) throw new Error('duplicate_captured_item');
    seen.add(key);
    if (item.scoring_result === 'O') correctCount++;
    else if (item.scoring_result === 'X') wrongCount++;
    else throw new Error('unknown_captured_scoring');
  }
  return { score: paper.score, itemCount: seen.size, correctCount, wrongCount };
}

function requestFields(request: ObjectValue): URLSearchParams {
  const post = object(request.postData);
  if (typeof post.mimeType !== 'string' || !post.mimeType.startsWith('application/x-www-form-urlencoded')) {
    throw new Error('unsupported_capture_body');
  }
  if (typeof post.text !== 'string') throw new Error('capture_body_missing');
  return new URLSearchParams(post.text);
}

export function inspectAssessmentCapture(capture: unknown): CapturedAssessment[] {
  const entries = object(object(capture).log).entries;
  if (!Array.isArray(entries)) throw new Error('invalid_capture_entries');
  const results: CapturedAssessment[] = [];
  entries.forEach((raw, entryIndex) => {
    const entry = object(raw);
    const request = object(entry.request);
    if (typeof request.url !== 'string') return;
    const url = new URL(request.url);
    if (url.origin !== ORIGIN || url.pathname !== DETAIL_PATH || request.method !== 'POST') return;
    const fields = requestFields(request);
    if (fields.get('p_process') !== DETAIL_COMMAND) return;
    const condition = object(JSON.parse(fields.get('condition') ?? 'null'));
    const flags = ['score', 'incorrect', 'similar', 'advance', 'report'] as const;
    // Analyze only the score-rendering variant. Its server effects remain unverified: never replay it.
    if (!flags.every(key => object(condition[key]).create === (key === 'score' ? 1 : 0))) return;
    const studentKey = sourceKey(condition.pri_no);
    const attemptKey = sourceKey(condition.testing_no);
    const studentName = name(condition.student_name);
    const response = object(entry.response);
    if (response.status !== 200) throw new Error('captured_response_failed');
    const content = object(response.content);
    if (typeof content.text !== 'string') throw new Error('captured_response_missing');
    const text = content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
    const detail = parseScoreView(JSON.parse(text), { studentKey, attemptKey, studentName });
    if (typeof entry.startedDateTime !== 'string' || !Number.isFinite(Date.parse(entry.startedDateTime))) {
      throw new Error('captured_time_missing');
    }
    results.push({ studentKey, attemptKey, studentName, ...detail, capturedAt: entry.startedDateTime, entryIndex,
      detailReplay: 'blocked_rendering_effect_unverified' });
  });
  return results;
}
