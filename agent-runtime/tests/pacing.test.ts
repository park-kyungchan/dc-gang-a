/**
 * pacing.test.ts — RUB-01, RUB-08
 * Verifies pacing tier descriptors and token budget invariants.
 */

import { describe, it, expect } from 'bun:test';
import { classifyTier, getPacingTiers, getTokenBudget } from '../lib/pacingClassifier';

describe('Pacing Tiers (RUB-01)', () => {
  it('Tier 1 requiresHITLGate === false', () => {
    const tiers = getPacingTiers();
    const t1 = tiers.find((t) => t.tier === 1);
    expect(t1).toBeDefined();
    expect(t1!.requiresHITLGate).toBe(false);
  });

  it('Tier 2 requiresHITLGate === false', () => {
    const tiers = getPacingTiers();
    const t2 = tiers.find((t) => t.tier === 2);
    expect(t2).toBeDefined();
    expect(t2!.requiresHITLGate).toBe(false);
  });

  it('Tier 3 requiresHITLGate === true', () => {
    const tiers = getPacingTiers();
    const t3 = tiers.find((t) => t.tier === 3);
    expect(t3).toBeDefined();
    expect(t3!.requiresHITLGate).toBe(true);
  });

  it('Tier 1 requiresAdversarialPipeline === false', () => {
    const tiers = getPacingTiers();
    const t1 = tiers.find((t) => t.tier === 1);
    expect(t1!.requiresAdversarialPipeline).toBe(false);
  });

  it('Tier 3 requiresAdversarialPipeline === true', () => {
    const tiers = getPacingTiers();
    const t3 = tiers.find((t) => t.tier === 3);
    expect(t3!.requiresAdversarialPipeline).toBe(true);
  });

  it('Tier 1 autoVerificationRequired === false', () => {
    const tiers = getPacingTiers();
    const t1 = tiers.find((t) => t.tier === 1);
    expect(t1!.autoVerificationRequired).toBe(false);
  });

  it('Tier 2 autoVerificationRequired === true', () => {
    const tiers = getPacingTiers();
    const t2 = tiers.find((t) => t.tier === 2);
    expect(t2!.autoVerificationRequired).toBe(true);
  });

  it('Tier 3 autoVerificationRequired === true', () => {
    const tiers = getPacingTiers();
    const t3 = tiers.find((t) => t.tier === 3);
    expect(t3!.autoVerificationRequired).toBe(true);
  });

  it('All tiers have non-empty triggers', () => {
    const tiers = getPacingTiers();
    for (const tier of tiers) {
      expect(tier.triggers.length).toBeGreaterThan(0);
    }
  });

  it('Exactly 3 tiers defined', () => {
    expect(getPacingTiers().length).toBe(3);
    expect(getPacingTiers().every((tier) => tier.policyStatus === 'historical')).toBe(true);
  });
});

describe('TokenBudget (RUB-08)', () => {
  it('the archived mutation budget is historical', () => {
    expect(getTokenBudget().policyStatus).toBe('historical');
  });
  it('maxMutatingCallsPerTurn === 3 (exact rule value)', () => {
    const budget = getTokenBudget();
    expect(budget.maxMutatingCallsPerTurn).toBe(3);
  });

  it('artifactOffloadThresholdLines === 30 (exact rule value)', () => {
    const budget = getTokenBudget();
    expect(budget.artifactOffloadThresholdLines).toBe(30);
  });

  it('preferSurgicalReplace === true', () => {
    const budget = getTokenBudget();
    expect(budget.preferSurgicalReplace).toBe(true);
  });

  it('maxParallelPhases is a positive integer', () => {
    const budget = getTokenBudget();
    expect(budget.maxParallelPhases).toBeGreaterThan(0);
    expect(Number.isInteger(budget.maxParallelPhases)).toBe(true);
  });
});

describe('classifyTier (RUB-01)', () => {
  it('1 file, no special flags → Tier 1', () => {
    const result = classifyTier({
      fileCount: 1,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(1);
  });

  it('2 files, no special flags → Tier 2', () => {
    const result = classifyTier({
      fileCount: 2,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(2);
  });

  it('3 files, no special flags → Tier 3', () => {
    const result = classifyTier({
      fileCount: 3,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(3);
  });

  it('10 files → Tier 3', () => {
    const result = classifyTier({
      fileCount: 10,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(3);
  });

  it('1 file + isSchemaMutation=true → Tier 3', () => {
    const result = classifyTier({
      fileCount: 1,
      isSchemaMutation: true,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(3);
  });

  it('1 file + isExternalApiChange=true → Tier 3', () => {
    const result = classifyTier({
      fileCount: 1,
      isSchemaMutation: false,
      isExternalApiChange: true,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(3);
  });

  it('1 file + isArchitectureChange=true → Tier 3', () => {
    const result = classifyTier({
      fileCount: 1,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: true,
    });
    expect(result.tier).toBe(3);
  });

  it('0 files, no special flags → Tier 1', () => {
    const result = classifyTier({
      fileCount: 0,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.tier).toBe(1);
  });

  it('classifyTier result has correct name for Tier 3', () => {
    const result = classifyTier({
      fileCount: 3,
      isSchemaMutation: false,
      isExternalApiChange: false,
      isArchitectureChange: false,
    });
    expect(result.name).toBe('Adversarial HITL Gate');
  });
});
