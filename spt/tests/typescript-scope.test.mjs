import assert from 'node:assert/strict';
import {test} from 'node:test';
import path from 'node:path';
import ts from 'typescript';

await test('TypeScript checks application source without compiling recovery copies', () => {
  const config = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  assert.deepEqual(parsed.errors, []);
  const files = parsed.fileNames.map(f => path.relative(process.cwd(), f).replaceAll('\\', '/'));
  assert.ok(files.includes('app/notebook.tsx'));
  assert.ok(files.includes('lib/server.ts'));
  assert.ok(files.includes('lib/client-api.ts'));
  assert.equal(files.some(f => f.startsWith('evidence/')), false, 'Recovery bytes are not application modules');
  assert.equal(parsed.options.strict, true, 'Do not weaken the source type policy');
});
