import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, link, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  configureCodexModel, loadCodexModelPolicy, planCodexModelConfig, validateCodexModelPolicy,
} from '../../harness/codex_model_config';

const policy = loadCodexModelPolicy();
const temporaryRoots: string[] = [];
async function temporaryRepository(current?: string) {
  const base = await mkdtemp(resolve(tmpdir(), 'codex-model-config-test-'));
  temporaryRoots.push(base);
  await mkdir(resolve(base, 'harness'));
  await writeFile(resolve(base, 'harness/codex-model-policy.json'), JSON.stringify(policy));
  if (current !== undefined) {
    await mkdir(resolve(base, '.codex'));
    await writeFile(resolve(base, '.codex/config.toml'), current);
  }
  return base;
}
afterEach(async () => {
  for (const base of temporaryRoots.splice(0)) await rm(base, { recursive: true, force: true });
});

test('requested compaction is exactly 75 percent and policy cannot introduce unrelated runtime settings', () => {
  expect(policy.modelContextWindow).toBe(1_050_000);
  expect(policy.modelAutoCompactTokenLimit).toBe(787_500);
  expect(policy.modelAutoCompactTokenLimit / policy.modelContextWindow).toBe(0.75);
  expect(() => validateCodexModelPolicy({ ...policy, modelAutoCompactTokenLimit: 872_000 })).toThrow('invalid_model_policy');
  expect(() => validateCodexModelPolicy({ ...policy, approval_policy: 'synthetic-unexpected' })).toThrow('invalid_model_policy');
});

test('updates only root integer tokens, preserving comments, selected model, permissions, MCP and profile settings', () => {
  const before = '# owner settings\nmodel = "gpt-6.1"\n'
    + 'model_context_window  =  256_000 # existing window\n'
    + "'model_auto_compact_token_limit' = +200_000 # existing limit\n"
    + 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n'
    + '[mcp_servers.synthetic]\nurl = "https://example.invalid"\n'
    + '[profiles.small]\nmodel_context_window = 128000\nmodel_auto_compact_token_limit = 64000\n';
  const planned = planCodexModelConfig(before);
  expect(planned).toBe(before.replace('256_000 #', '1050000 #').replace('+200_000 #', '787500 #'));
  expect(planCodexModelConfig(planned)).toBe(planned);
  const parsed = Bun.TOML.parse(planned) as { profiles: { small: Record<string, number> } };
  expect(parsed.profiles.small.model_context_window).toBe(128_000);
});

test('missing keys are inserted at the document root rather than in the first table', () => {
  const before = '# unchanged header\n[features]\nsynthetic = true\n';
  const planned = planCodexModelConfig(before);
  expect(planned).toBe('model_context_window = 1050000\nmodel_auto_compact_token_limit = 787500\n' + before);
  expect(planCodexModelConfig(planned)).toBe(planned);
});

test('keeps CRLF, missing terminal newline and already matching integer representations intact', () => {
  const before = 'model_context_window = 256000\r\nmodel_auto_compact_token_limit = 200000\r\nmodel="gpt-6"';
  expect(planCodexModelConfig(before)).toBe(before.replace('256000', '1050000').replace('200000', '787500'));
  const matching = '"model_context_window" = +1_050_000 # matching\r\nmodel_auto_compact_token_limit = 787_500';
  expect(planCodexModelConfig(matching)).toBe(matching);
});

test('does not rewrite fake settings or table headers inside multiline strings and arrays', () => {
  const before = 'description = """\nmodel_context_window = 13\n[features]\n"""\n'
    + "notes = [\n'''\nmodel_auto_compact_token_limit = 7\n[profiles.fake]\n''',\n\"synthetic\",\n]\n"
    + 'model_context_window = 256000\nmodel_auto_compact_token_limit = 200000\n';
  const expected = before.replace('model_context_window = 256000', 'model_context_window = 1050000')
    .replace('model_auto_compact_token_limit = 200000', 'model_auto_compact_token_limit = 787500');
  expect(planCodexModelConfig(before)).toBe(expected);
});

test('rejects invalid, duplicate, noninteger and ambiguous Unicode-escaped managed assignments', () => {
  for (const invalid of [
    'model_context_window = 1\nmodel_context_window = 2\n',
    'broken = [\n',
    'model_context_window = 3.5\n',
    'model_context_window = 0\n',
    'model_context_window.value = 5\n',
    '"model_\\u0063ontext_window" = 256000\n',
  ]) expect(() => planCodexModelConfig(invalid)).toThrow();
});

test('check reports missing settings without creating a config and separates requested, stored and effective states', async () => {
  const base = await temporaryRepository();
  const report = await configureCodexModel('--check', base);
  expect(report.status).toBe('needs_update');
  expect(report.requested.model_auto_compact_token_limit).toBe(787_500);
  expect(report.stored).toEqual({ present: false, settings: { model_context_window: null, model_auto_compact_token_limit: null } });
  expect(report.effective.status).toBe('unverified');
  expect(report.effective.modelContextWindow).toBeNull();
  expect(await readdir(base)).toEqual(['harness']);
});

test('apply reads back the exact preserved config, leaves no backups and is idempotent', async () => {
  const before = 'model="gpt-6.1"\nprivate_note="synthetic-private-value"\n[features]\nsynthetic=true\n';
  const base = await temporaryRepository(before);
  const report = await configureCodexModel('--apply', base);
  expect(report.status).toBe('configured');
  expect(report.changed).toBe(true);
  expect(report.stored.settings.model_context_window).toBe(1_050_000);
  expect(report.effective.status).toBe('unverified');
  expect(JSON.stringify(report)).not.toContain('synthetic-private-value');
  expect(await readFile(resolve(base, '.codex/config.toml'), 'utf8')).toBe(planCodexModelConfig(before));
  expect(await readdir(resolve(base, '.codex'))).toEqual(['config.toml']);
  expect((await configureCodexModel('--apply', base)).changed).toBe(false);
  expect((await configureCodexModel('--check', base)).status).toBe('configured');
});

test('an invalid existing config remains byte-for-byte untouched', async () => {
  const before = 'model_context_window=8\nmodel_context_window=9\n# synthetic-private-value\n';
  const base = await temporaryRepository(before);
  await expect(configureCodexModel('--apply', base)).rejects.toThrow('invalid_toml');
  expect(await readFile(resolve(base, '.codex/config.toml'), 'utf8')).toBe(before);
  expect(await readdir(resolve(base, '.codex'))).toEqual(['config.toml']);
});

test.skipIf(process.platform === 'win32')('refuses symlink directories, symlink files and hard-linked configs', async () => {
  const outside = await temporaryRepository('model="synthetic-outside"\n');
  const symlinkBase = await temporaryRepository();
  await symlink(resolve(outside, '.codex'), resolve(symlinkBase, '.codex'));
  await expect(configureCodexModel('--apply', symlinkBase)).rejects.toThrow('unsafe_config_directory');
  const fileBase = await temporaryRepository();
  await mkdir(resolve(fileBase, '.codex'));
  await symlink(resolve(outside, '.codex/config.toml'), resolve(fileBase, '.codex/config.toml'));
  await expect(configureCodexModel('--apply', fileBase)).rejects.toThrow('unsafe_config_file');
  await rm(resolve(fileBase, '.codex/config.toml'));
  await link(resolve(outside, '.codex/config.toml'), resolve(fileBase, '.codex/config.toml'));
  await expect(configureCodexModel('--apply', fileBase)).rejects.toThrow('unsafe_config_file');
  expect(await readFile(resolve(outside, '.codex/config.toml'), 'utf8')).toBe('model="synthetic-outside"\n');
});

test('CLI rejects external paths and arbitrary arguments without exposing them', () => {
  const cli = resolve(import.meta.dir, '../../harness/codex_model_config.ts');
  const result = Bun.spawnSync({ cmd: [process.execPath, cli, '--apply', '--path', 'synthetic-private-value'], stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode).toBe(1);
  expect(result.stdout.toString()).toBe('');
  expect(JSON.parse(result.stderr.toString())).toEqual({ status: 'blocked', reason: 'use_check_or_apply' });
});
