import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { REQUIRED_THEME_IDS, validateFeedbackCoverage } from '../../harness/feedback_coverage';

const root = resolve(import.meta.dir, '../..');
const registry = JSON.parse(readFileSync(resolve(root, '.agents/feedback-themes.json'), 'utf8')) as {
  themes: Array<{ id: string; sourceRefs: string[]; fixRefs: string[] }>;
};

describe('feedback theme coverage', () => {
  test('covers required repeated prompt themes with bounded references', () => {
    const result = validateFeedbackCoverage(registry, root);
    expect(result.ok).toBe(true);
    expect(result.presentCount).toBe(REQUIRED_THEME_IDS.length);
  });

  test('detects omission of any required theme', () => {
    for (const id of REQUIRED_THEME_IDS) {
      const altered = structuredClone(registry);
      altered.themes = altered.themes.filter((theme) => theme.id !== id);
      const result = validateFeedbackCoverage(altered, root);
      expect(result.ok).toBe(false);
      expect(result.missingThemeIds).toContain(id);
    }
  });

  test('rejects a missing or escaping evidence reference', () => {
    const altered = structuredClone(registry);
    altered.themes[0]!.sourceRefs = ['../private/session.txt'];
    const result = validateFeedbackCoverage(altered, root);
    expect(result.ok).toBe(false);
    expect(result.invalidThemeIds).toContain(altered.themes[0]!.id);
  });
});
