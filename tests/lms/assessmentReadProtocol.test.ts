import { describe, expect, it } from 'bun:test';
import { buildBrowserAssessmentRead, inspectAssessmentCapture, parseAssessmentSearch, prepareAssessmentRead, readAssessmentBatch } from '../../src/lms/assessmentReadProtocol';
import { encodePaperCode } from '../../src/lms/printedPaperCode';

function capture() {
  const condition = { testing_no: 8101, pri_no: 9101, student_name: 'Invented Student',
    score: { create: 1 }, incorrect: { create: 0 }, similar: { create: 0 }, advance: { create: 0 }, report: { create: 0 } };
  const detail = { result: 'OK', print_list: [{ pri_no: 9101, student_name: 'Invented Student', score: 73,
    exam_list: [{ exam_no: 1, scoring_result: 'O' }, { exam_no: 2, scoring_result: 'X' }] }] };
  return { log: { entries: [{ request: { method: 'POST', url: 'https://dc.gang-a.kr/servlet/controller.common.TestpageSelectExServlet',
    headers: [{ name: 'Cookie', value: 'DO_NOT_EMIT_SYNTHETIC_SECRET' }],
    postData: { mimeType: 'application/x-www-form-urlencoded', text: new URLSearchParams({ p_process: 'getStudyResultSingleTestingSingleUser', condition: JSON.stringify(condition) }).toString() } },
    response: { status: 200, content: { text: JSON.stringify(detail), mimeType: 'text/x-json' } }, startedDateTime: '2099-01-01T06:00:00Z' }] } };
}

describe('assessment read protocol', () => {
  it('extracts an exact captured rendering result without replaying or retaining authentication', () => {
    const result = inspectAssessmentCapture(capture());
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student', score: 73,
      itemCount: 2, correctCount: 1, wrongCount: 1, capturedAt: '2099-01-01T06:00:00Z', detailReplay: 'blocked_rendering_effect_unverified' });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_EMIT_SYNTHETIC_SECRET');
  });

  it('parses only the named result list without executing embedded JavaScript', () => {
    const html = `<script>EXTERN_DIALOG={testResultList: JSON.parse('[{"pNo":"0071","score":0,"testingNo":8101,"priNo":9101,"_id":"opaque","userName":"Invented Student"}]')};throw Error('DO_NOT_EXECUTE')</script>`;
    expect(parseAssessmentSearch(html)).toEqual([{ paperKey: '0071', score: 0, attemptKey: '8101', studentKey: '9101', studentName: 'Invented Student' }]);
  });

  it('reads exact search and score-view operations with browser-managed authentication', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const detail = capture().log.entries[0]!.response.content.text;
    const fetcher = async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(calls.length === 1
        ? `<script>EXTERN_DIALOG={testResultList:JSON.parse('[{"pNo":7101,"score":73,"testingNo":8101,"priNo":9101,"userName":"Invented Student"}]')}</script>` : detail,
        { status: 200, headers: { 'content-type': calls.length === 1 ? 'text/html' : 'text/x-json' } });
    };
    const result = await readAssessmentBatch([{ studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' }],
      { origin: 'https://dc.gang-a.kr', authenticatedTeacherVisible: true, scoreViewAdmission: true, fetcher });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: 'observed', paperCode: encodePaperCode('7101'), score: 73, itemCount: 2, correctCount: 1, wrongCount: 1,
      sourceTimestamp: null, lessonOccurrence: 'unverified', authenticationMode: 'browser_managed_manual' });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('/servlet/controller.dailyzerotest.DailyZeroTestServlet?reqCmd=DtResultSearch');
    expect(calls[0]!.init).toMatchObject({ method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store' });
    const fields = new URLSearchParams(String(calls[1]!.init.body));
    expect(fields.get('p_process')).toBe('getStudyResultSingleTestingSingleUser');
    expect(JSON.parse(fields.get('condition')!)).toEqual({ testing_no: 8101, pri_no: 9101, student_name: 'Invented Student',
      score: { create: 1 }, incorrect: { create: 0 }, similar: { create: 0 }, advance: { create: 0 }, report: { create: 0 } });
    expect(JSON.stringify(calls)).not.toContain('Cookie');
  });

  it('builds a self-contained native browser bridge without exporting authentication', async () => {
    const target = { studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' };
    const expression = buildBrowserAssessmentRead([target], 'Invented Teacher', true);
    const evaluate = new Function('location', 'document', 'fetch', `return ${expression}`);
    let calls = 0;
    const fetcher = async () => new Response(++calls === 1
      ? `<script>EXTERN_DIALOG={testResultList:JSON.parse('[{"pNo":7101,"score":73,"testingNo":8101,"priNo":9101,"userName":"Invented Student"}]')}</script>`
      : capture().log.entries[0]!.response.content.text);
    const result = await evaluate({ origin: 'https://dc.gang-a.kr' },
      { body: { innerText: 'Invented Teacher- [로그아웃]' }, querySelector: () => null }, fetcher);
    expect(result[0]).toMatchObject({ score: 73, correctCount: 1 });
    expect(expression).not.toMatch(/document\.cookie|JSESSIONID|webUserPass|headers.*Cookie/);
  });

  it('retains the successful target when the other read fails', async () => {
    const good = { studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' };
    const bad = { studentKey: '9102', attemptKey: '8102', studentName: 'Second Invented Student' };
    const fetcher = async (url: string, init: RequestInit) => {
      const fields = new URLSearchParams(String(init.body));
      if (fields.get('stu_name') === bad.studentName) return new Response('DO_NOT_LEAK', { status: 503 });
      return new Response(url.includes('DtResultSearch')
        ? `<script>EXTERN_DIALOG={testResultList:JSON.parse('[{"pNo":7101,"score":73,"testingNo":8101,"priNo":9101,"userName":"Invented Student"}]')}</script>`
        : capture().log.entries[0]!.response.content.text);
    };
    const result = await readAssessmentBatch([good, bad], {
      origin: 'https://dc.gang-a.kr', authenticatedTeacherVisible: true, scoreViewAdmission: true, fetcher });
    expect(result.map(x => x.status)).toEqual(['observed', 'blocked']);
    expect(result[1]).toMatchObject({ reason: 'transport_failed' });
    expect(JSON.stringify(result)).not.toContain('DO_NOT_LEAK');
  });

  it('refuses browser preparation without explicit score-view admission', () => {
    expect(() => buildBrowserAssessmentRead([{ studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' }],
      'Invented Teacher', false)).toThrow('score_view_admission_required');
  });

  it('rejects malformed and noncanonical target keys before network I/O', async () => {
    let calls = 0;
    const environment = { origin: 'https://dc.gang-a.kr', authenticatedTeacherVisible: true, scoreViewAdmission: true,
      fetcher: async () => { calls++; return new Response(''); } };
    for (const key of [' 9101', '09101', '9e3', '9007199254740993']) {
      await expect(readAssessmentBatch([{ studentKey: key, attemptKey: '8101', studentName: 'Invented Student' }],
        environment)).rejects.toThrow();
    }
    expect(calls).toBe(0);
  });

  it('rejects a foreign origin or missing admission before network I/O', async () => {
    let calls = 0;
    const target = { studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' };
    const fetcher = async () => { calls++; return new Response(''); };
    await expect(readAssessmentBatch([target], { origin: 'https://other.invalid', authenticatedTeacherVisible: true,
      scoreViewAdmission: true, fetcher })).rejects.toThrow('authentication_required');
    await expect(readAssessmentBatch([target], { origin: 'https://dc.gang-a.kr', authenticatedTeacherVisible: true,
      scoreViewAdmission: false, fetcher })).rejects.toThrow('score_view_admission_required');
    expect(calls).toBe(0);
  });

  it('does not treat a login page or a missing result list as an empty result', () => {
    expect(() => parseAssessmentSearch('<input type="password">')).toThrow('authentication_required');
    expect(() => parseAssessmentSearch('<html>changed layout</html>')).toThrow('result_list_missing_or_ambiguous');
  });

  it('rejects duplicate source rows and absent scores rather than defaulting to zero', () => {
    const row = { pNo: 7101, score: 73, testingNo: 8101, priNo: 9101, userName: 'Invented Student' };
    const html = (rows: unknown[]) => `testResultList:JSON.parse('${JSON.stringify(rows)}')`;
    expect(() => parseAssessmentSearch(html([row, row]))).toThrow('duplicate_search_row');
    const { score, ...missingScore } = row;
    expect(() => parseAssessmentSearch(html([missingScore]))).toThrow('invalid_search_score');
  });

  it('rejects wrong-subject details and unknown scoring enums', () => {
    const changed = capture();
    const entry = changed.log.entries[0]!;
    const detail = JSON.parse(entry.response.content.text);
    detail.print_list[0].pri_no = 9102;
    entry.response.content.text = JSON.stringify(detail);
    expect(() => inspectAssessmentCapture(changed)).toThrow('captured_subject_mismatch');
    detail.print_list[0].pri_no = 9101;
    detail.print_list[0].exam_list[0].scoring_result = '?';
    entry.response.content.text = JSON.stringify(detail);
    expect(() => inspectAssessmentCapture(changed)).toThrow('unknown_captured_scoring');
  });

  it('does not collect a clinic-generation variant as score-only evidence', () => {
    const changed = capture();
    const entry = changed.log.entries[0]!;
    const fields = new URLSearchParams(entry.request.postData.text);
    const condition = JSON.parse(fields.get('condition')!);
    condition.similar.create = 1;
    fields.set('condition', JSON.stringify(condition));
    entry.request.postData.text = fields.toString();
    expect(inspectAssessmentCapture(changed)).toEqual([]);
  });

  it('deduplicates overlapping captures and emits only minimized preparation metadata', () => {
    const prepared = prepareAssessmentRead([capture(), capture()], 'Invented Teacher', true);
    expect(prepared.summary).toEqual({ sourceCaptureCount: 2, capturedViewCount: 2, targetCount: 1, requestsExecuted: 0 });
    expect(JSON.stringify(prepared.summary)).not.toContain('Invented Student');
    expect(prepared.expression).not.toContain('DO_NOT_EMIT_SYNTHETIC_SECRET');
  });

  it('keeps a noncanonical paper key without inventing a normalized print code', async () => {
    let calls = 0;
    const fetcher = async () => new Response(++calls === 1
      ? `<script>EXTERN_DIALOG={testResultList:JSON.parse('[{"pNo":"0071","score":73,"testingNo":8101,"priNo":9101,"userName":"Invented Student"}]')}</script>`
      : capture().log.entries[0]!.response.content.text);
    const result = await readAssessmentBatch([{ studentKey: '9101', attemptKey: '8101', studentName: 'Invented Student' }], {
      origin: 'https://dc.gang-a.kr', authenticatedTeacherVisible: true, scoreViewAdmission: true, fetcher });
    expect(result[0]).toMatchObject({ status: 'observed', paperKey: '0071', paperCode: null });
  });
});
