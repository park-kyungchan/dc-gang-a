#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const REQUIRED_THEME_IDS = [
  'SESSION_CONTINUITY',
  'BACKWARD_PROPAGATION',
  'NATIVE_DEVTOOLS',
  'VERIFIED_READ_PATH',
  'BUN_TYPESCRIPT',
  'SETTLED_TEACHER_FACTS',
  'ADVERSARIAL_EVAL_SEQUENCE',
] as const;

export interface FeedbackTheme {
  id: string;
  promptPattern: string;
  sourceRefs: string[];
  rootCause: string;
  fixRefs: string[];
  canary: string;
  status: 'implemented_local' | 'partially_verified' | 'in_progress' | 'blocked';
}

export interface FeedbackRegistry {
  schemaVersion: 1;
  asOf: string;
  method: string;
  themes: FeedbackTheme[];
}

export interface FeedbackCoverage {
  ok: boolean;
  requiredCount: number;
  presentCount: number;
  missingThemeIds: string[];
  invalidThemeIds: string[];
  statusByTheme: Record<string, FeedbackTheme['status']>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateFeedbackCoverage(
  input: unknown,
  workspaceRoot: string,
  fileExists: (path: string) => boolean = existsSync,
): FeedbackCoverage {
  const registryValid = isRecord(input) && input.schemaVersion === 1
    && nonempty(input.asOf) && nonempty(input.method);
  const themes = registryValid && Array.isArray(input.themes)
    ? input.themes : [];
  const root = resolve(workspaceRoot);
  const safeRef = (ref: unknown): ref is string => {
    if (!nonempty(ref) || isAbsolute(ref)) return false;
    const normalized = ref.replaceAll('\\', '/');
    if (normalized.split('/').includes('..')) return false;
    const target = resolve(root, normalized);
    const rel = relative(root, target);
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && fileExists(target);
  };
  const seen = new Set<string>();
  const valid = new Map<string, FeedbackTheme>();
  const invalidThemeIds: string[] = [];
  for (const value of themes) {
    const id = isRecord(value) && nonempty(value.id) ? value.id : '<unnamed>';
    const refs = isRecord(value) ? [value.sourceRefs, value.fixRefs] : [];
    const validRefs = refs.length === 2 && refs.every((items) => Array.isArray(items)
      && items.length > 0 && items.every(safeRef));
    if (!isRecord(value) || seen.has(id) || !nonempty(value.promptPattern)
        || !nonempty(value.rootCause) || !nonempty(value.canary)
        || !['implemented_local', 'partially_verified', 'in_progress', 'blocked'].includes(String(value.status))
        || !validRefs) {
      invalidThemeIds.push(id);
    } else {
      valid.set(id, value as unknown as FeedbackTheme);
    }
    seen.add(id);
  }
  const missingThemeIds = REQUIRED_THEME_IDS.filter((id) => !valid.has(id));
  return {
    ok: registryValid && themes.length > 0 && missingThemeIds.length === 0 && invalidThemeIds.length === 0,
    requiredCount: REQUIRED_THEME_IDS.length,
    presentCount: valid.size,
    missingThemeIds,
    invalidThemeIds,
    statusByTheme: Object.fromEntries([...valid].map(([id, theme]) => [id, theme.status])),
  };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
    console.error('Usage: bun run harness/feedback_coverage.ts [--json]');
    process.exit(2);
  }
  let result: FeedbackCoverage;
  try {
    const registry = JSON.parse(readFileSync(resolve(root, '.agents/feedback-themes.json'), 'utf8')) as unknown;
    result = validateFeedbackCoverage(registry, root);
  } catch {
    result = { ok: false, requiredCount: REQUIRED_THEME_IDS.length, presentCount: 0,
      missingThemeIds: [...REQUIRED_THEME_IDS], invalidThemeIds: [], statusByTheme: {} };
  }
  console.log(args.includes('--json') ? JSON.stringify(result) :
    `Feedback themes: ${result.presentCount}/${result.requiredCount}; missing=${result.missingThemeIds.join(',') || 'none'}; invalid=${result.invalidThemeIds.join(',') || 'none'}`);
  process.exit(result.ok ? 0 : 1);
}
