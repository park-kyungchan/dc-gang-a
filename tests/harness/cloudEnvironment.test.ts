import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cloudReadiness, installPinnedDependencies, runCloudChecks } from '../../harness/cloud';
import { safeProjectPath, validateCloudEnvironment, validateCloudStartSkill } from '../../harness/cloud_environment';
import { scanPublicationText } from '../../harness/tools/prepush_audit';
const root = resolve(import.meta.dir, '../..');
const source = JSON.parse(readFileSync(resolve(root, 'harness/cloud-environment.json'), 'utf8'));
function workflowMetadata(state: 'verified' | 'reported_verified' | 'not_started' = 'verified') {
  return {
    schemaVersion: 1, kind: 'user_owned_workflow_checkpoint', observedAtUtc: '2026-10-01T05:24:00Z',
    source: 'reviewed_owner_report', outcome: 'academy_read_to_teacher_reviewed_main_sheet',
    activeStep: { owner: 'lead', action: 'review_native_preservation_gaps' },
    milestones: [{ id: 'main_sheet_deployment', stage: 'user_outcome', state }],
    contextMetrics: { status: 'unavailable', usedTokens: null, maximumTokens: null },
    permissions: { grantsAccess: false, grantsProductionWrites: false, changesManagedRuntime: false },
  };
}
test('current Cloud readiness never promotes archival source evidence to live acceptance', () => {
  const r = cloudReadiness(root, '2026-10-01');
  expect(r.sourceCheckpoint.staleForAcademyReads).toBe(true);
  expect(r.academyAccess).toBe('not_configured');
  expect(r.browserUse).toBe('not_checked_for_source_only_workflow');
  expect(r.studentJoins).toBe('unknown');
  expect(r.productionWrites).toBe(0);
  expect(r.servicesToStart).toEqual([]);
});
test('startup preserves dated deployment reports without asserting a current Sheet state', () => {
  for (const state of ['verified', 'reported_verified', 'not_started'] as const) {
    const r = cloudReadiness(root, '2026-10-02', () => JSON.stringify(workflowMetadata(state)));
    expect(r.operatingSheet).toBe('unverified');
    expect(r.declaredDevelopmentScope).toBe('synthetic_and_source_integrity');
    expect(r.currentResourceAccessChecked).toBe(false);
    expect(r.workflowCheckpoint?.reportedDeploymentMilestone).toBe(state);
    expect(r.workflowCheckpoint?.observedAtUtc).toBe('2026-10-01T05:24:00Z');
    expect(r.workflowCheckpoint?.establishesCurrentResourceAccess).toBe(false);
    expect(r.workflowCheckpoint?.authorizesProductionEffects).toBe(false);
    expect(r.sourceCheckpoint.asOf).toBe('2026-09-29');
    expect(r.sourceCheckpoint.staleForAcademyReads).toBe(true);
  }
});
test('source-only checkouts work without optional workflow metadata and reject invalid supplied metadata', () => {
  const r = cloudReadiness(root, '2026-10-01', () => null);
  expect(r.workflowCheckpoint).toBeNull();
  expect(r.operatingSheet).toBe('unverified');
  const changed = { ...workflowMetadata(), credential: 'synthetic-private-content' };
  for (const text of ['{synthetic-private-content', JSON.stringify(changed)]) {
    expect(() => cloudReadiness(root, '2026-10-01', () => text))
      .toThrowError(new Error('invalid_cloud_workflow_checkpoint'));
  }
});
test('the aggregate executes all eight restored source-only test files through explicit suites', () => {
  const executed: string[] = [];
  runCloudChecks(args => { executed.push(args[1]!); });
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const requiredSuites = {
    'test:backend': ['tests/backend/googleReadAdapter.test.ts', 'tests/backend/pdfExtraction.test.ts', 'tests/backend/dependencyDoctor.test.ts'],
    'test:workflow': ['tests/harness/workflowCheckpoint.test.ts', 'tests/harness/contextRouting.test.ts', 'tests/harness/workspaceEntry.test.ts', 'tests/harness/hermesBackendProfile.test.ts', 'tests/lms/academyReadAcceptance.test.ts',
      'tests/lms/lessonJournalReviewBundle.test.ts', 'tests/sheets/deployedMainRefresh.test.ts', 'tests/sheets/nativePreservationPreview.test.ts'],
  };
  for (const [name, files] of Object.entries(requiredSuites)) {
    expect(executed).toContain(name);
    expect(pkg.scripts[name]!.split(' ').slice(3)).toEqual(files);
  }
  expect(executed).not.toContain('test:local-roster');
  expect(executed).not.toContain('test:python');
  expect(executed).toContain('test:storage');
  expect(pkg.scripts['test:storage']).toBe('bun test --dots tests/storage/syntheticLearningSqlite.test.ts');
});
test('a backend validation failure stops the aggregate before later workflow gates and success reporting', () => {
  const executed: string[] = [];
  expect(() => runCloudChecks(args => {
    executed.push(args[1]!);
    if (args[1] === 'test:backend') throw new Error('backend_validation_failed');
  })).toThrow('backend_validation_failed');
  expect(executed).not.toContain('test:workflow');
  expect(executed).not.toContain('verify:evidence');
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

test('cached package metadata cannot mask a missing native compiler', () => {
  const calls: Array<{ args: string[]; extraEnv?: Record<string,string> }> = [];
  const ready = [false, true];
  const repaired = installPinnedDependencies(root, (args, extraEnv) => calls.push({ args, extraEnv }), () => ready.shift()!);
  expect(repaired).toBe(true);
  expect(calls).toHaveLength(2);
  expect(calls[1]!.args).toContain('--frozen-lockfile');
  expect(calls[1]!.extraEnv?.BUN_INSTALL_CACHE_DIR).toBe(resolve(root, 'scratch/cloud-package-cache'));
});
test('dependency recovery stops after one fresh-cache retry', () => {
  let calls = 0;
  expect(() => installPinnedDependencies(root, () => { calls++; }, () => false)).toThrow('unavailable_after_one_fresh_cache_retry');
  expect(calls).toBe(2);
});

test('Cloud start skill has valid native YAML and rejects unintended metadata', () => {
  expect(() => validateCloudStartSkill(readFileSync(resolve(root, source.startSkill), 'utf8'))).not.toThrow();
  expect(() => validateCloudStartSkill('---\nname: codex-cloud-start\ndescription: x\nunexpected: true\n---\n')).toThrow();
});

test('rewritten Cloud prompts remain readable ASCII guidance without question-mark corruption', () => {
  for (const prompt of [source.setupPrompt, source.continuationPrompt]) {
    expect(prompt).toMatch(/^[\x20-\x7E]+$/);
    expect(prompt).not.toContain('?');
    for (const required of [
      'not recovered original wording', 'Bun 1.4.2', 'TypeScript 7.0.2',
      'bun run cloud:install', 'bun run cloud:start', 'bun run cloud:check',
      'source archives', 'synthetic fixtures', 'real student records', 'credentials',
      'Google Sheets access', 'permission changes', 'Publish/Republish', 'iPhone work is paused',
    ]) expect(prompt).toContain(required);
  }
});
