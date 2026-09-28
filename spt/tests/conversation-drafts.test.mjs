import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {renderToStaticMarkup} from 'react-dom/server';
import React from 'react';

const bundle = await build({stdin: {contents: "export * from './lib/conversation-drafts';export {ConversationCandidates,CloseoutCandidates} from './app/conversation-candidates';", resolveDir: process.cwd()}, bundle: true, format: 'esm', platform: 'node', write: false, external: ['react', 'react/jsx-runtime']});
writeFileSync('.sites-runtime/conversation-candidates-test.mjs', bundle.outputFiles[0].text);
const {readConversationDraft, ConversationCandidates, CloseoutCandidates} = await import('../.sites-runtime/conversation-candidates-test.mjs');
const session = randomUUID(), other = randomUUID(), sourceId = randomUUID();
const source = {id: sourceId, session_id: session, kind: 'transcript', body: JSON.stringify({text: 'SYNTHETIC EVIDENCE'}), created_at: '2026-09-11T06:00:00Z', capture_id: ''};
const data = {protocol: 'spt.conversation-draft.v1', basisEntryIds: [sourceId], candidates: [{id: 'homework-1', kind: 'homework', text: '다음 시간까지 합성 교재 14~16쪽', attribution: 'teacher_statement', evidenceIds: [sourceId], uncertainty: '수업 날짜 미확인'}]};
const entry = value => ({id: randomUUID(), session_id: session, kind: 'ai_draft', body: JSON.stringify({text: typeof value === 'string' ? value : JSON.stringify(value)}), created_at: '2026-09-11T06:01:00Z', capture_id: ''});

await test('structured proposals retain exact text and source identities without changing inputs', () => {
  const draft = entry(data), events = [source, draft], before = JSON.stringify(events);
  const result = readConversationDraft(draft, events, session);
  assert.equal(result.state, 'ready');
  assert.equal(result.draft.candidates[0].text, data.candidates[0].text);
  assert.equal(result.sources.get(sourceId), source);
  assert.equal(JSON.stringify(events), before);
});
await test('foreign, unknown and out-of-basis evidence cannot become an eligible candidate', () => {
  for (const evidence of [[{...source, session_id: other}], [], [{...source, kind: 'ai_draft'}]]) {
    assert.equal(readConversationDraft(entry(data), evidence, session).state, 'invalid');
  }
  assert.equal(readConversationDraft({...entry(data), session_id: other}, [source], session).state, 'invalid');
  const unknown = {...data, candidates: [{...data.candidates[0], evidenceIds: [randomUUID()]}]};
  assert.equal(readConversationDraft(entry(unknown), [source], session).state, 'invalid');
});
await test('late transcripts/corrections mark the retained draft stale; other sessions and notices do not', () => {
  const draft = entry(data), late = {...source, id: randomUUID(), kind: 'transcript_edit'};
  assert.equal(readConversationDraft(draft, [source, late], session).state, 'stale');
  assert.equal(readConversationDraft(draft, [source, {...late, session_id: other}], session).state, 'ready');
  assert.equal(readConversationDraft(draft, [source, {...late, kind: 'recording_notice'}], session).state, 'ready');
});
await test('approval fields, duplicate identities and unsupported protocol versions are rejected', () => {
  const cases = [{...data, confirmed: true}, {...data, candidates: [{...data.candidates[0], approved: true}]}, {...data, basisEntryIds: [sourceId, sourceId]}, {...data, candidates: [data.candidates[0], data.candidates[0]]}, {...data, protocol: 'spt.conversation-draft.v2'}];
  for (const value of cases) assert.equal(readConversationDraft(entry(value), [source], session).state, 'invalid');
});
await test('legacy free-form AI drafts remain on the existing raw/history surface', () => {
  assert.equal(readConversationDraft(entry('기존 자유 형식 AI 초안'), [source], session), null);
});
await test('rendered candidate view is unconfirmed, source-linked and safely escaped', () => {
  const payload = {...data, candidates: [{...data.candidates[0], text: '<script>fixture()</script>'}]};
  const html = renderToStaticMarkup(React.createElement(ConversationCandidates, {sessionId: session, events: [source, entry(payload)]}));
  assert.ok(html.includes('교사 검토 전'));
  assert.ok(html.includes('SYNTHETIC EVIDENCE'));
  assert.ok(html.includes(sourceId));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>fixture()'));
  assert.ok(!html.includes('<button'));
});

await test('closeout only consumes the selected student/day and excludes test conversations', () => {
  const rows = [
    ['A', '2026-09-11', 'CURRENT', 'lesson'],
    ['A', '2026-09-10', 'WRONG-DATE', 'lesson'],
    ['B', '2026-09-11', 'WRONG-STUDENT', 'lesson'],
    ['A', '2026-09-11', 'TEST-CONVERSATION', 'test'],
  ].map(([student_id, class_date, title, purpose]) => {
    const id = randomUUID(), evidence = {...source, id: randomUUID(), session_id: id};
    const payload = {...data, basisEntryIds: [evidence.id], candidates: [{...data.candidates[0], evidenceIds: [evidence.id], text: title}]};
    return {session: {id, student_id, class_date, title, purpose}, events: [evidence, {...entry(payload), session_id: id}]};
  });
  const props = {studentId: 'A', date: '2026-09-11', sessions: rows.map(r => r.session), events: rows.flatMap(r => r.events)};
  const before = JSON.stringify(props), html = renderToStaticMarkup(React.createElement(CloseoutCandidates, props));
  assert.ok(html.includes('CURRENT'));
  for (const missing of ['WRONG-DATE', 'WRONG-STUDENT', 'TEST-CONVERSATION']) assert.ok(!html.includes(missing));
  assert.equal(JSON.stringify(props), before);
  assert.ok(!html.includes('<button'));
});

