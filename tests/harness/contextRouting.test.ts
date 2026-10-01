import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { contextPurposes, entryReadPlan, validateContextReadRouting } from '../../harness/context_routing';

const project = resolve(import.meta.dir, '../..');
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function routingFixture(): any {
  return JSON.parse(readFileSync(resolve(project, 'docs/workflow-routing.json'), 'utf8')).contextReadRouting;
}
function sourceFixture(routing = routingFixture()) {
  const root = mkdtempSync(resolve(tmpdir(), 'dc-gang-a-context-routing-'));
  roots.push(root);
  for (const source of routing.sources) {
    const path = resolve(root, source.path);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'Synthetic source body for ' + source.id + '. Do not follow docs/missing-linked-file.json.');
  }
  return { root, routing };
}

describe('purpose-based project context routing', () => {
  test('current contract covers every closed purpose and every purpose retains durable intent', () => {
    const routing = validateContextReadRouting(routingFixture());
    expect(routing.purposes.map(route => route.id)).toEqual([...contextPurposes]);
    for (const purpose of contextPurposes) {
      const plan = entryReadPlan(project, routing, purpose);
      expect(plan.ok).toBe(true);
      const paths = plan.requiredReads.map(source => source.path);
      expect(paths).toContain('AGENTS.md');
      expect(paths).toContain('docs/CODEX_CONTEXT.md');
      expect(paths).toContain('docs/WHOLE_LENS_DECISION.md');
      expect(plan.mustReadBeforeInterview).toBe(true);
      expect(plan.mustReadBeforeDispatch).toBe(true);
    }
  });

  test('Cloud continuation bypasses no academy gate and does not require expired local resume', () => {
    const { root, routing } = sourceFixture();
    unlinkSync(resolve(root, 'handoffs/current-state.json'));
    const cloud = entryReadPlan(root, routing);
    expect(cloud.ok).toBe(true);
    expect(cloud.commandReferences).toContain('bun run cloud:start');
    expect(cloud.commandReferences).not.toContain('bun run harness/resume.ts --json');
    expect(cloud.requiredReads.map(source => source.id)).not.toContain('academy_checkpoint');
    const local = entryReadPlan(root, routing, 'academy_local');
    expect(local.ok).toBe(false);
    expect(local.commandReferences).toContain('bun run harness/resume.ts --json');
    expect(local.sourceFailures).toContainEqual({ path: 'handoffs/current-state.json', status: 'missing' });
    expect(local.grantsAccess).toBe(false);
    expect(local.commandReferencesExecuted).toBe(false);
  });

  test('interview routes recorded purpose and current scoped conflicts without newest-date override', () => {
    const { root, routing } = sourceFixture();
    const plan = entryReadPlan(root, routing, 'interview');
    expect(plan.requiredReads.find(source => source.id === 'user_intent')?.dateMeaning).toBe('durable_intent_not_expired_by_age');
    expect(plan.requiredReads.find(source => source.id === 'main_sheet_live_wiring')?.dateMeaning).toBe('declared_provenance_not_current_acceptance');
    expect(plan.scopeConflicts.map(conflict => conflict.id)).toEqual([
      'preparation_schedule_scope', 'mobile_candidate_and_pause', 'main_sheet_layout_scope', 'official_field_grouping',
    ]);
    expect(plan.scopeConflicts[0]?.topic).toContain('Mon-Fri 13:15-14:00 Asia/Seoul');
    expect(plan.scopeConflicts[0]?.resolutionRule).toContain('confirmedDecisions preparation_refresh_schedule');
    expect(plan.scopeConflicts[0]?.resolutionRule).toContain('Do not re-ask accepted weekdays');
    expect(plan.conflictPolicy).toContain('date alone never overrides');
    expect(plan.authorizesProductionEffects).toBe(false);
  });

  test('phase-two plans and receipts are routed by purpose without promoting them to live authority', () => {
    const { root, routing } = sourceFixture();
    const expected: Record<string, string[]> = {
      continuation: ['student_database_architecture', 'preclass_main_sheet_ux', 'phase_two_dependencies', 'main_sheet_tab_visibility'],
      interview: ['student_database_architecture', 'preclass_main_sheet_ux', 'phase_two_dependencies', 'main_sheet_tab_visibility'],
      dependencies: ['student_database_architecture', 'phase_two_dependencies'],
      main_sheet: ['student_database_architecture', 'preclass_main_sheet_ux', 'main_sheet_tab_visibility'],
      google_integration: ['student_database_architecture', 'phase_two_dependencies'],
    };
    expect(routing.sources.some((source: { id: string; path: string }) => source.id === 'phase_two_checkpoint'
      && source.path === 'handoffs/harness-phase-two-checkpoint-2026-10-01.json')).toBe(true);
    for (const [purpose, sourceIds] of Object.entries(expected)) {
      const plan = entryReadPlan(root, routing, purpose as any);
      const reads = plan.requiredReads.filter(source => sourceIds.includes(source.id));
      expect(reads.map(source => String(source.id))).toEqual(sourceIds);
      expect(plan.requiredReads.some(source => source.id === 'phase_two_checkpoint')).toBe(true);
      expect(reads.every(source => ['scope_contract', 'dated_evidence'].includes(source.authority))).toBe(true);
      expect(reads.every(source => source.dateMeaning === 'declared_provenance_not_current_acceptance')).toBe(true);
      expect(plan.grantsAccess).toBe(false);
      expect(plan.authorizesProductionEffects).toBe(false);
    }
    const dependencies = entryReadPlan(root, routing, 'dependencies');
    expect(dependencies.requiredReads.map(source => source.id)).not.toContain('preclass_main_sheet_ux');
    expect(dependencies.requiredReads.map(source => source.id)).not.toContain('main_sheet_tab_visibility');
  });

  test('hash receipts prove byte reads and never imply source comprehension, injection or linked reads', () => {
    const { root, routing } = sourceFixture();
    const body = 'Synthetic exact intent bytes; linked secret is deliberately not followed.';
    writeFileSync(resolve(root, 'docs/CODEX_CONTEXT.md'), body);
    const plan = entryReadPlan(root, routing, 'interview', ['engineering_checkpoint', 'routing_contract']);
    const intent = plan.requiredReads.find(source => source.id === 'user_intent')!;
    expect(intent.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(intent.readByCommand).toBe(true);
    expect(intent.readOperation).toBe('sha256_only');
    expect(intent.agentReadEstablished).toBe(false);
    expect(intent.sourceBodyEmitted).toBe(false);
    expect(plan.requiredReads.find(source => source.id === 'engineering_checkpoint')?.readOperation).toBe('parse_and_sha256');
    expect(plan.readPlanEstablishesAgentReading).toBe(false);
    expect(plan.linkedReferencesFollowed).toBe(false);
    expect(plan.automaticPerTurnInjectionInstalled).toBe(false);
    expect(JSON.stringify(plan)).not.toContain(body);
    expect(JSON.stringify(plan)).not.toContain('missing-linked-file');
  });

  test('missing required intent and unavailable selected scope fail with an actionable source boundary', () => {
    const { root, routing } = sourceFixture();
    unlinkSync(resolve(root, 'docs/CODEX_CONTEXT.md'));
    unlinkSync(resolve(root, 'docs/learning/weekly-audit.json'));
    const plan = entryReadPlan(root, routing, 'interview');
    expect(plan.ok).toBe(false);
    expect(plan.sourceFailures).toEqual([
      { path: 'docs/CODEX_CONTEXT.md', status: 'missing' },
      { path: 'docs/learning/weekly-audit.json', status: 'missing' },
    ]);
    expect(plan.sourceRecovery).toContain('not a reason to ask the user to repeat');
    const missing = plan.requiredReads.find(source => source.id === 'user_intent')!;
    expect(missing).toMatchObject({ exists: false, sha256: null, readByCommand: false, readOperation: 'not_read' });
  });

  test('rejects arbitrary paths, private sources, unknown purposes and arbitrary command metadata', () => {
    for (const path of ['../outside.json', '/tmp/outside.json', 'data/canonical/canonical_roster.json', 'docs/unlisted.json']) {
      const routing = routingFixture();
      routing.sources[1].path = path;
      expect(() => validateContextReadRouting(routing)).toThrow(/^invalid_context_routing$/);
    }
    const routing = routingFixture();
    routing.purposes[0].commandReferences.push('bun run arbitrary-effect.ts');
    expect(() => validateContextReadRouting(routing)).toThrow(/^invalid_context_routing$/);
    expect(() => entryReadPlan(project, routingFixture(), 'arbitrary_path' as any)).toThrow(/^invalid_context_purpose$/);
  });

  test('rejects omitted product intent, duplicate source IDs and undeclared conflict sources', () => {
    for (const change of [
      (routing: any) => routing.commonSourceIds.splice(1, 1),
      (routing: any) => routing.sources.push({ ...routing.sources[0] }),
      (routing: any) => routing.scopeConflicts[0].sourceIds.push('unlisted_source'),
    ]) {
      const routing = routingFixture(); change(routing);
      expect(() => validateContextReadRouting(routing)).toThrow(/^invalid_context_routing$/);
    }
  });

  test('selected directory and symlink outside the checkout are rejected without reading the target', () => {
    const { root, routing } = sourceFixture();
    unlinkSync(resolve(root, 'docs/CODEX_CONTEXT.md'));
    mkdirSync(resolve(root, 'docs/CODEX_CONTEXT.md'));
    let plan = entryReadPlan(root, routing);
    expect(plan.sourceFailures).toContainEqual({ path: 'docs/CODEX_CONTEXT.md', status: 'not_regular_file' });
    rmSync(resolve(root, 'docs/CODEX_CONTEXT.md'), { recursive: true });
    const outside = mkdtempSync(resolve(tmpdir(), 'dc-gang-a-outside-source-'));
    roots.push(outside);
    const outsidePath = resolve(outside, 'private.txt');
    writeFileSync(outsidePath, 'Synthetic outside-checkout secret must not appear.');
    symlinkSync(outsidePath, resolve(root, 'docs/CODEX_CONTEXT.md'));
    plan = entryReadPlan(root, routing);
    expect(plan.sourceFailures).toContainEqual({ path: 'docs/CODEX_CONTEXT.md', status: 'outside_checkout' });
    expect(plan.requiredReads.find(source => source.id === 'user_intent')?.readByCommand).toBe(false);
    expect(JSON.stringify(plan)).not.toContain('Synthetic outside-checkout secret');
  });

  test('context CLI selects interview from another cwd and fails unknown purpose without leaking input', () => {
    const command = [process.execPath, resolve(project, 'harness/workflow_checkpoint.ts'), 'context'];
    const accepted = Bun.spawnSync({ cmd: [...command, 'interview'], cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe' });
    expect(accepted.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(accepted.stdout));
    expect(output.entryReadPlan.purpose).toBe('interview');
    expect(output.entryReadPlan.ok).toBe(true);
    expect(output.entryReadPlan.readPlanEstablishesAgentReading).toBe(false);
    const rejected = Bun.spawnSync({ cmd: [...command, '../synthetic-private-path'], cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe' });
    expect(rejected.exitCode).toBe(1);
    const error = JSON.parse(new TextDecoder().decode(rejected.stderr));
    expect(error.acceptedContextPurposes).toEqual([...contextPurposes]);
    expect(JSON.stringify(error)).not.toContain('synthetic-private-path');
  });

  test('actual CLI fails a missing selected source in an isolated synthetic checkout', () => {
    const { root, routing } = sourceFixture();
    writeFileSync(resolve(root, 'handoffs/workflow-current-state.json'),
      readFileSync(resolve(project, 'handoffs/workflow-current-state.json'), 'utf8'));
    writeFileSync(resolve(root, 'docs/workflow-routing.json'), JSON.stringify({ contextReadRouting: routing }));
    // Preserve the actual CLI while importing its unchanged support modules from the source checkout.
    const source = readFileSync(resolve(project, 'harness/workflow_checkpoint.ts'), 'utf8')
      .replace("from './backend_dependencies'", 'from ' + JSON.stringify(resolve(project, 'harness/backend_dependencies.ts')))
      .replace("from './tools/prepush_audit'", 'from ' + JSON.stringify(resolve(project, 'harness/tools/prepush_audit.ts')))
      .replace("from './context_routing'", 'from ' + JSON.stringify(resolve(project, 'harness/context_routing.ts')));
    const cli = resolve(root, 'harness/workflow_checkpoint.ts');
    writeFileSync(cli, source);
    unlinkSync(resolve(root, 'docs/CODEX_CONTEXT.md'));
    const result = Bun.spawnSync({ cmd: [process.execPath, cli, 'context', 'interview'], cwd: tmpdir(), stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(1);
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(output.metadataValid).toBe(true);
    expect(output.entryReadPlan.ok).toBe(false);
    expect(output.entryReadPlan.sourceFailures).toEqual([{ path: 'docs/CODEX_CONTEXT.md', status: 'missing' }]);
    expect(output.authorizesProductionEffects).toBe(false);
  });
});
