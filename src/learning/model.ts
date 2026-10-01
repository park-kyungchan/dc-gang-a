/** Pure learning contracts. No roster, credentials, filesystem or network reads. */
import { createHash } from "node:crypto";
import type { LessonKey } from "../wholeLens/domain";

export type Id<K extends string> = string & { readonly __kind: K };
export type StudentId = Id<"student">;
export type EditionId = Id<"edition">;
export type UnitId = Id<"unit">;
export type PageId = Id<"page">;
export type ProblemId = Id<"problem">;
export type EntityId = Id<"entity">;
export type RevisionId = Id<"revision">;

/** Use verified opaque source keys, never a display name or array position. */
export function stableId<K extends string>(kind: K, namespace: string, ...keys: string[]): Id<K> {
  [kind, namespace, ...keys].forEach(value => requireText(value, "identity component"));
  if (keys.length === 0) throw new Error("identity needs a verified key");
  return `${kind}_${digest([namespace, ...keys])}` as Id<K>;
}

export type Knowledge<T> =
  | Readonly<{ state: "known"; value: T; evidenceRefs: readonly string[] }>
  | Readonly<{ state: "unknown"; reason: string }>;

export function known<T>(value: T, evidenceRefs: readonly string[]): Knowledge<T> {
  const result = { state: "known" as const, value, evidenceRefs };
  assertKnowledge(result);
  return immutableCopy(result);
}
export function unknown<T = never>(reason: string): Knowledge<T> {
  requireText(reason, "unknown reason");
  return Object.freeze({ state: "unknown", reason });
}

export interface Student { readonly id: StudentId }
export interface TextbookEdition {
  readonly id: EditionId;
  readonly title: string;
  readonly editionLabel: Knowledge<string>;
  readonly provenanceRefs: readonly string[];
}
export type Unit = Readonly<{
  id: UnitId; editionId: EditionId; title: string;
} & (
  | { level: "major"; parentId: null }
  | { level: "middle" | "minor"; parentId: Knowledge<UnitId> }
)>;
export interface Page {
  readonly id: PageId;
  readonly editionId: EditionId;
  /** Printed page labels are not PDF indices; labels may be nonnumeric. */
  readonly printedLabel: string;
  readonly minorUnitId: Knowledge<UnitId>;
}
export interface Problem {
  readonly id: ProblemId;
  readonly editionId: EditionId;
  readonly printedLabel: string;
  readonly pageId: Knowledge<PageId>;
}
export interface LearningCatalog {
  readonly editions: readonly TextbookEdition[];
  readonly units: readonly Unit[];
  readonly pages: readonly Page[];
  readonly problems: readonly Problem[];
}

/** Shared catalog data is not copied per student. Assignment is its own edge. */
export interface StudentBookAssignment {
  readonly kind: "book_assignment";
  readonly studentId: StudentId;
  readonly editionId: Knowledge<EditionId>;
  readonly validFrom: string;
  readonly validUntil: Knowledge<string>;
  readonly authoredBy: "source" | "teacher";
  readonly evidenceRefs: readonly string[];
}

export interface LessonContext {
  readonly studentId: StudentId;
  readonly lessonDate: string;
  readonly occurrenceId: Knowledge<string>;
  /** Local wall-clock time, independent of the supplied calendar date. */
  readonly localStartTime: Knowledge<string>;
  readonly timeZone: string;
}

/** Compatible with the existing Whole-Lens exact key, without importing its I/O consumers. */
export function contextFromLessonKey(
  key: LessonKey, timeZone: string, localStartTime: Knowledge<string>, evidenceRefs: readonly string[],
): LessonContext {
  const context: LessonContext = {
    studentId: key.studentId as StudentId, lessonDate: key.lessonDate,
    occurrenceId: known(key.occurrenceId, evidenceRefs), localStartTime, timeZone,
  };
  assertContext(context);
  return immutableCopy(context);
}

export interface ContentScope {
  readonly editionId: Knowledge<EditionId>;
  readonly unitId: Knowledge<UnitId>;
  readonly pageIds: Knowledge<readonly PageId[]>;
  readonly problemIds: Knowledge<readonly ProblemId[]>;
}

export interface SourceProvenance {
  readonly system: "lms_day_record" | "lms_makeup" | "spt_classroom" | "app_submission" | "teacher_observation";
  readonly recordKey: string;
  readonly observedAt: string;
  readonly sourceTimestamp: Knowledge<string>;
  /** Verified contract/evidence locator, not raw source text, cookies or media. */
  readonly contractRef: string;
  readonly contentDigest: Knowledge<string>;
}

export interface SourceObservation {
  readonly kind: "source_observation";
  readonly context: LessonContext;
  readonly sessionKind: "lesson" | "makeup";
  readonly makeupForOccurrenceId: Knowledge<string>;
  readonly scope: ContentScope;
  readonly provenance: SourceProvenance;
  /** An observed row is not proof of the student/lesson join. */
  readonly exactBinding: Knowledge<Readonly<{ studentId: StudentId; lessonDate: string; occurrenceId: string }>>;
  readonly attendance: Knowledge<"held" | "cancelled" | "absent">;
  readonly activity: "assigned" | "attempted" | "reported_complete" | "teacher_inspected";
  readonly correctionChecked: Knowledge<boolean>;
  readonly correctness: Knowledge<"correct" | "incorrect" | "partial">;
}

export interface TeacherPlan {
  readonly kind: "teacher_plan";
  readonly context: LessonContext;
  readonly teacherId: string;
  readonly horizon: "present" | "future";
  readonly purpose: "lesson" | "homework" | "review" | "makeup";
  readonly status: "draft" | "approved" | "cancelled";
  readonly scope: ContentScope;
  readonly assignmentId: Knowledge<EntityId>;
  readonly basedOnRevisionIds: readonly RevisionId[];
  readonly dueDate: Knowledge<string>;
}
export type LearningEntry = SourceObservation | TeacherPlan;
export type LearningRecord = LearningEntry | StudentBookAssignment;

export function validateCatalog(catalog: LearningCatalog): void {
  const records = [...catalog.editions, ...catalog.units, ...catalog.pages, ...catalog.problems];
  const ids = records.map(row => row.id);
  ids.forEach(id => requireText(id, "catalog id"));
  if (new Set(ids).size !== ids.length) throw new Error("duplicate catalog id");
  const editions = new Set(catalog.editions.map(row => row.id));
  const units = new Map(catalog.units.map(row => [row.id, row]));
  const pages = new Map(catalog.pages.map(row => [row.id, row]));
  for (const edition of catalog.editions) {
    requireText(edition.title, "edition title");
    assertKnowledge(edition.editionLabel, value => requireText(value, "edition label"));
    assertRefs(edition.provenanceRefs);
  }
  for (const row of [...catalog.units, ...catalog.pages, ...catalog.problems]) {
    if (!editions.has(row.editionId)) throw new Error("unknown catalog edition");
  }
  for (const unit of catalog.units) {
    requireText(unit.title, "unit title");
    if (unit.level === "major") {
      if (unit.parentId !== null) throw new Error("major unit cannot have a parent");
    } else {
      if (unit.level !== "middle" && unit.level !== "minor") throw new Error("invalid unit level");
      assertKnowledge(unit.parentId, value => {
        const parent = units.get(value);
        if (!parent || parent.editionId !== unit.editionId ||
          parent.level !== (unit.level === "middle" ? "major" : "middle")) {
          throw new Error("unit parent must be the preceding level of the same edition");
        }
      });
    }
  }
  for (const page of catalog.pages) {
    requireText(page.printedLabel, "printed page label");
    assertKnowledge(page.minorUnitId, value => {
      const unit = units.get(value);
      if (!unit || unit.level !== "minor" || unit.editionId !== page.editionId) throw new Error("invalid page unit");
    });
  }
  for (const problem of catalog.problems) {
    requireText(problem.printedLabel, "printed problem label");
    assertKnowledge(problem.pageId, value => {
      const page = pages.get(value);
      if (!page || page.editionId !== problem.editionId) throw new Error("invalid problem page");
    });
  }
}

/** Unknown ancestors remain unknown; textbook title/page labels are never joins. */
export function resolveProblemPath(catalog: LearningCatalog, problemId: ProblemId) {
  validateCatalog(catalog);
  const problem = catalog.problems.find(row => row.id === problemId);
  if (!problem) throw new Error("unknown problem");
  const pageId = problem.pageId.state === "known" ? problem.pageId.value : null;
  const page = pageId ? catalog.pages.find(row => row.id === pageId)! : null;
  const minorId = page?.minorUnitId.state === "known" ? page.minorUnitId.value : null;
  const minor = minorId ? catalog.units.find(row => row.id === minorId)! : null;
  const middleId = minor && minor.level !== "major" && minor.parentId.state === "known" ? minor.parentId.value : null;
  const middle = middleId ? catalog.units.find(row => row.id === middleId)! : null;
  const majorId = middle && middle.level !== "major" && middle.parentId.state === "known" ? middle.parentId.value : null;
  const major = majorId ? catalog.units.find(row => row.id === majorId)! : null;
  return immutableCopy({ editionId: problem.editionId, major, middle, minor, page, problem });
}

export function validateScope(scope: ContentScope, catalog?: LearningCatalog): void {
  assertExactKeys(scope, ["editionId", "unitId", "pageIds", "problemIds"]);
  assertKnowledge(scope.editionId, value => requireText(value, "scope edition"));
  assertKnowledge(scope.unitId, value => requireText(value, "scope unit"));
  for (const values of [scope.pageIds, scope.problemIds]) assertKnowledge<readonly string[]>(values, value => {
    if (!Array.isArray(value)) throw new Error("scope needs an array of opaque ids");
    value.forEach(id => requireText(id, "scope content id"));
    if (new Set(value).size !== value.length) throw new Error("duplicate scope id");
  });
  if (!catalog) return;
  validateCatalog(catalog);
  const editionId = scope.editionId.state === "known" ? scope.editionId.value : null;
  if (editionId && !catalog.editions.some(row => row.id === editionId)) throw new Error("unknown scope edition");
  const unitId = scope.unitId.state === "known" ? scope.unitId.value : null;
  const scoped = [
    ...(unitId ? [catalog.units.find(row => row.id === unitId)] : []),
    ...(scope.pageIds.state === "known" ? scope.pageIds.value.map(id => catalog.pages.find(row => row.id === id)) : []),
    ...(scope.problemIds.state === "known" ? scope.problemIds.value.map(id => catalog.problems.find(row => row.id === id)) : []),
  ];
  if (scoped.some(row => !row || (editionId !== null && row.editionId !== editionId))) throw new Error("scope catalog mismatch");
  if (new Set(scoped.map(row => row!.editionId)).size > 1) throw new Error("scope mixes editions");
  const unitRelationship = (minorId: UnitId): "within" | "outside" | "unknown" => {
    const target = catalog.units.find(row => row.id === unitId)!;
    const levels = { major: 0, middle: 1, minor: 2 };
    let current = catalog.units.find(row => row.id === minorId);
    while (current) {
      if (current.id === unitId) return "within";
      if (levels[current.level] <= levels[target.level] || current.level === "major") return "outside";
      if (current.parentId.state === "unknown") return "unknown";
      const parentId = current.parentId.value;
      current = catalog.units.find(row => row.id === parentId);
    }
    return "unknown";
  };
  const relevantPages = new Set<PageId>(scope.pageIds.state === "known" ? scope.pageIds.value : []);
  if (scope.problemIds.state === "known") for (const id of scope.problemIds.value) {
    const problem = catalog.problems.find(row => row.id === id)!;
    if (problem.pageId.state === "known") {
      if (scope.pageIds.state === "known" && scope.pageIds.value.length > 0 && !scope.pageIds.value.includes(problem.pageId.value)) {
        throw new Error("problem lies outside the declared page scope");
      }
      relevantPages.add(problem.pageId.value);
    }
  }
  if (unitId) for (const id of relevantPages) {
    const page = catalog.pages.find(row => row.id === id)!;
    // Unknown ancestry does not establish a mismatch or a verified unit join.
    if (page.minorUnitId.state === "known" && unitRelationship(page.minorUnitId.value) === "outside") {
      throw new Error("page lies outside the declared unit scope");
    }
  }
}

export function validateRecord(record: LearningRecord): void {
  // Reject undefined/non-JSON values before any digest or persistence boundary.
  canonicalJson(record);
  if (record.kind === "book_assignment") {
    assertExactKeys(record, ["kind", "studentId", "editionId", "validFrom", "validUntil", "authoredBy", "evidenceRefs"]);
    requireText(record.studentId, "student id");
    assertKnowledge(record.editionId, value => requireText(value, "edition id"));
    assertDate(record.validFrom);
    assertKnowledge(record.validUntil, value => {
      assertDate(value);
      if (value < record.validFrom) throw new Error("assignment ends before it begins");
    });
    requireEnum(record.authoredBy, ["source", "teacher"]);
    assertRefs(record.evidenceRefs);
    return;
  }
  assertContext(record.context);
  validateScope(record.scope);
  if (record.kind === "teacher_plan") {
    assertExactKeys(record, ["kind", "context", "teacherId", "horizon", "purpose", "status", "scope", "assignmentId", "basedOnRevisionIds", "dueDate"]);
    requireText(record.teacherId, "teacher id");
    requireEnum(record.horizon, ["present", "future"]);
    requireEnum(record.purpose, ["lesson", "homework", "review", "makeup"]);
    requireEnum(record.status, ["draft", "approved", "cancelled"]);
    assertKnowledge(record.assignmentId, value => requireText(value, "assignment id"));
    assertKnowledge(record.dueDate, assertDate);
    if (!Array.isArray(record.basedOnRevisionIds)) throw new Error("plan basis needs revision ids");
    record.basedOnRevisionIds.forEach(value => requireText(value, "basis revision id"));
    if (new Set(record.basedOnRevisionIds).size !== record.basedOnRevisionIds.length) throw new Error("duplicate basis revision");
    return;
  }
  if (record.kind !== "source_observation") throw new Error("unknown learning record kind");
  assertExactKeys(record, ["kind", "context", "sessionKind", "makeupForOccurrenceId", "scope", "provenance", "exactBinding", "attendance", "activity", "correctionChecked", "correctness"]);
  requireEnum(record.sessionKind, ["lesson", "makeup"]);
  assertKnowledge(record.makeupForOccurrenceId, value => requireText(value, "makeup origin"));
  const source = record.provenance;
  assertExactKeys(source, ["system", "recordKey", "observedAt", "sourceTimestamp", "contractRef", "contentDigest"]);
  requireEnum(source.system, ["lms_day_record", "lms_makeup", "spt_classroom", "app_submission", "teacher_observation"]);
  requireText(source.recordKey, "source record key");
  requireText(source.contractRef, "source contract");
  assertInstant(source.observedAt);
  assertKnowledge(source.sourceTimestamp, value => {
    assertInstant(value);
    if (Date.parse(value) > Date.parse(source.observedAt)) throw new Error("source timestamp is later than observation");
  });
  assertKnowledge(source.contentDigest, value => {
    if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("invalid source digest");
  });
  assertKnowledge(record.exactBinding, value => {
    assertExactKeys(value, ["studentId", "lessonDate", "occurrenceId"]);
    if (record.context.occurrenceId.state !== "known" || value.studentId !== record.context.studentId ||
      value.lessonDate !== record.context.lessonDate || value.occurrenceId !== record.context.occurrenceId.value) {
      throw new Error("source binding does not match exact student and lesson");
    }
  });
  assertKnowledge(record.attendance, value => requireEnum(value, ["held", "cancelled", "absent"]));
  requireEnum(record.activity, ["assigned", "attempted", "reported_complete", "teacher_inspected"]);
  assertKnowledge(record.correctionChecked, value => { if (typeof value !== "boolean") throw new Error("invalid correction check"); });
  assertKnowledge(record.correctness, value => requireEnum(value, ["correct", "incorrect", "partial"]));
  if (record.activity === "teacher_inspected" && source.system !== "teacher_observation") {
    throw new Error("teacher inspection requires an explicit teacher observation");
  }
}

export function studentOf(record: LearningRecord): StudentId {
  return record.kind === "book_assignment" ? record.studentId : record.context.studentId;
}

export function assertContext(context: LessonContext): void {
  assertExactKeys(context, ["studentId", "lessonDate", "occurrenceId", "localStartTime", "timeZone"]);
  requireText(context.studentId, "student id");
  assertDate(context.lessonDate);
  assertKnowledge(context.occurrenceId, value => requireText(value, "occurrence id"));
  assertKnowledge(context.localStartTime, assertTime);
  requireText(context.timeZone, "time zone");
  try { new Intl.DateTimeFormat("en", { timeZone: context.timeZone }); }
  catch { throw new Error("invalid time zone"); }
}
export function assertDate(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
    throw new Error("invalid calendar date");
  }
}
export function assertTime(value: string): void {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("invalid local lesson time");
}
export function assertInstant(value: string): void {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw new Error("invalid timestamp with timezone");
  assertDate(value.slice(0, 10));
}
export function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty`);
}
export function assertRefs(refs: readonly string[]): void {
  if (!Array.isArray(refs) || refs.length === 0) throw new Error("known data needs evidence references");
  refs.forEach(value => requireText(value, "evidence reference"));
  if (new Set(refs).size !== refs.length) throw new Error("duplicate evidence reference");
}
export function assertKnowledge<T>(item: Knowledge<T>, validate?: (value: T) => void): void {
  if (!item || typeof item !== "object") throw new Error("missing knowledge state");
  if (item.state === "unknown") {
    assertExactKeys(item, ["state", "reason"]);
    requireText(item.reason, "unknown reason"); return;
  }
  if (item.state !== "known" || item.value === undefined || item.value === null) throw new Error("invalid knowledge state");
  assertExactKeys(item, ["state", "value", "evidenceRefs"]);
  assertRefs(item.evidenceRefs);
  validate?.(item.value);
}
export function assertExactKeys(value: object, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || expected.some(key => !Object.hasOwn(value, key))) throw new Error("unexpected or missing domain fields");
}
function requireEnum(value: string, values: readonly string[]): void {
  if (!values.includes(value)) throw new Error("invalid domain enum");
}

/** Stable JSON avoids property-order-dependent hashes; it is not a signature. */
export function canonicalJson(value: unknown): string {
  const visiting = new Set<object>();
  const encode = (part: unknown): string => {
    if (part === null || typeof part === "boolean" || typeof part === "string") return JSON.stringify(part);
    if (typeof part === "number" && Number.isFinite(part)) return JSON.stringify(part);
    if (typeof part !== "object" || part === null) throw new Error("only finite JSON data is allowed");
    if (Object.getOwnPropertySymbols(part).length > 0) throw new Error("symbol fields are not JSON data");
    if (Object.values(Object.getOwnPropertyDescriptors(part)).some(descriptor => descriptor.get || descriptor.set)) {
      throw new Error("accessors are not JSON data");
    }
    if (visiting.has(part)) throw new Error("cyclic JSON is not allowed");
    visiting.add(part);
    let result: string;
    if (Array.isArray(part)) {
      if (Object.keys(part).length !== part.length) throw new Error("sparse or decorated arrays are not allowed");
      result = `[${part.map(encode).join(",")}]`;
    } else {
      if (Object.getPrototypeOf(part) !== Object.prototype && Object.getPrototypeOf(part) !== null) throw new Error("plain JSON objects required");
      result = `{${Object.keys(part).sort().map(key => `${JSON.stringify(key)}:${encode((part as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    visiting.delete(part);
    return result;
  };
  return encode(value);
}
export function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}
export function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value)) as T;
  const freeze = (part: unknown): void => {
    if (part !== null && typeof part === "object") { Object.values(part).forEach(freeze); Object.freeze(part); }
  };
  freeze(copy);
  return copy;
}
