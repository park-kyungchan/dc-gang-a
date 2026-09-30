import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyTier, getAgentManifest, getConstraint, getDomainConstraints,
  getPacingTiers, getTokenBudget, isToolBlocked, resolveDataFile,
} from '../index';
import hooks from '../data/hooks.json';
import manifest from '../data/manifest.json';

describe('Adversarial runtime boundaries', () => {
  it('never presents historical workflow records as installed Codex policy', () => {
    expect(manifest.codexIntegration).toBe('none');
    expect(manifest.enforcement).toBe('none');
    expect(getPacingTiers().every((tier) => tier.policyStatus === 'historical')).toBe(true);
    expect(getTokenBudget().policyStatus).toBe('historical');
    expect(getAgentManifest('lead-workflow-orchestrator').policyStatus).toBe('historical');
    expect(getConstraint('MAX_MUTATING_CALLS')?.policyStatus).toBe('historical');
    expect(hooks.hooks.every((hook) => hook.enabled === false)).toBe(true);
  });
  it('does not turn content-based credential policy into a blanket write ban', () => {
    expect(getConstraint('NO_SESSION_COOKIE_PERSISTENCE')?.blockedTools).toEqual([]);
    expect(isToolBlocked('implementation-specialist', 'write_to_file')).toBe(false);
    expect(isToolBlocked('implementation-specialist', 'replace_file_content')).toBe(false);
    expect(isToolBlocked('rubric-researcher', 'write_to_file')).toBe(true);
  });

  it('keeps data resolution inside its data directory', () => {
    for (const filename of ['', '.', '..', '../manifest.json', '..\\manifest.json', '/tmp/a', 'a\0b', 'C:secret.json', 'file.json:stream', 'CON.json']) {
      expect(() => resolveDataFile(filename)).toThrow();
    }
    expect(resolveDataFile('manifest.json')).toEndWith('manifest.json');
  });

  it('rejects invalid file counts instead of assigning a low tier', () => {
    for (const fileCount of [-1, NaN, Infinity, 1.5]) {
      expect(() => classifyTier({
        fileCount,
        isSchemaMutation: false,
        isExternalApiChange: false,
        isArchitectureChange: false,
      })).toThrow(RangeError);
    }
  });

  it('does not advertise hooks without installed handlers as active', () => {
    const root = resolve(import.meta.dir, '../..');
    for (const hook of hooks.hooks) {
      const handler = hook.handlerCommand.split(' ')[2];
      if (!handler || !existsSync(resolve(root, handler))) {
        expect(hook.enabled).toBe(false);
      }
    }
  });

  it('does not allow nested policy mutation through exported objects', () => {
    const agent = getAgentManifest('rubric-researcher');
    const constraints = getDomainConstraints();
    const tiers = getPacingTiers();
    expect(Object.isFrozen(agent.toolPolicy.allowedTools)).toBe(true);
    expect(Object.isFrozen(agent.toolPolicy)).toBe(true);
    expect(Object.isFrozen(constraints)).toBe(true);
    expect(Object.isFrozen(constraints[0]?.blockedTools)).toBe(true);
    expect(Object.isFrozen(tiers[0]?.triggers)).toBe(true);
    expect(isToolBlocked('rubric-researcher', 'write_to_file')).toBe(true);
  });
});
