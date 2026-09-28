// Lint source, not generated test bundles or evidence. Do not disable source rules.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {ESLint} from 'eslint';

const eslint = new ESLint();
await test('generated runtime and evidence directories are outside source lint', async () => {
  for (const path of ['.sites-runtime/generated-contract.mjs', '.wrangler/generated.js', 'evidence/baseline-01/generated.js']) {
    assert.equal(await eslint.isPathIgnored(path), true, path);
  }
});
await test('application and test source remain linted with existing error rules', async () => {
  for (const path of ['app/notebook.tsx', 'lib/client-api.ts', 'tests/client-api.test.mjs', 'tests/local/source-probe.ts']) {
    assert.equal(await eslint.isPathIgnored(path), false, path);
  }
  const [result] = await eslint.lintText('export const diagnostic: any = 1;', {filePath: 'lib/lint-boundary-probe.ts'});
  assert.ok(result.messages.some(m => m.ruleId === '@typescript-eslint/no-explicit-any' && m.severity === 2));
});
