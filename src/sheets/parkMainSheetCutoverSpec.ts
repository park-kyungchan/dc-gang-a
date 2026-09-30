/** Review-only layout for the one-time academy Main Sheet cutover. No writer imports this file. */
export type CellPlan = {
  readonly range: string;
  readonly value: string | number | null;
  readonly kind: 'literal' | 'blank' | 'source_fact' | 'teacher_input' | 'derived_status';
  readonly note?: string;
};

export type SectionPlan = {
  readonly range: string;
  readonly title: string;
  readonly headerRow?: number;
  readonly fixedRows?: readonly number[];
  readonly cells: readonly CellPlan[];
};

const literal = (range: string, value: string): CellPlan => ({ range, value, kind: 'literal' });
const blank = (range: string, kind: CellPlan['kind'], note?: string): CellPlan => ({
  range, value: null, kind, note,
});

/**
 * The five identities are a dated layout snapshot from `bun run harness roster --json`.
 * Recheck the canonical roster before a production batch; IDs are never inferred from names.
 */
export const parkCutoverRoster = [
  { row: 9, studentId: '1293032', name: '신지우', grade: '초5' },
  { row: 10, studentId: '1293067', name: '박세은', grade: '초5' },
  { row: 18, studentId: '1294174', name: '이루한', grade: '중1' },
  { row: 19, studentId: '1293138', name: '유지연', grade: '중1' },
  { row: 20, studentId: '1294575', name: '이현승', grade: '중1' },
] as const;

const legacyHeaderRow2 = [
  ['A2', '선생님'], ['B2', '학년'], ['C2', '학생이름'], ['D2', 'LCAD\n점수'],
  ['E2', '지난과정 학기 인증 평가'], ['M2', '현재 진도현황'],
] as const;
const legacyHeaderRow3 = [
  '선행', '학습기간', '평가일', '점수', '심화', '학습기간', '평가일', '점수',
  '선행', '시작일', '예상종료일', '심화', '시작일', '예상종료일',
] as const;

export const parkMainSheetCutoverSpec = {
  schemaVersion: 1,
  asOfKst: '2026-09-29',
  status: 'review_only_no_sheet_write',
  target: {
    workbookTitle: '대치강아 학생진도현황',
    tabTitle: '박경찬',
    sheetId: 1754681846,
    sourceTabTitle: '김예원',
    sourceRange: '김예원!A1:R47',
    destinationLegacyRange: '박경찬!A1:R47',
    destinationNewRange: '박경찬!A48:R110',
    minimumGrid: { rowCount: 110, columnCount: 18 },
    frozenRowCount: 3,
    frozenColumnCount: 3,
    frozenVerticalBoundary: 'C/D',
  },
  evidenceAtDesign: {
    currentTargetGrid: { rows: 72, columns: 16 },
    currentTargetObservedRange: '박경찬!A1:P63',
    currentTargetOccupiedCells: 467,
    currentTargetFormulaCells: 110,
    currentTargetValidationCells: 18,
    sourceRead: 'bounded native Sheet read of 김예원!A1:R47',
    sourceValuesCopied: false,
    sourceFormatOnly: true,
    sourceMergesRowSizesProtections: 'unverified',
  },
  oneTimeBatchSequence: [
    'Refresh source and target metadata, values, formulas, formats, validations, merges, row sizes, and protections.',
    'Take a recoverable copy of the whole target tab plus a structured A1:R110 before image; verify recovery access.',
    'Review exact conflicts in existing 박경찬!A1:P63, including 110 formulas and 18 validations, and dependent references.',
    'Expand the target grid to at least 110 rows and R; clear only the approved target A1:R110 cells and affected formatting/validations.',
    'Copy 김예원!A1:R47 with PASTE_FORMAT only, subject to verified source protection and merge behavior.',
    'Write the generic legacy headers, teacher name, grade markers and five canonical Park names below; keep peer values absent.',
    'Apply the reviewed new layout from row 48, native dates/times, validations, protections, and C/D freeze.',
    'Read back the same target cells, formulas, formats, validations, merges, dimensions, freeze settings and preserved DB tabs.',
  ],
  productionGate: {
    approvalRequired: true,
    beforeAfterRangesRequired: true,
    recovery: 'Restore the verified pre-cutover whole-tab copy if readback fails; retain original DB tabs.',
    preservedTabs: 'All existing 박경찬_DB_* tabs and their SPT consumers; no schema/header rewrite.',
    noLmsOrSenderEffect: true,
    noFunctionalWriterClaim: true,
  },
  legacy: {
    range: 'A1:R47',
    copyMode: 'PASTE_FORMAT',
    row1: 'blank',
    genericHeaderCells: [
      ...legacyHeaderRow2.map(([range, value]) => literal(range, value)),
      ...legacyHeaderRow3.map((value, index) => literal(`${String.fromCharCode(69 + index)}3`, value)),
    ],
    teacherCell: literal('A4', '박경찬'),
    gradeCells: [literal('B9', '초5'), literal('B18', '중1'), blank('B31', 'blank')],
    studentCells: parkCutoverRoster.map(({ row, name }) => literal(`C${row}`, name)),
    studentIdentityKeys: parkCutoverRoster.map(({ row, studentId }) => ({ row, studentId })),
    studentDataClearRange: 'D4:R47',
    peerNamesAndValuesCopied: false,
    blankStudentRows: 'All C4:C47 except C9,C10,C18,C19,C20',
    unresolved: [
      'Whether source merged cells, borders, conditional formats, row heights and widths require separate native operations.',
      'Whether additional student formulas or validation cells should be rebuilt after source formatting is copied.',
      'All real legacy D4:R47 student values; do not fill from another teacher or infer from LMS.',
    ],
  },
  statusVocabulary: ['확인 불가', '검증 대기', '교사 검토 대기', '검토 완료', '기록 대기', '기록됨', '오류'] as const,
  nativeFormats: [
    { ranges: ['B49', 'B101'], type: 'DATE', pattern: 'yyyy-mm-dd', input: 'native_date_serial' },
    { ranges: ['H49', 'M51:M55', 'M70:M74', 'F103', 'F105', 'F107'], type: 'DATE_TIME', pattern: 'yyyy-mm-dd hh:mm', input: 'native_datetime_serial' },
    { ranges: ['J70:J74', 'B80'], type: 'TIME', pattern: 'hh:mm', input: 'native_time_serial' },
  ],
  validations: [
    { range: 'B49', kind: 'DATE_IS_VALID', strict: true, allowBlank: false },
    { range: 'D49', kind: 'ONE_OF_CANONICAL_GROUPS', source: 'fresh harness roster groups plus 전체', strict: true },
    { range: 'F49', kind: 'ONE_OF_CANONICAL_STUDENTS', source: 'fresh harness roster, filtered by verified date scope', strict: true },
    { range: 'B79', kind: 'ONE_OF_CANONICAL_STUDENTS', source: 'fresh harness roster plus verified occurrence', strict: true },
    { range: 'F79', kind: 'ONE_OF_LIST', values: ['과제', '대기', '교재 확인', '질문 원문', '취소', '수정'], strict: true },
    { range: 'B80', kind: 'CUSTOM_FORMULA', formula: '=OR(ISBLANK(B80),AND(ISNUMBER(B80),B80>=0,B80<1))', strict: true, allowBlank: true },
  ],
  sections: [
    {
      range: 'A48:R56', title: '14:00 수업 준비 · 날짜별 전체 학생', headerRow: 50,
      fixedRows: [51, 52, 53, 54, 55],
      cells: [
        literal('A48', '14:00 수업 준비 · 날짜별 전체 학생'),
        literal('A49', '수업일'), { range: 'B49', value: 46295, kind: 'teacher_input', note: '2026-09-30 as a native Google Sheets date serial.' },
        literal('C49', '반'), literal('D49', '전체'),
        literal('E49', '선택 학생'), blank('F49', 'teacher_input'),
        literal('G49', '조회 시각'), blank('H49', 'source_fact'),
        literal('I49', '범위 검증'), literal('J49', '확인 불가'),
        literal('K49', '새로고침'), literal('L49', '수동'),
        ...['학생', '학년', '반', '수업 발생키', '이전 숙제 교재/범위', '선행 영상', '문제 풀이', '앱 채점', '오답 영상', '오답 수정', '교사 육안 확인', '근거', '근거 시각', '미확인 사유', '검토', '미정리 입력', '다음 조치', '상태']
          .map((value, index) => literal(`${String.fromCharCode(65 + index)}50`, value)),
        ...[
          { row: 51, name: '이루한', grade: '중1', group: '수금2부' },
          { row: 52, name: '이현승', grade: '중1', group: '월수금2부' },
        ].flatMap(({ row, name, grade, group }) => [
          literal(`A${row}`, name), literal(`B${row}`, grade), literal(`C${row}`, group),
          literal(`N${row}`, '수업 발생키 및 앱 결합 미검증'), literal(`R${row}`, '확인 불가'),
        ]),
        literal('A56', '수업일별 실제 대상·누락·페이지 범위는 LMS 검증 후 표시'),
      ],
    },
    {
      range: 'A58:R66', title: '선택 학생 · 정확한 수업 발생키와 원본 근거',
      cells: [
        literal('A58', '선택 학생 상세'), literal('A59', '학생'), blank('B59', 'derived_status'),
        literal('D59', '수업 발생키'), blank('E59', 'source_fact'),
        literal('J59', '과정/교재'), blank('K59', 'source_fact'),
        literal('A60', '이전 수업 숙제'), blank('D60', 'source_fact'),
        literal('A61', '교재별 소지·검사'), blank('D61', 'source_fact'),
        literal('A62', '문항·채점·오답'), blank('D62', 'source_fact'),
        literal('A63', '원본 영상/오디오 링크'), blank('D63', 'source_fact'),
        literal('A64', '교사 판단'), blank('D64', 'teacher_input'),
        literal('A65', '원본 시각·조회 시각'), blank('D65', 'source_fact'),
        literal('A66', '미확인 결합'), literal('D66', '확인 불가'),
      ],
    },
    {
      range: 'A68:R75', title: '수업 중 · 전체 학생 현재/대기/다음 과제', headerRow: 69,
      fixedRows: [70, 71, 72, 73, 74],
      cells: [
        literal('A68', '수업 중 · 전체 학생'),
        ...['학생', '현재 과제', '교재/시험키', '진행 상태', '대기 상태', '대기 중 할 일', '다음 과제', '취소 사유', '검사 상태', '시작 시각', '경과', '원본 이벤트', '근거 시각', '미정리 질문', '담당 교사', '검토', '오류', '상태']
          .map((value, index) => literal(`${String.fromCharCode(65 + index)}69`, value)),
        literal('A70', '이루한'), literal('A71', '이현승'),
        literal('A75', '대기 시간 임계값 없음 · 과제 취소는 사유와 별도 이벤트로 기록'),
      ],
    },
    {
      range: 'A77:R83', title: '고정 입력 · 명시적 기록',
      cells: [
        literal('A77', '고정 입력 · 기록 전 수업/학생 확인'),
        literal('A79', '학생'), blank('B79', 'teacher_input'),
        literal('C79', '수업 발생키'), blank('D79', 'teacher_input'),
        literal('E79', '종류'), blank('F79', 'teacher_input'),
        literal('G79', '교재/시험키'), blank('H79', 'teacher_input'),
        literal('I79', '쪽/범위 시작'), blank('J79', 'teacher_input'),
        literal('K79', '쪽/문항 끝'), blank('L79', 'teacher_input'),
        literal('M79', '요청 ID'), blank('N79', 'teacher_input'),
        literal('A80', '발생 시각'), blank('B80', 'teacher_input'),
        literal('C80', '교사 원문'), blank('D80:R81', 'teacher_input', 'Preserve exact original wording; no auto normalization.'),
        literal('A82', '기록'), literal('C82', '동작 미연결'),
        literal('M82', '결과 이벤트 ID'), blank('N82', 'derived_status'),
        literal('A83', '기록은 검증된 수업·학생 키와 멱등 요청 ID가 필요함'),
      ],
    },
    {
      range: 'A85:R91', title: '수업 종료 전 · 학생/교재별 숙제 제안과 승인', headerRow: 86,
      cells: [
        literal('A85', '수업 종료 전 · 학생/교재별 숙제'),
        ...['학생', '교재 판본', '현재 진도', '미완료 범위', '다음 수업일', '14:00 초안', '수업 종료 제안', '교사 수정', '승인', '과제 ID', '근거', '근거 시각', '달력 완전성', '쪽 감사', '개별 속도', '정확도 근거', '미확인 사유', '상태']
          .map((value, index) => literal(`${String.fromCharCode(65 + index)}86`, value)),
        literal('A87', '이루한'), literal('A88', '이현승'),
      ],
    },
    {
      range: 'A93:R100', title: '수업 후 · 전 학생 미정리 질문', headerRow: 94,
      cells: [
        literal('A93', '전 학생 미정리 질문 · 수업 후 21:30–22:00 강조'),
        ...['학생', '수업일', '원문 ID', '교사 원문', '교재', '쪽', '문항', '앱 시도', '채점', '1차 수정', '별표', '교사 재확인', '원본 링크', '발생 시각', '접수 시각', '정리 담당', '수정 이력', '상태']
          .map((value, index) => literal(`${String.fromCharCode(65 + index)}94`, value)),
        literal('A100', '원문은 보존하고 정리·수정은 별도 이력으로 추가'),
      ],
    },
    {
      range: 'A101:R110', title: '마감 · 초안, 검토, LMS 저장, 발송 인계',
      cells: [
        literal('A101', '마감 · 초안과 공식 효과 분리'), blank('B101', 'teacher_input'),
        literal('A102', '선택 학생'), blank('B102', 'derived_status'),
        literal('D102', '초안 개정 ID'), blank('E102', 'derived_status'),
        literal('A103', '교사 검토'), literal('D103', '교사 검토 대기'), blank('F103', 'teacher_input'),
        literal('A104', 'DayRecord 8개 필드'), literal('D104', '검증 대기'),
        literal('A105', '공식 저장·같은 대상 재조회'), literal('D105', '기록 대기'), blank('F105', 'source_fact'),
        literal('A106', '학부모 문구 초안'), blank('D106', 'teacher_input'),
        literal('A107', '발송 인계'), literal('D107', '교사 직접 발송'), blank('F107', 'source_fact'),
        literal('A108', '발송 수신 증빙'), literal('D108', '확인 불가'),
        literal('A109', '초안·수정·검토는 추가 이력으로 보존'),
        literal('A110', '원본 매체는 링크로 유지 · 공식 LMS와 발송 상태는 별도 증빙 필요'),
      ],
    },
  ] satisfies readonly SectionPlan[],
  runtimeBoundaries: {
    lmsFacts: 'Only exact source-bound occurrence rows; missing or unverified joins stay 확인 불가.',
    appFacts: 'Student/course/submission/grading/correction joins are unverified.',
    teacherCommit: 'Fixed input and 기록 are visual until a serialized, idempotent writer and readback exist.',
    rawLmsRetention: 'Review raw LMS snapshot retention at semester end; no automatic deletion. Keep the teacher-only audit ledger separate from the shared operating Sheet.',
    teacherHistoryRetention: 'No fixed expiration for notes, drafts and correction history.',
    originalMedia: 'Linked only; do not embed or delete originals.',
  },
} as const;
