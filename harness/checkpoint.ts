#!/usr/bin/env bun
/** Typed, bounded checkpoint contract for Codex session handoff. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface NativeDevToolsExposure {
  callableToolCount: number;
  listPagesCallSucceeded: true;
  pageDetailsEmitted: false;
  teacherAuthentication: 'unverified';
  studentReadPerformed: false;
}

export interface SessionCheckpoint {
  schemaVersion: 1;
  kind: 'development_environment_checkpoint';
  status: 'development_environment_eval_completed_with_deferred_boundaries';
  observedAtUtc: string;
  activeTaskContinues: string;
  sourceScorecard: string;
  resolvedCriterionIds: string[];
  nextKickoffPath: string;
  verifiedLocalWork: string[];
  validation: { nativeDevTools: NativeDevToolsExposure; bunFocused: string; productionWrites: 0 };
  deferredBoundaries: string[];
}

export interface NextSessionKickoff {
  schemaVersion: 1;
  kind: 'next_session_kickoff';
  status: 'ready_for_next_session';
  scheduledFor: string;
  activeTask: string;
  checkpointPath: string;
  firstCommands: string[];
  priorities: Array<{ id: string; action: string; evidenceBoundary: string }>;
  stopRules: string[];
}

export class CheckpointContractError extends Error {
  constructor(message: string) { super(message); this.name = 'CheckpointContractError'; }
}

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every(nonempty);
const date = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export function validateCheckpoint(value: unknown): SessionCheckpoint {
  if (!record(value) || value.schemaVersion !== 1
      || value.kind !== 'development_environment_checkpoint'
      || value.status !== 'development_environment_eval_completed_with_deferred_boundaries'
      || !nonempty(value.observedAtUtc)
      || !nonempty(value.activeTaskContinues)
      || !nonempty(value.sourceScorecard)
      || !Array.isArray(value.resolvedCriterionIds)
      || !value.resolvedCriterionIds.includes('MCP-01')
      || !value.resolvedCriterionIds.every(nonempty)
      || !nonempty(value.nextKickoffPath)
      || !strings(value.verifiedLocalWork)
      || !Array.isArray(value.deferredBoundaries)
      || !value.deferredBoundaries.every(nonempty)
      || !record(value.validation)) throw new CheckpointContractError('invalid_checkpoint_shape');
  const validation = value.validation;
  const devtools = validation.nativeDevTools;
  if (!record(devtools) || !Number.isSafeInteger(devtools.callableToolCount)
      || (devtools.callableToolCount as number) < 1
      || devtools.listPagesCallSucceeded !== true
      || devtools.pageDetailsEmitted !== false
      || devtools.teacherAuthentication !== 'unverified'
      || devtools.studentReadPerformed !== false
      || !nonempty(validation.bunFocused)
      || validation.productionWrites !== 0) {
    throw new CheckpointContractError('unverified_native_exposure_or_effect');
  }
  return value as unknown as SessionCheckpoint;
}

export function validateKickoff(value: unknown): NextSessionKickoff {
  if (!record(value) || value.schemaVersion !== 1 || value.kind !== 'next_session_kickoff'
      || value.status !== 'ready_for_next_session' || !date(value.scheduledFor)
      || !nonempty(value.activeTask) || !nonempty(value.checkpointPath)
      || !strings(value.firstCommands) || !strings(value.stopRules)
      || !Array.isArray(value.priorities) || value.priorities.length === 0) {
    throw new CheckpointContractError('invalid_kickoff_shape');
  }
  const ids = new Set<string>();
  for (const priority of value.priorities) {
    if (!record(priority) || !nonempty(priority.id) || ids.has(priority.id)
        || !nonempty(priority.action) || !nonempty(priority.evidenceBoundary)) {
      throw new CheckpointContractError('invalid_kickoff_priority');
    }
    ids.add(priority.id);
  }
  return value as unknown as NextSessionKickoff;
}

export function validateCheckpointPair(checkpointRaw: unknown, kickoffRaw: unknown) {
  const checkpoint = validateCheckpoint(checkpointRaw);
  const kickoff = validateKickoff(kickoffRaw);
  if (checkpoint.nextKickoffPath !== 'handoffs/2026-09-29-next-session-kickoff.json'
      || kickoff.checkpointPath !== 'handoffs/2026-09-29-native-devtools-exposure-checkpoint.json'
      || kickoff.activeTask !== checkpoint.activeTaskContinues) {
    throw new CheckpointContractError('checkpoint_kickoff_mismatch');
  }
  return { checkpoint, kickoff };
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..');
  try {
    const checkpoint = JSON.parse(readFileSync(resolve(root,
      'handoffs/2026-09-29-native-devtools-exposure-checkpoint.json'), 'utf8')) as unknown;
    const kickoff = JSON.parse(readFileSync(resolve(root,
      'handoffs/2026-09-29-next-session-kickoff.json'), 'utf8')) as unknown;
    const pair = validateCheckpointPair(checkpoint, kickoff);
    console.log(JSON.stringify({ ok: true, status: pair.checkpoint.status,
      callableToolCount: pair.checkpoint.validation.nativeDevTools.callableToolCount,
      kickoff: pair.kickoff.status, scheduledFor: pair.kickoff.scheduledFor }));
  } catch (error) {
    console.error(JSON.stringify({ ok: false,
      reason: error instanceof CheckpointContractError ? error.message : 'checkpoint_unreadable' }));
    process.exitCode = 1;
  }
}

