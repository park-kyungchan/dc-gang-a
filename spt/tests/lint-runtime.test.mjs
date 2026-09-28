import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';

// Actual outbox with private IndexedDB and a labeled transport double.
// No provider or production request.
const bundle=await build({entryPoints:['lib/outbox.ts'],bundle:true,platform:'node',format:'esm',write:false});
writeFileSync('.sites-runtime/outbox-recovery-status.mjs',bundle.outputFiles[0].text);
const {DeviceOutbox}=await import('../.sites-runtime/outbox-recovery-status.mjs');

test('recovered identity clears obsolete offline guidance even with an empty outbox',async()=>{
  const original=globalThis.fetch,box=new DeviceOutbox('SYNTHETIC-IDENTITY-RECOVERY');
  await box.read();
  try{
    globalThis.fetch=async()=>{throw new TypeError('SYNTHETIC_OFFLINE')};
    await box.flush();
    assert.match(box.message,/연결·로그인/);
    globalThis.fetch=async url=>{assert.equal(url,'/api/identity');return Response.json({ownerKey:box.owner})};
    await box.flush();
    assert.equal(box.pending.length,0);
    assert.equal(box.message,'');
  }finally{globalThis.fetch=original;}
});
