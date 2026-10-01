/** Invented teaching examples only. This fixture never imports an academy roster. */
import { appendRevision, known, stableId, unknown, type LearningCatalog, type LearningEntry, type LearningRevision, type SourceObservation, type TeacherPlan } from "../../src/learning/index.ts";
import { projectLearningView, renderLearningViewCells } from "../../src/sheets/learningViewProjection.ts";
import { LEARNING_VIEW_OWNERSHIP } from "../../src/sheets/mainSheetLearningPreview.ts";

export function makeSyntheticLearningPreview() {
  const refs = ["synthetic:main-sheet-demo"];
  const studentId = stableId("student", "synthetic-preview", "student-a");
  const editionId = stableId("edition", "synthetic-preview", "textbook-a");
  const majorId = stableId("unit", "synthetic-preview", "major-a");
  const middleId = stableId("unit", "synthetic-preview", "middle-a");
  const minorId = stableId("unit", "synthetic-preview", "minor-a");
  const pageId = stableId("page", "synthetic-preview", "page-a");
  const questionIds = ["1", "2"].map(label => stableId("problem", "synthetic-preview", label));
  const capturedAt = "2026-10-01T05:00:00Z";
  const catalog: LearningCatalog = {
    editions: [{ id: editionId, title: "가상 수학 교재 A", editionLabel: known("가상 1판", refs), provenanceRefs: refs }],
    units: [
      { id: majorId, editionId, title: "식과 계산", level: "major", parentId: null },
      { id: middleId, editionId, title: "문자와 식", level: "middle", parentId: known(majorId, refs) },
      { id: minorId, editionId, title: "일차식 계산", level: "minor", parentId: known(middleId, refs) },
    ],
    pages: [{ id: pageId, editionId, printedLabel: "12", minorUnitId: known(minorId, refs) }],
    problems: questionIds.map((id, index) => ({ id, editionId, printedLabel: String(index + 1), pageId: known(pageId, refs) })),
  };
  const scope = (question: number) => ({ editionId: known(editionId, refs), unitId: known(minorId, refs), pageIds: known([pageId], refs), problemIds: known([questionIds[question]!], refs) });
  const context = (lessonDate: string, occurrence: string) => ({ studentId, lessonDate, occurrenceId: known(occurrence, refs), localStartTime: known("18:00", refs), timeZone: "Asia/Seoul" });
  const observation = (key: string, date: string, occurrence: string, question: number, extra: Partial<SourceObservation> = {}): SourceObservation => ({
    kind: "source_observation", context: context(date, occurrence), sessionKind: "lesson", makeupForOccurrenceId: unknown("정규 수업"), scope: scope(question),
    provenance: { system: "lms_day_record", recordKey: key, observedAt: capturedAt, sourceTimestamp: unknown("가상 원본 시각 미확인"), contractRef: "synthetic:demo-contract", contentDigest: unknown("가상 예시") },
    exactBinding: known({ studentId, lessonDate: date, occurrenceId: occurrence }, refs), attendance: known("held", refs), activity: "attempted", correctionChecked: unknown("강사 검사 대기"), correctness: unknown("문항 채점 미확인"), ...extra,
  });
  const teacherPlan = (date: string, occurrence: string, question: number, horizon: "present" | "future", status: "draft" | "approved"): TeacherPlan => ({
    kind: "teacher_plan", context: context(date, occurrence), teacherId: "synthetic-teacher", horizon, purpose: "lesson", status,
    scope: scope(question), assignmentId: unknown("가상 배정 연결 미확인"), basedOnRevisionIds: [], dueDate: unknown("미정"),
  });
  const app = observation("synthetic-app-q1", "2026-10-01", "synthetic-today", 0);
  const entries: LearningEntry[] = [
    observation("synthetic-previous", "2026-09-23", "synthetic-previous", 0, { activity: "reported_complete" }),
    observation("synthetic-makeup", "2026-09-28", "synthetic-makeup", 1, { sessionKind: "makeup", makeupForOccurrenceId: known("synthetic-previous", refs) }),
    { ...app, provenance: { ...app.provenance, system: "app_submission" }, activity: "reported_complete", correctness: known("correct", refs) },
    observation("synthetic-conflict", "2026-10-01", "synthetic-today", 0, { activity: "assigned", attendance: known("cancelled", refs) }),
    observation("synthetic-unresolved", "2026-10-01", "synthetic-unresolved", 1, { exactBinding: unknown("학생·수업 연결 검증 전"), context: { ...context("2026-10-01", "synthetic-unresolved"), localStartTime: unknown("시간 미확인") } }),
    teacherPlan("2026-10-01", "synthetic-today", 0, "present", "approved"),
    teacherPlan("2026-10-08", "synthetic-future", 1, "future", "draft"),
  ];
  let history: readonly LearningRevision[] = [];
  entries.forEach((payload, index) => {
    const next = appendRevision(history, { entityId: stableId("entity", "synthetic-preview", String(index)), expectedRevisionId: null,
      idempotencyKey: `synthetic-preview:${index}`, actorId: "synthetic-teacher", recordedAt: capturedAt, reason: "Invented UI example", payload });
    if (next.result.status !== "ready") throw new Error("Synthetic fixture invalid");
    history = next.history;
  });
  const view = projectLearningView({ history, catalog, filters: { asOfDate: "2026-10-01", timeZone: "Asia/Seoul" },
    capturedAt, sourceCoverage: unknown("가상 시안. 실제 학원 원본·전체 학생 범위 미검증"), maxSourceAgeMs: 60_000,
    studentLabels: [{ studentId, label: "가상 학생 A" }] });
  const rendered = renderLearningViewCells(view);
  return {
    schemaVersion: 1, kind: "synthetic_main_sheet_design_preview", status: "static_design_only", syntheticOnly: true,
    implementation: ["src/sheets/learningViewProjection.ts", "src/sheets/mainSheetLearningPreview.ts"],
    grid: { rows: 160, columns: 16 }, layoutVersion: view.layoutVersion,
    title: "가상 자료 · Main Sheet 설계 미리보기 · 필터/기록 미연결",
    controls: [
      { cell: "B4", label: "월", initial: "전체", allowed: ["전체", "2026-09", "2026-10"] },
      { cell: "E4", label: "날짜", initial: "전체", allowed: ["전체", "2026-09-23", "2026-09-28", "2026-10-01", "2026-10-08"] },
      { cell: "H4", label: "수업시간", initial: "전체", allowed: ["전체", "18:00"] },
      { cell: "K4", label: "학생", initial: "가상 학생 A", allowed: ["전체", "가상 학생 A"], syntheticId: studentId },
      { cell: "N4", label: "교재", initial: "가상 수학 교재 A", allowed: ["전체", "가상 수학 교재 A"], syntheticId: editionId },
      { cell: "B6", label: "대단원", initial: "전체", allowed: ["전체", "식과 계산"], syntheticId: majorId },
      { cell: "E6", label: "중단원", initial: "전체", allowed: ["전체", "문자와 식"], syntheticId: middleId },
      { cell: "H6", label: "소단원", initial: "전체", allowed: ["전체", "일차식 계산"], syntheticId: minorId },
      { cell: "K6", label: "쪽", initial: "전체", allowed: ["전체", "12"], syntheticId: pageId },
      { cell: "N6", label: "문항", initial: "전체", allowed: ["전체", "1", "2"] },
    ],
    ownership: LEARNING_VIEW_OWNERSHIP, cells: rendered.cells, sections: rendered.sections,
    scenarioCoverage: ["historical_regular_lesson", "historical_makeup", "current_approved_plan", "future_draft_plan", "unresolved_identity", "attendance_work_conflict", "app_grade_without_teacher_inspection"],
    selectedScope: view.filters, warnings: ["Every value is invented; no academy roster or source text is present.", "Selectors and fixed input are design-only. This static preview does not refresh or save on edit.", "Do not adopt this layout on the operating Main tab without exact before/after review."],
  };
}
