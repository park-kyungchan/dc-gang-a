/**
 * Pacing Tier types for the Agent Runtime layer.
 * Preserves historical Antigravity pacing; these tiers do not gate Codex work.
 */

export type PacingTier = 1 | 2 | 3;

export interface PacingTierDescriptor {
  readonly tier: PacingTier;
  readonly policyStatus: 'historical';
  readonly name:
    | 'Rapid Path'
    | 'Test-Verified Sequential Path'
    | 'Adversarial HITL Gate';
  readonly maxFilesMutated: number; // 1 for T1, 2 for T2, Infinity for T3
  readonly requiresHITLGate: boolean; // historical requirement only
  readonly requiresAdversarialPipeline: boolean; // historical requirement only
  readonly autoVerificationRequired: boolean; // false, true, true
  readonly description: string;
  readonly triggers: string[]; // list of trigger conditions from source rules
}

export interface TokenBudget {
  readonly policyStatus: 'historical';
  readonly maxMutatingCallsPerTurn: 3; // historical value, not a Codex limit
  readonly artifactOffloadThresholdLines: 30; // historical value
  readonly preferSurgicalReplace: true; // replace_file_content over write_to_file overwrite
  readonly maxParallelPhases: number;
}
