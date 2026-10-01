/**
 * Self-contained, invented-record rehearsal of the date-first preclass Main.
 * No domain/roster/source reads, credentials, network, dependencies or Sheet writes.
 * Run: bun run harness/preclass_preview.ts
 */
import { fileURLToPath } from "node:url";

type EvidenceState = "known" | "unknown" | "not_required";
type Tone = "good" | "attention" | "unknown" | "neutral";
type Review = "pending" | "checked" | "followup" | "unable";
type SourceId = "assignment" | "prestudy" | "attempts" | "grading" | "correction";
interface Evidence {
  id: SourceId;
  label: string;
  state: EvidenceState;
  tone: Tone;
  summary: string;
  detail: string;
  source: string;
  sourceTimestamp: string | null;
  observedAt: string;
  coverage: string;
  relation: string;
}
interface Question {
  page: string;
  question: string;
  attempt: string;
  grade: string;
  correction: string;
  inspection: string;
}
interface Student {
  id: string;
  name: string;
  group: string;
  time: string;
  lessonDate: string;
  weekStart: string;
  occurrenceId: string;
  session: string;
  priorOccurrenceId: string | null;
  priorDate: string | null;
  editionId: string;
  course: string;
  scope: string;
  prestudyScope: string;
  conceptTestScope: string;
  teacherReview: Review;
  reviewText: string;
  note: string;
  noteTimestamp: string;
  plan: string;
  planTimestamp: string;
  followup: boolean;
  evidence: Evidence[];
  questions: Question[];
}
interface Fixture {
  date: string;
  cohortCoverage: "complete_synthetic";
  cohortTimestamp: string;
  students: Student[];
}

const exampleDate = "2099-01-14";
const at = (date: string, time: string) => `${date}T${time}:00+09:00`;
const source = (
  id: SourceId, label: string, state: EvidenceState, tone: Tone,
  summary: string, detail: string, sourceName: string, timestamp: string | null,
  coverage: string, relation: string, date = exampleDate,
): Evidence => ({
  id, label, state, tone, summary, detail, source: sourceName,
  sourceTimestamp: timestamp, observedAt: at(date, "13:28"), coverage, relation,
});
const assignment = (detail = "가상 수학 A · 2099판 · 2단원 / 풀이 p.24–25 1–12번 · 예습 p.26–27") => source(
  "assignment", "직전 수업 숙제", "known", "good", "범위 확인", detail,
  "가상 LMS · 직전 수업일지", at("2099-01-12", "18:10"),
  "직전 회차의 확정 숙제 1건 확인", "학생 → 직전 정규 회차 → 교재 판본 → 단원·쪽·문제 연결 확인",
);
const unknownSource = (id: SourceId, label: string, reason: string, relation: string, timestamp: string | null = null) => source(
  id, label, "unknown", "unknown", "확인 불가", reason, "가상 앱 읽기", timestamp,
  "조회 범위 미확인 · 기록이 없다고 판단할 수 없음", relation,
);
const shared = {
  lessonDate: exampleDate, weekStart: "2099-01-12", group: "가상 목요 A", time: "16:00",
  session: "정규", priorDate: "2099-01-12", editionId: "synthetic-edition-a-2099",
  course: "가상 수학 A · 2099판", scope: "2단원 · p.24–25 · 1–12번",
  prestudyScope: "2단원 · p.26–27 · 개념 설명",
  conceptTestScope: "직전 숙제의 예습 범위 · p.26–27",
  noteTimestamp: at("2099-01-12", "18:20"), planTimestamp: at(exampleDate, "13:20"),
};

const fixtures: Fixture[] = [{
  date: exampleDate, cohortCoverage: "complete_synthetic", cohortTimestamp: at(exampleDate, "13:26"), students: [
    {
      ...shared, id: "synthetic-student-sky", name: "가상 하늘", occurrenceId: "synthetic-sky-regular-20990114",
      priorOccurrenceId: "synthetic-sky-regular-20990112", teacherReview: "pending", reviewText: "수정 원본을 아직 눈으로 확인하지 않음",
      note: "지난 수업에서는 풀이 과정을 말로 설명할 때 단위가 빠졌음.", plan: "오답 6·9번의 설명을 듣고, 단위를 쓰는 습관을 함께 확인.", followup: false,
      evidence: [
        assignment(),
        source("prestudy", "예습 영상", "known", "good", "업로드 확인", "예습 p.26–27에 대응하는 가상 영상 1건. 업로드는 확인했으며 내용의 교사 판단은 별도.", "가상 앱 · 제출", at(exampleDate, "12:42"), "대상 범위 제출 조회 끝까지 확인", "학생·현재 회차·판본·예습 범위 연결 확인"),
        source("attempts", "숙제 풀이", "known", "good", "12 / 12 풀이", "숙제 1–12번의 풀이 시도 기록이 있음. 풀이 수가 이해나 숙제 승인 결과를 뜻하지 않음.", "가상 앱 · 문제 시도", at(exampleDate, "12:48"), "범위 내 12문제 · 전체 시도 조회 확인", "직전 숙제 → 현재 준비 회차 → 각 문제의 시도 연결 확인"),
        source("grading", "앱 채점", "known", "attention", "채점 12 · 오답 2", "가상 앱 백엔드 채점 12건 중 6·9번 오답. 문제별 결과를 유지.", "가상 앱 · 채점", at(exampleDate, "12:50"), "대상 12문제의 최신 시도별 결과 확인", "문제 → 정확한 풀이 시도 → 채점 결과 연결 확인"),
        source("correction", "오답 영상·수정", "known", "good", "수정 기록 2 / 2", "6·9번의 수정과 설명 영상이 가상 앱에 기록됨. 앱의 수정 기록과 교사의 눈 확인은 별도.", "가상 앱 · 수정", at(exampleDate, "13:02"), "확인된 오답 2문제의 수정 조회 확인", "오답의 채점 시도 → 수정본·영상 연결 확인"),
      ],
      questions: [
        { page: "24", question: "3", attempt: "풀이 기록 있음", grade: "정답", correction: "대상 아님", inspection: "미확인" },
        { page: "24", question: "6", attempt: "풀이 기록 있음", grade: "오답", correction: "앱 수정 기록 있음", inspection: "미확인" },
        { page: "25", question: "9", attempt: "풀이 기록 있음", grade: "오답", correction: "앱 수정 기록 있음", inspection: "미확인" },
      ],
    },
    {
      ...shared, id: "synthetic-student-sea", name: "가상 바다", occurrenceId: "synthetic-sea-regular-20990114", priorOccurrenceId: "synthetic-sea-regular-20990112",
      teacherReview: "pending", reviewText: "앱 연결을 먼저 확인할 필요가 있음", note: "예습 설명을 듣고 질문을 한 번 더 나누기로 함.", plan: "앱 연결 확인 후 예습 내용을 짧게 설명하도록 요청.", followup: false,
      evidence: [
        assignment(),
        unknownSource("prestudy", "예습 영상", "가상 제출 항목은 있으나 이 학생·수업·예습 범위와의 대응이 미확인.", "학생·현재 회차·예습 범위 연결 미확인", at(exampleDate, "12:40")),
        unknownSource("attempts", "숙제 풀이", "대상 숙제의 전체 문제 시도 조회가 확보되지 않음.", "숙제 범위·전체 조회 연결 미확인"),
        unknownSource("grading", "앱 채점", "풀이 시도와 채점 결과의 연결이 미확인.", "문제·시도·채점 연결 미확인"),
        unknownSource("correction", "오답 영상·수정", "채점된 오답 범위를 확인하지 못해 수정 대상과 상태를 판단할 수 없음.", "오답 범위·수정본 연결 미확인"),
      ],
      questions: [{ page: "24–25", question: "1–12", attempt: "연결 미확인", grade: "연결 미확인", correction: "대상 미확인", inspection: "미확인" }],
    },
    {
      ...shared, id: "synthetic-student-leaf", name: "가상 솔잎", occurrenceId: "synthetic-leaf-regular-20990114", priorOccurrenceId: "synthetic-leaf-regular-20990112",
      teacherReview: "followup", reviewText: "11번 수정 설명을 수업에서 다시 확인하기로 함", note: "수정 풀이에 계산 과정이 한 줄 빠져 있음.", plan: "12번 풀이를 확인하고, 8·11번의 수정 설명을 함께 검토.", followup: true,
      evidence: [
        assignment(),
        source("prestudy", "예습 영상", "known", "good", "업로드 확인", "배정 예습 범위의 가상 영상 1건 확인.", "가상 앱 · 제출", at(exampleDate, "12:35"), "대상 범위 제출 전체 조회 확인", "학생·현재 회차·판본·예습 범위 연결 확인"),
        source("attempts", "숙제 풀이", "known", "attention", "11 / 12 풀이", "대상 12문제의 전체 조회에서 12번 풀이 시도 기록은 없음. 다른 학생이나 출결 판단으로 확장하지 않음.", "가상 앱 · 문제 시도", at(exampleDate, "12:51"), "범위 내 12문제 · 전체 조회 완료", "직전 숙제 → 각 문제의 시도 연결 확인"),
        source("grading", "앱 채점", "known", "attention", "채점 11 · 오답 3", "시도 11건의 채점 확인. 시도 없는 12번에 점수나 오답을 부여하지 않음.", "가상 앱 · 채점", at(exampleDate, "12:53"), "풀이 시도 11건의 채점 조회 확인", "문제 → 풀이 시도 → 채점 연결 확인"),
        source("correction", "오답 영상·수정", "known", "attention", "수정 기록 1 / 3", "3문제 중 1문제에 수정 기록이 있음. 나머지 두 문제는 전체 조회에서 대응 수정 기록이 없음.", "가상 앱 · 수정", at(exampleDate, "13:00"), "확인된 오답 3문제 · 수정 전체 조회 확인", "오답 시도 → 수정본·영상 연결 확인"),
      ],
      questions: [
        { page: "24", question: "4", attempt: "풀이 기록 있음", grade: "정답", correction: "대상 아님", inspection: "미확인" },
        { page: "25", question: "8", attempt: "풀이 기록 있음", grade: "오답", correction: "앱 수정 기록 있음", inspection: "미확인" },
        { page: "25", question: "11", attempt: "풀이 기록 있음", grade: "오답", correction: "대응 기록 없음 · 조회 확인", inspection: "보완 필요" },
        { page: "25", question: "12", attempt: "시도 기록 없음 · 조회 확인", grade: "채점 대상 없음", correction: "대상 미확인", inspection: "미확인" },
      ],
    },
    {
      ...shared, id: "synthetic-student-star", name: "가상 별", occurrenceId: "synthetic-star-regular-20990114", priorOccurrenceId: "synthetic-star-regular-20990112",
      course: "가상 수학 B · 2099판", editionId: "synthetic-edition-b-2099", scope: "1단원 · p.10–11 · 1–8번", prestudyScope: "이번 회차 배정 없음", conceptTestScope: "배정 없음 · 직전 예습 배정 확인",
      teacherReview: "checked", reviewText: "가상 교사가 풀이 설명과 준비 원본을 확인함", note: "이번 회차는 새 단원 도입 전 복습으로 진행.", plan: "복습 설명을 확인한 뒤 다음 개념으로 진행.", followup: false,
      evidence: [
        assignment("가상 수학 B · 2099판 · 1단원 / 풀이 p.10–11 1–8번 · 예습 배정 없음"),
        source("prestudy", "예습 영상", "not_required", "neutral", "배정 없음", "확인된 직전 숙제에 예습 영상 배정이 없음.", "가상 LMS · 배정", at("2099-01-12", "18:10"), "직전 회차 숙제 전체 확인", "직전 확정 숙제의 예습 배정 없음 확인"),
        source("attempts", "숙제 풀이", "known", "good", "8 / 8 풀이", "대상 8문제의 가상 시도 기록 확인.", "가상 앱 · 문제 시도", at(exampleDate, "12:44"), "대상 8문제 전체 조회 확인", "직전 숙제 → 판본·각 문제 → 시도 연결 확인"),
        source("grading", "앱 채점", "known", "good", "채점 8 · 오답 0", "대상 8건의 가상 채점 모두 정답. 교사의 준비 판단은 별도.", "가상 앱 · 채점", at(exampleDate, "12:46"), "대상 8시도의 채점 전체 확인", "문제 → 시도 → 채점 연결 확인"),
        source("correction", "오답 영상·수정", "not_required", "neutral", "대상 없음", "확인된 숙제 범위 채점에 오답이 없어 수정 대상이 없음.", "가상 앱 · 채점", at(exampleDate, "12:46"), "대상 8시도의 채점 전체 확인", "확인된 채점 범위에 오답 없음"),
      ], questions: [{ page: "10", question: "2", attempt: "풀이 기록 있음", grade: "정답", correction: "대상 아님", inspection: "확인함" }],
    },
    {
      ...shared, id: "synthetic-student-bird", name: "가상 은새", group: "가상 목요 B", time: "17:30", occurrenceId: "synthetic-bird-regular-20990114", priorOccurrenceId: "synthetic-bird-regular-20990112",
      teacherReview: "pending", reviewText: "같은 교재 제목의 다른 판본인지 확인 필요", note: "학생이 보여준 책의 인쇄 판본을 다음 시간에 확인하기로 함.", plan: "실물 교재 판본 확인 후 앱의 문제 범위와 대조.", followup: false,
      evidence: [
        assignment(),
        unknownSource("prestudy", "예습 영상", "가상 영상 업로드는 있으나 교재 판본이 일치하는지 미확인. 해당 예습 범위의 제출 여부는 모름.", "앱 교재 판본 → 배정 판본 연결 미확인", at(exampleDate, "12:37")),
        unknownSource("attempts", "숙제 풀이", "같은 쪽 번호만으로 다른 판본의 문제를 대응시킬 수 없음.", "판본·쪽·문제 연결 미확인", at(exampleDate, "12:45")),
        unknownSource("grading", "앱 채점", "앱의 결과를 이 숙제 문제의 채점으로 배치할 수 없음.", "판본·문제·시도 연결 미확인", at(exampleDate, "12:47")),
        unknownSource("correction", "오답 영상·수정", "대상 문제 판본이 미확인이라 수정 대응도 미확인.", "판본·오답 시도·수정 연결 미확인"),
      ], questions: [{ page: "24–25", question: "1–12", attempt: "판본 연결 미확인", grade: "판본 연결 미확인", correction: "대상 미확인", inspection: "미확인" }],
    },
    {
      ...shared, id: "synthetic-student-moon", name: "가상 달", group: "가상 개별 보강", time: "17:30", session: "보강", occurrenceId: "synthetic-moon-makeup-20990114", priorOccurrenceId: null,
      priorDate: null, scope: "직전 숙제 연결 미확인", prestudyScope: "예습 범위 미확인", conceptTestScope: "직전 예습 범위 연결 미확인",
      teacherReview: "unable", reviewText: "정규·보강의 숙제 연결 확인 후 판단", note: "보강 회차의 원래 수업과 별도 숙제를 구분해서 확인해야 함.", plan: "직전 유효 수업과 보강 숙제 연결을 먼저 확인.", followup: true,
      evidence: [
        unknownSource("assignment", "직전 수업 숙제", "정규·보강 중 이 회차에 적용되는 직전 숙제와 예습 범위를 아직 연결하지 못함.", "보강 → 원래 회차·직전 확정 숙제 연결 미확인"),
        unknownSource("prestudy", "예습 영상", "배정 예습 범위가 미확인이라 제출을 판단할 수 없음.", "숙제·예습 범위 연결 미확인"),
        unknownSource("attempts", "숙제 풀이", "숙제 대상 범위가 미확인이라 풀이 수를 집계하지 않음.", "숙제·문제 범위 연결 미확인"),
        unknownSource("grading", "앱 채점", "정규 회차의 채점을 보강 회차로 옮겨 사용하지 않음.", "정규·보강 회차 연결 미확인"),
        unknownSource("correction", "오답 영상·수정", "이 회차의 오답 대상과 수정 경로가 미확인.", "회차·오답 대상 연결 미확인"),
      ], questions: [{ page: "미확인", question: "미확인", attempt: "대상 범위 미확인", grade: "대상 범위 미확인", correction: "대상 미확인", inspection: "판단 보류" }],
    },
  ],
}];

// A second, smaller date proves date scope without pretending a fetched current roster.
fixtures.push({
  date: "2099-01-15", cohortCoverage: "complete_synthetic", cohortTimestamp: at("2099-01-15", "13:26"),
  students: fixtures[0].students.slice(0, 2).map(student => ({
    ...student, lessonDate: "2099-01-15", occurrenceId: `${student.id}-synthetic-20990115`,
    group: "가상 금요 A", teacherReview: "pending", reviewText: "이 날짜의 교사 확인 전", priorOccurrenceId: null,
    priorDate: null, scope: "이 날짜의 직전 숙제 연결 미확인", prestudyScope: "예습 범위 미확인", conceptTestScope: "직전 예습 범위 연결 미확인",
    note: "전날과 다른 회차이므로 확인 기록을 옮겨 사용하지 않음.", plan: "이 날짜에 적용되는 숙제와 회차를 먼저 확인.", followup: false,
    noteTimestamp: at("2099-01-15", "13:10"), planTimestamp: at("2099-01-15", "13:20"),
    evidence: student.evidence.map(item => ({
      ...item, state: "unknown", tone: "unknown", summary: "확인 불가", detail: "이 날짜의 학생·회차·범위 연결이 미확인.",
      sourceTimestamp: null, observedAt: at("2099-01-15", "13:28"), coverage: "이 날짜의 전체 조회 미확인", relation: "선택 날짜의 회차 연결 미확인",
    })),
    questions: [{ page: "미확인", question: "미확인", attempt: "대상 범위 미확인", grade: "대상 범위 미확인", correction: "대상 미확인", inspection: "미확인" }],
  })),
});

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

export function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

export const uxPlan = {
  schemaVersion: 1,
  asOf: "2026-10-01",
  status: "synthetic_reviewable_proposal_not_native_or_source_acceptance",
  objective: "선택 날짜에 등원 예정인 전체 학생의 직전 숙제 → 예습 → 풀이 → 앱 채점 → 오답 영상·수정 → 교사 눈 확인과 메모·수업 계획을 하나의 Main 작업 흐름으로 연결한다.",
  artifacts: {
    generator: "harness/preclass_preview.ts",
    plan: "docs/preclass-main-sheet-ux-2026-10-01.json",
    preview: "docs/preclass-main-sheet-preview.synthetic.html",
    regenerate: "bun run harness/preclass_preview.ts",
    dependencies: "Bun 1.4.2 built-ins only; no libraries, remote fonts, images, scripts, source reads or network calls",
  },
  decisionProvenance: [
    { id: "preclass_first", authority: "current_user_answer", decision: "수업 전 준비: 전체 학생의 숙제·사전학습·채점·오답 상태 검토" },
    { id: "refresh_window", authority: "current_user_answer", decision: "월–금 13:15–14:00 Asia/Seoul 중 갱신, 요일과 관계없이 교사의 수동 갱신 가능", supersedesOnly: "기존 wiring의 13:15–13:45 시간 창; host·인증·배포·실행 보장은 미결" },
    { id: "all_context", authority: "current_user_answer", decision: "갱신 날짜에 등원하는 학생의 예습·숙제·교사 기록 등 관련 흐름을 전부 연결하고 Main Sheet UI/UX 개선" },
    { id: "one_main", authority: "current_user_answer_and_lead_observation", decision: "교사 운영 탭은 기존 박경찬 Main 하나; Lead가 박경찬 관련 보조 탭 숨김 처리를 확인했다고 전달함", limitation: "이 미리보기는 탭 숨김을 수행·독립 검증하지 않음. 숨김은 접근 통제나 DB 무결성을 뜻하지 않음." },
    { id: "granularity", authority: "existing_domain_contract", decision: "학생 → 서울 날짜의 주 → 정확한 정규/보강 회차 → 교재 판본 → 단원 → 쪽 → 문제; 관찰·메모·계획·수정 이력 분리", references: ["src/learning/model.ts", "docs/main-sheet-design.json"] },
  ],
  operationBaseline: {
    authority: "docs/main-sheet-live-input-map-2026-10-01.json",
    observedAtUtc: "2026-10-01T05:24:00Z",
    target: { spreadsheetId: "1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg", sheetId: 1754681846, title: "박경찬" },
    grid: { rows: 133, columns: 18, frozenRows: 3 },
    currentStudentSlots: "C4:R47",
    currentTopMeaning: "기존 공통 강사 평가·현재 진도 표. 예습·숙제·채점·교사 메모 전용 열이 없음.",
    existingNativeControls: "관찰 당시 수식·검증·셀 노트·자동 소유 범위 없음. 기존 I5/I8 선택자는 삭제되어 현재 위치로 사용할 수 없음.",
    freshMetadataRequiredBeforeNativeAction: true,
    nativeCurrentOperationNotProvedByPrototype: true,
  },
  preservation: [
    { target: "A1:R3", keep: "현재 공통 제목·서식·머지와 3행 고정", proposedEffect: "none" },
    { target: "A4:B47", keep: "박경찬 강사·학년 그룹 머지", proposedEffect: "none" },
    { target: "C4:R47", keep: "평가·진도 의미, 기존 교사 값, 검증 전 학생 매핑", proposedEffect: "정확한 학생·회차 매핑 및 열별 출처·소유권 리뷰 전 갱신 금지" },
    { target: "O4:O47 and R4:R47", keep: "예상 종료일은 교사의 계획", proposedEffect: "관찰 사실로 재분류하거나 자동으로 덮어쓰지 않음" },
    { target: "A48:P133", keep: "보존된 legacy 값·메타데이터·기존 소비자", proposedEffect: "none; 메모·계획 쓰기 공간으로 추정 금지" },
    { target: "Q48:R133", keep: "현재 미배정 빈 셀", proposedEffect: "none; 빈 셀이 자동 소유권을 뜻하지 않음" },
    { target: "other instructor/shared/support/recovery tabs", keep: "다른 교사·공유 탭 및 숨겨진 관련 기록·복구 원본", proposedEffect: "이 작업에서 추가 변경·삭제·새 DB 탭 생성 없음" },
  ],
  prototype: {
    data: "두 날짜에만 명시적으로 만든 가상 교재·학생·회차·근거. 2099-01-14 6명, 2099-01-15 2명; 현재 학원 명부가 아님.",
    controls: ["날짜 선택 및 가상 날짜 바로가기", "전체 학생을 유지하는 학생 상세 선택", "준비 체크리스트", "가상 원본 위치 대화상자", "교사 눈 확인과 메모·계획의 메모리 내 추가 이력", "실제 데이터를 읽지 않는 수동 갱신 시뮬레이션"],
    refreshTruth: "시뮬레이션은 시안 시도 횟수·실제 브라우저 클릭 시각만 표시. 출처 값·출처 시각·전체 조회 상태를 갱신하지 않는다.",
    persistence: "브라우저 메모리에만 존재. 재실행 또는 페이지 새로고침 시 초기화; LMS/Sheet/DB 저장 없음.",
    noFixtureDate: "학생 목록 확인 불가. 명부가 없는 날짜를 0명·결석·미완료로 판정하지 않음.",
    detailQuestionRows: "현재 범위의 일부 가상 문제 예시이며 전체 문제 목록이 아님. 페이지·범위 수준 기록을 개별 문제의 채점으로 복제하지 않음.",
    selectionInvariant: "상세 선택과 검토 기록은 전체 학생 목록을 줄이지 않음. 선택 날짜의 학생·회차에만 기록; 정규·보강이나 다른 날짜로 기록을 복사하지 않음.",
    accessibility: "native buttons/forms/dialog/details, Korean labels, visible focus, status text in addition to color, keyboard selection, responsive whole-class/detail flow",
  },
  nativeProposal: {
    immediateReviewSurface: "이 self-contained HTML은 제품 흐름의 로컬 검토물이며 Google Sheet에 배포된 UI가 아님.",
    firstCandidate: "기존 박경찬 Main을 열어 쓰는 교사에게 날짜·전체 학생·선택 상세를 제공하는 bound sidebar/dialog. 기존 평가·진도 표 의미를 보존하되 넓은 전체 학생 화면의 실제 사용성을 검토한다.",
    alternateAfterTeacherReview: "사용자가 Sheet 셀 안의 전체 준비표를 선호하면 기존 운영값·소비자와 충돌하지 않는 정확한 추가 영역 및 행 증설을 별도 레이아웃 diff로 제시한다. 현재 133행 뒤나 빈 셀에 대한 소유권은 아직 부여되지 않음.",
    staging: [
      { order: 1, deliverable: "이 가상 화면에서 읽기 순서·전체 학생 범위·메모/계획 구분을 교사 검토", state: "reviewable_synthetic" },
      { order: 2, deliverable: "교사·날짜·등원 명부·직전 확정 숙제와 app 제출/채점/수정의 정확한 읽기 계약 및 전체 조회 확인", state: "pending_verified_sources" },
      { order: 3, deliverable: "Main native 표면, 정확한 위치·소유권·보존값과 authenticated runtime 검토", state: "proposal_not_layout_approval" },
      { order: 4, deliverable: "완전한 최신 inventory로 수동 갱신의 before/after/recovery 및 출처 시각·미확인 상태 제시", state: "pending_non_executable_native_diff" },
      { order: 5, deliverable: "정확히 승인된 batch의 같은 대상 readback 및 교사 메모·계획 보존 확인", state: "pending_explicit_native_batch" },
      { order: 6, deliverable: "지원되는 unattended source 인증·영속 claim/outcome 저장소와 월–금13:15–14:00 실행/실패/누락 표시", state: "pending_runtime_and_actual_first_run" },
    ],
    journalWrites: "교사 준비 확인·메모·계획은 official LMS 필드가 아님. LMS closeout의 exact target/value/wire/secondary effect/readback은 별도 승인 흐름.",
  },
  sourcePresentation: {
    eachFieldShows: ["출처 시스템", "원본 갱신 시각 또는 미확인", "읽은 시각", "전체 조회 범위", "학생·회차·교재·문제 관계의 확인/미확인", "원본 참조 위치"],
    unknownPolicy: "관계 또는 전체 조회가 미확인이면 확인 불가. 누락·오래됨·판본 불일치를 미제출·오답·결석으로 바꾸지 않음.",
    knownMissingPolicy: "대상·관계·전체 조회가 모두 확인된 범위에서만 대응 기록 없음을 사실로 표시하며 학생 태도·능력·출결로 일반화하지 않음.",
    timestampPolicy: "출처 시각과 읽은 시각, 최근 시도와 성공을 분리. 새로고침 버튼 클릭으로 출처 시각을 새로 만들지 않음. 유저가 지정하지 않은 대기/신선도 기준을 만들지 않음.",
    teacherPolicy: "교사 눈 확인·보완·보류, append-only 메모·계획을 출처 사실과 별도 저장/표시. 교사 판정만으로 앱 관계 미확인을 해소하거나 채점·수정 상태를 바꾸지 않음.",
  },
  pendingAcceptance: [
    "전체 학생 화면과 선택 상세의 실제 Main 배치 및 교사 사용성 리뷰",
    "등원 일정·휴원·결석·보강과 직전 유효 수업 숙제/교사 추가 배정의 현재 연결",
    "앱 학생·수업·교재 판본·범위·시도·채점·수정·영상 계약과 전체 조회",
    "자동 실행 source 인증과 host, Free Tier 실사용 조건, 영속 private DB/audit destination",
    "정확한 Sheet 레이아웃/값 diff와 복구 경로; 이 artifact는 승인 또는 배포가 아님",
  ],
  externalEffects: { sourceReads: 0, productionWrites: 0, deployments: 0, installedTriggers: 0, remoteMessages: 0 },
  references: ["AGENTS.md", "docs/CODEX_CONTEXT.md", "docs/WHOLE_LENS_DECISION.md", "docs/main-sheet-design.json", "docs/main-sheet-live-input-map-2026-10-01.json", "docs/main-sheet-live-refresh-wiring.json", "src/preclass/preclassScanner.ts", "src/learning/model.ts"],
};

export function renderPreclassPreview(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>박경찬 Main · 수업 전 준비 · 가상 시안</title>
  <style>
    :root{--ink:#17312f;--muted:#516863;--teal:#075f59;--teal-dark:#064843;--line:#d8e2dc;--wash:#f3f6f1;--good-bg:#e4f2ec;--good:#165647;--warn-bg:#fff1d8;--warn:#79501c;--unknown-bg:#eceff6;--unknown:#45516f;--warm:#fffaf0;--white:#fff;font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:var(--ink);background:var(--wash);font-synthesis:none}
    *{box-sizing:border-box}body{margin:0}button,input,select,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:wait}button,input,textarea,select{border-radius:9px}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid #bc5b15;outline-offset:3px}button{min-height:42px}h1,h2,h3,p{margin:0}h1{font-size:28px;letter-spacing:-.06em;line-height:1.3}h2{font-size:19px;letter-spacing:-.035em}h3{font-size:15px;letter-spacing:-.025em}small{font-size:12px;line-height:1.6}[hidden]{display:none!important}.skip{position:absolute;left:12px;top:-80px;background:white;color:var(--ink);padding:12px;z-index:10}.skip:focus{top:12px}
    .header{background:var(--teal-dark);color:white;padding:23px 32px 25px}.header-row{max-width:1660px;margin:auto;display:flex;align-items:center;justify-content:space-between;gap:16px}.eyebrow{display:block;font-size:12px;font-weight:750;letter-spacing:.09em;color:#bbe1d0;margin-bottom:6px}.header p{color:#dceae4;font-size:14px;margin-top:8px}.header-tag{border:1px solid #83b7a5;border-radius:25px;padding:8px 15px;font-size:12px;white-space:nowrap}.simulation{background:#fff3da;border-bottom:1px solid #e5c994;padding:10px 32px;color:#63451f;font-size:13px;line-height:1.65}.simulation-inner{max-width:1660px;margin:auto}.shell{max-width:1724px;padding:24px 32px 32px;margin:auto}.toolbar{display:flex;align-items:end;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:18px}.date-tools{display:flex;gap:10px;align-items:end;flex-wrap:wrap}label.field{display:grid;gap:7px;font-size:12px;font-weight:700;color:var(--muted)}input,select,textarea{border:1px solid #aabdb2;background:white;color:var(--ink);padding:10px 12px}input[type=date]{height:44px;min-width:170px}.btn{border:1px solid #afc4b8;background:white;color:var(--ink);padding:10px 13px;font-size:13px;font-weight:650}.btn.primary{background:var(--teal);border-color:var(--teal);color:white}.btn.text{background:transparent;border-color:transparent;color:var(--teal);padding:6px 8px;min-height:36px;font-size:12px}.btn:hover{filter:brightness(.96)}.refresh-tools{display:flex;gap:12px;align-items:center}.refresh-meta{font-size:12px;line-height:1.7;color:var(--muted)}.refresh-meta strong{font-weight:700;color:var(--ink)}.schedule{border:1px solid var(--line);padding:12px 16px;background:#f9fbf7;border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:18px;font-size:12px;line-height:1.7}.schedule strong{color:var(--teal-dark)}.schedule .pending{color:var(--warn)}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}.stat{padding:15px 17px;border:1px solid var(--line);background:white;border-radius:13px}.stat-label{font-size:12px;font-weight:700;color:var(--muted)}.stat-value{margin-top:6px;font-size:26px;font-weight:750;letter-spacing:-.04em}.stat-value small{font-size:13px;font-weight:500;margin-left:5px}.stat-sub{font-size:11px;color:var(--muted);line-height:1.5;margin-top:5px}.workspace{display:grid;grid-template-columns:minmax(580px,1.05fr) minmax(480px,.95fr);gap:18px;align-items:start}.panel{border:1px solid var(--line);border-radius:15px;background:white;min-width:0;overflow:hidden;box-shadow:0 3px 12px #0f463408}.panel-head{padding:19px 20px 15px;border-bottom:1px solid var(--line)}.panel-head p{font-size:12px;color:var(--muted);line-height:1.7;margin-top:6px}.panel-heading-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.label-pill{font-size:11px;border:1px solid #c7d8ce;color:var(--teal);padding:4px 8px;border-radius:15px;white-space:nowrap}.cohort-info{padding:10px 20px;font-size:11px;color:var(--muted);line-height:1.6;background:#f8faf6}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}.overview{min-width:640px;font-size:12px}.overview th{background:#f3f7f2;text-align:left;color:var(--muted);font-size:11px;font-weight:700;padding:11px 7px;border-block:1px solid var(--line);white-space:nowrap}.overview td{padding:13px 7px;border-bottom:1px solid #e9eeea;vertical-align:top;line-height:1.5}.overview th:first-child,.overview td:first-child{padding-left:20px}.overview tr.selected{background:#eef7f0}.overview tr.selected td:first-child{box-shadow:inset 3px 0 var(--teal)}.student-name{display:block;border:0;background:transparent;color:var(--teal);font-weight:750;padding:0;text-align:left;min-height:27px;font-size:13px;text-decoration:underline;text-underline-offset:3px}.student-meta{font-size:10px;color:var(--muted);display:block;margin-top:2px}.cell-sub{display:block;font-size:10px;color:var(--muted);margin-top:4px}.badge{display:inline-block;border-radius:5px;padding:4px 6px;font-size:10px;font-weight:700;line-height:1.5;white-space:nowrap;border:1px solid transparent}.badge.good{background:var(--good-bg);color:var(--good)}.badge.attention{background:var(--warn-bg);color:var(--warn)}.badge.unknown{background:var(--unknown-bg);color:var(--unknown);border:1px dashed #aab4c4}.badge.neutral{background:#f0f3ef;color:#4e6158}.legend{display:flex;flex-wrap:wrap;gap:8px;padding:12px 20px;font-size:11px;border-bottom:1px solid var(--line)}.legend-item{display:flex;gap:5px;align-items:center}.whole-note{padding:14px 20px;font-size:12px;line-height:1.7;color:var(--muted)}.prep{padding:18px 20px;background:#fcfdfb;border-top:1px solid var(--line)}.prep-title{display:flex;gap:8px;align-items:center;margin-bottom:12px}.prep-title h3{flex:1}.prep-check{display:flex;align-items:center;gap:9px;font-size:12px;line-height:1.65;margin:8px 0}.prep-check input{accent-color:var(--teal);width:17px;height:17px;margin:0;flex-shrink:0}.prep small{display:block;color:var(--muted);margin-top:10px}.detail-head{padding:20px 22px;background:#f6faf4;border-bottom:1px solid var(--line)}.detail-head-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.detail-name{font-size:24px;font-weight:750;letter-spacing:-.04em}.detail-meta{font-size:12px;color:var(--muted);margin:6px 0 12px;line-height:1.7}.context-chips{display:flex;gap:6px;flex-wrap:wrap;font-size:11px}.context-chips span{border:1px solid #d3dfd4;padding:5px 8px;border-radius:7px;background:white}.detail-section{padding:18px 22px;border-bottom:1px solid var(--line)}.section-title{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}.section-title small{color:var(--muted)}.scope-box{display:grid;grid-template-columns:82px 1fr;gap:7px 10px;padding:12px 14px;background:#f6f8f4;border:1px solid #dce6db;border-radius:10px;font-size:12px;line-height:1.7}.scope-box dt{color:var(--muted)}.scope-box dd{margin:0}.prior-link{font-size:11px;color:var(--muted);line-height:1.7;margin-top:10px}.timeline{padding-top:4px}.evidence-step{display:grid;grid-template-columns:25px minmax(0,1fr);gap:10px;position:relative;padding-bottom:14px}.evidence-step:last-child{padding-bottom:0}.evidence-step:not(:last-child):before{content:"";position:absolute;left:11px;top:26px;bottom:0;width:1px;background:#cedbd1}.step-dot{position:relative;z-index:1;width:23px;height:23px;border-radius:50%;background:#edf4ed;border:1px solid #bfcfc2;color:var(--teal);text-align:center;line-height:21px;font-size:10px;font-weight:700}.evidence-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.evidence-label{font-size:12px;font-weight:700}.evidence-summary{font-size:11px}.evidence-meta{font-size:10px;color:var(--muted);margin-top:5px;line-height:1.8}.evidence-detail{margin-top:5px;font-size:11px}.evidence-detail summary{color:var(--teal);cursor:pointer;padding:5px 0;list-style:revert}.source-open{padding:11px 13px;margin-top:6px;background:#f7f9f5;border-radius:8px;line-height:1.8}.source-open p{margin-top:5px}.source-open strong{font-weight:650}.unknown-note{font-size:11px;border-left:3px solid #8d98ae;background:#f0f2f7;color:var(--unknown);padding:9px 11px;margin-top:10px;line-height:1.7}.questions{font-size:11px;min-width:450px}.questions th,.questions td{text-align:left;padding:9px 8px;border-bottom:1px solid #e4eae4;line-height:1.65}.questions th{color:var(--muted);background:#f5f8f3;font-size:10px}.questions td:first-child{font-weight:700}.question-note{margin-top:9px;color:var(--muted);font-size:10px;line-height:1.7}.teacher-zone{background:var(--warm)}.teacher-text{font-size:12px;line-height:1.8;padding:10px 12px;border:1px solid #e6ddc9;border-radius:9px;background:#fffdf8}.teacher-text small{color:var(--muted);display:block;margin-top:7px;font-size:10px}.teacher-grid{display:grid;gap:11px}.teacher-grid h3{font-size:12px;margin-bottom:6px}.review-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.teacher-explain{font-size:11px;color:var(--muted);margin-top:11px;line-height:1.7}.teacher-history{font-size:11px;margin-top:13px}.teacher-history summary{padding:6px 0;color:var(--teal);cursor:pointer}.history-list{padding:0;list-style:none;margin:7px 0 0}.history-list li{border-left:2px solid #c6b888;padding:6px 11px;margin:5px 0;background:#fffdf7;line-height:1.7}.history-list small{display:block;color:var(--muted);font-size:10px}.empty{padding:24px 22px;line-height:1.8;color:var(--muted);font-size:13px}.empty strong{color:var(--ink)}.footer{margin-top:17px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:11px;line-height:1.7}.live-status{margin-top:8px;min-height:18px;font-size:12px;color:var(--teal)}.modal{width:min(520px,calc(100vw - 32px));border:1px solid #bccbbf;border-radius:16px;padding:0;color:var(--ink);box-shadow:0 20px 70px #18372f33}.modal::backdrop{background:#103d3566}.modal-inner{padding:24px}.modal h2{font-size:20px;margin-bottom:12px}.modal p{font-size:12px;line-height:1.8;color:var(--muted);margin-bottom:12px}.modal fieldset{border:0;padding:0;margin:0 0 13px}.modal legend{font-size:12px;font-weight:700;margin-bottom:8px}.radio{display:flex;gap:8px;align-items:start;font-size:12px;padding:8px 0;line-height:1.7}.radio input{accent-color:var(--teal);margin-top:5px}.modal textarea{resize:vertical;min-height:88px;width:100%;font-size:13px}.modal label.field{margin-top:12px}.modal-actions{display:flex;justify-content:end;gap:8px;margin-top:18px}.modal-notice{background:#fff3dc;border-radius:8px;padding:10px 12px;color:var(--warn)!important}.original-placeholder{border:1px dashed #a9b9ad;background:#f4f7f1;border-radius:10px;padding:28px 16px;text-align:center;margin:16px 0;color:var(--muted);font-size:13px}
    @media(min-width:1600px){.workspace{grid-template-columns:minmax(750px,1.12fr) minmax(580px,.88fr)}.overview{font-size:13px}.overview td{padding-top:16px;padding-bottom:16px}.badge{font-size:11px}.student-name{font-size:14px}.student-meta,.cell-sub{font-size:11px}}
    @media(max-width:1190px){.workspace{grid-template-columns:1fr}.detail-head{padding-top:18px}.stats{gap:9px}.header-row{align-items:start}.refresh-tools{margin-left:auto}.detail-section{padding:18px 20px}}
    @media(max-width:640px){.header{padding:20px}.header-tag{display:none}.header h1{font-size:25px}.simulation{padding:10px 20px}.shell{padding:18px 14px 26px}.stats{grid-template-columns:repeat(2,1fr)}.stat{padding:13px}.stat-value{font-size:24px}.toolbar{gap:12px}.refresh-tools{width:100%;justify-content:space-between;margin:0}.schedule{gap:8px}.date-tools{gap:6px}.date-tools .btn{font-size:11px;padding:9px}.scope-box{grid-template-columns:70px 1fr}.context-chips span{font-size:10px}.panel-head{padding:17px}.cohort-info,.legend,.whole-note,.prep{padding-left:17px;padding-right:17px}.detail-section,.detail-head{padding-left:17px;padding-right:17px}}
    @media(prefers-reduced-motion:no-preference){button{transition:background .12s ease,filter .12s ease}}
  </style>
</head>
<body>
  <a href="#whole-class" class="skip">전체 학생 목록으로 이동</a>
  <header class="header"><div class="header-row"><div><span class="eyebrow">박경찬 MAIN · 수업 전 준비</span><h1>전체 학생을 보고, 한 명의 흐름을 연결</h1><p>직전 숙제부터 예습·풀이·채점·수정, 교사의 오늘 수업 판단까지.</p></div><span class="header-tag">날짜 → 전체 학생 → 선택 학생</span></div></header>
  <div class="simulation"><div class="simulation-inner"><strong>가상 시안</strong> · 학생·교재·근거는 모두 만든 예시입니다. 실제 LMS·앱·Sheet·DB와 연결되지 않았으며, 입력은 페이지를 새로고침하면 사라집니다.</div></div>
  <main class="shell">
    <div class="toolbar">
      <div class="date-tools"><label class="field" for="lesson-date">준비할 수업 날짜 · 서울 기준<input id="lesson-date" type="date" value="2099-01-14"></label><button class="btn" data-example-date="2099-01-14">가상 1/14 · 6명</button><button class="btn" data-example-date="2099-01-15">가상 1/15 · 2명</button></div>
      <div class="refresh-tools"><div class="refresh-meta"><strong>출처 갱신: 연결 전</strong><br><span id="refresh-attempt">시안 수동 실행 전</span></div><button class="btn primary" id="refresh-button">수동 갱신 · 시뮬레이션</button></div>
    </div>
    <div class="schedule"><div><strong>요청한 자동 갱신</strong> · 월–금 13:15–14:00 · 서울 시간 <span class="pending">/ 아직 실행되지 않음</span></div><div>수동 갱신은 모든 요일 가능 · 실제 출처 연결과 실행 일정 설정은 확인 중</div></div>
    <div id="stats" class="stats" aria-label="전체 준비 현황"></div>
    <div class="workspace">
      <section class="panel" id="whole-class" aria-labelledby="whole-title" tabindex="-1">
        <div class="panel-head"><div class="panel-heading-row"><h2 id="whole-title">등원 예정 전체 학생</h2><span id="cohort-count" class="label-pill"></span></div><p>학생을 선택해도 전체 목록을 유지합니다. 출결은 실제 수업의 별도 기록입니다.</p></div>
        <div id="cohort-info" class="cohort-info"></div>
        <div class="legend"><span class="legend-item"><span class="badge good">근거 확인</span>대상·관계·조회 확인</span><span class="legend-item"><span class="badge attention">보완 항목</span>확인된 사실</span><span class="legend-item"><span class="badge unknown">확인 불가</span>연결·조회 미확인</span></div>
        <div class="table-scroll" id="overview-wrap"><table class="overview"><caption hidden>선택 날짜의 가상 전체 학생 준비 목록</caption><thead><tr><th scope="col">학생 / 수업</th><th scope="col">직전 숙제</th><th scope="col">예습</th><th scope="col">풀이 / 채점</th><th scope="col">오답 수정</th><th scope="col">교사 눈 확인</th></tr></thead><tbody id="student-rows"></tbody></table></div>
        <div id="cohort-empty" class="empty" hidden></div>
        <div class="whole-note">‘확인 불가’는 미제출·미완료를 뜻하지 않습니다. 출처가 확인된 보완 항목과 교사의 직접 확인을 따로 봅니다.</div>
        <div class="prep"><div class="prep-title"><h3>수업 준비 체크</h3><span id="prep-count" class="label-pill"></span></div><div id="prep-checks"></div><small>교사가 검토 순서를 표시하는 시안입니다. 학생의 채점이나 출처 상태는 바뀌지 않습니다.</small></div>
      </section>
      <section class="panel" id="student-panel" aria-labelledby="detail-title"><div id="selected-detail"></div></section>
    </div>
    <div id="live-status" class="live-status" role="status" aria-live="polite"></div>
    <footer class="footer"><span>전체 학생의 준비 흐름 → 선택 학생의 원본 검토 → 교사 메모·수업 계획</span><span>가상 날짜 2099-01-14 / 01-15 · 원본 시각과 읽은 시각을 구분</span></footer>
  </main>
  <dialog class="modal" id="review-dialog" aria-labelledby="review-title"><form id="review-form" class="modal-inner"><h2 id="review-title">교사 눈 확인 · 가상 기록</h2><p id="review-student"></p><p class="modal-notice">직접 본 근거에 대한 교사 판단입니다. 앱의 채점·수정 기록이나 미확인된 연결을 자동으로 바꾸지 않습니다.</p><fieldset><legend>판단을 선택하세요</legend><label class="radio"><input type="radio" name="review" value="checked" required>원본과 풀이·수정 설명을 직접 확인함</label><label class="radio"><input type="radio" name="review" value="followup">직접 확인한 내용에 보완이 필요함</label><label class="radio"><input type="radio" name="review" value="unable">근거 연결 또는 원본 확인이 어려워 판단 보류</label></fieldset><label class="field" for="review-note">확인한 내용 · 가상 시안에만 기록<textarea id="review-note" maxlength="800" required placeholder="어떤 문제·영상·설명을 확인했는지 적어주세요."></textarea></label><div class="modal-actions"><button type="button" class="btn" data-close-dialog="review-dialog">취소</button><button type="submit" class="btn primary">시안에 확인 기록 추가</button></div></form></dialog>
  <dialog class="modal" id="memo-dialog" aria-labelledby="memo-title"><form id="memo-form" class="modal-inner"><h2 id="memo-title">교사 메모·수업 계획 · 가상 기록</h2><p id="memo-student"></p><p>메모는 관찰과 맥락, 계획은 앞으로 하려는 일입니다. 기존 내용을 지우지 않고 이 페이지의 이력에 추가합니다.</p><label class="field" for="memo-kind">기록 종류<select id="memo-kind"><option value="note">교사 메모</option><option value="plan">오늘 수업 계획</option></select></label><label class="field" for="memo-text">추가할 내용 · 가상 시안에만 기록<textarea id="memo-text" maxlength="800" required placeholder="새 가상 기록을 적어주세요."></textarea></label><div class="modal-actions"><button type="button" class="btn" data-close-dialog="memo-dialog">취소</button><button type="submit" class="btn primary">시안에 기록 추가</button></div></form></dialog>
  <dialog class="modal" id="source-dialog" aria-labelledby="source-title"><div class="modal-inner"><h2 id="source-title">원본 보기 · 가상 예시</h2><p id="source-caption"></p><div class="original-placeholder">검증된 원본 링크가 연결될 자리<br><small>이 시안에는 학생 영상·문서·실제 링크가 없습니다.</small></div><p>실제 화면에서는 같은 학생·수업·교재·문제에 대응하는 원본과 출처 시각을 확인한 뒤 교사가 판단합니다.</p><div class="modal-actions"><button class="btn primary" data-close-dialog="source-dialog">닫기</button></div></div></dialog>
  <script id="synthetic-fixture" type="application/json">${jsonForHtml(fixtures)}</script>
  <script>
  (() => {
    'use strict';
    const fixtures = JSON.parse(document.getElementById('synthetic-fixture').textContent);
    const byId = id => document.getElementById(id);
    const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const badge = (text, tone) => '<span class="badge ' + esc(tone) + '">' + esc(text) + '</span>';
    const sourceTime = value => value ? esc(value.slice(5, 10).replace('-', '/') + ' ' + value.slice(11, 16) + ' 서울') : '원본 시각 미확인';
    const reviewLabels = {pending:'눈 확인 전',checked:'직접 확인함',followup:'보완 필요',unable:'판단 보류'};
    const reviewTones = {pending:'neutral',checked:'good',followup:'attention',unable:'unknown'};
    const checklist = ['선택 날짜의 전체 학생과 정규·보강 범위 확인','각 학생의 숙제 → 예습·풀이·채점·수정 연결 검토','교사 눈 확인과 오늘 수업 계획 검토'];
    const histories = new Map();
    const prepByDate = new Map();
    let selectedId = null;
    let modalTarget = null;
    let simulationCount = 0;
    const currentFixture = () => fixtures.find(fixture => fixture.date === byId('lesson-date').value);
    const currentStudent = () => currentFixture()?.students.find(student => student.id === selectedId);
    const historyKey = student => student.lessonDate + ':' + student.id + ':' + student.occurrenceId;
    const history = student => histories.get(historyKey(student)) || [];
    const review = student => history(student).filter(entry => entry.kind === 'review').at(-1)?.review || student.teacherReview;
    const lastText = (student, kind) => history(student).filter(entry => entry.kind === kind).at(-1) || {text:student[kind],at:student[kind + 'Timestamp'],origin:'가상 교사 기존 기록'};
    const hasUnknown = student => student.evidence.some(item => item.state === 'unknown');
    const status = text => { byId('live-status').textContent = text; };
    const simulationTime = () => new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()) + ' 서울';
    function renderStats(fixture) {
      const rows = fixture?.students;
      const values = rows ? [
        ['등원 예정',rows.length,'명','가상 명부 전체 조회 확인'],
        ['근거 연결 확인 필요',rows.filter(hasUnknown).length,'명','미제출·미완료로 판단하지 않음'],
        ['직접 눈 확인 전',rows.filter(row => review(row) !== 'checked').length,'명','보완·보류 포함 · 교사 판단 별도'],
        ['확인된 보완 항목',rows.filter(row => row.evidence.some(item => item.state === 'known' && item.tone === 'attention')).length,'명','원본이 확인된 풀이·채점·수정 사실'],
      ] : [
        ['등원 예정','미확인','','해당 날짜의 학생 목록이 연결되지 않음'],
        ['근거 연결','미확인','','조회되지 않은 상태를 0으로 집계하지 않음'],
        ['교사 눈 확인','미확인','','해당 날짜의 확인 기록 없음'],
        ['보완 항목','미확인','','출처 조회 전에는 판단하지 않음'],
      ];
      byId('stats').innerHTML = values.map(([label,value,unit,sub]) => '<div class="stat"><div class="stat-label">' + esc(label) + '</div><div class="stat-value">' + esc(value) + '<small>' + esc(unit) + '</small></div><p class="stat-sub">' + esc(sub) + '</p></div>').join('');
    }
    function renderCohort(fixture) {
      byId('cohort-count').textContent = fixture ? '전체 ' + fixture.students.length + '명 표시' : '학생 범위 미확인';
      byId('cohort-info').textContent = fixture ? fixture.date + ' · 가상 명부 전체 조회 확인 · 원본 ' + fixture.cohortTimestamp.slice(11,16) + ' 서울 · 실제 출석 여부 아님' : byId('lesson-date').value + ' · 이 날짜의 실제 명부나 가상 예시가 없습니다.';
      byId('overview-wrap').hidden = !fixture;
      byId('cohort-empty').hidden = !!fixture;
      if (!fixture) {
        byId('student-rows').innerHTML = '';
        byId('cohort-empty').innerHTML = '<strong>전체 학생 목록 확인 불가</strong><br>조회되지 않은 날짜를 학생 0명이나 결석으로 판단하지 않습니다.<br>가상 1/14 또는 1/15 버튼으로 준비 흐름을 볼 수 있습니다.';
        return;
      }
      byId('student-rows').innerHTML = fixture.students.map(student => {
        const sources = Object.fromEntries(student.evidence.map(item => [item.id,item]));
        const r = review(student);
        return '<tr class="' + (student.id === selectedId ? 'selected' : '') + '"><td><button class="student-name" data-student="' + esc(student.id) + '" aria-pressed="' + (student.id === selectedId) + '" aria-controls="student-panel">' + esc(student.name) + '</button><span class="student-meta">' + esc(student.time + ' · ' + student.session) + '</span><span class="student-meta">' + esc(student.group) + '</span></td><td>' + badge(sources.assignment.summary,sources.assignment.tone) + '<span class="cell-sub">' + esc(student.scope) + '</span></td><td>' + badge(sources.prestudy.summary,sources.prestudy.tone) + '</td><td>' + badge(sources.attempts.summary,sources.attempts.tone) + '<span class="cell-sub">' + esc(sources.grading.summary) + '</span></td><td>' + badge(sources.correction.summary,sources.correction.tone) + '</td><td>' + badge(reviewLabels[r],reviewTones[r]) + '</td></tr>';
      }).join('');
    }
    function renderPrep() {
      const date = byId('lesson-date').value;
      const checked = prepByDate.get(date) || new Set();
      byId('prep-count').textContent = checked.size + ' / ' + checklist.length;
      byId('prep-checks').innerHTML = checklist.map((text,index) => '<label class="prep-check"><input type="checkbox" data-prep="' + index + '"' + (checked.has(index) ? ' checked' : '') + (!currentFixture() ? ' disabled' : '') + '>' + esc(text) + '</label>').join('');
    }
    function renderDetail(student) {
      if (!student) {
        byId('selected-detail').innerHTML = '<div class="panel-head"><h2 id="detail-title">선택 학생의 준비 흐름</h2></div><div class="empty">날짜에 대응하는 학생이 확인되면 전체 목록에서 선택하세요. 다른 날짜의 근거와 교사 확인을 대신 보여주지 않습니다.</div>';
        return;
      }
      const r = review(student);
      const entries = history(student);
      const currentReview = entries.filter(item => item.kind === 'review').at(-1);
      const note = lastText(student,'note');
      const plan = lastText(student,'plan');
      const prior = student.priorDate ? student.priorDate + ' 정규 회차의 확정 숙제를 기준으로 연결' : '직전 유효 수업·숙제 연결 미확인 · 정규와 보강을 합치지 않음';
      const sourceRows = student.evidence.map((item,index) => '<div class="evidence-step"><span class="step-dot" aria-hidden="true">' + (index + 1) + '</span><div><div class="evidence-top"><span class="evidence-label">' + esc(item.label) + '</span>' + badge(item.summary,item.tone) + '</div><div class="evidence-meta">' + esc(item.source) + ' · 원본 ' + sourceTime(item.sourceTimestamp) + '<br>읽은 시각 ' + sourceTime(item.observedAt) + ' · ' + esc(item.state === 'unknown' ? '연결 또는 조회 미확인' : '범위·관계 확인') + '</div><details class="evidence-detail"><summary>근거와 연결 보기</summary><div class="source-open"><p>' + esc(item.detail) + '</p><p><strong>범위:</strong> ' + esc(item.coverage) + '</p><p><strong>관계:</strong> ' + esc(item.relation) + '</p><button class="btn text" data-source="' + esc(item.id) + '">원본 위치 보기 · 가상 예시</button></div></details></div></div>').join('');
      const questionRows = student.questions.map(item => '<tr><td>p.' + esc(item.page) + '<br>' + esc(item.question) + '번</td><td>' + esc(item.attempt) + '</td><td>' + esc(item.grade) + '</td><td>' + esc(item.correction) + '</td><td>' + esc(item.inspection) + '</td></tr>').join('');
      const extraHistory = entries.map(entry => '<li><strong>' + esc(entry.kind === 'review' ? '교사 눈 확인 · ' + reviewLabels[entry.review] : entry.kind === 'note' ? '교사 메모' : '오늘 수업 계획') + '</strong><br>' + esc(entry.text) + '<small>' + esc(entry.at) + ' · 이 페이지의 가상 추가 기록</small></li>').join('');
      byId('selected-detail').innerHTML = '<div class="detail-head"><div class="detail-head-top"><h2 id="detail-title" class="detail-name">' + esc(student.name) + '</h2><span class="label-pill">선택 학생</span></div><p class="detail-meta">' + esc(student.lessonDate + ' · ' + student.time + ' · ' + student.group + ' · ' + student.session) + '</p><div class="context-chips"><span>' + esc(student.course) + '</span><span>주 시작 ' + esc(student.weekStart) + '</span><span>' + esc(student.session) + ' 회차 따로 연결</span></div></div><div class="detail-section"><div class="section-title"><h3>이 수업에 이어지는 숙제</h3><small>가상 LMS 배정 근거</small></div><dl class="scope-box"><dt>문제 풀이</dt><dd>' + esc(student.scope) + '</dd><dt>예습</dt><dd>' + esc(student.prestudyScope) + '</dd><dt>개념 확인</dt><dd>' + esc(student.conceptTestScope) + '</dd></dl><p class="prior-link">' + esc(prior) + '</p></div><div class="detail-section"><div class="section-title"><h3>배정에서 오답 수정까지</h3><small>출처 사실</small></div><div class="timeline">' + sourceRows + '</div>' + (hasUnknown(student) ? '<p class="unknown-note">연결이 미확인된 항목은 확인 불가입니다. 미제출·미완료·결석으로 바꾸지 않습니다.</p>' : '') + '</div><div class="detail-section"><div class="section-title"><h3>문제별 근거 · 일부 가상 예시</h3><small>판본·쪽·문제 구분</small></div><div class="table-scroll"><table class="questions"><caption hidden>현재 범위의 일부 가상 문제 예시. 전체 문제 목록이 아님.</caption><thead><tr><th scope="col">문제</th><th scope="col">풀이</th><th scope="col">앱 채점</th><th scope="col">앱 수정</th><th scope="col">교사 눈 확인</th></tr></thead><tbody>' + questionRows + '</tbody></table></div><p class="question-note">이 표는 일부 문제 예시입니다. 범위의 요약이나 학생 준비 확인을 개별 문제 채점·눈 확인으로 복제하지 않습니다.</p></div><div class="detail-section teacher-zone"><div class="section-title"><h3>교사의 준비 판단</h3>' + badge(reviewLabels[r],reviewTones[r]) + '</div><div class="teacher-text">' + esc(currentReview?.text || student.reviewText) + '<small>교사 직접 기록 · 앱 채점/수정과 별도</small></div><div class="review-actions"><button class="btn primary" id="open-review">눈 확인 기록 · 시안</button><button class="btn" id="open-memo">메모·계획 추가 · 시안</button></div><p class="teacher-explain">학생 준비에 대한 판단을 기록합니다. 문제별 눈 확인은 해당 문제의 원본과 설명을 별도로 확인해야 합니다.</p></div><div class="detail-section teacher-zone"><div class="section-title"><h3>교사 메모와 오늘 수업 계획</h3><small>출처 사실과 별도</small></div><div class="teacher-grid"><div><h3>교사 메모</h3><div class="teacher-text">' + esc(note.text) + '<small>' + esc(note.origin || '이 페이지의 가상 추가 기록') + ' · ' + (note.origin ? sourceTime(note.at) : esc(note.at)) + '</small></div></div><div><h3>오늘 수업 계획</h3><div class="teacher-text">' + esc(plan.text) + '<small>앞으로 할 일 · ' + (plan.origin ? sourceTime(plan.at) : esc(plan.at)) + '</small></div></div></div><details class="teacher-history"><summary>메모·계획·판단의 추가 이력 ' + entries.length + '건</summary><ul class="history-list"><li><strong>기존 가상 교사 메모</strong><br>' + esc(student.note) + '<small>원본 ' + sourceTime(student.noteTimestamp) + '</small></li><li><strong>기존 가상 수업 계획</strong><br>' + esc(student.plan) + '<small>원본 ' + sourceTime(student.planTimestamp) + '</small></li>' + extraHistory + '</ul></details><p class="teacher-explain">가상 기록은 이 페이지 메모리에만 남습니다. 실제 LMS·Main Sheet에 저장하지 않습니다.</p></div>';
    }
    function render() {
      const fixture = currentFixture();
      if (!fixture?.students.some(row => row.id === selectedId)) selectedId = fixture?.students[0]?.id || null;
      renderStats(fixture);renderCohort(fixture);renderPrep();renderDetail(currentStudent());
    }
    function selectDate(date) {
      byId('lesson-date').value = date;selectedId = null;render();status('선택 날짜를 바꿨습니다. 다른 날짜의 근거와 확인 기록을 섞지 않습니다.');
    }
    function openDialog(id) { byId(id).showModal(); }
    function append(entry) {
      const student = currentStudent();
      if (!student || historyKey(student) !== modalTarget) { status('기록 대상이 바뀌어 추가하지 않았습니다.');return false; }
      histories.set(historyKey(student),[...history(student),{...entry,at:simulationTime()}]);
      return true;
    }
    document.addEventListener('click',event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.exampleDate) selectDate(button.dataset.exampleDate);
      if (button.dataset.student) { selectedId = button.dataset.student;render();status(currentStudent().name + ' 상세를 선택했습니다. 전체 학생 목록은 그대로 표시합니다.');byId('student-rows').querySelector('[data-student="' + selectedId + '"]').focus(); }
      if (button.dataset.closeDialog) byId(button.dataset.closeDialog).close();
      const student = currentStudent();
      if (!student) return;
      if (button.id === 'open-review') { modalTarget = historyKey(student);byId('review-form').reset();byId('review-student').textContent = student.name + ' · ' + student.lessonDate + ' · ' + student.session;openDialog('review-dialog'); }
      if (button.id === 'open-memo') { modalTarget = historyKey(student);byId('memo-form').reset();byId('memo-student').textContent = student.name + ' · ' + student.lessonDate + ' · ' + student.session;openDialog('memo-dialog'); }
      if (button.dataset.source) { const item = student.evidence.find(row => row.id === button.dataset.source);byId('source-caption').textContent = student.name + ' · ' + item.label + ' · ' + item.source + ' · 실제 원본 연결 전';openDialog('source-dialog'); }
    });
    byId('lesson-date').addEventListener('change',() => { selectedId = null;render();status('선택 날짜의 학생과 근거만 표시합니다.'); });
    byId('prep-checks').addEventListener('change',event => {
      const index = Number(event.target.dataset.prep);
      if (!Number.isInteger(index) || !currentFixture()) return;
      const date = byId('lesson-date').value;
      const checked = new Set(prepByDate.get(date) || []);
      event.target.checked ? checked.add(index) : checked.delete(index);prepByDate.set(date,checked);byId('prep-count').textContent = checked.size + ' / ' + checklist.length;
      status('교사의 가상 검토 순서만 표시했습니다. 출처 상태는 그대로입니다.');
    });
    byId('review-form').addEventListener('submit',event => {
      event.preventDefault();const text = byId('review-note').value.trim();if (!text) {byId('review-note').setCustomValidity('확인한 내용을 적어주세요.');byId('review-note').reportValidity();return;}
      const value = new FormData(event.target).get('review');if (!['checked','followup','unable'].includes(value)) return;
      if (append({kind:'review',review:value,text})) { byId('review-dialog').close();render();status('가상 교사 눈 확인 이력에 추가했습니다. 앱 근거와 문제별 확인 상태는 바꾸지 않았습니다.');byId('open-review').focus(); }
    });
    byId('review-note').addEventListener('input',event => event.target.setCustomValidity(''));
    byId('memo-form').addEventListener('submit',event => {
      event.preventDefault();const text = byId('memo-text').value.trim();if (!text) {byId('memo-text').setCustomValidity('추가할 내용을 적어주세요.');byId('memo-text').reportValidity();return;}
      const kind = byId('memo-kind').value;if (!['note','plan'].includes(kind)) return;
      if (append({kind,text})) { byId('memo-dialog').close();render();status('가상 기록 이력에 추가했습니다. 기존 메모와 계획을 보존했습니다.');byId('open-memo').focus(); }
    });
    byId('memo-text').addEventListener('input',event => event.target.setCustomValidity(''));
    byId('refresh-button').addEventListener('click',() => {
      simulationCount += 1;byId('refresh-attempt').textContent = '시안 실행 ' + simulationCount + '회 · ' + simulationTime();
      status('가상 갱신 동작을 표시했습니다. 실제 조회·저장을 하지 않아 출처 값과 출처 시각은 바뀌지 않았습니다.');
    });
    render();
  })();
  </script>
</body>
</html>\n`;
}

if (import.meta.main) {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const htmlPath = `${projectRoot}docs/preclass-main-sheet-preview.synthetic.html`;
  const planPath = `${projectRoot}docs/preclass-main-sheet-ux-2026-10-01.json`;
  const html = renderPreclassPreview();
  if (fixtures.some(fixture => fixture.students.some(student => student.lessonDate !== fixture.date || !student.id.startsWith("synthetic-") || !student.occurrenceId.includes("synthetic")))) {
    throw new Error("Synthetic fixture has an invalid date or identity.");
  }
  await Bun.write(htmlPath, html);
  await Bun.write(planPath, `${JSON.stringify(uxPlan, null, 2)}\n`);
  console.log(JSON.stringify({ status: "generated_synthetic_only", htmlPath, planPath, dates: fixtures.map(fixture => ({ date: fixture.date, students: fixture.students.length })), bytes: new TextEncoder().encode(html).length, networkCalls: 0, sheetWrites: 0 }));
}
