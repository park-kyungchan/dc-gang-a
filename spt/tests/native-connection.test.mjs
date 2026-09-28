// Actual SPT handlers with private SQLite/env fixtures. No provider calls.
import assert from 'node:assert/strict';
import {test, afterEach} from 'node:test';
import {api, sql, sign, req, good} from './pilot-contract.mjs';

const env = globalThis.__sptEnv;
const nativeKey = 'fixture-native-elevenlabs-not-a-real-key';
const appKey = 'fixture-app-elevenlabs-not-a-real-key';
const read = () => api.notebook.GET(new Request('https://spt.example/api/notebook?date=2026-09-09'));
async function bindNative(key = nativeKey) {
  sign();
  env.SPT_ELEVENLABS_OWNER_KEY = await api.server.owner();
  if (key !== null) env.ELEVENLABS_API_KEY = key;
}
afterEach(() => {
  delete env.SPT_ELEVENLABS_OWNER_KEY;
  delete env.ELEVENLABS_API_KEY;
  sql.prepare('DELETE FROM spt_secrets').run();
  sign();
});

await test('only the bound owner consumes a native key, without a D1 copy or response disclosure', async () => {
  await bindNative();
  const user = await api.server.owner();
  const response = await read();
  const raw = await response.clone().text();
  const data = await good(response);
  assert.equal(data.connected, true);
  assert.equal(data.connectionSource, 'hermes');
  assert.ok(!raw.includes(nativeKey));
  assert.equal(await api.server.apiKey(user), nativeKey);
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_secrets').get().n, 0);
  sign('teacher-b');
  assert.equal((await good(await read())).connected, false);
  await assert.rejects(api.server.apiKey(await api.server.owner()));
});
await test('a key without an explicit owner binding is never a shared fallback', async () => {
  sign();
  env.ELEVENLABS_API_KEY = nativeKey;
  assert.equal((await good(await read())).connected, false);
  await assert.rejects(api.server.apiKey(await api.server.owner()));
});
await test('native rotation is consumed; removal does not resurrect a shadow app key', async () => {
  sign();
  await good(await api.connection.POST(req('/api/connection', {action: 'save', key: appKey})));
  await bindNative();
  const user = await api.server.owner();
  env.ELEVENLABS_API_KEY = nativeKey + '-rotated';
  assert.equal(await api.server.apiKey(user), nativeKey + '-rotated');
  delete env.ELEVENLABS_API_KEY;
  const state = await good(await read());
  assert.equal(state.connected, false);
  assert.equal(state.connectionSource, 'hermes');
  await assert.rejects(api.server.apiKey(user));
  // Explicitly removing the owner binding restores the unchanged app-owned path.
  delete env.SPT_ELEVENLABS_OWNER_KEY;
  assert.equal(await api.server.apiKey(user), appKey);
  assert.equal((await good(await read())).connectionSource, 'app');
});
await test('app save/remove cannot claim to rotate or delete a Hermes-managed credential', async () => {
  await bindNative();
  for (const payload of [{action: 'save', key: appKey}, {action: 'remove'}]) {
    assert.equal((await api.connection.POST(req('/api/connection', payload))).status, 409);
  }
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_secrets').get().n, 0);
  assert.equal(await api.server.apiKey(await api.server.owner()), nativeKey);
});
await test('malformed native credentials stay unconfigured without exposing or normalizing them', async () => {
  for (const value of ['', 'short', nativeKey + '\n', 'x'.repeat(1025)]) {
    await bindNative(value);
    const response = await read();
    const state = await good(response);
    assert.equal(state.connected, false);
    assert.equal(state.connectionSource, 'hermes');
    await assert.rejects(api.server.apiKey(await api.server.owner()));
  }
});
