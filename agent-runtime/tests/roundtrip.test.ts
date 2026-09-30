/**
 * roundtrip.test.ts — RUB-04
 * Verifies JSON.parse(JSON.stringify(data)) deep-equals original for all data files.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_DIR = resolve(import.meta.dir, '../data');

function loadJson(filename: string): unknown {
  const raw = readFileSync(resolve(DATA_DIR, filename), 'utf-8');
  return JSON.parse(raw);
}

describe('JSON Roundtrip Fidelity (RUB-04)', () => {
  const dataFiles = ['pacing.json', 'agents.json', 'hooks.json', 'constraints.json', 'manifest.json'];

  for (const filename of dataFiles) {
    it(`${filename} survives JSON.parse(JSON.stringify(...)) without loss`, () => {
      const original = loadJson(filename);
      const roundtripped = JSON.parse(JSON.stringify(original));
      expect(roundtripped).toEqual(original);
    });
  }

  it('pacing.json has valid structure (tiers + tokenBudget)', () => {
    const data = loadJson('pacing.json') as { tiers: unknown[]; tokenBudget: unknown };
    expect(Array.isArray(data.tiers)).toBe(true);
    expect(data.tokenBudget).toBeDefined();
  });

  it('agents.json has valid structure (agents array)', () => {
    const data = loadJson('agents.json') as { agents: unknown[] };
    expect(Array.isArray(data.agents)).toBe(true);
  });

  it('hooks.json has valid structure (hooks array)', () => {
    const data = loadJson('hooks.json') as { hooks: unknown[] };
    expect(Array.isArray(data.hooks)).toBe(true);
  });

  it('constraints.json has valid structure (constraints array)', () => {
    const data = loadJson('constraints.json') as { constraints: unknown[] };
    expect(Array.isArray(data.constraints)).toBe(true);
  });

  it('manifest.json has required top-level fields', () => {
    const data = loadJson('manifest.json') as Record<string, unknown>;
    expect(data['version']).toBeDefined();
    expect(data['schemaVersion']).toBeDefined();
    expect(data['rulePrecedence']).toBeDefined();
    expect(data['pluginName']).toBeDefined();
    expect(data['description']).toBeDefined();
    expect(data['generatedAt']).toBeDefined();
    expect(data['codexIntegration']).toBe('none');
    expect(data['enforcement']).toBe('none');
  });

  it('manifest.json rulePrecedence is ["workspace", "global"]', () => {
    const data = loadJson('manifest.json') as { rulePrecedence: string[] };
    expect(data.rulePrecedence).toEqual(['workspace', 'global']);
  });

  it('manifest.json generatedAt is a valid ISO 8601 timestamp', () => {
    const data = loadJson('manifest.json') as { generatedAt: string };
    const date = new Date(data.generatedAt);
    expect(isNaN(date.getTime())).toBe(false);
  });
});
