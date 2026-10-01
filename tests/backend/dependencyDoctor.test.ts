import { expect, test } from 'bun:test';
import { backendDependencyDoctor } from '../../harness/backend_dependencies';
test('dependency doctor verifies executable compiler and native primitives without auth or live reads', () => {
  const result = backendDependencyDoctor();
  expect(result.schemaVersion).toBe(1);
  expect(result.coreReady).toBe(true);
  expect(result.runtime.bun).toBe(result.runtime.requiredBun);
  expect(result.compiler.version).toBe('7.0.2');
  expect(result.newPackagesRequired).toEqual([]);
  expect(result.native).toEqual({ fetch: true, sha256: true, abortTimeout: true });
  expect(result.limitations.join(' ')).toContain('No credentials or auth config inspected');
});
