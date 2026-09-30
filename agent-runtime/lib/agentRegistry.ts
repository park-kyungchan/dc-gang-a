/**
 * Agent registry for the agent-runtime layer.
 * Provides O(1) lookup of historical Antigravity agent records by AgentRole.
 * Looking up a record does not dispatch a Codex subagent.
 * getAgentManifest('unknown-id') throws AgentRegistryError — never returns null/undefined.
 */

import { readFileSync } from 'node:fs';
import type { AgentManifest, AgentRole } from '../types/agents.ts';
import { deepFreeze } from './deepFreeze.ts';
import { resolveDataFile } from './pathResolver.ts';

export class AgentRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentRegistryError';
    Object.setPrototypeOf(this, AgentRegistryError.prototype);
  }
}

interface AgentsData {
  agents: AgentManifest[];
}

function loadAgentsData(): AgentsData {
  const filePath = resolveDataFile('agents.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as AgentsData;
}

let _registry: Map<AgentRole, AgentManifest> | null = null;

function getRegistry(): Map<AgentRole, AgentManifest> {
  if (!_registry) {
    const data = loadAgentsData();
    _registry = new Map(data.agents.map((a) => [a.agentId, deepFreeze(a)]));
  }
  return _registry;
}

/**
 * Fail-closed lookup: throws AgentRegistryError if agentId is not found.
 */
export function getAgentManifest(agentId: AgentRole | string): AgentManifest {
  const registry = getRegistry();
  const manifest = registry.get(agentId as AgentRole);
  if (!manifest) {
    throw new AgentRegistryError(
      `[agent-runtime] Unknown agent ID: '${agentId}'. Known agents: ${Array.from(registry.keys()).join(', ')}`
    );
  }
  return manifest;
}

/**
 * Returns all registered AgentManifest records.
 */
export function getAllAgentManifests(): AgentManifest[] {
  return Array.from(getRegistry().values());
}

/**
 * Returns true if the agentId is a known registered agent.
 */
export function hasAgent(agentId: string): boolean {
  return getRegistry().has(agentId as AgentRole);
}
