import { afterEach, expect, test } from 'bun:test';
import { linkSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
  applyWorkspaceEntry, checkWorkspaceEntry, managedRepositoryPath, managedWorkspaceEntryPath,
  legacyWorkspaceEntryContent, replaceWorkspaceEntryIfUnchanged, workspaceEntryContent, type WorkspaceEntryIO,
} from '../../harness/workspace_entry';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

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
    replaceIfUnchanged(path, expected, content) {
      if (files.get(path) !== expected) return false;
      writes.push(path);
      files.set(path, content);
      return true;
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

test('read-only check identifies an exact legacy bridge and apply migrates it once', () => {
  const fixture = memoryIO(legacyWorkspaceEntryContent);
  const checked = checkWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(checked.status).toBe('outdated');
  expect(checked.reason).toBe('generated_parent_entry_outdated');
  expect(checked.ok).toBe(false);
  expect(checked.changed).toBe(false);
  expect(fixture.writes).toEqual([]);
  const updated = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(updated.status).toBe('updated');
  expect(updated.ok).toBe(true);
  expect(updated.changed).toBe(true);
  expect(updated.effectivePromptLoaded).toBe('unverified');
  expect(updated.hooksInstalled).toBe(false);
  expect(updated.automaticPerTurnInjectionInstalled).toBe(false);
  expect(fixture.files.get(managedWorkspaceEntryPath)).toBe(workspaceEntryContent);
  expect(checkWorkspaceEntry(managedRepositoryPath, fixture.io).status).toBe('current');
  expect(applyWorkspaceEntry(managedRepositoryPath, fixture.io).changed).toBe(false);
  expect(fixture.writes).toEqual([managedWorkspaceEntryPath]);
});

test('existing user-authored or edited generated parent guidance is preserved exactly', () => {
  for (const guidance of ['# Existing user guidance\nKeep my rules.\n', workspaceEntryContent + '\nUser additions.\n',
    legacyWorkspaceEntryContent + '\nUser additions.\n', legacyWorkspaceEntryContent.replace('Bun 1.4.2', 'Bun 1.4.3'), '']) {
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

test('a legacy bridge changed before replacement is preserved without retry overwrite', () => {
  const fixture = memoryIO(legacyWorkspaceEntryContent);
  const originalReplace = fixture.io.replaceIfUnchanged;
  fixture.io.replaceIfUnchanged = (path, expected, content) => {
    expect(expected).toBe(legacyWorkspaceEntryContent);
    fixture.files.set(path, '# Concurrent user guidance\n');
    return originalReplace(path, expected, content);
  };
  const entry = applyWorkspaceEntry(managedRepositoryPath, fixture.io);
  expect(entry.status).toBe('conflict');
  expect(entry.reason).toBe('managed_entry_update_conflict');
  expect(entry.changed).toBe(false);
  expect(fixture.files.get(managedWorkspaceEntryPath)).toBe('# Concurrent user guidance\n');
  expect(fixture.writes).toEqual([]);
});

test('legacy migration requires successful current-content readback and sanitizes write failures', () => {
  const unreadback = memoryIO(legacyWorkspaceEntryContent);
  unreadback.io.replaceIfUnchanged = () => true;
  const failed = applyWorkspaceEntry(managedRepositoryPath, unreadback.io);
  expect(failed.status).toBe('conflict');
  expect(failed.reason).toBe('managed_entry_readback_failed');
  expect(failed.ok).toBe(false);
  const unwriteable = memoryIO(legacyWorkspaceEntryContent);
  unwriteable.io.replaceIfUnchanged = () => { throw new Error('sensitive failure detail'); };
  expect(applyWorkspaceEntry(managedRepositoryPath, unwriteable.io).reason).toBe('managed_entry_update_failed');
  expect(unwriteable.files.get(managedWorkspaceEntryPath)).toBe(legacyWorkspaceEntryContent);
  expect(unwriteable.writes).toEqual([]);
});

test('disk replacement checks exact bytes and preserves symlinks and hard-linked guidance', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'dc-gang-a-workspace-entry-'));
  roots.push(root);
  const target = resolve(root, 'AGENTS.md');
  writeFileSync(target, legacyWorkspaceEntryContent);
  expect(replaceWorkspaceEntryIfUnchanged(target, legacyWorkspaceEntryContent, workspaceEntryContent)).toBe(true);
  expect(readFileSync(target, 'utf8')).toBe(workspaceEntryContent);
  writeFileSync(target, legacyWorkspaceEntryContent + '\nUser additions.\n');
  expect(replaceWorkspaceEntryIfUnchanged(target, legacyWorkspaceEntryContent, workspaceEntryContent)).toBe(false);
  expect(readFileSync(target, 'utf8')).toBe(legacyWorkspaceEntryContent + '\nUser additions.\n');
  writeFileSync(target, legacyWorkspaceEntryContent);
  const symlink = resolve(root, 'symlink.md');
  symlinkSync(target, symlink);
  expect(replaceWorkspaceEntryIfUnchanged(symlink, legacyWorkspaceEntryContent, workspaceEntryContent)).toBe(false);
  const hardlink = resolve(root, 'hardlink.md');
  linkSync(target, hardlink);
  expect(replaceWorkspaceEntryIfUnchanged(target, legacyWorkspaceEntryContent, workspaceEntryContent)).toBe(false);
  expect(readFileSync(hardlink, 'utf8')).toBe(legacyWorkspaceEntryContent);
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
