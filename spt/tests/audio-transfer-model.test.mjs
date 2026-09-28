import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['lib/audio-transfer-model.ts'],bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const origin='https://spt.example',now=1789466400000;
const row={id:'11111111-1111-4111-8111-111111111111',session_id:'22222222-2222-4222-8222-222222222222',student_id:'QA_A',class_date:'2040-01-02',session_title:'SYNTHETIC',session_purpose:'test'};
const grant={protocol:'spt.audio-transfer.v1',importId:row.id,sessionId:row.session_id,studentId:row.student_id,classDate:row.class_date,token:'S'.repeat(43),expiresAt:now/1000+300,uploadURL:origin+'/api/audio-transfer/upload',statusURL:origin+'/api/audio-transfer/status'};
test('encoded Shortcut input retains only source-bound finite transfer rights and a non-secret return URL',()=>{
 const url=new URL(m.transferShortcutURL(grant,row,origin,now)),input=JSON.parse(url.searchParams.get('text'));
 assert.equal(url.searchParams.get('name'),'SPT 녹음 자동전송');assert.equal(url.searchParams.get('input'),'text');assert.equal(input.importId,row.id);assert.equal(input.token,grant.token);
 const back=new URL(input.returnURL);assert.equal(back.searchParams.get('view'),'record');assert.equal(back.searchParams.get('audioImport'),row.id);assert.ok(!back.href.includes(grant.token));assert.ok(!Object.hasOwn(input,'cookie'));
 assert.deepEqual(m.transferReturnTarget(back.search,row),{importId:row.id,studentId:row.student_id,date:row.class_date,sessionId:row.session_id,title:row.session_title,purpose:'test'});
});
test('expired, malformed, retargeted and foreign-endpoint grants fail before opening a native action',()=>{
 for(const change of [{token:grant.token+' '},{expiresAt:now/1000},{expiresAt:Infinity},{importId:row.session_id},{studentId:'foreign'},{classDate:'2040-01-03'},{uploadURL:'https://foreign.invalid/upload'},{statusURL:origin+'/api/notebook'},{protocol:'legacy'}])assert.throws(()=>m.transferShortcutURL({...grant,...change},row,origin,now),/전송 권한/);
});
test('a return reference is not allowed to reassign the retained source or create another capture',()=>{
 const valid='?student=QA_A&date=2040-01-02&audioImport='+row.id;
 for(const q of [valid.replace('QA_A','QA_B'),valid.replace('2040-01-02','2040-01-03'),valid.replace(row.id,row.session_id)])assert.throws(()=>m.transferReturnTarget(q,row),/원래 학생/);
});
