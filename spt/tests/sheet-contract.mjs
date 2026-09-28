// Synthetic Sheet rows only. Tests source-to-student binding before any write.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';

globalThis.__syntheticSheetEnv={};
const bundled=await build({entryPoints:['lib/sheet-bridge.ts'],bundle:true,platform:'node',format:'esm',write:false,plugins:[{name:'fake-runtime',setup(build){
 build.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'fixture'}));
 build.onResolve({filter:/^next\/headers$/},()=>({path:'headers',namespace:'fixture'}));
 build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='env'?'export const env=globalThis.__syntheticSheetEnv':'export async function headers(){return new Headers()}'}));
}}]});
const {validateMappings,sameMappings}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const profile=(id,name,row,revision)=>({id,name,sourceRow:row,status:'재원',revision,cells:[]});
const snapshot={profileSource:{profiles:[profile('FAKE-ALPHA','Invented Learner Alpha',11,'v1'),profile('FAKE-BETA','Invented Learner Beta',12,'v2')]},mainSource:{rows:[{sourceRow:31,name:'Invented Learner Alpha',cells:[]},{sourceRow:32,name:'Invented Learner Beta',cells:[]}]},tracker:{students:[{studentId:'FAKE-ALPHA',revision:'tracker-a'},{studentId:'FAKE-BETA',revision:'tracker-b'}]}};
const alpha={studentId:'FAKE-ALPHA',name:'Invented Learner Alpha',profileRow:11,mainRow:31};
const beta={studentId:'FAKE-BETA',name:'Invented Learner Beta',profileRow:12,mainRow:32};

test('source-confirmed mappings retain source rows and tracker revision',()=>{
 const mapped=validateMappings(snapshot,[alpha,beta]);
 assert.deepEqual(mapped.map(m=>[m.studentId,m.profileRow,m.mainRow,m.trackerRevision]),[['FAKE-ALPHA',11,31,'tracker-a'],['FAKE-BETA',12,32,'tracker-b']]);
 assert.equal(sameMappings(snapshot,mapped),true);
});

test('name, source row, and unique ownership are required',()=>{
 for(const candidates of [[{...alpha,name:'Invented Learner Beta'}],[{...alpha,profileRow:12}],[{...alpha,mainRow:32}],[alpha,alpha],[alpha,{...beta,mainRow:31}],[{...alpha,studentId:'FAKE-UNKNOWN'}],[]])assert.throws(()=>validateMappings(snapshot,candidates));
});

test('changed source identity invalidates stored mapping while inactive mappings are skipped',()=>{
 const current=validateMappings(snapshot,[alpha]);
 const changed=structuredClone(snapshot);changed.profileSource.profiles[0].name='Invented changed name';
 assert.equal(sameMappings(changed,current),false);
 assert.equal(sameMappings(changed,[{...current[0],active:false}]),true);
});
