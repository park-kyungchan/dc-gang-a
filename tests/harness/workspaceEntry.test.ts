import { expect, test } from 'bun:test';
import {
  applyWorkspaceEntry, checkWorkspaceEntry, managedRepositoryPath, managedWorkspaceEntryPath,
  workspaceEntryContent, type WorkspaceEntryIO,
} from '../../harness/workspace_entry';

function memoryIO(initial: string | null = null) {
  const files = new Map<string, string>();
  if (initial !== null) files.set(managedWorkspaceEntryPath, initial);
  const reads: string[] = [];
  const writes: string[] = [];
  const inspections: string[] = [];
  const io: WorkspaceEntryIO = {
    canonicalPath(path) { inspections.push(path); return path; },
    kind(path) {
      inspections.push(path);
      if (path === '/workspace' || path === managedRepositoryPath) return 'directory';
      return files.has(path) ? 'file' : 'missing';
    },
    readText(path) { reads.push(path); return files.get(path)!; },
    createExclusive(path, content) {
      writes.push(path);
      if (files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
      files.set(path, content);
    },
  };
  return { io, files, reads, writes, inspections };
}

test('missing native parent entry is reported without writes or effective-prompt claims', () => {
  const fixture = memoryIO();
  const checked = checkWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(checked.status).toBe('missing');
  expect(checked.ok).toBe(false);
  expect(checked.changed).toBe(false);
  expect(checked.effectivePromptLoaded).toBe('unverified');
  expect(checked.hooksInstalled).toBe(false);
  expect(checked.automaticPerTurnInjectionInstalled).toBe(false);
  expect(fixture.writes).toEqual([]);
  expect(fixture.files.size).toBe(0);
});

test('managed install creates only the exact fixed bridge and repeat install is a noop', () => {
  const fixture = memoryIO();
  const installed = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(installed.status).toBe('created');
  expect(installed.ok).toBe(true);
  expect(installed.changed).toBe(true);
  expect(installed.targetPath).toBe(managedWorkspaceEntryPath);
  expect(fixture.files.get(managedWorkspaceEntryPath)).toBe(workspaceEntryContent);
  const repeated = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(repeated.status).toBe('current');
  expect(repeated.changed).toBe(false);
  expect(checkWorkspaceEntry(managedRepositoryPath, fixture.io).status).toBe('current');
  expect(fixture.writes).toEqual([managedWorkspaceEntryPath]);
});

test('existing user-authored or edited generated parent guidance is preserved exactly', () => {
  for (const guidance of ['# Existing user guidance\nKeep my rules.\n', workspaceEntryContent + '\nUser additions.\n', '']) {
    const fixture = memoryIO(guidance);
    for (const entry of [checkWorkspaceEntry(managedRepositoryPath, fixture.io),
      applyWorkspaceEntry(managedRepositoryPath, fixture.io)]) {
      expect(entry.status).toBe('conflict');
      expect(entry.reason).toBe('existing_parent_guidance_preserved');
      expect(entry.ok).toBe(false);
      expect(entry.changed).toBe(false);
    }
    expect(fixture.files.get(managedWorkspaceEntryPath)).toBe(guidance);
    expect(fixture.writes).toEqual([]);
  }
});

test('portable and unrelated parent paths are not applicable with no filesystem access', () => {
  for (const base of ['/tmp/dc-gang-a', '/home/teacher/dc-gang-a', '/workspace',
    '/workspace/another-repo', '/workspace/dc-gang-a/nested', 'C:\\dc-gang-a']) {
    const fixture = memoryIO();
    for (const entry of [applyWorkspaceEntry(base, fixture.io), checkWorkspaceEntry(base, fixture.io)]) {
      expect(entry.status).toBe('not_applicable');
      expect(entry.ok).toBe(true);
      expect(entry.applicable).toBe(false);
      expect(entry.targetPath).toBeNull();
      expect(entry.changed).toBe(false);
    }
    expect(fixture.inspections).toEqual([]);
    expect(fixture.reads).toEqual([]);
    expect(fixture.writes).toEqual([]);
  }
});

test('a canonical path escaping the managed workspace never creates another parent entry', () => {
  for (const escaped of ['/workspace', managedRepositoryPath]) {
    const fixture = memoryIO();
    fixture.io.canonicalPath = path => path === escaped ? '/tmp/unrelated' : path;
    expect(applyWorkspaceEntry(managedRepositoryPath, fixture.io).status).toBe('not_applicable');
    expect(fixture.writes).toEqual([]);
    expect(fixture.reads).toEqual([]);
  }
});

test('parent symlinks and non-file entries are conflicts without reading target contents', () => {
  for (const kind of ['symlink', 'directory', 'other'] as const) {
    const fixture = memoryIO();
    const originalKind = fixture.io.kind;
    fixture.io.kind = path => path === managedWorkspaceEntryPath ? kind : originalKind(path);
    const entry = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
    expect(entry.status).toBe('conflict');
    expect(entry.reason).toBe('parent_entry_not_regular_file');
    expect(fixture.reads).toEqual([]);
    expect(fixture.writes).toEqual([]);
  }
});

test('concurrent parent guidance creation is inspected and preserved without retry overwrite', () => {
  for (const guidance of ['# Concurrent user guidance\n', workspaceEntryContent]) {
    const fixture = memoryIO();
    fixture.io.createExclusive = () => {
      fixture.files.set(managedWorkspaceEntryPath, guidance);
      throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    };
    const entry = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
    expect(entry.status).toBe(guidance === workspaceEntryContent ? 'current' : 'conflict');
    expect(entry.changed).toBe(false);
    expect(fixture.files.get(managedWorkspaceEntryPath)).toBe(guidance);
    expect(fixture.writes).toEqual([]);
  }
});

test('unreadable guidance and failed creation report sanitized conflicts', () => {
  const unreadable = memoryIO('private guidance');
  unreadable.io.readText = () => { throw new Error('sensitive failure detail'); };
  expect(applyWorkspaceEntry(managedRepositoryPath, unreadable.io).reason).toBe('managed_entry_inspection_failed');
  expect(unreadable.writes).toEqual([]);
  const unwriteable = memoryIO();
  unwriteable.io.createExclusive = () => { throw new Error('sensitive failure detail'); };
  expect(applyWorkspaceEntry(managedRepositoryPath, unwriteable.io).reason).toBe('managed_entry_creation_failed');
  expect(unwriteable.files.size).toBe(0);
});

test('bridge routes purpose interviews to preserved sources and supplies the pinned runtime fallback', () => {
  for (const required of [
    '/workspace/dc-gang-a/AGENTS.md', 'bun run workflow:context',
    'docs/CODEX_CONTEXT.md', 'docs/WHOLE_LENS_DECISION.md', 'docs/main-sheet-live-refresh-wiring.json',
    '/workspace/.cloud-tools/bun-1.4.2/node_modules/@oven/bun-linux-x64/bin/bun',
    'before dispatching subagents', 'dated provenance', 'does not establish',
  ]) expect(workspaceEntryContent).toContain(required);
});
