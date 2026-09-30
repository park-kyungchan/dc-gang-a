/**
 * Path resolver for the agent-runtime module.
 * Exact replication of resolveModuleDir() pattern from canonicalEntities.ts.
 * Anchors ALL paths to import.meta.dir (Bun) or dirname(fileURLToPath(import.meta.url)) (Node ESM).
 * NEVER uses process.cwd().
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

/**
 * Robust cross-runtime directory resolution.
 * Anchors paths to the physical file location, immune to process.cwd() drift.
 */
function resolveModuleDir(): string {
  // Bun: import.meta.dir is the directory of the current module
  if (typeof import.meta !== 'undefined' && 'dir' in import.meta && typeof import.meta.dir === 'string') {
    return import.meta.dir;
  }
  // Node ESM: derive from import.meta.url
  if (typeof import.meta !== 'undefined' && import.meta.url) {
    return dirname(fileURLToPath(import.meta.url));
  }
  // CommonJS fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof (globalThis as any).__dirname !== 'undefined') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).__dirname as string;
  }
  throw new Error('Cannot resolve module directory: no import.meta.dir, import.meta.url, or __dirname available');
}

/**
 * Returns the absolute path to the agent-runtime root directory.
 * This is the directory containing index.ts, types/, data/, lib/, tests/.
 */
export function resolveAgentRuntimeDir(): string {
  // lib/ is one level below agent-runtime root
  const runtimeRoot = resolve(resolveModuleDir(), '..');
  if (!existsSync(runtimeRoot)) {
    throw new Error(`agent-runtime root directory not found at: '${runtimeRoot}'`);
  }
  return runtimeRoot;
}

/**
 * Returns the absolute path to a data file within agent-runtime/data/.
 */
export function resolveDataFile(filename: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename) ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./i.test(filename)) {
    throw new Error('[agent-runtime] Invalid data filename');
  }
  return resolve(resolveAgentRuntimeDir(), 'data', filename);
}
