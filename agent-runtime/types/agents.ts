/**
 * Agent manifest types for the Agent Runtime layer.
 * Preserves the historical Antigravity 4-agent governance matrix.
 */

export type ModelTier = 'flash_lite' | 'flash' | 'inherit' | 'pro';
export type WorkspaceMode = 'inherit' | 'share' | 'branch';
export type ToolPolicyMode = 'allowlist' | 'denylist';

export interface ToolPolicy {
  readonly policyMode: ToolPolicyMode;
  readonly allowedTools: readonly string[];
  readonly blockedTools: readonly string[];
}

export type AgentRole =
  | 'rubric-researcher'
  | 'implementation-specialist'
  | 'adversarial-auditor'
  | 'lead-workflow-orchestrator';

export interface AgentManifest {
  readonly agentId: AgentRole;
  readonly policyStatus: 'historical';
  readonly displayName: string;
  readonly role: string;
  readonly modelTier: ModelTier;
  readonly workspaceMode: WorkspaceMode;
  readonly isMainAgent: boolean;
  readonly toolPolicy: ToolPolicy;
  readonly dispatchPattern: string; // historical usage note, not a Codex dispatch rule
}
