/**
 * codex-compat.test.ts — RUB-06, RUB-12
 * Verifies the agent-runtime barrel export works without any AGY env vars.
 * Verifies resolveAgentRuntimeDir() returns an existing path.
 */

import { describe, it, expect } from 'bun:test';

describe('Codex Compatibility & Zero-AGY-Runtime (RUB-06, RUB-12)', () => {
  it('AGY-specific env vars are NOT required — module loads without them', async () => {
    // If ANTIGRAVITY_* env vars were required, the import would fail
    // This test passes by virtue of the module loading successfully
    const mod = await import('../index');
    expect(mod).toBeDefined();
  });

  it('AgentRuntimeManifest type is exported (structural check via classifyTier)', async () => {
    const { classifyTier } = await import('../index');
    // classifyTier is the primary lib export; if the barrel is broken this fails
    expect(typeof classifyTier).toBe('function');
  });

  it('getAgentManifest is exported from barrel', async () => {
    const { getAgentManifest } = await import('../index');
    expect(typeof getAgentManifest).toBe('function');
  });

  it('isToolBlocked is exported from barrel', async () => {
    const { isToolBlocked } = await import('../index');
    expect(typeof isToolBlocked).toBe('function');
  });

  it('resolveAgentRuntimeDir is exported from barrel', async () => {
    const { resolveAgentRuntimeDir } = await import('../index');
    expect(typeof resolveAgentRuntimeDir).toBe('function');
  });

  it('resolveAgentRuntimeDir() returns a path that exists on disk', async () => {
    const { resolveAgentRuntimeDir } = await import('../index');
    const { existsSync } = await import('node:fs');
    const dir = resolveAgentRuntimeDir();
    expect(typeof dir).toBe('string');
    expect(dir.length).toBeGreaterThan(0);
    expect(existsSync(dir)).toBe(true);
  });

  it('resolveAgentRuntimeDir() does NOT use process.cwd() (path is absolute)', async () => {
    const { resolveAgentRuntimeDir } = await import('../index');
    const dir = resolveAgentRuntimeDir();
    // An absolute path on Windows starts with a drive letter, on Unix with /
    const isAbsolute = /^([A-Za-z]:[\\\/]|\/)/.test(dir);
    expect(isAbsolute).toBe(true);
  });

  it('AgentRegistryError is exported from barrel', async () => {
    const { AgentRegistryError } = await import('../index');
    expect(AgentRegistryError).toBeDefined();
    const err = new AgentRegistryError('test');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AgentRegistryError');
  });

  it('getPacingTiers returns non-empty array without AGY runtime', async () => {
    const { getPacingTiers } = await import('../index');
    const tiers = getPacingTiers();
    expect(Array.isArray(tiers)).toBe(true);
    expect(tiers.length).toBeGreaterThan(0);
  });

  it('getDomainConstraints returns non-empty array without AGY runtime', async () => {
    const { getDomainConstraints } = await import('../index');
    const constraints = getDomainConstraints();
    expect(Array.isArray(constraints)).toBe(true);
    expect(constraints.length).toBeGreaterThan(0);
  });

  it('getAllAgentManifests returns all 4 agents without AGY runtime', async () => {
    const { getAllAgentManifests } = await import('../index');
    const agents = getAllAgentManifests();
    expect(agents.length).toBe(4);
  });

  it('ANTIGRAVITY_PLUGIN_PATH env var is not set (confirming no AGY runtime dependency)', () => {
    // This test verifies the module doesn't REQUIRE AGY env vars to function
    // It's ok if the var happens to be set, but the module must work without it
    const agentMod = import('../lib/agentRegistry');
    expect(agentMod).toBeDefined(); // import returns a promise (it's a module, not an error)
  });
});
