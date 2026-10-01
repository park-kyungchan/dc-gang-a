import {
  assertKnowledge, assertRefs, immutableCopy, known, requireText, unknown,
  type EditionId, type Knowledge, type PageId, type ProblemId, type StudentId,
} from "./model";

export interface VerifiedLegacyMapping {
  readonly sourceRowKey: string;
  readonly studentId: StudentId;
  readonly editionId: EditionId;
  readonly pageId: Knowledge<PageId>;
  readonly problemId: Knowledge<ProblemId>;
  readonly evidenceRefs: readonly string[];
}

/** Names and textbook/unit labels deliberately are not accepted as identity keys. */
export function resolveLegacyIdentity(sourceRowKey: string, mappings: readonly VerifiedLegacyMapping[]): Knowledge<VerifiedLegacyMapping> {
  requireText(sourceRowKey, "source row key");
  const candidates = mappings.filter(mapping => mapping.sourceRowKey === sourceRowKey);
  if (candidates.length === 0) return unknown("No verified opaque identity mapping for this source row.");
  if (candidates.length !== 1) return unknown("Ambiguous source row mappings; teacher review required before migration.");
  const mapping = candidates[0];
  requireText(mapping.studentId, "mapped student id");
  requireText(mapping.editionId, "mapped edition id");
  assertKnowledge(mapping.pageId, value => requireText(value, "mapped page id"));
  assertKnowledge(mapping.problemId, value => requireText(value, "mapped problem id"));
  assertRefs(mapping.evidenceRefs);
  return known(immutableCopy(mapping), mapping.evidenceRefs);
}
