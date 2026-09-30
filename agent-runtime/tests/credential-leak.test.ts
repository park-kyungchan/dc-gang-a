/**
 * credential-leak.test.ts — RUB-07
 * Scans all agent-runtime .json and .ts files for known PII patterns and credential tokens.
 * Asserts ZERO matches for student IDs, session tokens, and academy-specific prefixes.
 *
 * EXCLUDED from scan:
 *   - This test file itself (contains forbidden strings as detection pattern strings, not real PII)
 *   - data/constraints.json (legitimately references token names in security rule descriptions)
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, extname, basename } from 'node:path';

const RUNTIME_ROOT = resolve(import.meta.dir, '..');

/** Files excluded from PII scan — contain pattern strings for legitimate security documentation */
const SCAN_EXCLUDES = new Set([
  resolve(import.meta.dir, 'credential-leak.test.ts'),
  resolve(RUNTIME_ROOT, 'data', 'constraints.json'),
]);

/** Recursively collect .ts and .json files, respecting exclusions */
function collectFiles(dir: string, collected: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (SCAN_EXCLUDES.has(fullPath)) continue;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectFiles(fullPath, collected);
    } else {
      const ext = extname(entry);
      if (ext === '.ts' || ext === '.json') {
        collected.push(fullPath);
      }
    }
  }
  return collected;
}

/** All files including excluded — for structural checks */
function collectAllFiles(dir: string, collected: string[] = []): string[] {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectAllFiles(fullPath, collected);
    } else {
      const ext = extname(entry);
      if (ext === '.ts' || ext === '.json') {
        collected.push(fullPath);
      }
    }
  }
  return collected;
}

/**
 * Forbidden patterns — actual leaked PII/credentials, not legitimate rule documentation.
 * Precise patterns to catch real data values rather than security doc references.
 */
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\b1293032\b/, label: 'student-id-1293032' },
  { pattern: /\b1294174\b/, label: 'student-id-1294174' },
  { pattern: /\b1293067\b/, label: 'student-id-1293067' },
  { pattern: /\b1293138\b/, label: 'student-id-1293138' },
  // Session cookie value assignment (actual value leak, not name in docs)
  { pattern: /JSESSIONID\s*[=:]\s*["'][A-Za-z0-9._-]{10,}/, label: 'JSESSIONID value assignment' },
  // Academy prefix as a raw data value (not a doc mention)
  { pattern: /GA14581_[A-Za-z0-9]/, label: 'GA14581_ academy prefix as data value' },
  { pattern: /password\s*[:=]\s*["'][^"']+["']/i, label: 'hardcoded password' },
  { pattern: /api[_-]?key\s*[:=]\s*["'][^"']{8,}["']/i, label: 'hardcoded API key' },
];

describe('Credential & PII Leak Detection (RUB-07)', () => {
  const scannedFiles = collectFiles(RUNTIME_ROOT);
  const allFiles = collectAllFiles(RUNTIME_ROOT);

  it('No student IDs, session tokens, or PII patterns found in scanned agent-runtime files', () => {
    const violations: string[] = [];

    for (const filePath of scannedFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const relativePath = filePath.replace(RUNTIME_ROOT, 'agent-runtime');

      for (const { pattern, label } of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`[${label}] found in: ${relativePath}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(`Credential/PII leak detected:\n${violations.join('\n')}`);
    }

    expect(violations.length).toBe(0);
  });

  it('No canonical_roster.json import paths in lib/ or types/ source files', () => {
    const violations: string[] = [];
    const sourceFiles = scannedFiles.filter(
      (f) =>
        f.includes(`${RUNTIME_ROOT}\\lib\\`) ||
        f.includes(`${RUNTIME_ROOT}/lib/`) ||
        f.includes(`${RUNTIME_ROOT}\\types\\`) ||
        f.includes(`${RUNTIME_ROOT}/types/`) ||
        basename(f) === 'index.ts'
    );
    for (const filePath of sourceFiles) {
      const content = readFileSync(filePath, 'utf-8');
      const relativePath = filePath.replace(RUNTIME_ROOT, 'agent-runtime');
      if (content.includes('canonical_roster.json')) {
        violations.push(`canonical_roster.json reference found in: ${relativePath}`);
      }
    }

    expect(violations.length).toBe(0);
  });

  it('At least 10 .ts and .json files exist in agent-runtime', () => {
    expect(allFiles.length).toBeGreaterThanOrEqual(10);
  });

  it('Scan exclusion list is exactly 2 files (test file + constraints.json)', () => {
    expect(SCAN_EXCLUDES.size).toBe(2);
  });
});
