#!/usr/bin/env bun
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = resolve(import.meta.dir, '..');
const managedKeys = ['model_context_window', 'model_auto_compact_token_limit'] as const;
type ManagedKey = typeof managedKeys[number];
type ParsedConfig = Record<string, unknown>;
export type ModelConfigAction = '--check' | '--apply';
export interface CodexModelPolicy {
  schemaVersion: 1;
  scope: 'repository';
  configPath: '.codex/config.toml';
  modelContextWindow: number;
  autoCompactRatio: number;
  modelAutoCompactTokenLimit: number;
  activation: 'new_session_subject_to_managed_overrides';
  effectiveRuntime: 'unverified';
  schemaSource: string;
}
export class CodexModelConfigError extends Error {}
function reject(reason: string): never { throw new CodexModelConfigError(reason); }

export function validateCodexModelPolicy(raw: unknown): CodexModelPolicy {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) reject('invalid_model_policy');
  const p = raw as Record<string, unknown>;
  const keys = ['schemaVersion', 'scope', 'configPath', 'modelContextWindow', 'autoCompactRatio',
    'modelAutoCompactTokenLimit', 'activation', 'effectiveRuntime', 'schemaSource'];
  if (Object.keys(p).length !== keys.length || keys.some(key => !Object.hasOwn(p, key))
    || p.schemaVersion !== 1 || p.scope !== 'repository' || p.configPath !== '.codex/config.toml'
    || !Number.isSafeInteger(p.modelContextWindow) || (p.modelContextWindow as number) <= 0
    || typeof p.autoCompactRatio !== 'number' || p.autoCompactRatio <= 0 || p.autoCompactRatio > 1
    || !Number.isSafeInteger(p.modelAutoCompactTokenLimit)
    || p.modelAutoCompactTokenLimit !== Math.floor((p.modelContextWindow as number) * p.autoCompactRatio)
    || (p.modelAutoCompactTokenLimit as number) <= 0
    || p.activation !== 'new_session_subject_to_managed_overrides' || p.effectiveRuntime !== 'unverified'
    || p.schemaSource !== 'https://raw.githubusercontent.com/openai/codex/main/codex-rs/core/config.schema.json') {
    reject('invalid_model_policy');
  }
  return p as unknown as CodexModelPolicy;
}

export function loadCodexModelPolicy(base = repositoryRoot): CodexModelPolicy {
  try {
    return validateCodexModelPolicy(JSON.parse(readFileSync(resolve(base, 'harness/codex-model-policy.json'), 'utf8')));
  } catch { return reject('invalid_model_policy'); }
}

function parseConfig(current: string): ParsedConfig {
  try { return Bun.TOML.parse(current) as ParsedConfig; }
  catch { return reject('invalid_toml'); }
}

type RootAssignment = { key: ManagedKey; line: number; prefix: string; suffix: string };
// Parse the whole document first. This scanner only locates root integer tokens;
// it never serializes unrelated settings or confuses multiline values with keys.
function rootAssignments(lines: string[]): RootAssignment[] {
  const assignments: RootAssignment[] = [];
  let quote: 'basic' | 'literal' | 'multi_basic' | 'multi_literal' | null = null;
  let depth = 0;
  const assignment = /^([ \t]*(model_context_window|model_auto_compact_token_limit|"model_context_window"|"model_auto_compact_token_limit"|'model_context_window'|'model_auto_compact_token_limit')[ \t]*=[ \t]*)([+-]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|\d[\d_]*))([ \t]*(?:#.*)?)$/;
  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber]!.replace(/\r$/, '');
    if (quote === null && depth === 0) {
      if (/^[ \t]*\[/.test(line)) break;
      const match = assignment.exec(line);
      if (match) assignments.push({ key: match[2]!.replace(/["']/g, '') as ManagedKey,
        line: lineNumber, prefix: match[1]!, suffix: match[4]! });
    }
    for (let i = 0; i < line.length; i++) {
      const char = line[i]!;
      if (quote === 'basic' || quote === 'multi_basic') {
        if (char === '\\') { i++; continue; }
        if (quote === 'basic' && char === '"') { quote = null; continue; }
        if (quote === 'multi_basic' && line.startsWith('"""', i)) {
          while (line[i + 1] === '"') i++;
          quote = null;
        }
      } else if (quote === 'literal' || quote === 'multi_literal') {
        if (quote === 'literal' && char === "'") { quote = null; continue; }
        if (quote === 'multi_literal' && line.startsWith("'''", i)) {
          while (line[i + 1] === "'") i++;
          quote = null;
        }
      } else {
        if (char === '#') break;
        if (char === '"' || char === "'") {
          const triple = line.startsWith(char.repeat(3), i);
          quote = char === '"' ? (triple ? 'multi_basic' : 'basic') : (triple ? 'multi_literal' : 'literal');
          if (triple) i += 2;
        } else if (char === '[' || char === '{') depth++;
        else if (char === ']' || char === '}') depth--;
      }
    }
  }
  return assignments;
}

function values(policy: CodexModelPolicy): Record<ManagedKey, number> {
  return { model_context_window: policy.modelContextWindow,
    model_auto_compact_token_limit: policy.modelAutoCompactTokenLimit };
}

export function planCodexModelConfig(current: string, policy = loadCodexModelPolicy()): string {
  policy = validateCodexModelPolicy(policy);
  const parsed = parseConfig(current);
  const lines = current.split('\n');
  const assignments = rootAssignments(lines);
  const desired = values(policy);
  const missing: string[] = [];
  const eol = current.includes('\r\n') ? '\r\n' : '\n';
  for (const key of managedKeys) {
    const locations = assignments.filter(a => a.key === key);
    if (!Object.hasOwn(parsed, key)) {
      if (locations.length !== 0) reject('ambiguous_model_assignment');
      missing.push(`${key} = ${desired[key]}${eol}`);
      continue;
    }
    if (!Number.isSafeInteger(parsed[key]) || (parsed[key] as number) <= 0) reject('invalid_model_setting');
    if (locations.length !== 1) reject('ambiguous_model_assignment');
    const located = locations[0]!;
    if (parsed[key] !== desired[key]) {
      const cr = lines[located.line]!.endsWith('\r') ? '\r' : '';
      lines[located.line] = located.prefix + desired[key] + located.suffix + cr;
    }
  }
  const updated = missing.join('') + lines.join('\n');
  const validated = parseConfig(updated);
  if (managedKeys.some(key => validated[key] !== desired[key])) reject('model_config_validation_failed');
  return updated;
}

async function optionalStat(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// base is injectable for isolated tests. The CLI always uses this Cloud checkout.
export async function configureCodexModel(action: ModelConfigAction, base = repositoryRoot) {
  if (action !== '--check' && action !== '--apply') reject('use_check_or_apply');
  const policy = loadCodexModelPolicy(base);
  const directory = resolve(base, '.codex');
  const path = resolve(directory, 'config.toml');
  const parentStat = await optionalStat(directory);
  if (parentStat && !parentStat.isDirectory()) reject('unsafe_config_directory');
  const fileStat = await optionalStat(path);
  if (fileStat && (!fileStat.isFile() || fileStat.nlink !== 1)) reject('unsafe_config_file');
  const current = fileStat ? await readFile(path, 'utf8') : '';
  const planned = planCodexModelConfig(current, policy);
  const changed = planned !== current;
  if (action === '--apply' && changed) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const checkedParent = await lstat(directory);
    if (!checkedParent.isDirectory()) reject('unsafe_config_directory');
    const temporary = resolve(directory, `.model-config-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, planned, { encoding: 'utf8', flag: 'wx', mode: fileStat ? fileStat.mode & 0o777 : 0o600 });
      const latest = await optionalStat(path);
      if (fileStat ? (!latest || !latest.isFile() || latest.nlink !== 1 || latest.ino !== fileStat.ino
        || await readFile(path, 'utf8') !== current) : latest !== null) reject('config_changed_during_apply');
      await rename(temporary, path);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    if (await readFile(path, 'utf8') !== planned) reject('config_readback_mismatch');
  }
  const configured = parseConfig(action === '--apply' ? planned : current);
  return {
    schemaVersion: 1, action, scope: policy.scope, configPath: policy.configPath,
    status: action === '--apply' || !changed ? 'configured' : 'needs_update',
    changed: action === '--apply' && changed,
    requested: { ...values(policy), autoCompactRatio: policy.autoCompactRatio },
    stored: { present: fileStat !== null || action === '--apply',
      settings: Object.fromEntries(managedKeys.map(key => [key, configured[key] ?? null])) },
    effective: { status: policy.effectiveRuntime, modelContextWindow: null, modelAutoCompactTokenLimit: null,
      runtime: 'codex_cloud_managed',
      activation: policy.activation },
  };
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3) reject('use_check_or_apply');
    const result = await configureCodexModel(process.argv[2] as ModelConfigAction);
    process.stdout.write(JSON.stringify(result) + '\n');
    if (result.status !== 'configured') process.exitCode = 1;
  } catch (error) {
    process.stderr.write(JSON.stringify({ status: 'blocked',
      reason: error instanceof CodexModelConfigError ? error.message : 'model_config_operation_failed' }) + '\n');
    process.exitCode = 1;
  }
}
