import {
  assertExactKeys, assertInstant, canonicalJson, digest, immutableCopy, requireText, stableId, studentOf, validateRecord,
  type EntityId, type LearningRecord, type RevisionId,
} from "./model";

export interface RevisionCommand {
  readonly entityId: EntityId;
  readonly expectedRevisionId: RevisionId | null;
  /** Caller persists and reuses this key for retries of the identical command. */
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly recordedAt: string;
  readonly reason: string;
  readonly payload: LearningRecord;
}
export interface LearningRevision {
  readonly schemaVersion: 1;
  readonly revisionId: RevisionId;
  readonly entityId: EntityId;
  readonly sequence: number;
  readonly previousRevisionId: RevisionId | null;
  readonly previousDigest: string | null;
  readonly idempotencyKey: string;
  readonly actorId: string;
  readonly recordedAt: string;
  readonly reason: string;
  readonly commandDigest: string;
  readonly payload: LearningRecord;
  readonly integrityDigest: string;
}
export type RevisionConflict = "stale_base" | "idempotency_reuse" | "record_kind_changed" |
  "student_partition_changed" | "source_identity_changed" | "source_time_regressed" | "recorded_time_regressed";
export type RevisionPreview =
  | Readonly<{ status: "ready"; before: LearningRecord | null; after: LearningRecord; candidate: LearningRevision }>
  | Readonly<{ status: "replay"; existing: LearningRevision }>
  | Readonly<{ status: "conflict"; reason: RevisionConflict; current: LearningRevision | null }>;

/** Validate the full supplied history before reading or appending it. No trusted partial history. */
export function validateLedger(history: readonly LearningRevision[]): void {
  const latest = new Map<EntityId, LearningRevision>();
  const revisionIds = new Set<RevisionId>();
  const retryKeys = new Set<string>();
  for (const revision of history) {
    assertExactKeys(revision, ["schemaVersion", "revisionId", "entityId", "sequence", "previousRevisionId", "previousDigest",
      "idempotencyKey", "actorId", "recordedAt", "reason", "commandDigest", "payload", "integrityDigest"]);
    const { integrityDigest, ...body } = revision;
    if (revision.schemaVersion !== 1 || digest(body) !== integrityDigest) throw new Error("revision integrity failure");
    assertCommand(commandFrom(revision));
    if (digest(commandFrom(revision)) !== revision.commandDigest) throw new Error("command integrity failure");
    if (revision.revisionId !== revisionIdFor(revision.entityId, revision.idempotencyKey)) throw new Error("revision identity failure");
    const previous = latest.get(revision.entityId) ?? null;
    if (revision.sequence !== (previous?.sequence ?? 0) + 1 ||
      revision.previousRevisionId !== (previous?.revisionId ?? null) ||
      revision.previousDigest !== (previous?.integrityDigest ?? null)) throw new Error("broken append-only revision chain");
    if (previous && transitionConflict(previous, commandFrom(revision))) throw new Error("invalid revision transition");
    if (revisionIds.has(revision.revisionId) || retryKeys.has(retryKey(revision))) throw new Error("duplicate revision or idempotency key");
    validateReferences(history.slice(0, revisionIds.size), revision.payload);
    revisionIds.add(revision.revisionId);
    retryKeys.add(retryKey(revision));
    latest.set(revision.entityId, revision);
  }
}

/** Preview retains exact before/after values. A ready preview is not write approval. */
export function previewRevision(history: readonly LearningRevision[], command: RevisionCommand): RevisionPreview {
  validateLedger(history);
  assertCommand(command);
  const existing = history.find(row => retryKey(row) === retryKey(command));
  const current = history.filter(row => row.entityId === command.entityId).at(-1) ?? null;
  if (existing) return immutableCopy(existing.commandDigest === digest(command)
    ? { status: "replay" as const, existing }
    : { status: "conflict" as const, reason: "idempotency_reuse" as const, current });
  if (command.expectedRevisionId !== (current?.revisionId ?? null)) {
    return immutableCopy({ status: "conflict", reason: "stale_base", current });
  }
  const conflict = current ? transitionConflict(current, command) : null;
  if (conflict) return immutableCopy({ status: "conflict", reason: conflict, current });
  validateReferences(history, command.payload);
  const body: Omit<LearningRevision, "integrityDigest"> = {
    schemaVersion: 1,
    revisionId: revisionIdFor(command.entityId, command.idempotencyKey),
    entityId: command.entityId,
    sequence: (current?.sequence ?? 0) + 1,
    previousRevisionId: current?.revisionId ?? null,
    previousDigest: current?.integrityDigest ?? null,
    idempotencyKey: command.idempotencyKey,
    actorId: command.actorId,
    recordedAt: command.recordedAt,
    reason: command.reason,
    commandDigest: digest(command),
    payload: command.payload,
  };
  return immutableCopy({
    status: "ready", before: current?.payload ?? null, after: command.payload,
    candidate: { ...body, integrityDigest: digest(body) },
  });
}

/** Pure in-memory append; recomputes the preview so a stale preview cannot bypass CAS. */
export function appendRevision(history: readonly LearningRevision[], command: RevisionCommand): {
  readonly history: readonly LearningRevision[]; readonly result: RevisionPreview;
} {
  const result = previewRevision(history, command);
  return immutableCopy({ history: result.status === "ready" ? [...history, result.candidate] : history, result });
}

export function currentRevisions(history: readonly LearningRevision[]): readonly LearningRevision[] {
  validateLedger(history);
  const current = new Map<EntityId, LearningRevision>();
  for (const row of history) current.set(row.entityId, row);
  return immutableCopy([...current.values()]);
}

function assertCommand(command: RevisionCommand): void {
  assertExactKeys(command, ["entityId", "expectedRevisionId", "idempotencyKey", "actorId", "recordedAt", "reason", "payload"]);
  canonicalJson(command);
  requireText(command.entityId, "entity id");
  if (command.expectedRevisionId !== null) requireText(command.expectedRevisionId, "expected revision");
  requireText(command.idempotencyKey, "idempotency key");
  requireText(command.actorId, "actor id");
  requireText(command.reason, "revision reason");
  assertInstant(command.recordedAt);
  validateRecord(command.payload);
  if (command.payload.kind === "source_observation" &&
    Date.parse(command.payload.provenance.observedAt) > Date.parse(command.recordedAt)) {
    throw new Error("cannot record an observation from the future");
  }
}

function transitionConflict(current: LearningRevision, next: RevisionCommand): RevisionConflict | null {
  const before = current.payload;
  const after = next.payload;
  if (before.kind !== after.kind) return "record_kind_changed";
  if (studentOf(before) !== studentOf(after)) return "student_partition_changed";
  if (Date.parse(next.recordedAt) < Date.parse(current.recordedAt)) return "recorded_time_regressed";
  if (before.kind === "source_observation" && after.kind === "source_observation") {
    if (before.provenance.system !== after.provenance.system || before.provenance.recordKey !== after.provenance.recordKey) {
      return "source_identity_changed";
    }
    if (Date.parse(after.provenance.observedAt) < Date.parse(before.provenance.observedAt)) return "source_time_regressed";
  }
  return null;
}

/** Teacher plans cite already-existing evidence; references do not establish correctness. */
function validateReferences(history: readonly LearningRevision[], payload: LearningRecord): void {
  if (payload.kind !== "teacher_plan") return;
  for (const id of payload.basedOnRevisionIds) {
    const source = history.find(row => row.revisionId === id);
    if (!source || studentOf(source.payload) !== payload.context.studentId) throw new Error("unknown or foreign plan basis revision");
  }
  if (payload.assignmentId.state === "known") {
    const id = payload.assignmentId.value;
    const assigned = history.filter(row => row.entityId === id).at(-1)?.payload;
    if (!assigned || assigned.kind !== "book_assignment" || assigned.studentId !== payload.context.studentId) {
      throw new Error("unknown or foreign book assignment");
    }
    if (payload.context.lessonDate < assigned.validFrom ||
      (assigned.validUntil.state === "known" && payload.context.lessonDate > assigned.validUntil.value)) {
      throw new Error("book assignment is outside its effective dates");
    }
    if (assigned.editionId.state === "known" && payload.scope.editionId.state === "known" &&
      assigned.editionId.value !== payload.scope.editionId.value) throw new Error("plan and book assignment editions differ");
  }
}

function revisionIdFor(entityId: EntityId, key: string): RevisionId { return stableId("revision", "learning-v1", entityId, key); }
function retryKey(value: Pick<RevisionCommand, "entityId" | "idempotencyKey">): string {
  return canonicalJson([value.entityId, value.idempotencyKey]);
}
function commandFrom(revision: LearningRevision): RevisionCommand {
  return {
    entityId: revision.entityId, expectedRevisionId: revision.previousRevisionId,
    idempotencyKey: revision.idempotencyKey, actorId: revision.actorId,
    recordedAt: revision.recordedAt, reason: revision.reason, payload: revision.payload,
  };
}
