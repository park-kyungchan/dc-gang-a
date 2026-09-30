/**
 * Top-level manifest types for the Agent Runtime layer.
 * Defines the AgentRuntimeManifest envelope and subagent contract structures.
 */

import type { ModelTier, WorkspaceMode } from './agents.ts';

export interface DispatchContract {
  readonly objective: string;
  readonly contextBoundaries: string;
  readonly modelTier: ModelTier;
  readonly workspaceMode: WorkspaceMode;
  readonly acceptanceRubric: string;
  readonly outputContract?: string; // optional — warn at runtime when absent, NOT compile error
}

export interface HandshakeReport {
  readonly status: 'SUCCESS' | 'FAIL' | 'BLOCKED';
  readonly targetComponent: string;
  readonly evidence: string;
  readonly rubricVerification: Record<string, 'PASS' | 'FAIL'>;
  readonly criticalRisks: readonly string[];
}

export type RulePrecedenceOrder = readonly ['workspace', 'global'];

export interface AgentRuntimeManifest {
  readonly version: string; // e.g. "1.2.0" (from plugin.json)
  readonly schemaVersion: string; // semantic versioning for this agent-runtime layer
  readonly rulePrecedence: RulePrecedenceOrder;
  readonly pluginName: string;
  readonly description: string;
  readonly codexIntegration: 'none';
  readonly enforcement: 'none';
  readonly generatedAt: string; // ISO 8601
}
