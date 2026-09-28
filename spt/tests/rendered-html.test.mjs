import {syntheticRosterPlugin} from './fixtures/synthetic-roster-plugin.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=await build({entryPoints:['app/page.tsx'],bundle:true,format:'esm',platform:'node',packages:'external',write:false,plugins:[syntheticRosterPlugin,{name:'authenticated-server-fixture',setup(b){b.onResolve({filter:/^(cloudflare:workers|next\/headers|next\/navigation)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:a.path==='cloudflare:workers'?'export const env={}':a.path==='next/headers'?'export async function headers(){return globalThis.__pageHeaders}':'export function redirect(url){throw new Error("AUTH_REDIRECT "+url)}'}));}}]});
await mkdir('.sites-runtime',{recursive:true});await writeFile('.sites-runtime/page-contract.mjs',bundle.outputFiles[0].text);const {default:Home}=await import('../.sites-runtime/page-contract.mjs');
test('the classroom remains authenticated and renders actionable content after sign-in',async()=>{
 globalThis.__pageHeaders=new Headers();await assert.rejects(()=>Home(),/AUTH_REDIRECT/);
 globalThis.__pageHeaders=new Headers({'oai-authenticated-user-email':'page-test@example.invalid'});const html=renderToStaticMarkup(await Home());
 // A replaces FIELD while keeping the same authenticated app consumer.
 assert.match(html,/class="[^"]*a-shell[^"]*class-overview/);
 assert.ok(html.includes('aria-label="작업 영역"'));
 assert.ok(html.includes('class="a-board"'));
 assert.ok(html.includes('id="class-roster"'));
 assert.ok(html.includes('id="student-work"'));
 assert.ok(html.includes('aria-label="수업일"'));
 assert.ok(html.includes('활동 배정'));
 assert.ok(html.includes('명 예정'));
 assert.ok(!html.includes('page-test@example.invalid'));assert.ok(!html.includes('대화에 집중하는 시간'));
});
