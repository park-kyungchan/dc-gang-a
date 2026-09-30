import { expect, test } from 'bun:test';
import { isTeacherUrl, networkSummary, publicTabs, safeBrowserState, structuralSnapshot } from '../../harness/chrome_devtools_session';

test('teacher tab discovery requires exact origin and emits no URL or title', () => {
  expect(isTeacherUrl('https://dc.gang-a.kr/servlet/X?std_seq=1294174')).toBe(true);
  expect(isTeacherUrl('https://dc.gang-a.kr.evil.test/')).toBe(false);
  expect(isTeacherUrl('https://user:pass@dc.gang-a.kr/')).toBe(false);
  const tabs = publicTabs([
    { id: 7, url: 'https://dc.gang-a.kr/servlet/X?std_seq=1294174' },
    { id: 8, url: 'https://dc.gang-a.kr.evil.test/' },
  ]);
  expect(tabs).toEqual([{ id: 7, teacherSite: true }]);
  expect(JSON.stringify(tabs)).not.toContain('1294174');
});

test('snapshot and status expose bounded structure only', () => {
  const snapshot = structuralSnapshot(Array.from({ length: 45 }, (_, i) =>
    `uid=${i} button \"학생 이름 1294174 개인정보\"`).join('\n'));
  expect(snapshot.structuralEntries).toHaveLength(40);
  expect(snapshot.truncated).toBe(true);
  expect(JSON.stringify(snapshot)).not.toContain('1294174');
  expect(JSON.stringify(snapshot)).not.toContain('학생 이름');
  const state = safeBrowserState('{"teacherOrigin":true,"passwordInputPresent":false,"readyState":"complete","formCount":2,"title":"Student 1294174","path":"/student/1294174"}');
  expect(state).toEqual({ teacherOrigin: true, passwordInputPresent: false, readyState: 'complete', formCount: 2 });
  expect(safeBrowserState('{"teacherOrigin":false,"passwordInputPresent":false}')).toBeNull();
});

test('network metadata redacts dynamic paths, values and unapproved query keys', () => {
  const network = networkSummary([
    'reqid=1 GET https://dc.gang-a.kr/servlet/controller.tutor.TutorMenuIndexServlet?p_process=CourseManageIndex&std_seq=1294174 [200]',
    'reqid=2 POST https://dc.gang-a.kr/student/1294174?secretKey=token123 [200]',
    'reqid=3 GET https://elsewhere.test/?private=123 [200]',
  ].join('\n'));
  expect(network.requestLineCount).toBe(3);
  expect(network.requestShapes).toHaveLength(2);
  expect(network.requestShapes[0]?.routeTemplate).toBe('/servlet/controller.tutor.TutorMenuIndexServlet');
  expect(network.requestShapes[0]?.queryKeys).toEqual(['p_process', 'std_seq']);
  expect(network.requestShapes[1]?.routeTemplate).toBe('redacted');
  expect(network.requestShapes[1]?.queryKeys).toEqual([]);
  expect(network.bodiesOrHeadersEmitted).toBe(false);
  expect(JSON.stringify(network)).not.toMatch(/1294174|CourseManageIndex|token123|secretKey/);
});
