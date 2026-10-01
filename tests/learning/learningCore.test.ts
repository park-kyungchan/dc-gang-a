import { describe, expect, it } from "bun:test";
import {
  appendRevision, canonicalJson, contextFromLessonKey, currentRevisions, digest,
  filterLearningEntries, known, previewRevision, projectLearningTimeline, reconcilePlan,
  resolveLegacyIdentity, resolveProblemPath, stableId, unknown, validateCatalog,
  validateLedger, validateRecord, validateScope,
  type LearningCatalog, type LearningRevision, type RevisionCommand,
  type SourceObservation, type StudentBookAssignment, type TeacherPlan,
} from "../../src/learning";

// All values in this file are invented. No file/roster/browser/HTTP fixture imports.
const refs = ["synthetic:evidence:1"];
const student = stableId("student", "synthetic", "alpha");
const otherStudent = stableId("student", "synthetic", "beta");
const edition = stableId("edition", "synthetic", "book", "2099-A");
const otherEdition = stableId("edition", "synthetic", "book", "2099-B");
const major = stableId("unit", "synthetic", "major");
const middle = stableId("unit", "synthetic", "middle");
const minor = stableId("unit", "synthetic", "minor");
const page = stableId("page", "synthetic", "A", "12");
const page2 = stableId("page", "synthetic", "A", "13");
const problem = stableId("problem", "synthetic", "A", "12", "1");
const problem2 = stableId("problem", "synthetic", "A", "12", "2");
const entity = stableId("entity", "synthetic", "plan");
const context = contextFromLessonKey({ studentId: student, lessonDate: "2099-01-12", occurrenceId: "synthetic-occurrence" },
  "Asia/Seoul", known("14:00", refs), refs);
const scope = {
  editionId: known(edition, refs), unitId: known(minor, refs),
  pageIds: known([page], refs), problemIds: unknown<readonly typeof problem[]>("Problem scope not observed"),
};
const catalog: LearningCatalog = {
  editions: [
    { id: edition, title: "Synthetic Book", editionLabel: known("2099-A", refs), provenanceRefs: refs },
    { id: otherEdition, title: "Synthetic Book", editionLabel: known("2099-B", refs), provenanceRefs: refs },
  ],
  units: [
    { id: major, editionId: edition, title: "Synthetic major", level: "major", parentId: null },
    { id: middle, editionId: edition, title: "Synthetic middle", level: "middle", parentId: known(major, refs) },
    { id: minor, editionId: edition, title: "Synthetic minor", level: "minor", parentId: known(middle, refs) },
  ],
  pages: [
    { id: page, editionId: edition, printedLabel: "12", minorUnitId: known(minor, refs) },
    { id: page2, editionId: edition, printedLabel: "13", minorUnitId: unknown("TOC not checked") },
  ],
  problems: [{ id: problem, editionId: edition, printedLabel: "1", pageId: known(page, refs) }],
};
function plan(overrides: Partial<TeacherPlan> = {}): TeacherPlan {
  return {
    kind: "teacher_plan", context, teacherId: "synthetic-teacher", horizon: "future", purpose: "lesson",
    status: "approved", scope, assignmentId: unknown("Not yet bound"), basedOnRevisionIds: [],
    dueDate: known("2099-01-12", refs), ...overrides,
  };
}
function observation(overrides: Partial<SourceObservation> = {}): SourceObservation {
  return {
    kind: "source_observation", context, sessionKind: "lesson", makeupForOccurrenceId: unknown("Not a makeup"), scope,
    provenance: {
      system: "lms_day_record", recordKey: "synthetic-record", observedAt: "2099-01-12T10:00:00Z",
      sourceTimestamp: known("2099-01-12T09:59:00Z", refs), contractRef: "synthetic:verified-contract",
      contentDigest: unknown("Original payload not retained"),
    },
    exactBinding: known({ studentId: student, lessonDate: context.lessonDate, occurrenceId: "synthetic-occurrence" }, refs),
    attendance: known("held", refs), activity: "attempted", correctionChecked: unknown("Not inspected"),
    correctness: unknown("No exact grading proof"), ...overrides,
  };
}
function command(overrides: Partial<RevisionCommand> = {}): RevisionCommand {
  return {
    entityId: entity, expectedRevisionId: null, idempotencyKey: "synthetic-operation-1",
    actorId: "synthetic-teacher", recordedAt: "2099-01-12T10:00:00Z", reason: "Synthetic teacher plan creation",
    payload: plan(), ...overrides,
  };
}
function historyOf(input: RevisionCommand = command()): readonly LearningRevision[] {
  return appendRevision([], input).history;
}

describe("learning catalog and unknown hierarchy", () => {
  it("uses stable namespace/edition-aware keys without separator collisions", () => {
    expect(stableId("page", "synthetic", "a|b", "c")).not.toBe(stableId("page", "synthetic", "a", "b|c"));
    expect(stableId("page", "synthetic", "a", "1")).toBe(stableId("page", "synthetic", "a", "1"));
    expect(edition).not.toBe(otherEdition);
    expect(() => stableId("student", "synthetic")).toThrow();
  });
  it("requires evidence for known values", () => {
    expect(() => known("not proved", [])).toThrow();
    expect(() => unknown(" ")).toThrow();
  });
  it("resolves edition-major-middle-minor-page-problem by opaque ids", () => {
    const path = resolveProblemPath(catalog, problem);
    expect(path.editionId).toBe(edition);
    expect([path.major?.id, path.middle?.id, path.minor?.id, path.page?.id]).toEqual([major, middle, minor, page]);
  });
  it("permits unresolved parents without inventing hierarchy", () => {
    const incomplete = { ...catalog, pages: catalog.pages.map(row => ({ ...row, minorUnitId: unknown("Not mapped") })) };
    const path = resolveProblemPath(incomplete, problem);
    expect(path.page?.id).toBe(page);
    expect([path.major, path.middle, path.minor]).toEqual([null, null, null]);
  });
  it("permits an unknown problem page", () => {
    const incomplete = { ...catalog, problems: [{ ...catalog.problems[0], pageId: unknown("Not inspected") }] };
    expect(resolveProblemPath(incomplete, problem).page).toBeNull();
  });
  it("rejects duplicate identities and wrong hierarchy levels", () => {
    expect(() => validateCatalog({ ...catalog, problems: [...catalog.problems, catalog.problems[0]] })).toThrow("duplicate");
    expect(() => validateCatalog({ ...catalog, units: catalog.units.map(row => row.id === minor ?
      { ...row, level: "minor" as const, parentId: known(major, refs) } : row) })).toThrow("preceding level");
  });
  it("rejects cross-edition parents and scope joins", () => {
    expect(() => validateCatalog({ ...catalog, pages: [{ ...catalog.pages[0], editionId: otherEdition }] })).toThrow("page unit");
    expect(() => validateScope({ ...scope, editionId: known(otherEdition, refs) }, catalog)).toThrow("mismatch");
  });
  it("does not merge editions that share a title", () => {
    expect(catalog.editions[0].title).toBe(catalog.editions[1].title);
    expect(() => validateCatalog(catalog)).not.toThrow();
    expect(catalog.editions[0].id).not.toBe(catalog.editions[1].id);
  });
  it("rejects duplicate scope ids", () => {
    expect(() => validateScope({ ...scope, pageIds: known([page, page], refs) })).toThrow("duplicate");
  });
  it("rejects contradictory unit/page/problem scope while preserving unknown ancestry", () => {
    const anotherMinor = stableId("unit", "synthetic", "other-minor");
    const expanded: LearningCatalog = { ...catalog,
      units: [...catalog.units, { id: anotherMinor, editionId: edition, title: "Other synthetic minor",
        level: "minor", parentId: unknown("Unknown middle unit") }],
      pages: catalog.pages.map(row => row.id === page2 ? { ...row, minorUnitId: known(anotherMinor, refs) } : row),
    };
    expect(() => validateScope({ ...scope, pageIds: known([page2], refs) }, expanded)).toThrow("unit scope");
    expect(() => validateScope({ ...scope, unitId: known(major, refs), pageIds: known([page2], refs) }, expanded)).not.toThrow();
    expect(() => validateScope({ ...scope, pageIds: known([page2], refs), problemIds: known([problem], refs) }, catalog)).toThrow("page scope");
    expect(() => validateScope({ ...scope, unitId: known(major, refs), problemIds: known([problem], refs) }, catalog)).not.toThrow();
  });
  it("rejects hidden unknown values and source fields smuggled into a plan", () => {
    expect(() => validateRecord({ ...plan(), provenance: observation().provenance } as TeacherPlan)).toThrow("fields");
    expect(() => validateRecord(plan({ context: { ...context,
      occurrenceId: { state: "unknown", reason: "Unknown", value: "not verified" } as never } }))).toThrow("fields");
  });
  it("rejects invalid dates, time zones and time values", () => {
    for (const change of [{ lessonDate: "2099-02-30" }, { timeZone: "not/a-zone" }, { localStartTime: known("24:00", refs) }]) {
      expect(() => validateRecord(plan({ context: { ...context, ...change } }))).toThrow();
    }
  });
  it("requires exact source binding and never promotes an observed row", () => {
    expect(() => validateRecord(observation({ exactBinding: known({ studentId: otherStudent, lessonDate: context.lessonDate,
      occurrenceId: "synthetic-occurrence" }, refs) }))).toThrow("binding");
    expect(() => validateRecord(observation({ exactBinding: unknown("Observed row only") }))).not.toThrow();
  });
  it("rejects source timestamps beyond observation and implicit teacher inspection", () => {
    const source = observation();
    expect(() => validateRecord({ ...source, provenance: { ...source.provenance,
      sourceTimestamp: known("2099-01-12T11:00:00Z", refs) } })).toThrow("later");
    expect(() => validateRecord(observation({ activity: "teacher_inspected" }))).toThrow("teacher observation");
  });
  it("returns unresolved missing and ambiguous legacy identity mappings", () => {
    expect(resolveLegacyIdentity("synthetic-row", []).state).toBe("unknown");
    const mapping = { sourceRowKey: "synthetic-row", studentId: student, editionId: edition,
      pageId: unknown("No page key"), problemId: unknown("No problem key"), evidenceRefs: refs };
    expect(resolveLegacyIdentity("synthetic-row", [mapping, { ...mapping, studentId: otherStudent }]).state).toBe("unknown");
    const resolved = resolveLegacyIdentity("synthetic-row", [mapping]);
    expect(resolved.state).toBe("known");
    if (resolved.state === "known") expect(resolved.value.problemId.state).toBe("unknown");
  });
});

describe("append-only learning revisions", () => {
  it("previews exact before/after without mutating caller history", () => {
    const history: LearningRevision[] = [];
    const preview = previewRevision(history, command());
    expect(history).toHaveLength(0);
    expect(preview.status).toBe("ready");
    if (preview.status === "ready") { expect(preview.before).toBeNull(); expect(preview.after.kind).toBe("teacher_plan"); }
  });
  it("links revisions and preserves the original fact or plan", () => {
    const first = historyOf();
    const revised = command({ expectedRevisionId: first[0].revisionId, idempotencyKey: "synthetic-operation-2",
      reason: "Teacher changed the proposed scope", payload: plan({ scope: { ...scope, pageIds: known([page2], refs) } }) });
    const next = appendRevision(first, revised);
    expect(next.history).toHaveLength(2);
    expect(next.history[1].previousDigest).toBe(first[0].integrityDigest);
    expect(next.history[1].previousRevisionId).toBe(first[0].revisionId);
    expect(next.history[0]).toEqual(first[0]);
    expect(currentRevisions(next.history)).toEqual([next.history[1]]);
    expect(() => validateLedger(next.history)).not.toThrow();
  });
  it("replays an identical request even after newer revisions without re-appending", () => {
    const original = command();
    const first = historyOf(original);
    const second = appendRevision(first, command({ expectedRevisionId: first[0].revisionId, idempotencyKey: "second" })).history;
    const retry = appendRevision(second, original);
    expect(retry.result.status).toBe("replay");
    expect(retry.history).toHaveLength(2);
  });
  it("rejects idempotency reuse with different data", () => {
    const result = previewRevision(historyOf(), command({ reason: "Different command same retry key" }));
    expect(result).toMatchObject({ status: "conflict", reason: "idempotency_reuse" });
  });
  it("rechecks compare-and-swap against current state on append", () => {
    const first = historyOf();
    const contender = command({ expectedRevisionId: first[0].revisionId, idempotencyKey: "contender" });
    expect(previewRevision(first, contender).status).toBe("ready");
    const advanced = appendRevision(first, { ...contender, idempotencyKey: "winner" }).history;
    expect(appendRevision(advanced, contender).result).toMatchObject({ status: "conflict", reason: "stale_base" });
    expect(advanced).toHaveLength(2);
  });
  it("keeps source facts and teacher plans in separate entity streams", () => {
    const history = historyOf();
    expect(previewRevision(history, command({ expectedRevisionId: history[0].revisionId, idempotencyKey: "new",
      payload: observation() }))).toMatchObject({ status: "conflict", reason: "record_kind_changed" });
  });
  it("rejects changing a student's partition", () => {
    const history = historyOf();
    expect(previewRevision(history, command({ expectedRevisionId: history[0].revisionId, idempotencyKey: "new",
      payload: plan({ context: { ...context, studentId: otherStudent } }) })))
      .toMatchObject({ status: "conflict", reason: "student_partition_changed" });
  });
  it("rejects changing a source identity and backwards source timestamps", () => {
    const source = observation();
    const history = historyOf(command({ payload: source }));
    const base = command({ expectedRevisionId: history[0].revisionId, idempotencyKey: "new" });
    expect(previewRevision(history, { ...base, payload: { ...source, provenance: { ...source.provenance, recordKey: "different" } } }))
      .toMatchObject({ status: "conflict", reason: "source_identity_changed" });
    expect(previewRevision(history, { ...base, payload: { ...source, provenance: { ...source.provenance,
      observedAt: "2099-01-12T09:59:30Z" } } })).toMatchObject({ status: "conflict", reason: "source_time_regressed" });
  });
  it("rejects future observations and backwards recording time", () => {
    expect(() => historyOf(command({ payload: observation(), recordedAt: "2099-01-12T09:00:00Z" }))).toThrow("future");
    const history = historyOf();
    expect(previewRevision(history, command({ expectedRevisionId: history[0].revisionId, idempotencyKey: "new",
      recordedAt: "2099-01-12T09:00:00Z" }))).toMatchObject({ status: "conflict", reason: "recorded_time_regressed" });
  });
  it("detects changed data, reordered or missing chain links", () => {
    const first = historyOf();
    const second = appendRevision(first, command({ expectedRevisionId: first[0].revisionId, idempotencyKey: "second" })).history;
    expect(() => validateLedger([{ ...first[0], reason: "Changed stored history" }])).toThrow("integrity");
    expect(() => validateLedger([second[1], second[0]])).toThrow("chain");
    expect(() => validateLedger([second[1]])).toThrow("chain");
  });
  it("deeply freezes copies instead of retaining caller-owned payloads", () => {
    const input = JSON.parse(JSON.stringify(command())) as RevisionCommand;
    const history = historyOf(input);
    (input.payload as { teacherId: string }).teacherId = "caller mutation";
    expect((history[0].payload as TeacherPlan).teacherId).toBe("synthetic-teacher");
    expect(Object.isFrozen(history[0].payload)).toBe(true);
    expect(Object.isFrozen((history[0].payload as TeacherPlan).scope.pageIds)).toBe(true);
  });
  it("hashes object key order consistently and refuses non-JSON data", () => {
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
    expect(() => canonicalJson({ value: undefined })).toThrow();
    expect(() => canonicalJson({ value: NaN })).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
    expect(() => canonicalJson(new Array(2))).toThrow();
    expect(() => canonicalJson({ [Symbol("hidden")]: "data" })).toThrow();
    expect(() => canonicalJson({ get value() { return "side effect"; } })).toThrow();
    expect(() => historyOf({ ...command(), ignored: "untracked field" } as RevisionCommand)).toThrow("fields");
  });
  it("binds a plan to a same-student assignment and already-existing evidence", () => {
    const assignmentId = stableId("entity", "synthetic", "assignment");
    const assignment: StudentBookAssignment = { kind: "book_assignment", studentId: student,
      editionId: known(edition, refs), validFrom: "2099-01-01", validUntil: unknown("Open ended"),
      authoredBy: "teacher", evidenceRefs: refs };
    const history = historyOf(command({ entityId: assignmentId, payload: assignment }));
    expect(previewRevision(history, command({ payload: plan({ assignmentId: known(assignmentId, refs),
      basedOnRevisionIds: [history[0].revisionId] }) })).status).toBe("ready");
    expect(() => previewRevision(history, command({ payload: plan({ context: { ...context, studentId: otherStudent },
      assignmentId: known(assignmentId, refs) }) }))).toThrow("foreign");
    expect(() => previewRevision(history, command({ payload: plan({ basedOnRevisionIds:
      [stableId("revision", "synthetic", "missing")] }) }))).toThrow("basis");
  });
  it("rejects expired assignments and edition mismatches", () => {
    const assignmentId = stableId("entity", "synthetic", "assignment");
    const assignment: StudentBookAssignment = { kind: "book_assignment", studentId: student,
      editionId: known(otherEdition, refs), validFrom: "2099-01-01", validUntil: known("2099-01-11", refs),
      authoredBy: "source", evidenceRefs: refs };
    const history = historyOf(command({ entityId: assignmentId, payload: assignment }));
    expect(() => previewRevision(history, command({ payload: plan({ assignmentId: known(assignmentId, refs) }) }))).toThrow("effective");
    const active = historyOf(command({ entityId: assignmentId, payload: { ...assignment, validUntil: unknown("Open ended") } }));
    expect(() => previewRevision(active, command({ payload: plan({ assignmentId: known(assignmentId, refs) }) }))).toThrow("editions");
  });
  it("shares an edition between student assignments without duplicating the catalog", () => {
    const assignment = (studentId: typeof student): StudentBookAssignment => ({ kind: "book_assignment", studentId,
      editionId: known(edition, refs), validFrom: "2099-01-01", validUntil: unknown("Open ended"),
      authoredBy: "teacher", evidenceRefs: refs });
    const first = historyOf(command({ payload: assignment(student) }));
    const next = appendRevision(first, command({ entityId: stableId("entity", "synthetic", "beta-assignment"), payload: assignment(otherStudent) }));
    expect(next.history).toHaveLength(2);
    expect((next.history[0].payload as StudentBookAssignment).editionId).toEqual((next.history[1].payload as StudentBookAssignment).editionId);
  });
});

describe("plan versus actual reconciliation", () => {
  it("keeps draft/cancelled plans and unresolved scope unknown", () => {
    for (const status of ["draft", "cancelled"] as const) expect(reconcilePlan(plan({ status }), [observation()]).coverage).toBe("unknown");
    expect(reconcilePlan(plan({ context: { ...context, occurrenceId: unknown("Not joined") } }), []).coverage).toBe("unknown");
    expect(reconcilePlan(plan({ scope: { ...scope, pageIds: unknown("Not mapped") } }), []).coverage).toBe("unknown");
  });
  it("reports no observation, without asserting work was not done", () => {
    const result = reconcilePlan(plan(), []);
    expect(result.coverage).toBe("not_observed");
    expect(result.completion).toBe("not_established");
    expect(result.notObservedTargets).toEqual([`page:${page}`]);
  });
  it("does not treat assigned work as attempted work", () => {
    expect(reconcilePlan(plan(), [observation({ activity: "assigned" })]).coverage).toBe("not_observed");
  });
  it("excludes unknown joins, foreign students, occurrences, editions and makeup sessions", () => {
    const excluded = [
      observation({ exactBinding: unknown("Row observed only") }),
      observation({ context: { ...context, studentId: otherStudent }, exactBinding: unknown("Foreign student") }),
      observation({ context: { ...context, occurrenceId: known("other-occurrence", refs) }, exactBinding: unknown("Foreign occurrence") }),
      observation({ scope: { ...scope, editionId: known(otherEdition, refs) } }),
      observation({ sessionKind: "makeup", makeupForOccurrenceId: known("synthetic-occurrence", refs) }),
    ];
    expect(reconcilePlan(plan(), excluded).excludedObservationIndexes).toEqual([0, 1, 2, 3, 4]);
    expect(reconcilePlan(plan(), excluded).coverage).toBe("not_observed");
  });
  it("distinguishes partial coverage and extra observed targets", () => {
    const result = reconcilePlan(plan({ scope: { ...scope, pageIds: known([page, page2], refs) } }), [observation()]);
    expect(result.coverage).toBe("partially_observed");
    expect(result.notObservedTargets).toEqual([`page:${page2}`]);
    const extra = reconcilePlan(plan(), [observation({ scope: { ...scope, pageIds: known([page, page2], refs) } })]);
    expect(extra.extraObservedTargets).toEqual([`page:${page2}`]);
  });
  it("keeps reported completion separate from correction-checked teacher inspection", () => {
    const source = observation({ activity: "reported_complete" });
    expect(reconcilePlan(plan(), [source]).completion).toBe("reported_only");
    const inspected = { ...source, activity: "teacher_inspected" as const,
      provenance: { ...source.provenance, system: "teacher_observation" as const } };
    expect(reconcilePlan(plan(), [inspected]).completion).toBe("reported_only");
    expect(reconcilePlan(plan(), [{ ...inspected, correctionChecked: known(true, refs) }]).completion).toBe("teacher_inspected");
    expect(source.correctness.state).toBe("unknown");
  });
  it("does not infer entire-page coverage from problem evidence", () => {
    const source = observation({ scope: { ...scope, pageIds: unknown("No whole-page observation"), problemIds: known([problem], refs) } });
    expect(reconcilePlan(plan(), [source]).coverage).toBe("not_observed");
  });
  it("keeps known page context from widening an exact question observation", () => {
    for (const activity of ["attempted", "reported_complete", "teacher_inspected"] as const) {
      const source = observation({
        scope: { ...scope, pageIds: known([page], refs), problemIds: known([problem], refs) },
        activity, correctionChecked: known(true, refs),
        provenance: { ...observation().provenance, system: "teacher_observation" },
      });
      const result = reconcilePlan(plan(), [source]);
      expect(result.coverage).toBe("not_observed");
      expect(result.completion).toBe("not_established");
      expect(result.notObservedTargets).toEqual([`page:${page}`]);
      expect(result.extraObservedTargets).toEqual([`problem:${problem}`]);
    }
  });
  it("requires itemized question checks before marking every planned question inspected", () => {
    const problemScope = { ...scope, problemIds: known([problem, problem2], refs) };
    const source = observation({
      scope: problemScope, activity: "teacher_inspected", correctionChecked: known(true, refs),
      provenance: { ...observation().provenance, system: "teacher_observation" },
    });
    const grouped = reconcilePlan(plan({ scope: problemScope }), [source]);
    expect(grouped.coverage).toBe("fully_observed");
    expect(grouped.completion).toBe("reported_only");
    const first = { ...source, scope: { ...problemScope, problemIds: known([problem], refs) } };
    const second = { ...source, scope: { ...problemScope, problemIds: known([problem2], refs) } };
    expect(reconcilePlan(plan({ scope: problemScope }), [first, first]).completion).toBe("not_established");
    expect(reconcilePlan(plan({ scope: problemScope }), [first, second]).completion).toBe("teacher_inspected");
  });
  it("reconciles exact problems without inferring correctness", () => {
    const problemScope = { ...scope, problemIds: known([problem, problem2], refs) };
    const result = reconcilePlan(plan({ scope: problemScope }), [observation({ scope: { ...problemScope, problemIds: known([problem], refs) } })]);
    expect(result.coverage).toBe("partially_observed");
    expect(result.notObservedTargets).toEqual([`problem:${problem2}`]);
    expect(result).not.toHaveProperty("accuracy");
  });
  it("retains contradictory attendance/work as a conflict", () => {
    const result = reconcilePlan(plan(), [observation(), observation({ activity: "assigned", attendance: known("cancelled", refs) })]);
    expect(result.coverage).toBe("conflict");
    expect(result.completion).toBe("not_established");
  });
  it("matches an explicitly planned makeup by its own occurrence", () => {
    expect(reconcilePlan(plan({ purpose: "makeup" }), [observation({ sessionKind: "makeup", makeupForOccurrenceId: known("prior-occurrence", refs) })])
      .coverage).toBe("fully_observed");
  });
});

describe("date-first filters and audit envelopes", () => {
  it("combines month/day/lesson-time/student/book filters", () => {
    const entries = [plan(), plan({ context: { ...context, studentId: otherStudent } }),
      plan({ context: { ...context, localStartTime: unknown("No time evidence") } }),
      plan({ scope: { ...scope, editionId: known(otherEdition, refs) } })];
    expect(filterLearningEntries(entries, { month: "2099-01", day: "2099-01-12", lessonTime: "14:00",
      studentId: student, editionId: edition })).toHaveLength(1);
  });
  it("does not substitute a source UTC timestamp for the local lesson date", () => {
    const source = observation({ provenance: { ...observation().provenance, observedAt: "2099-01-13T00:00:00Z" } });
    expect(filterLearningEntries([source], { day: "2099-01-12" })).toHaveLength(1);
    expect(filterLearningEntries([source], { day: "2099-01-13" })).toHaveLength(0);
  });
  it("rejects invalid filters even for empty results", () => {
    expect(() => filterLearningEntries([], { month: "2099-13" })).toThrow();
    expect(() => projectLearningTimeline([], { lessonTime: "99:00" })).toThrow();
  });
  it("retains distinct entities with identical payloads", () => {
    const first = historyOf();
    const next = appendRevision(first, command({ entityId: stableId("entity", "synthetic", "identical-plan") })).history;
    const rows = projectLearningTimeline(next);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map(row => row.entityId)).size).toBe(2);
  });
});
