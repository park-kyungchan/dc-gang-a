#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { resolve } from 'node:path';
import { safeProjectPath, validateCloudEnvironment } from './cloud_environment';
import { validateCurrentState } from './resume';
const root = resolve(import.meta.dir, '..');
const stamp = (base: string) => resolve(base, 'scratch/cloud-install-lock.sha256');
const lockHash = (base: string) => createHash('sha256').update(readFileSync(resolve(base, 'bun.lock'))).digest('hex');
const config = () => validateCloudEnvironment(JSON.parse(readFileSync(resolve(root, 'harness/cloud-environment.json'), 'utf8')));
export function cloudReadiness(base = root, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })) {
  const c = validateCloudEnvironment(JSON.parse(readFileSync(resolve(base, 'harness/cloud-environment.json'), 'utf8')));
  for (const ref of [c.sourceCheckpoint, c.startSkill, 'review/codex-cloud-readiness-2026-09-30.json']) {
    if (!existsSync(safeProjectPath(base, ref))) throw new Error('missing_cloud_reference');
  }
  const raw = JSON.parse(readFileSync(safeProjectPath(base, c.sourceCheckpoint), 'utf8')) as { asOf: string };
  // Archival integrity only: never renew dated academy-read authority.
  const state = validateCurrentState(raw, base, undefined, raw.asOf);
  return {
    ok: true, workflow: 'synthetic_development', experience: c.experience,
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch, cpuCount: cpus().length, memoryGiB: Math.round(totalmem() / 1024 ** 3) },
    sourceCheckpoint: { path: c.sourceCheckpoint, asOf: state.asOf, latestEvidence: state.latestCompletedEvidence.path,
      staleForAcademyReads: today > c.checkpointValidThrough, validation: 'archival_source_integrity_only' },
    academyAccess: 'not_configured', browserUse: 'unsupported_in_current_cloud', operatingSheet: 'not_deployed',
    studentJoins: 'unknown', productionWrites: 0, servicesToStart: c.services,
    dependencyRefresh: existsSync(stamp(base)) && readFileSync(stamp(base), 'utf8').trim() === lockHash(base)
      ? 'lockfile_unchanged' : 'run_bun_run_cloud_install',
    next: ['bun run cloud:check', 'Read handoffs/cloud-current-state.json'],
  };
}
function run(args: string[]): void {
  const p = Bun.spawnSync({ cmd: [process.execPath, ...args], cwd: root,
    env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, stdout: 'inherit', stderr: 'inherit' });
  if (p.exitCode !== 0) throw new Error('cloud_command_failed:' + args.join(' '));
}
async function main() {
  const action = process.argv[2];
  if (process.argv.length !== 3 || !['install','start','check','info'].includes(action ?? '')) throw new Error('use_install_start_check_info');
  const c = config();
  if (Bun.version !== c.runtime.bun) throw new Error('required_bun_version_' + c.runtime.bun);
  if (action === 'info') { console.log(JSON.stringify(c, null, 2)); return; }
  if (action === 'install') {
    run(['install','--frozen-lockfile','--ignore-scripts']);
    await Bun.write(stamp(root), lockHash(root) + '\n');
    console.log(JSON.stringify({ ok: true, action, bun: Bun.version, browserDownloaded: false, pythonInstalled: false }));
    return;
  }
  console.log(JSON.stringify(cloudReadiness(), null, 2));
  if (action === 'check') {
    for (const script of ['typecheck','typecheck:harness','typecheck:agent-runtime','test:bun','test:synthetic','test:agent-runtime','verify:evidence']) run(['run',script]);
    console.log(JSON.stringify({ ok: true, scope: 'synthetic_and_source_integrity', academyReads: 0, productionWrites: 0 }));
  }
}
if (import.meta.main) {
  try { await main(); } catch (e) {
    console.error(JSON.stringify({ ok: false, reason: e instanceof Error ? e.message : 'cloud_setup_failed' })); process.exitCode = 1;
  }
}
