/**
 * Domain constraint types for the Agent Runtime layer.
 * Encodes workspace-level and global invariants (e.g., ZERO_GREP, NO_SESSION_COOKIE_PERSISTENCE).
 */

export type ConstraintScope = 'workspace' | 'global';
export type ConstraintSeverity = 'error' | 'warn';

export interface DomainConstraint {
  readonly id: string; // e.g. "ZERO_GREP", "MAX_MUTATING_CALLS"
  readonly policyStatus: 'advisory' | 'historical';
  readonly description: string;
  readonly scope: ConstraintScope;
  readonly blockedTools: readonly string[];
  readonly allowedAlternatives: readonly string[];
  readonly severity: ConstraintSeverity; // classification inside this proposed runtime only
  readonly sourceRule: string; // e.g. "AGENTS.md#Deterministic Entity & Route Queries"
}
