/**
 * agent-runtime — Agent-agnostic typed runtime layer
 *
 * Preserves typed historical Antigravity workflow records for inspection.
 * Importing this module does not install Codex rules, hooks, or agent dispatch.
 *
 * Usage:
 *   import { AgentRuntimeManifest } from './agent-runtime/index.ts';
 *   import { classifyTier, getAgentManifest, isToolBlocked } from './agent-runtime/index.ts';
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type { PacingTier, PacingTierDescriptor, TokenBudget } from './types/pacing.ts';
export type {
  ModelTier,
  WorkspaceMode,
  ToolPolicyMode,
  ToolPolicy,
  AgentRole,
  AgentManifest,
} from './types/agents.ts';
export type { HookEventType, AgentHook } from './types/hooks.ts';
export type { ConstraintScope, ConstraintSeverity, DomainConstraint } from './types/constraints.ts';
export type {
  DispatchContract,
  HandshakeReport,
  RulePrecedenceOrder,
  AgentRuntimeManifest,
} from './types/manifest.ts';

// ── Lib ───────────────────────────────────────────────────────────────────────
export { classifyTier, getPacingTiers, getTokenBudget } from './lib/pacingClassifier.ts';
export type { ClassifyTierParams } from './lib/pacingClassifier.ts';

export {
  getAgentManifest,
  getAllAgentManifests,
  hasAgent,
  AgentRegistryError,
} from './lib/agentRegistry.ts';

export {
  isToolBlocked,
  getDomainConstraints,
  getConstraint,
} from './lib/constraintChecker.ts';

export { resolveAgentRuntimeDir, resolveDataFile } from './lib/pathResolver.ts';
