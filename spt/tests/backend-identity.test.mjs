import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';

// Actual identity functions with explicit in-memory native runtime bindings.
// No real credentials, Site headers, production state or native Agent run.
globalThis.__backendIdentityEnv = {};
globalThis.__backendIdentityHeaders = new Headers();
const compiled = await build({stdin:{contents:"export * from './app/chatgpt-auth';export {owner} from './lib/server';export {GET as identity} from './app/api/identity/route';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'backend-identity-fixture',setup(b){
  b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
  b.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));
  b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},({path})=>({contents:path==='env'?'export const env=globalThis.__backendIdentityEnv':path==='headers'?'export async function headers(){return globalThis.__backendIdentityHeaders}':'export function redirect(){throw new Error("redirect")}'}));
}}]});
writeFileSync('.sites-runtime/backend-identity-test.mjs',compiled.outputFiles[0].text);
const {getChatGPTUser,owner,identity} = await import('../.sites-runtime/backend-identity-test.mjs');
const fixtureToken = 'SYNTHETIC-BACKEND-ONLY-'.repeat(3);
const fixtureOwner = 'native-11111111-1111-4111-8111-111111111111';

await test('existing Site identity is unchanged when backend mode is absent',async()=>{
  globalThis.__backendIdentityHeaders = new Headers({'oai-authenticated-user-email':'site-fixture@example.invalid','x-spt-backend-token':fixtureToken});
  assert.equal((await getChatGPTUser()).email,'site-fixture@example.invalid');
  assert.match(await owner(),/^siwc-[0-9a-f]{64}$/);
});
await test('independent mode rejects forged Site identity and missing or wrong gateway proof',async()=>{
  Object.assign(globalThis.__backendIdentityEnv,{SPT_BACKEND_MODE:'paired-local',SPT_BACKEND_OWNER_KEY:fixtureOwner,SPT_BACKEND_SESSION_TOKEN:fixtureToken});
  globalThis.__backendIdentityHeaders = new Headers({'oai-authenticated-user-email':'forged@example.invalid'});
  assert.equal(await getChatGPTUser(),null);
  globalThis.__backendIdentityHeaders = new Headers({'oai-authenticated-user-email':'forged@example.invalid','x-spt-backend-token':'WRONG'});
  assert.equal(await getChatGPTUser(),null);
  await assert.rejects(owner(),/로그인/);
});
await test('paired gateway identity is stable and never inferred from a browser email',async()=>{
  globalThis.__backendIdentityHeaders = new Headers({'x-spt-backend-token':fixtureToken,'oai-authenticated-user-email':'forged@example.invalid'});
  const user = await getChatGPTUser();
  assert.equal(user.nativeOwnerKey,fixtureOwner);
  assert.equal(user.email,'');
  assert.equal(await owner(),fixtureOwner);
  await assert.rejects(owner(new Request('https://spt.example/api/notebook',{method:'POST',headers:{origin:'https://foreign.example'}})),/출처/);
});
await test('an incomplete independent binding fails closed without falling back to Site headers',async()=>{
  delete globalThis.__backendIdentityEnv.SPT_BACKEND_SESSION_TOKEN;
  assert.equal(await getChatGPTUser(),null);
  globalThis.__backendIdentityEnv.SPT_BACKEND_SESSION_TOKEN=fixtureToken;
  globalThis.__backendIdentityEnv.SPT_BACKEND_OWNER_KEY='arbitrary-owner';
  assert.equal(await getChatGPTUser(),null);
});
await test('the authenticated native deployment reports its exact build and bounded window only',async()=>{
  Object.assign(globalThis.__backendIdentityEnv,{SPT_BACKEND_OWNER_KEY:fixtureOwner,SPT_BACKEND_SESSION_TOKEN:fixtureToken,SPT_BUILD_ID:'spt-fixture-build',SPT_RUN_UNTIL:'2026-10-16T12:00:00Z'});
  globalThis.__backendIdentityHeaders=new Headers({'x-spt-backend-token':fixtureToken});
  const response=await identity(),value=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(value.runtime,{buildId:'spt-fixture-build',runUntil:'2026-10-16T12:00:00Z'});
  globalThis.__backendIdentityHeaders=new Headers();
  const denied=await identity();assert.equal(denied.status,401);assert.equal((await denied.json()).runtime,undefined);
});
