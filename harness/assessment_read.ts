#!/usr/bin/env bun
/** Offline preparation only. Native browser/vault remains the authenticated executor. */
import { dirname, extname, resolve } from 'node:path';
import { open, realpath } from 'node:fs/promises';
import { prepareAssessmentRead } from '../src/lms/assessmentReadProtocol';

export function parseAssessmentReadArguments(args: string[], profileHome: string | undefined) {
  if (!profileHome) throw new Error('active_profile_required');
  const captures: string[] = [];
  const seen = new Set<string>();
  let teacherLabel = '';
  let output = '';
  let admission = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]!;
    if (flag !== '--har' && seen.has(flag)) throw new Error('duplicate_flag');
    seen.add(flag);
    if (flag === '--admit-score-view') { admission = true; continue; }
    if (!['--har', '--teacher', '--output'].includes(flag)) throw new Error('unsupported_flag');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('missing_flag_value');
    if (flag === '--har') {
      if (extname(value) !== '.har') throw new Error('har_file_required');
      captures.push(value);
    }
    if (flag === '--teacher') teacherLabel = value;
    if (flag === '--output') output = value;
  }
  if (!admission) throw new Error('score_view_admission_required');
  if (captures.length === 0 || captures.length > 2 || !teacherLabel.trim()) throw new Error('invalid_preparation_scope');
  if (extname(output) !== '.js' || resolve(dirname(output)) !== resolve(profileHome, 'cache/scratch')) {
    throw new Error('profile_scratch_destination_required');
  }
  return { captures, teacherLabel, output: resolve(output), admission };
}

if (import.meta.main) {
  try {
    const options = parseAssessmentReadArguments(process.argv.slice(2), process.env.HERMES_HOME);
    const root = await realpath(resolve(process.env.HERMES_HOME!, 'cache/scratch'));
    if (await realpath(dirname(options.output)) !== root) throw new Error('profile_scratch_destination_required');
    const captures: unknown[] = [];
    for (const path of options.captures) {
      const file = Bun.file(path);
      if (file.size > 50_000_000) throw new Error('capture_too_large');
      captures.push(await file.json());
    }
    const prepared = prepareAssessmentRead(captures, options.teacherLabel, options.admission);
    // Exclusive creation refuses existing files/symlinks; private identity never enters stdout or Git.
    const handle = await open(options.output, 'wx', 0o600);
    try { await handle.writeFile(prepared.expression); }
    finally { await handle.close(); }
    process.stdout.write(JSON.stringify({ ok: true, ...prepared.summary, preparedPrivateBrowserScript: true,
      credentialsExported: false, authenticationMode: 'native_browser_vault_required' }) + '\n');
  } catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'assessment_preparation_failed';
    process.stderr.write(JSON.stringify({ ok: false, code }) + '\n');
    process.exitCode = 1;
  }
}
