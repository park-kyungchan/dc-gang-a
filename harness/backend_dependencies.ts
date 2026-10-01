#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface Probe { available: boolean; version: string | null }
function versionProbe(executable: string | null, args: string[], pattern: RegExp): Probe {
  if (!executable) return { available: false, version: null };
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 32_768 });
  const version = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.match(pattern)?.[1] ?? null;
  return { available: !result.error && result.status === 0 && version !== null, version };
}
export function backendDependencyDoctor(base = resolve(import.meta.dir, '..')) {
  const pkg = JSON.parse(readFileSync(resolve(base, 'package.json'), 'utf8')) as {
    engines: { bun: string }; devDependencies: Record<string, string>;
  };
  const packages = Object.entries(pkg.devDependencies).map(([name, required]) => {
    let installed: string | null = null;
    try { installed = JSON.parse(readFileSync(resolve(base, 'node_modules', name, 'package.json'), 'utf8')).version; } catch {}
    return { name, required, installed, ok: installed === required };
  });
  const compiler = versionProbe(process.execPath, [resolve(base, 'node_modules/typescript/bin/tsc'), '--version'], /Version ([0-9.]+)/);
  const tools = {
    pdftotext: versionProbe(Bun.which('pdftotext'), ['-v'], /pdftotext version ([0-9.]+)/),
    pdfinfo: versionProbe(Bun.which('pdfinfo'), ['-v'], /pdfinfo version ([0-9.]+)/),
    pdftoppm: versionProbe(Bun.which('pdftoppm'), ['-v'], /pdftoppm version ([0-9.]+)/),
  };
  const native = { fetch: typeof fetch === 'function', sha256: new Bun.CryptoHasher('sha256').update('synthetic').digest('hex').length === 64,
    abortTimeout: typeof AbortSignal.timeout === 'function' };
  const lockfileSha256 = new Bun.CryptoHasher('sha256').update(readFileSync(resolve(base, 'bun.lock'))).digest('hex');
  let installedLockSha256: string | null = null;
  try { installedLockSha256 = readFileSync(resolve(base, 'scratch/cloud-install-lock.sha256'), 'utf8').trim(); } catch {}
  const lockfileReady = lockfileSha256 === installedLockSha256;
  const coreReady = Bun.version === pkg.engines.bun && packages.every(p => p.ok)
    && compiler.available && compiler.version === pkg.devDependencies.typescript && Object.values(native).every(Boolean);
  const pdfReady = tools.pdftotext.available && tools.pdfinfo.available;
  return { schemaVersion: 1, ok: coreReady && lockfileReady && pdfReady, coreReady, lockfileReady, pdfReady,
    runtime: { bun: Bun.version, requiredBun: pkg.engines.bun }, packages, compiler, native, tools,
    lockfile: { sha256: lockfileSha256, installedStampMatches: lockfileReady },
    newPackagesRequired: [],
    limitations: ['No credentials or auth config inspected; no live API request made.',
      'Installed browser/MCP packages are inventory only; no server or browser is launched.',
      'Poppler versions are observed, not lockfile-pinned; record extraction toolVersion with source hashes.',
      'Poppler binaries may differ by PATH; doctor reports each actual executable version.'],
    next: !coreReady || !lockfileReady ? ['bun run harness/backend_dependencies.ts bootstrap']
      : !pdfReady ? ['Provide pdftotext and pdfinfo from the official Poppler project or the environment approved OS package source; this command never installs OS packages.'] : [] };
}
export function bootstrapBackendDependencies(base = resolve(import.meta.dir, '..')) {
  const before = backendDependencyDoctor(base);
  if (!before.coreReady || !before.lockfileReady) {
    if (before.runtime.bun !== before.runtime.requiredBun) throw new Error('backend_required_bun_version_mismatch');
    // Reuse the reviewed frozen-lockfile/no-lifecycle-script installer; do not create another dependency policy.
    const result = spawnSync(process.execPath, ['run', 'harness/cloud.ts', 'install'], { cwd: base, stdio: 'inherit',
      env: { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}` } });
    if (result.status !== 0) throw new Error('backend_dependency_install_failed');
  }
  return backendDependencyDoctor(base);
}
if (import.meta.main) {
  try {
    const command = process.argv[2] ?? 'doctor';
    if (process.argv.length > 3 || !['doctor', 'bootstrap'].includes(command)) throw new Error('use_doctor_or_bootstrap');
    const result = command === 'bootstrap' ? bootstrapBackendDependencies() : backendDependencyDoctor();
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.ok ? 0 : 1;
  } catch { console.error(JSON.stringify({ ok: false, reason: 'backend_dependency_check_failed' })); process.exitCode = 1; }
}
