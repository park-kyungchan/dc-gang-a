import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudReadiness } from '../../harness/cloud';
import { safeProjectPath, validateCloudEnvironment } from '../../harness/cloud_environment';
import { scanPublicationText } from '../../harness/tools/prepush_audit';
const root = resolve(import.meta.dir, '../..');
const source = JSON.parse(readFileSync(resolve(root, 'harness/cloud-environment.json'), 'utf8'));
test('current Cloud readiness never promotes archival source evidence to live acceptance', () => {
  const r = cloudReadiness(root, '2026-10-01');
  expect(r.sourceCheckpoint.staleForAcademyReads).toBe(true);
  expect(r.academyAccess).toBe('not_configured');
  expect(r.browserUse).toBe('unsupported_in_current_cloud');
  expect(r.studentJoins).toBe('unknown');
  expect(r.productionWrites).toBe(0);
  expect(r.servicesToStart).toEqual([]);
});
test('rejects legacy Cloud, runtime drift, academy destinations and requested secrets', () => {
  for (const change of [
    { experience: 'legacy' }, { runtime: { ...source.runtime, bun: 'latest' } },
    { requiredSecrets: ['LMS_SESSION'] },
    { network: { ...source.network, additionalDomains: ['dc.gang-a.kr'] } },
  ]) expect(() => validateCloudEnvironment({ ...source, ...change })).toThrow();
});
test('rejects paths and unofficial documentation escaping the reviewed scope', () => {
  expect(() => safeProjectPath(root, '../outside.json')).toThrow();
  expect(() => safeProjectPath(root, 'C:\\outside.json')).toThrow();
  expect(() => validateCloudEnvironment({ ...source, documentation: [{ url: 'https://example.com/docs', finding: 'x' }] })).toThrow();
});
test('publication scan refuses protected files and credential-shaped literals without emitting values', () => {
  expect(scanPublicationText('data/canonical/example.json', '{}')).toEqual(['protected_path']);
  const secret = 'ghp_' + 'x'.repeat(25);
  expect(scanPublicationText('src/example.ts', secret)).toEqual(['github_token']);
  expect(scanPublicationText('src/example.ts', 'JSESSIONID=' + 'a'.repeat(32))).toEqual(['literal_session']);
  expect(scanPublicationText('src/example.ts', 'const score = null;')).toEqual([]);
});
