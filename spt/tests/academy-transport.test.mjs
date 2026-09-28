// Actual installed workerd -> isolated loopback HTTP. No credentials or academy.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
const owner='native-11111111-1111-4111-8111-111111111111',token='SYNTHETIC_TRANSPORT_ONLY_0123456789';
let behavior='normal';const calls=[];
const native=createServer(async(req,res)=>{
 let body='';for await(const part of req)body+=part;
 calls.push({path:req.url,owner:req.headers['x-spt-owner'],authorization:req.headers.authorization,body:body?JSON.parse(body):null});
 if(behavior==='redirect'){res.writeHead(302,{Location:'http://127.0.0.1:4194/not-authorized'});res.end('not JSON');return;}
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({state:'prepared',synthetic:true}));
});
await new Promise((resolve,reject)=>{native.once('error',reject);native.listen(4194,'127.0.0.1',resolve);});
let mf;
try{
 const result=await build({stdin:{contents:`import {academyCall} from './lib/academy-bridge';export default {async fetch(){try{return Response.json(await academyCall('${owner}',{action:'preview',entryId:'11111111-1111-4111-8111-111111111111'}))}catch(e){return Response.json({name:e.name,error:e.message},{status:e.status||500})}}};`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:workers'],treeShaking:true,plugins:[{name:'unused-next-header-boundary',setup(b){b.onResolve({filter:/^next\/(headers|navigation)$/},()=>({path:'unused-headers',namespace:'isolated'}));b.onLoad({filter:/.*/,namespace:'isolated'},()=>({contents:'export function headers(){throw Error("Unexpected Next header use in transport-only test")}export const cookies=headers;export const redirect=headers;'}));}}]});
 mf=new Miniflare({host:'127.0.0.1',port:4193,compatibilityDate:'2026-05-15',modules:true,script:result.outputFiles[0].text,bindings:{SPT_ACADEMY_OWNER_KEY:owner,SPT_ACADEMY_TOKEN:token,SPT_ACADEMY_URL:'http://127.0.0.1:4194/academy'}});
 await test('installed workerd delivers the actual academy client request to the exact native loopback',async()=>{
  const response=await mf.dispatchFetch('http://private.test/');const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body,{state:'prepared',synthetic:true});assert.equal(calls.length,1);assert.equal(calls[0].path,'/academy');assert.equal(calls[0].owner,owner);assert.equal(calls[0].authorization,'Bearer '+token);
 });
 await test('native redirect is rejected before JSON decoding and never forwards the bound credential',async()=>{
  behavior='redirect';const count=calls.length;const response=await mf.dispatchFetch('http://private.test/');const body=await response.json();assert.equal(response.status,502,JSON.stringify(body));assert.equal(calls.length,count+1);assert.ok(calls.every(c=>c.path==='/academy'));assert.doesNotMatch(JSON.stringify(body),new RegExp(token));
 });
}finally{
 if(mf)await mf.dispose();await new Promise(resolve=>native.close(resolve));
}
