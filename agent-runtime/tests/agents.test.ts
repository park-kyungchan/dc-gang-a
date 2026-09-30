/**
 * agents.test.ts — RUB-09
 * Verifies all 4 agent manifests are present and have correct tool policies.
 */

import { describe, it, expect } from 'bun:test';
import { getAllAgentManifests, getAgentManifest, AgentRegistryError } from '../lib/agentRegistry';

describe('Agent Registry (RUB-09)', () => {
  it('All 4 agents are present', () => {
    const agents = getAllAgentManifests();
    const ids = agents.map((a) => a.agentId);
    expect(ids).toContain('rubric-researcher');
    expect(ids).toContain('implementation-specialist');
    expect(ids).toContain('adversarial-auditor');
    expect(ids).toContain('lead-workflow-orchestrator');
    expect(agents.length).toBe(4);
    expect(agents.every((agent) => agent.policyStatus === 'historical')).toBe(true);
  });

  it('rubric-researcher.toolPolicy.blockedTools includes write_to_file', () => {
    const agent = getAgentManifest('rubric-researcher');
    expect(agent.toolPolicy.blockedTools).toContain('write_to_file');
  });

  it('rubric-researcher.toolPolicy.blockedTools includes replace_file_content', () => {
    const agent = getAgentManifest('rubric-researcher');
    expect(agent.toolPolicy.blockedTools).toContain('replace_file_content');
  });

  it('rubric-researcher.toolPolicy.blockedTools includes run_command', () => {
    const agent = getAgentManifest('rubric-researcher');
    expect(agent.toolPolicy.blockedTools).toContain('run_command');
  });

  it('rubric-researcher policyMode is allowlist', () => {
    const agent = getAgentManifest('rubric-researcher');
    expect(agent.toolPolicy.policyMode).toBe('allowlist');
  });

  it('adversarial-auditor blocked from write_to_file', () => {
    const agent = getAgentManifest('adversarial-auditor');
    expect(agent.toolPolicy.blockedTools).toContain('write_to_file');
  });

  it('adversarial-auditor blocked from replace_file_content', () => {
    const agent = getAgentManifest('adversarial-auditor');
    expect(agent.toolPolicy.blockedTools).toContain('replace_file_content');
  });

  it('adversarial-auditor policyMode is denylist', () => {
    const agent = getAgentManifest('adversarial-auditor');
    expect(agent.toolPolicy.policyMode).toBe('denylist');
  });

  it('implementation-specialist can use write_to_file (in allowedTools)', () => {
    const agent = getAgentManifest('implementation-specialist');
    expect(agent.toolPolicy.allowedTools).toContain('write_to_file');
  });

  it('implementation-specialist blocked from invoke_subagent', () => {
    const agent = getAgentManifest('implementation-specialist');
    expect(agent.toolPolicy.blockedTools).toContain('invoke_subagent');
  });

  it('lead-workflow-orchestrator.isMainAgent === true', () => {
    const agent = getAgentManifest('lead-workflow-orchestrator');
    expect(agent.isMainAgent).toBe(true);
  });

  it('non-main agents have isMainAgent === false', () => {
    for (const agentId of [
      'rubric-researcher',
      'implementation-specialist',
      'adversarial-auditor',
    ] as const) {
      const agent = getAgentManifest(agentId);
      expect(agent.isMainAgent).toBe(false);
    }
  });

  it('getAgentManifest throws AgentRegistryError for unknown ID', () => {
    expect(() => getAgentManifest('totally-unknown-agent' as never)).toThrow(AgentRegistryError);
  });

  it('getAgentManifest throws AgentRegistryError (not undefined) for empty string', () => {
    expect(() => getAgentManifest('' as never)).toThrow(AgentRegistryError);
  });

  it('All agents have non-empty displayName', () => {
    for (const agent of getAllAgentManifests()) {
      expect(agent.displayName.length).toBeGreaterThan(0);
    }
  });

  it('All agents have non-empty dispatchPattern', () => {
    for (const agent of getAllAgentManifests()) {
      expect(agent.dispatchPattern.length).toBeGreaterThan(0);
    }
  });
});
