import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inspectProjectConfig } from '../../harness/runtime_preflight';

test('runtime preflight separates project declarations from session proof', () => {
  const root = resolve(import.meta.dir, '../..');
  const parsed = Bun.TOML.parse(readFileSync(resolve(root, '.codex/config.toml'), 'utf8')) as unknown as {
    mcp_servers: { chromeDevTools: { args: string[] }; localBrowser: { args: string[] } };
  };
  const declared = inspectProjectConfig(parsed);
  expect(declared?.modelContextWindowConfigured).toBe(1050000);
  expect(declared?.autoCompactThresholdConfigured).toBe(872000);
  expect(declared?.playwrightChromeConfigured).toBe(true);
  expect(declared?.chromeDevToolsConfigured).toBe(true);
  expect(declared?.chromeDevToolsPackagePresent).toBe(true);
  expect(declared?.chromeDevToolsDeclaredScriptValid).toBe(true);
  expect(declared?.localBrowserDeclaredScriptValid).toBe(true);

  const badDevTools = structuredClone(parsed);
  badDevTools.mcp_servers.chromeDevTools.args[0] = resolve(root, 'missing-devtools.js');
  expect(inspectProjectConfig(badDevTools)?.chromeDevToolsPackagePresent).toBe(true);
  expect(inspectProjectConfig(badDevTools)?.chromeDevToolsDeclaredScriptValid).toBe(false);
  expect(inspectProjectConfig(badDevTools)?.chromeDevToolsConfigured).toBe(false);

  const badPlaywright = structuredClone(parsed);
  badPlaywright.mcp_servers.localBrowser.args[0] = resolve(root, 'missing-playwright.js');
  expect(inspectProjectConfig(badPlaywright)?.localBrowserPackagePresent).toBe(true);
  expect(inspectProjectConfig(badPlaywright)?.localBrowserDeclaredScriptValid).toBe(false);
  expect(inspectProjectConfig(badPlaywright)?.playwrightChromeConfigured).toBe(false);

  const wrongExistingTarget = structuredClone(parsed);
  wrongExistingTarget.mcp_servers.chromeDevTools.args[0] = resolve(root, 'package.json');
  expect(inspectProjectConfig(wrongExistingTarget)?.chromeDevToolsDeclaredScriptValid).toBe(false);
  expect(inspectProjectConfig(wrongExistingTarget)?.chromeDevToolsConfigured).toBe(false);

  const run = Bun.spawnSync({ cmd: ['bun', 'run', 'harness/runtime_preflight.ts', '--json'], cwd: root,
    stdout: 'pipe', stderr: 'pipe' });
  expect(run.exitCode).toBe(0);
  const output = JSON.parse(new TextDecoder().decode(run.stdout));
  expect(output.effectiveSession.activeModelCapacity).toBe('unverified_by_project_preflight');
  expect(output.effectiveSession.mcpConnection).toBe('unverified_by_cli_listing');
  expect(output.mcpRegistration).toBeNull();
});
