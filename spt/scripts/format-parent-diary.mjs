// Bounded file consumer of the same parent-diary schema/renderer as SPT source.
// Produces private reviewed proposals; never invokes an academy/provider API.
import {build} from 'esbuild';
import {readFileSync,writeFileSync,statSync,mkdirSync} from 'node:fs';
import {dirname,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
try{
 if(process.argv.length!==4)throw new Error('Usage: node scripts/format-parent-diary.mjs INPUT.json OUTPUT.json');
 const [input,output]=process.argv.slice(2).map(p=>resolve(p));
 for(const path of [input,output]){const p=relative(root,path);if(p.startsWith('..')||isAbsolute(p))throw new Error('Input/output must remain in the SPT workspace.');}
 if(statSync(input).size>1000000)throw new Error('Input exceeds this bounded formatter limit.');
 const value=JSON.parse(readFileSync(input,'utf8')),rows=Array.isArray(value)?value:[value];
 if(!rows.length||rows.length>30)throw new Error('Supply 1..30 reviewed student/day inputs.');
 const built=await build({stdin:{contents:"export * from './lib/diary-draft';",resolveDir:root},bundle:true,platform:'node',format:'esm',write:false});
 const api=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 const previews=rows.map(row=>api.previewParentDiary(row));
 if(new Set(previews.map(v=>v.studentId+':'+v.date)).size!==previews.length)throw new Error('Duplicate student/day input.');
 const result={version:'spt.parent-diary-preview.v1',sourceFile:input,count:previews.length,allReady:previews.every(v=>v.ready),previews,authority:'Proposal only; source/revision and teacher review are checked by the existing application/academy consumer.'};
 mkdirSync(dirname(output),{recursive:true,mode:0o700});
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({output,count:result.count,allReady:result.allReady,limits:previews.map(v=>({studentId:v.studentId,...v.limits}))}));
 if(!result.allReady)process.exitCode=2;
}catch(error){console.error(error instanceof Error?error.message:'Parent-diary formatting failed.');process.exitCode=1;}
