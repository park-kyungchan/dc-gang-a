import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['lib/audio-import-state.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {importTranscription}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const row={id:'capture-a',session_id:'session-a',owner:'owner-a',status:'stored',transcript_id:null};
const e={id:'entry-a',owner:row.owner,session_id:row.session_id,capture_id:row.id,kind:'transcript',body:JSON.stringify({text:'SYNTHETIC RETAINED'})};
test('legacy text-only evidence needs the exact owner/session/capture, not a matching label',()=>{
 assert.deepEqual(importTranscription(row,[e]),{state:'available',entryIds:[e.id]});
 for(const changed of [{owner:'foreign'},{capture_id:'capture-b'},{kind:'observation'}])assert.deepEqual(importTranscription(row,[{...e,...changed}]),{state:'not_found',entryIds:[]});
 assert.equal(importTranscription(row,[{...e,session_id:'another-session'}]).state,'needs_review');
});
test('broken pointers, malformed/empty text, contradictory origin and invalid originals cannot invite a new STT call',()=>{
 for(const body of ['{bad','{}',JSON.stringify({text:' '}),JSON.stringify({text:'SYNTHETIC',originalAudioId:'foreign-capture'})])assert.equal(importTranscription(row,[{...e,body}]).state,'needs_review');
 assert.equal(importTranscription({...row,transcript_id:'missing'},[e]).state,'needs_review');
 assert.equal(importTranscription({...row,status:'transcribed'},[]).state,'needs_review');
 assert.equal(importTranscription({...row,status:'invalid'},[e]).state,'needs_review');
});
test('multiple genuine source-linked entries remain available without silently choosing the newest session text',()=>{
 assert.deepEqual(importTranscription(row,[e,{...e,id:'entry-b'},e]),{state:'available',entryIds:['entry-a','entry-b']});
});
