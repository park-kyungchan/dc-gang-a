/**
 * constraints.test.ts — RUB-05
 * Verifies domain constraints: ZERO_GREP, NO_SESSION_COOKIE_PERSISTENCE, and all required entries.
 */

import { describe, it, expect } from 'bun:test';
import { getDomainConstraints, getConstraint } from '../lib/constraintChecker';

describe('Domain Constraints (RUB-05)', () => {
  it('ZERO_GREP constraint exists', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c).toBeDefined();
  });

  it('ZERO_GREP.blockedTools includes grep_search', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c!.blockedTools).toContain('grep_search');
  });

  it('ZERO_GREP.blockedTools includes find_by_name', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c!.blockedTools).toContain('find_by_name');
  });

  it('ZERO_GREP.scope === workspace', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c!.scope).toBe('workspace');
  });

  it('ZERO_GREP.severity === error', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c!.severity).toBe('error');
  });

  it('ZERO_GREP has at least one allowedAlternative', () => {
    const c = getConstraint('ZERO_GREP');
    expect(c!.allowedAlternatives.length).toBeGreaterThan(0);
  });

  it('NO_SESSION_COOKIE_PERSISTENCE constraint exists', () => {
    const c = getConstraint('NO_SESSION_COOKIE_PERSISTENCE');
    expect(c).toBeDefined();
  });

  it('NO_SESSION_COOKIE_PERSISTENCE.severity === error', () => {
    const c = getConstraint('NO_SESSION_COOKIE_PERSISTENCE');
    expect(c!.severity).toBe('error');
  });

  it('NO_SESSION_COOKIE_PERSISTENCE.scope === global', () => {
    const c = getConstraint('NO_SESSION_COOKIE_PERSISTENCE');
    expect(c!.scope).toBe('global');
  });

  it('MAX_MUTATING_CALLS constraint exists', () => {
    const c = getConstraint('MAX_MUTATING_CALLS');
    expect(c).toBeDefined();
  });

  it('legacy MAX_MUTATING_CALLS retains its archived severity without Codex effect', () => {
    const c = getConstraint('MAX_MUTATING_CALLS');
    expect(c!.policyStatus).toBe('historical');
    expect(c!.severity).toBe('error');
  });

  it('MAX_MUTATING_CALLS.scope === global', () => {
    const c = getConstraint('MAX_MUTATING_CALLS');
    expect(c!.scope).toBe('global');
  });

  it('NO_HALLUCINATED_DATA constraint exists', () => {
    const c = getConstraint('NO_HALLUCINATED_DATA');
    expect(c).toBeDefined();
  });

  it('NO_SEND_TRIGGER constraint exists', () => {
    const c = getConstraint('NO_SEND_TRIGGER');
    expect(c).toBeDefined();
  });

  it('NO_SEND_TRIGGER.severity === error', () => {
    const c = getConstraint('NO_SEND_TRIGGER');
    expect(c!.severity).toBe('error');
  });

  it('PREFER_SURGICAL_REPLACE constraint exists', () => {
    const c = getConstraint('PREFER_SURGICAL_REPLACE');
    expect(c).toBeDefined();
  });

  it('PREFER_SURGICAL_REPLACE.severity === warn', () => {
    const c = getConstraint('PREFER_SURGICAL_REPLACE');
    expect(c!.severity).toBe('warn');
    expect(c!.policyStatus).toBe('historical');
  });

  it('other constraints are advisory descriptions, not installed guards', () => {
    for (const constraint of getDomainConstraints()) {
      if (constraint.id !== 'MAX_MUTATING_CALLS' && constraint.id !== 'PREFER_SURGICAL_REPLACE') {
        expect(constraint.policyStatus).toBe('advisory');
      }
    }
  });

  it('All 6 required constraints are present', () => {
    const required = [
      'ZERO_GREP',
      'NO_SESSION_COOKIE_PERSISTENCE',
      'MAX_MUTATING_CALLS',
      'NO_HALLUCINATED_DATA',
      'NO_SEND_TRIGGER',
      'PREFER_SURGICAL_REPLACE',
    ];
    const constraints = getDomainConstraints();
    const ids = constraints.map((c) => c.id);
    for (const req of required) {
      expect(ids).toContain(req);
    }
  });

  it('All constraints have non-empty sourceRule', () => {
    for (const c of getDomainConstraints()) {
      expect(c.sourceRule.length).toBeGreaterThan(0);
    }
  });

  it('All constraints have non-empty description', () => {
    for (const c of getDomainConstraints()) {
      expect(c.description.length).toBeGreaterThan(0);
    }
  });

  it('getConstraint returns undefined for unknown ID', () => {
    const result = getConstraint('THIS_DOES_NOT_EXIST');
    expect(result).toBeUndefined();
  });
});
