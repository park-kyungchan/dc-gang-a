/**
 * hooks.test.ts — RUB-11
 * Verifies agent-agnostic hook definitions: semantic event types, no Antigravity key names.
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOKS_PATH = resolve(import.meta.dir, '../data/hooks.json');

interface HooksFile {
  hooks: Array<{
    id: string;
    eventType: string;
    triggerPattern: string;
    handlerCommand: string;
    timeoutMs: number;
    enabled: boolean;
    description: string;
  }>;
}

function loadHooks(): HooksFile {
  return JSON.parse(readFileSync(HOOKS_PATH, 'utf-8')) as HooksFile;
}

describe('Hooks (RUB-11)', () => {
  it('Exactly 3 hooks are defined', () => {
    const data = loadHooks();
    expect(data.hooks.length).toBe(3);
  });

  it('All hooks have valid HookEventType values', () => {
    const validTypes = new Set(['pre-mutate', 'post-execute', 'session-stop']);
    const data = loadHooks();
    for (const hook of data.hooks) {
      expect(validTypes.has(hook.eventType)).toBe(true);
    }
  });

  it('pre-mutate hook exists', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'pre-mutate');
    expect(hook).toBeDefined();
  });

  it('post-execute hook exists', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'post-execute');
    expect(hook).toBeDefined();
  });

  it('session-stop hook exists', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'session-stop');
    expect(hook).toBeDefined();
  });

  it('NO Antigravity-specific key "PreToolUse" anywhere in hooks.json', () => {
    const rawContent = readFileSync(HOOKS_PATH, 'utf-8');
    expect(rawContent).not.toContain('PreToolUse');
  });

  it('NO Antigravity-specific key "PostToolUse" anywhere in hooks.json', () => {
    const rawContent = readFileSync(HOOKS_PATH, 'utf-8');
    expect(rawContent).not.toContain('PostToolUse');
  });

  it('NO Antigravity-specific key "Stop" as a standalone key in hooks.json', () => {
    const rawContent = readFileSync(HOOKS_PATH, 'utf-8');
    // Only check for the exact Antigravity Stop key pattern (not substring matches in descriptions)
    expect(rawContent).not.toContain('"Stop"');
  });

  it('pre-mutate hook triggerPattern covers write_to_file', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'pre-mutate');
    expect(hook!.triggerPattern).toContain('write_to_file');
  });

  it('pre-mutate hook triggerPattern covers replace_file_content', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'pre-mutate');
    expect(hook!.triggerPattern).toContain('replace_file_content');
  });

  it('All hooks have timeoutMs > 0', () => {
    const data = loadHooks();
    for (const hook of data.hooks) {
      expect(hook.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('All hooks have enabled field as boolean', () => {
    const data = loadHooks();
    for (const hook of data.hooks) {
      expect(typeof hook.enabled).toBe('boolean');
    }
  });

  it('All hooks have non-empty id', () => {
    const data = loadHooks();
    for (const hook of data.hooks) {
      expect(hook.id.length).toBeGreaterThan(0);
    }
  });

  it('All hooks have non-empty description', () => {
    const data = loadHooks();
    for (const hook of data.hooks) {
      expect(hook.description.length).toBeGreaterThan(0);
    }
  });

  it('session-stop hook triggerPattern is wildcard *', () => {
    const data = loadHooks();
    const hook = data.hooks.find((h) => h.eventType === 'session-stop');
    expect(hook!.triggerPattern).toBe('*');
  });
});
