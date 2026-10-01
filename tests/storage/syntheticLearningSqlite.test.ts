import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  known, unknown, validateLedger,
  type EntityId, type EditionId, type PageId, type ProblemId, type RevisionCommand,
  type SourceObservation, type StudentId, type TeacherPlan,
} from "../../src/learning/index.ts";
import {
  SyntheticLearningSqliteStore, validateSyntheticLearningExport,
} from "../../src/storage/syntheticLearningSqlite.ts";

// Invented records only. Leading zeros and opaque strings deliberately remain strings.
const refs = ["synthetic:evidence:storage"];
const studentId = "00007" as StudentId;
const entityId = "entity:synthetic:plan:00001" as EntityId;
const namespace = "synthetic:learning-storage";
const folders: string[] = [];
const stores: SyntheticLearningSqliteStore[] = [];

function path(): string {
  const folder = mkdtempSync(join(tmpdir(), "learning-store-"));
  folders.push(folder);
  return join(folder, "ledger.synthetic.sqlite");
}
function open(databasePath = ":memory:", partition = namespace): SyntheticLearningSqliteStore {
  const store = new SyntheticLearningSqliteStore({ databasePath, namespace: partition });
  stores.push(store);
  return store;
}
function plan(status: TeacherPlan["status"] = "draft"): TeacherPlan {
  return {
    kind: "teacher_plan", teacherId: "synthetic:teacher", horizon: "present", purpose: "homework", status,
    context: {
      studentId, lessonDate: "2099-01-12", occurrenceId: known("occurrence:00009", refs),
      localStartTime: known("14:00", refs), timeZone: "Asia/Seoul",
    },
    scope: {
      editionId: known("edition:synthetic:2099" as EditionId, refs), unitId: unknown("Unit not inspected"),
      pageIds: known(["page:0001" as PageId], refs), problemIds: known(["question:00001" as ProblemId], refs),
    },
    assignmentId: unknown("No verified assignment edge"), basedOnRevisionIds: [],
    dueDate: known("2099-01-12", refs),
  };
}
function command(overrides: Partial<RevisionCommand> = {}): RevisionCommand {
  return {
    entityId, expectedRevisionId: null, idempotencyKey: "synthetic:request:1", actorId: "synthetic:teacher",
    recordedAt: "2099-01-12T05:00:00Z", reason: "Synthetic draft", payload: plan(), ...overrides,
  };
}
function inspection(): SourceObservation {
  return {
    kind: "source_observation", context: plan().context, scope: plan().scope, sessionKind: "lesson",
    makeupForOccurrenceId: unknown("Not a makeup"),
    provenance: {
      system: "teacher_observation", recordKey: "synthetic:inspection:0001", observedAt: "2099-01-12T05:00:00Z",
      sourceTimestamp: unknown("No separate source timestamp"), contractRef: "synthetic:teacher-inspection",
      contentDigest: unknown("No original payload retained"),
    },
    exactBinding: unknown("Exact occurrence source join is unresolved"), attendance: unknown("Not observed"),
    activity: "attempted", correctionChecked: unknown("Not inspected"), correctness: known("incorrect", refs),
  };
}
function revised(store: SyntheticLearningSqliteStore, retryKey = "synthetic:request:2"): RevisionCommand {
  return command({
    expectedRevisionId: store.current()[0]!.revisionId, idempotencyKey: retryKey,
    recordedAt: "2099-01-12T05:01:00Z", reason: "Synthetic teacher approval", payload: plan("approved"),
  });
}

afterEach(() => {
  for (const store of stores.splice(0)) store.close();
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe("synthetic Bun SQLite learning persistence", () => {
  it("previews without writing, then survives file reopen with exact opaque identity and unknowns", () => {
    const file = path();
    const first = open(file);
    expect(first.preview(command()).status).toBe("ready");
    expect(first.history()).toHaveLength(0);
    expect(first.append(command()).status).toBe("ready");
    const saved = first.history();
    first.close();
    stores.splice(stores.indexOf(first), 1);
    const second = open(file);
    expect(second.history()).toEqual(saved);
    const entry = second.current()[0]!.payload;
    expect(entry).toEqual(plan());
    if (entry.kind !== "teacher_plan") throw new Error("Synthetic fixture kind changed");
    expect(entry.context.studentId).toBe(studentId);
    expect(entry.context.occurrenceId).toEqual(known("occurrence:00009", refs));
    expect(entry.scope.problemIds).toEqual(known(["question:00001" as ProblemId], refs));
    expect(entry.scope.unitId.state).toBe("unknown");
    expect(Object.isFrozen(second.history()[0]!.payload)).toBe(true);
  });

  it("replays the original command after later revisions and rejects changed retry data", () => {
    const store = open();
    const original = command();
    store.append(original);
    store.append(revised(store));
    expect(store.append(original)).toMatchObject({ status: "replay", existing: store.history()[0] });
    expect(store.append({ ...original, reason: "Changed retry" })).toMatchObject({ status: "conflict", reason: "idempotency_reuse" });
    expect(store.history()).toHaveLength(2);
  });

  it("reloads CAS under the writer transaction when another connection invalidates a preview", () => {
    const file = path();
    const first = open(file);
    const second = open(file);
    first.append(command());
    const candidate = revised(first, "synthetic:contender");
    expect(first.preview(candidate).status).toBe("ready");
    expect(second.append(revised(second, "synthetic:winner")).status).toBe("ready");
    expect(first.append(candidate)).toMatchObject({ status: "conflict", reason: "stale_base" });
    expect(first.history()).toHaveLength(2);
    expect(first.current()[0]!.idempotencyKey).toBe("synthetic:winner");
  });

  it("keeps correction and compensation history instead of replacing earlier revisions", () => {
    const store = open();
    store.append(command());
    const original = store.history()[0]!;
    store.append(revised(store));
    expect(store.append(command({
      expectedRevisionId: store.current()[0]!.revisionId, idempotencyKey: "synthetic:compensation",
      recordedAt: "2099-01-12T05:02:00Z", reason: "Synthetic compensation restoring the reviewed draft",
      payload: original.payload,
    })).status).toBe("ready");
    const history = store.history();
    expect(history).toHaveLength(3);
    expect(history[0]).toEqual(original);
    expect(history[2]!.payload).toEqual(original.payload);
    expect(history[2]!.previousRevisionId).toBe(history[1]!.revisionId);
    expect(() => validateLedger(history)).not.toThrow();
  });

  it("isolates namespaces even when entity IDs and retry keys coincide", () => {
    const file = path();
    const first = open(file);
    const other = open(file, "synthetic:other-owner");
    first.append(command());
    expect(other.history()).toHaveLength(0);
    expect(other.append(command({ payload: plan("approved") })).status).toBe("ready");
    expect(first.current()[0]!.payload).toEqual(plan("draft"));
    expect(other.current()[0]!.payload).toEqual(plan("approved"));
    expect(first.export().namespace).not.toBe(other.export().namespace);
  });

  it("rejects moving an existing entity to another student partition", () => {
    const store = open();
    store.append(command());
    const nextPlan = plan("approved");
    expect(store.append({ ...revised(store), payload: {
      ...nextPlan, context: { ...nextPlan.context, studentId: "00008" as StudentId },
    } })).toMatchObject({ status: "conflict", reason: "student_partition_changed" });
    expect(store.history()).toHaveLength(1);
  });

  it("blocks UPDATE and DELETE at the SQLite boundary", () => {
    const file = path();
    const store = open(file);
    store.append(command());
    const direct = new Database(file);
    try {
      expect(() => direct.exec("UPDATE synthetic_learning_revisions SET student_id = '00008'")).toThrow("append_only");
      expect(() => direct.exec("DELETE FROM synthetic_learning_revisions")).toThrow("append_only");
    } finally { direct.close(); }
    expect(store.history()).toHaveLength(1);
  });

  it("rolls back a failed append and permits the same original retry key", () => {
    const file = path();
    const store = open(file);
    const direct = new Database(file);
    try {
      direct.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON synthetic_learning_revisions BEGIN SELECT RAISE(ABORT, 'synthetic_failure'); END;");
      expect(() => store.append(command())).toThrow("synthetic_failure");
      expect(store.history()).toHaveLength(0);
      direct.exec("DROP TRIGGER injected_failure");
      expect(store.append(command()).status).toBe("ready");
      expect(store.append(command()).status).toBe("replay");
    } finally { direct.close(); }
  });

  it("round trips a versioned logical export into an empty matching namespace", () => {
    const source = open();
    source.append(command());
    source.append(revised(source));
    const bundle = source.export();
    expect(() => validateSyntheticLearningExport(bundle)).not.toThrow();
    const target = open();
    target.importEmpty(bundle);
    expect(target.export()).toEqual(bundle);
    expect(target.append(command()).status).toBe("replay");
    expect(() => target.importEmpty(bundle)).toThrow("not_empty");
    expect(() => open(":memory:", "synthetic:foreign").importEmpty(bundle)).toThrow("namespace_mismatch");
  });

  it("preserves source correction history and dependent plan references in append order during migration", () => {
    const source = open();
    const factEntity = "entity:synthetic:inspection:0001" as EntityId;
    source.append(command({ entityId: factEntity, payload: inspection() }));
    const first = source.current()[0]!;
    source.append(command({
      entityId: factEntity, expectedRevisionId: first.revisionId, idempotencyKey: "synthetic:inspection:2",
      recordedAt: "2099-01-12T05:01:00Z", reason: "Synthetic explicit correction check",
      payload: { ...inspection(), activity: "teacher_inspected", correctionChecked: known(true, refs),
        provenance: { ...inspection().provenance, observedAt: "2099-01-12T05:01:00Z" } },
    }));
    const latest = source.current()[0]!;
    source.append(command({
      recordedAt: "2099-01-12T05:02:00Z", payload: { ...plan(), basedOnRevisionIds: [latest.revisionId] },
    }));
    const target = open();
    target.importEmpty(source.export());
    expect(target.history()).toEqual(source.history());
    expect(target.history()[0]!.payload).toEqual(inspection());
    const corrected = target.history()[1]!.payload;
    if (corrected.kind !== "source_observation") throw new Error("Synthetic fixture kind changed");
    expect(corrected.correctionChecked).toEqual(known(true, refs));
    expect(corrected.exactBinding.state).toBe("unknown");
    expect(target.current()).toHaveLength(2);
    expect(() => validateLedger(target.history())).not.toThrow();
  });

  it("rejects changed export bytes or an unsupported version without changing the target", () => {
    const source = open();
    source.append(command());
    const target = open();
    const bundle = source.export();
    expect(() => target.importEmpty({ ...bundle, revisionCount: 0 })).toThrow("count");
    expect(() => target.importEmpty({ ...bundle, contentDigest: "0".repeat(64) })).toThrow("digest");
    expect(() => target.importEmpty({ ...bundle, schemaVersion: 2 } as never)).toThrow("unsupported");
    expect(target.history()).toHaveLength(0);
  });

  it("rolls back every imported row when a later row fails", () => {
    const source = open();
    source.append(command());
    source.append(revised(source));
    const file = path();
    const target = open(file);
    const direct = new Database(file);
    try {
      direct.exec("CREATE TRIGGER injected_failure BEFORE INSERT ON synthetic_learning_revisions WHEN NEW.entity_sequence = 2 BEGIN SELECT RAISE(ABORT, 'synthetic_import_failure'); END;");
      expect(() => target.importEmpty(source.export())).toThrow("synthetic_import_failure");
      expect(target.history()).toHaveLength(0);
      direct.exec("DROP TRIGGER injected_failure");
      target.importEmpty(source.export());
      expect(target.history()).toHaveLength(2);
    } finally { direct.close(); }
  });

  it("refuses an unrelated database without mutating its user tables", () => {
    const file = path();
    const direct = new Database(file, { create: true });
    try {
      direct.exec("CREATE TABLE unrelated(value TEXT); INSERT INTO unrelated VALUES ('synthetic');");
      expect(() => open(file)).toThrow("not_modified");
      expect(direct.query("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([{ name: "unrelated" }]);
      expect(direct.query("SELECT value FROM unrelated").all()).toEqual([{ value: "synthetic" }]);
    } finally { direct.close(); }
  });

  it("rejects unintended paths/namespaces and does not silently upgrade a later schema", () => {
    expect(() => open("production.sqlite")).toThrow("synthetic_database_path");
    expect(() => open(":memory:", "production")).toThrow("synthetic_namespace");
    const file = path();
    open(file);
    const direct = new Database(file);
    try {
      direct.exec("PRAGMA user_version = 2");
      expect(() => open(file)).toThrow("unsupported_synthetic_schema");
      expect(direct.query("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    } finally { direct.close(); }
  });
});
