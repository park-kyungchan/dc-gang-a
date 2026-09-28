// Real SPT Sheet handlers, native-auth/SQLite fixtures and a fake HMAC peer.
// Never reads native credentials or calls Google.
import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {api,sql,sign,req,good} from './pilot-contract.mjs';
const env=globalThis.__sptEnv,originalFetch=globalThis.fetch;
const native='native-11111111-1111-4111-8111-111111111111',foreign='native-22222222-2222-4222-8222-222222222222';
const key='SYNTHETIC-SHEET-HMAC-KEY-NOT-A-CREDENTIAL-0123456789',token='SYNTHETIC-INTERNAL-SESSION-TOKEN-0123456789';
const date='2026-09-14',url='https://script.google.com/macros/s/SYNTHETIC/exec';
const read=()=>api.sheet.GET(new Request('https://spt.example/api/sheet?date='+date));
const preview=()=>api.sheet.POST(req('/api/sheet',{action:'preview',date}));
function setup(){Object.assign(env,{SPT_BACKEND_MODE:'paired-local',SPT_BACKEND_OWNER_KEY:native,SPT_BACKEND_SESSION_TOKEN:token,SPT_SHEET_BRIDGE_OWNER_KEY:native,SPT_SHEET_BRIDGE_URL:url,SPT_SHEET_BRIDGE_KEY:key});globalThis.__sptHeaders=new Headers({'x-spt-backend-token':token});}
afterEach(()=>{for(const name of ['SPT_BACKEND_MODE','SPT_BACKEND_OWNER_KEY','SPT_BACKEND_SESSION_TOKEN','SPT_SHEET_BRIDGE_OWNER_KEY','SPT_SHEET_BRIDGE_URL','SPT_SHEET_BRIDGE_KEY'])delete env[name];globalThis.fetch=originalFetch;sign();});
function peer(){let calls=0;globalThis.fetch=async(target,options)=>{calls++;assert.equal(target,url);const input=JSON.parse(options.body),{signature,...unsigned}=input;assert.equal(input.payload.actorKey,native);assert.equal(signature,createHmac('sha256',env.SPT_SHEET_BRIDGE_KEY).update(JSON.stringify(unsigned)).digest('hex'));return Response.json({ok:true,snapshot:{schema:1,spreadsheetId:'1R8DoOOo5yg3M1hgHPA0Vuqp3Ng-K5bQgxdiy5dEeXOg',date,readAt:new Date().toISOString(),profileSource:{profiles:[]},mainSource:{rows:[]},tracker:{students:[]}}})};return()=>calls;}
await test('native owner consumes the bound HMAC key and public replies never disclose it',async()=>{
 setup();const calls=peer();assert.equal(await api.server.owner(),native);assert.equal((await good(await read())).configured,true);const response=await preview(),raw=await response.clone().text();await good(response);assert.equal(calls(),1);assert.ok(!raw.includes(key));assert.equal(sql.prepare('SELECT COUNT(*) n FROM spt_secrets WHERE owner=?').get(native).n,0);
});
await test('another or missing native binding refuses before any HMAC request',async()=>{
 for(const bound of [foreign,undefined,'native-'+'a'.repeat(64)]){setup();if(bound===undefined)delete env.SPT_SHEET_BRIDGE_OWNER_KEY;else env.SPT_SHEET_BRIDGE_OWNER_KEY=bound;const calls=peer();assert.equal((await good(await read())).configured,false);assert.equal((await preview()).status,403);assert.equal(calls(),0);}
});
await test('native key removal or malformed value stays unavailable; valid rotation is consumed',async()=>{
 setup();const calls=peer();env.SPT_SHEET_BRIDGE_KEY=key+'-rotated';await good(await preview());assert.equal(calls(),1);
 for(const value of [undefined,'',key+'\n','short']){if(value===undefined)delete env.SPT_SHEET_BRIDGE_KEY;else env.SPT_SHEET_BRIDGE_KEY=value;assert.equal((await good(await read())).configured,false);assert.equal((await preview()).status,503);assert.equal(calls(),1);}
});
