/**
 * Repository/test-only SQLite persistence for invented learning revisions.
 * No source adapters, authentication, scheduler, media storage or production writer.
 * The synthetic filename/namespace markers express purpose; they are not a DLP boundary.
 */
import { Database } from "bun:sqlite";
import {
  assertExactKeys, canonicalJson, currentRevisions, digest, immutableCopy, previewRevision,
  studentOf, validateLedger,
  type LearningRevision, type RevisionCommand, type RevisionPreview,
} from "../learning/index.ts";

export interface SyntheticStoreOptions {
  readonly databasePath: string;
  readonly namespace: string;
}

/** Lossless logical export, independent of SQLite rowids and provider-specific SQL. */
export interface SyntheticLearningExport {
  readonly schemaVersion: 1;
  readonly purpose: "synthetic_learning_development";
  readonly namespace: string;
  readonly revisionCount: number;
  readonly history: readonly LearningRevision[];
  readonly contentDigest: string;
}

const purpose = "synthetic_learning_development";
const applicationTables = ["synthetic_learning_meta", "synthetic_learning_revisions"];
const schema = `
CREATE TABLE synthetic_learning_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  purpose TEXT NOT NULL CHECK (purpose = 'synthetic_learning_development')
);
INSERT INTO synthetic_learning_meta VALUES (1, 1, 'synthetic_learning_development');
CREATE TABLE synthetic_learning_revisions (
  append_order INTEGER PRIMARY KEY AUTOINCREMENT,
  namespace TEXT NOT NULL,
  revision_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  entity_sequence INTEGER NOT NULL CHECK (entity_sequence >= 1),
  student_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  revision_json TEXT NOT NULL CHECK (json_valid(revision_json)),
  UNIQUE (namespace, revision_id),
  UNIQUE (namespace, entity_id, entity_sequence),
  UNIQUE (namespace, entity_id, idempotency_key)
);
CREATE INDEX synthetic_learning_student ON synthetic_learning_revisions (namespace, student_id, append_order);
CREATE TRIGGER synthetic_learning_no_update BEFORE UPDATE ON synthetic_learning_revisions
BEGIN SELECT RAISE(ABORT, 'append_only_learning_revisions'); END;
CREATE TRIGGER synthetic_learning_no_delete BEFORE DELETE ON synthetic_learning_revisions
BEGIN SELECT RAISE(ABORT, 'append_only_learning_revisions'); END;
PRAGMA user_version = 1;
`;

interface StoredRow {
  revision_id: string;
  entity_id: string;
  entity_sequence: number;
  student_id: string;
  idempotency_key: string;
  revision_json: string;
}

export class SyntheticLearningSqliteStore {
  readonly namespace: string;
  readonly databasePath: string;
  private readonly db: Database;

  constructor(options: SyntheticStoreOptions) {
    assertNamespace(options.namespace);
    if (typeof options.databasePath !== "string" ||
      (options.databasePath !== ":memory:" && !options.databasePath.endsWith(".synthetic.sqlite"))) {
      throw new Error("synthetic_database_path_required");
    }
    this.namespace = options.namespace;
    this.databasePath = options.databasePath;
    this.db = new Database(options.databasePath, { create: true, strict: true });
    try {
      this.db.exec("PRAGMA busy_timeout = 1000;");
      this.immediate(() => this.initialize());
      this.history();
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Validate full partition history, including duplicated indexed identity fields. */
  history(): readonly LearningRevision[] {
    const rows = this.db.query<StoredRow, [string]>(`
      SELECT revision_id, entity_id, entity_sequence, student_id, idempotency_key, revision_json
      FROM synthetic_learning_revisions WHERE namespace = ? ORDER BY append_order
    `).all(this.namespace);
    const history = rows.map(row => {
      const revision = JSON.parse(row.revision_json) as LearningRevision;
      if (revision.revisionId !== row.revision_id || revision.entityId !== row.entity_id ||
        revision.sequence !== row.entity_sequence || studentOf(revision.payload) !== row.student_id ||
        revision.idempotencyKey !== row.idempotency_key) {
        throw new Error("storage_identity_mismatch");
      }
      return revision;
    });
    validateLedger(history);
    return immutableCopy(history);
  }

  current(): readonly LearningRevision[] { return currentRevisions(this.history()); }

  /** A preview never grants permission and must be recomputed at append time. */
  preview(command: RevisionCommand): RevisionPreview {
    return previewRevision(this.history(), command);
  }

  /** Reload, validate, CAS and append under the same SQLite writer transaction. */
  append(command: RevisionCommand): RevisionPreview {
    return this.immediate(() => {
      const result = previewRevision(this.history(), command);
      if (result.status !== "ready") return result;
      this.insert(result.candidate);
      const readback = this.history().find(row => row.revisionId === result.candidate.revisionId);
      if (!readback || canonicalJson(readback) !== canonicalJson(result.candidate)) {
        throw new Error("synthetic_append_readback_failed");
      }
      return result;
    });
  }

  export(): SyntheticLearningExport {
    const history = this.history();
    const body: Omit<SyntheticLearningExport, "contentDigest"> = {
      schemaVersion: 1 as const, purpose, namespace: this.namespace,
      revisionCount: history.length, history,
    };
    return immutableCopy({ ...body, contentDigest: digest(body) });
  }

  /** Empty matching partition only; no merge, deletion, remapping or implicit overwrite. */
  importEmpty(bundle: SyntheticLearningExport): void {
    validateSyntheticLearningExport(bundle);
    if (bundle.namespace !== this.namespace) throw new Error("migration_namespace_mismatch");
    this.immediate(() => {
      if (this.history().length !== 0) throw new Error("migration_target_not_empty");
      for (const revision of bundle.history) this.insert(revision);
      if (canonicalJson(this.export()) !== canonicalJson(bundle)) throw new Error("migration_readback_failed");
    });
  }

  close(): void { this.db.close(); }

  private initialize(): void {
    const tables = this.db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all().map(row => row.name);
    if (tables.length === 0) {
      const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
      if (version !== 0) throw new Error("unsupported_synthetic_schema_version");
      this.db.exec(schema);
      return;
    }
    if (canonicalJson(tables) !== canonicalJson([...applicationTables].sort())) {
      throw new Error("unrecognized_database_not_modified");
    }
    const meta = this.db.query<{ schema_version: number; purpose: string }, []>(
      "SELECT schema_version, purpose FROM synthetic_learning_meta WHERE singleton = 1",
    ).get();
    const version = this.db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version;
    if (!meta || meta.schema_version !== 1 || meta.purpose !== purpose || version !== 1) {
      throw new Error("unsupported_synthetic_schema_version");
    }
    const triggers = this.db.query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'synthetic_learning_revisions' ORDER BY name",
    ).all().map(row => row.name);
    if (canonicalJson(triggers) !== canonicalJson(["synthetic_learning_no_delete", "synthetic_learning_no_update"])) {
      throw new Error("synthetic_append_only_triggers_missing");
    }
  }

  private insert(revision: LearningRevision): void {
    this.db.query(`
      INSERT INTO synthetic_learning_revisions
      (namespace, revision_id, entity_id, entity_sequence, student_id, idempotency_key, revision_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(this.namespace, revision.revisionId, revision.entityId, revision.sequence,
      studentOf(revision.payload), revision.idempotencyKey, canonicalJson(revision));
  }

  private immediate<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export function validateSyntheticLearningExport(bundle: SyntheticLearningExport): void {
  assertExactKeys(bundle, ["schemaVersion", "purpose", "namespace", "revisionCount", "history", "contentDigest"]);
  if (bundle.schemaVersion !== 1 || bundle.purpose !== purpose) throw new Error("unsupported_learning_export");
  assertNamespace(bundle.namespace);
  if (!Array.isArray(bundle.history) || !Number.isSafeInteger(bundle.revisionCount) ||
    bundle.revisionCount !== bundle.history.length) throw new Error("migration_revision_count_mismatch");
  const { contentDigest, ...body } = bundle;
  if (digest(body) !== contentDigest) throw new Error("migration_digest_mismatch");
  validateLedger(bundle.history);
}

function assertNamespace(namespace: string): void {
  if (typeof namespace !== "string" || !/^synthetic:[a-z0-9][a-z0-9._:-]{0,126}$/.test(namespace)) {
    throw new Error("synthetic_namespace_required");
  }
}
