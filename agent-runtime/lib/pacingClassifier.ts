/**
 * Pacing tier classifier for the agent-runtime layer.
 * classifyTier() returns a historical Antigravity descriptor for comparison.
 * It does not impose approval, mutation limits, or agent dispatch in Codex.
 *
 * Logic (from source rules):
 *   fileCount >= 3 OR isSchemaMutation OR isExternalApiChange OR isArchitectureChange → Tier 3
 *   fileCount == 2 → Tier 2
 *   fileCount == 1 → Tier 1
 */

import { readFileSync } from 'node:fs';
import type { PacingTierDescriptor, TokenBudget } from '../types/pacing.ts';
import { deepFreeze } from './deepFreeze.ts';
import { resolveDataFile } from './pathResolver.ts';

interface PacingData {
  tiers: PacingTierDescriptor[];
  tokenBudget: TokenBudget;
}

function loadPacingData(): PacingData {
  const filePath = resolveDataFile('pacing.json');
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as PacingData;
}

let _cachedData: PacingData | null = null;

function getPacingData(): PacingData {
  if (!_cachedData) {
    _cachedData = deepFreeze(loadPacingData());
  }
  return _cachedData;
}

export interface ClassifyTierParams {
  fileCount: number;
  isSchemaMutation: boolean; // *.prisma, *.sql, migration files
  isExternalApiChange: boolean; // auth/API changes
  isArchitectureChange: boolean; // 3+ core files
}

/**
 * Classifies the task into a PacingTier based on the parameters.
 * Fail-closed: always returns a tier, never returns null/undefined.
 */
export function classifyTier(params: ClassifyTierParams): PacingTierDescriptor {
  const { fileCount, isSchemaMutation, isExternalApiChange, isArchitectureChange } = params;
  if (!Number.isSafeInteger(fileCount) || fileCount < 0) {
    throw new RangeError('[agent-runtime] fileCount must be a non-negative safe integer');
  }
  const data = getPacingData();

  let tierNum: 1 | 2 | 3;

  if (
    fileCount >= 3 ||
    isSchemaMutation ||
    isExternalApiChange ||
    isArchitectureChange
  ) {
    tierNum = 3;
  } else if (fileCount === 2) {
    tierNum = 2;
  } else {
    tierNum = 1;
  }

  const descriptor = data.tiers.find((t) => t.tier === tierNum);
  if (!descriptor) {
    throw new Error(`[agent-runtime] classifyTier: No tier descriptor found for tier ${tierNum}`);
  }
  return descriptor;
}

/** Historical pacing data; callers must not treat it as active Codex policy. */
export function getPacingTiers(): readonly PacingTierDescriptor[] {
  return getPacingData().tiers;
}

/** Historical Antigravity budget, not a Codex execution limit. */
export function getTokenBudget(): TokenBudget {
  return getPacingData().tokenBudget;
}
