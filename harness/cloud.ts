#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { safeProjectPath, validateCloudEnvironment, validateCloudStartSkill } from './cloud_environment';
import { validateCurrentState } from './resume';
import { validateWorkflowCheckpoint } from './workflow_checkpoint';
const root = resolve(import.meta.dir, '..');
const stamp = (base: string) => resolve(base, 'scratch/cloud-install-lock.sha256');
const lockHash = (base: string) => createHash('sha256').update(readFileSync(resolve(base, 'bun.lock'))).digest('hex');
const config = () => validateCloudEnvironment(JSON.parse(readFileSync(resolve(root, 'harness/cloud-environment.json'), 'utf8')));
type WorkflowTextReader = (path: string) => string | null;
function readOptionalWorkflowText(path: string): string | null {
  try { return readFileSync(path, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('cloud_workflow_checkpoint_unreadable');
  }
}
export function cloudReadiness(base = root, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
  readWorkflowText: WorkflowTextReader = readOptionalWorkflowText) {
  const c = validateCloudEnvironment(JSON.parse(readFileSync(resolve(base, 'harness/cloud-environment.json'), 'utf8')));
  for (const ref of [c.sourceCheckpoint, c.startSkill, 'review/codex-cloud-readiness-2026-09-30.json']) {
    if (!existsSync(safeProjectPath(base, ref))) throw new Error('missing_cloud_reference');
  }
  validateCloudStartSkill(readFileSync(safeProjectPath(base, c.startSkill), 'utf8'));
  const raw = JSON.parse(readFileSync(safeProjectPath(base, c.sourceCheckpoint), 'utf8')) as { asOf: string };
  // Archival integrity only: never renew dated academy-read authority.
  const state = validateCurrentState(raw, base, undefined, raw.asOf);
  const workflowPath = 'handoffs/workflow-current-state.json';
  const workflowText = readWorkflowText(safeProjectPath(base, workflowPath));
  let workflowCheckpoint = null;
  if (workflowText !== null) {
    try {
      const workflow = validateWorkflowCheckpoint(JSON.parse(workflowText));
      workflowCheckpoint = {
        path: workflowPath, observedAtUtc: workflow.observedAtUtc, source: workflow.source,
        reportedDeploymentMilestone: workflow.milestones.find(m => m.id === 'main_sheet_deployment')?.state ?? 'unknown',
        validation: 'dated_metadata_only_not_current_resource_verification',
        establishesCurrentResourceAccess: false, authorizesProductionEffects: false,
      };
    } catch { throw new Error('invalid_cloud_workflow_checkpoint'); }
  }
  return {
    ok: true, workflow: 'synthetic_development', experience: c.experience,
    declaredDevelopmentScope: 'synthetic_and_source_integrity', currentResourceAccessChecked: false,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, cpuCount: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3) },
    sourceCheckpoint: { path: c.sourceCheckpoint, asOf: state.asOf, latestEvidence: state.latestCompletedEvidence.path,
      staleForAcademyReads: today > c.checkpointValidThrough, validation: 'archival_source_integrity_only' },
    academyAccess: 'not_configured', browserUse: 'not_checked_for_source_only_workflow', operatingSheet: 'unverified',
    workflowCheckpoint,
    studentJoins: 'unknown', productionWrites: 0, servicesToStart: c.services,
    dependencyRefresh: existsSync(stamp(base)) && readFileSync(stamp(base), 'utf8').trim() === lockHash(base)
      ? 'lockfile_unchanged' : 'run_bun_run_cloud_install',
    next: ['bun run cloud:check', 'Read handoffs/cloud-current-state.json'],
  };
}
export type InstallRunner = (args: string[], extraEnv?: Record<string,string>) => void;
export const cloudCheckScripts = [
  'typecheck', 'typecheck:harness', 'typecheck:agent-runtime', 'test:bun', 'test:synthetic', 'test:agent-runtime',
  'test:endpoint-catalog', 'test:learning', 'test:learning-projection', 'test:backend', 'test:workflow', 'test:model-config', 'verify:evidence',
] as const;
export function runCloudChecks(runCheck: InstallRunner): void {
  for (const script of cloudCheckScripts) runCheck(['run', script]);
}
export function installPinnedDependencies(base: string, run: InstallRunner, compilerReady: () => boolean): boolean {
  run(['install','--frozen-lockfile','--ignore-scripts']);
  if (compilerReady()) return false;
  run(['install','--frozen-lockfile','--ignore-scripts','--force','--backend','copyfile'],
    { BUN_INSTALL_CACHE_DIR: resolve(base, 'scratch/cloud-package-cache') });
  if (!compilerReady()) throw new Error('native_typescript_compiler_unavailable_after_one_fresh_cache_retry');
  return true;
}
function run(args: string[], extraEnv: Record<string,string> = {}): void {
  const p = Bun.spawnSync({ cmd: [process.execPath, ...args], cwd: root,
    env: { ...process.env, ...extraEnv, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error('cloud_command_failed:' + args.join(' '));
}
async function main() {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !['install','start','check','info'].includes(action ?? '')) throw new Error('use_install_start_check_info');
  const c = config();
  if (Bun.version !== c.runtime.bun) throw new Error('required_bun_version_' + c.runtime.bun);
  if (action === 'info') { console.log(JSON.stringify(c, null, 2)); return; }
  if (action === 'install') {
    const freshCacheRetryUsed = installPinnedDependencies(root, run, () =>
      Bun.spawnSync({ cmd: [process.execPath, 'node_modules/typescript/bin/tsc', '--version'], cwd: root, stdout: 'pipe', stderr: 'pipe' }).exitCode === 0);
    await Bun.write(stamp(root), lockHash(root) + '\n');
    console.log(JSON.stringify({ ok: true, action, bun: Bun.version, browserDownloaded: false, pythonInstalled: false, freshCacheRetryUsed }));
    return;
  }
  console.log(JSON.stringify(cloudReadiness(), null, 2));
  if (action === 'check') {
    runCloudChecks(run);
    console.log(JSON.stringify({ ok: true, scope: 'synthetic_and_source_integrity', academyReads: 0, productionWrites: 0 }));
  }
}
if (import.meta.main) {
  try { await main(); } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: e instanceof Error ? e.message : 'cloud_setup_failed' })); process.exitCode = 1;
  }
}
