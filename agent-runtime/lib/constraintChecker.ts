/**
 * Constraint checker for the agent-runtime layer.
 * Replays proposed/historical tool-name rules for analysis only.
 * Nothing in this module installs a Codex guard or checks arguments/effects.
 */

import { readFileSync } from 'node:fs';
import type { AgentRole } from '../types/agents.ts';
import type { DomainConstraint } from '../types/constraints.ts';
import { getAgentManifest } from './agentRegistry.ts';
import { deepFreeze } from './deepFreeze.ts';
import { resolveDataFile } from './pathResolver.ts';

interface ConstraintsData {
  constraints: DomainConstraint[];
}

function loadConstraintsData(): ConstraintsData {
  const filePath = resolveDataFile('constraints.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as ConstraintsData;
}

let _constraints: readonly DomainConstraint[] | null = null;

function getConstraints(): readonly DomainConstraint[] {
  if (!_constraints) {
    _constraints = deepFreeze(loadConstraintsData().constraints);
  }
  return _constraints;
}

/**
 * Returns true if the proposed historical policy would block a tool name.
 * This is not an active Codex authorization decision.
 *
 * Checks in order:
 * 1. Agent's toolPolicy (allowlist/denylist)
 * 2. Global DomainConstraints (blockedTools)
 *
 * A tool is blocked if:
 *   - policyMode === 'allowlist' AND toolName NOT in allowedTools
 *   - policyMode === 'denylist' AND toolName IS in blockedTools
 *   - policyMode === 'denylist' AND allowedTools is non-empty AND toolName NOT in allowedTools
 *     (allowedTools acts as an explicit permit list even in denylist mode)
 *   - Any DomainConstraint lists the toolName in blockedTools (error-severity)
 */
export function isToolBlocked(agentId: AgentRole | string, toolName: string): boolean {
  // 1. Check agent tool policy
  const manifest = getAgentManifest(agentId);
  const { policyMode, allowedTools, blockedTools } = manifest.toolPolicy;

  if (policyMode === 'allowlist') {
    if (!allowedTools.includes(toolName)) {
      return true;
    }
  } else if (policyMode === 'denylist') {
    // Explicit block via blockedTools list
    if (blockedTools.includes(toolName)) {
      return true;
    }
    // If allowedTools is non-empty, treat it as an additional allowlist gate
    // (prevents future denylist agents from inadvertently permitting undocumented tools)
    if (allowedTools.length > 0 && !allowedTools.includes(toolName)) {
      return true;
    }
  }

  // 2. Check error-severity domain constraints
  const constraints = getConstraints();
  for (const constraint of constraints) {
    if (constraint.severity === 'error' && constraint.blockedTools.includes(toolName)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns all domain constraints.
 */
export function getDomainConstraints(): readonly DomainConstraint[] {
  return getConstraints();
}

/**
 * Returns the constraint with the given ID, or undefined if not found.
 */
export function getConstraint(id: string): DomainConstraint | undefined {
  return getConstraints().find((c) => c.id === id);
}
