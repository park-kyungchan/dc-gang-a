// Characterize the existing Notebook transport before extraction.
// The fake replaces only HTTP IO; the production post implementation is executed.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';

const bundle = await build({
  stdin: {contents: "export {post} from './app/notebook';", resolveDir: process.cwd()},
  bundle: true, platform: 'node', format: 'esm', write: false,
  external: ['react', 'react/jsx-runtime', 'lucide-react'],
});
writeFileSync('.sites-runtime/client-api-contract.mjs', bundle.outputFiles[0].text);
const {post} = await import('../.sites-runtime/client-api-contract.mjs');

async function withFetch(response, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (...args) => {calls.push(args); return response(...args);};
  try {await run(calls);} finally {globalThis.fetch = original;}
}

await test('JSON success preserves payload, URL, method, content type and a timeout signal', async () => {
  await withFetch(() => Response.json({saved: true, id: 'synthetic'}), async calls => {
    assert.deepEqual(await post('/api/fixture', {action: 'fixture', value: '한글'}), {saved: true, id: 'synthetic'});
    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, '/api/fixture');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), {action: 'fixture', value: '한글'});
    assert.ok(options.signal instanceof AbortSignal);
  });
});
await test('each call retains the existing 15 second timeout', async () => {
  const original = AbortSignal.timeout;
  const deadlines = [];
  AbortSignal.timeout = value => {deadlines.push(value); return original(value);};
  try {await withFetch(() => Response.json({}), async () => {await post('/api/fixture', {});});}
  finally {AbortSignal.timeout = original;}
  assert.deepEqual(deadlines, [15000]);
});
await test('a conflict reports the server message without retrying the mutation', async () => {
  await withFetch(() => Response.json({error: '다른 수정본이 있습니다.'}, {status: 409}), async calls => {
    await assert.rejects(post('/api/fixture', {}), {message: '다른 수정본이 있습니다.'});
    assert.equal(calls.length, 1);
  });
});
await test('a non-JSON server failure reports the existing parse fallback', async () => {
  await withFetch(() => new Response('unavailable', {status: 502}), async calls => {
    await assert.rejects(post('/api/fixture', {}), {message: '서버 응답을 확인하지 못했습니다.'});
    assert.equal(calls.length, 1);
  });
});
await test('an error response without error text retains the generic failure', async () => {
  await withFetch(() => Response.json({}, {status: 400}), async () => {
    await assert.rejects(post('/api/fixture', {}), {message: '처리하지 못했습니다.'});
  });
});
await test('network rejection is preserved and never causes an implicit retry', async () => {
  const failure = new Error('synthetic network loss');
  await withFetch(() => {throw failure;}, async calls => {
    await assert.rejects(post('/api/fixture', {}), e => e === failure);
    assert.equal(calls.length, 1);
  });
});
await test('legacy malformed-200 behavior is characterized, not silently redesigned', async () => {
  await withFetch(() => new Response('not-json', {status: 200}), async () => {
    assert.deepEqual(await post('/api/fixture', {}), {error: '서버 응답을 확인하지 못했습니다.'});
  });
});
