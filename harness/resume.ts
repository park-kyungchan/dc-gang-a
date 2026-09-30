#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pilotBrief, validatePilotScope } from './lead';
import { validateCheckpointPair } from './checkpoint';

export interface CurrentState {
  schemaVersion: 1;
  asOf: string;
  activeTask: { id: string; status: 'active' };
  latestCompletedEvidence: {
    path: string;
    completedOn: string;
    status: 'completed';
    type: 'completed_handoff';
  };
  activeSubphase: {
    id: 'development_environment_adversarial_eval';
    phase: 'I1' | 'V1';
    status: 'in_progress' | 'awaiting_session_reload' | 'checkpointed_for_next_session';
    planPath: string;
    prerequisiteEvidencePath: string;
    integrationEvidencePath?: string;
    checkpointPath?: string;
    kickoffPath?: string;
  };
  nextScheduledTask: {
    path: string;
    scheduledFor: string;
    status: 'scheduled_not_started';
  };
  pendingBoundaries: Array<{
    id: string;
    status: string;
    detail: string;
  }>;
  sessionMetadataAudit: { path: string };
  teacherConfirmedNextClassScope: { path: string; date: string; groupIds: string[] };
  operatingCutoverState: { path: string; status: string };
  nextSessionStart: { commands: string[]; readPaths: string[] };
}

export class ResumeIndexError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid_index' | 'unsafe_reference' | 'missing_reference' | 'stale_index',
    readonly reference?: string,
  ) {
    super(message);
    this.name = 'ResumeIndexError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month
    && date.getUTCDate() === day;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ResumeIndexError(`Invalid or missing ${field}.`, 'invalid_index');
  }
  return value;
}

function validateShape(value: unknown): CurrentState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isDate(value.asOf)) {
    throw new ResumeIndexError('Unsupported or malformed resume index.', 'invalid_index');
  }
  const activeTask = value.activeTask;
  const latest = value.latestCompletedEvidence;
  const subphase = value.activeSubphase;
  const next = value.nextScheduledTask;
  const audit = value.sessionMetadataAudit;
  const classScope = value.teacherConfirmedNextClassScope;
  const cutover = value.operatingCutoverState;
  const start = value.nextSessionStart;
  if (!isRecord(activeTask) || activeTask.status !== 'active'
      || !isRecord(latest) || latest.status !== 'completed' || latest.type !== 'completed_handoff'
      || !isDate(latest.completedOn)
      || !isRecord(subphase) || subphase.id !== 'development_environment_adversarial_eval'
      || !((subphase.phase === 'I1' && subphase.status === 'in_progress')
        || (subphase.phase === 'V1' && ['awaiting_session_reload', 'checkpointed_for_next_session'].includes(String(subphase.status))))
      || !isRecord(next) || next.status !== 'scheduled_not_started' || !isDate(next.scheduledFor)
      || !isRecord(audit) || !isRecord(classScope) || !isRecord(cutover) || !isRecord(start)
      || !isDate(classScope.date) || !Array.isArray(classScope.groupIds)
      || !classScope.groupIds.every((entry) => typeof entry === 'string' && entry.length > 0)
      || !Array.isArray(value.pendingBoundaries)
      || !Array.isArray(start.commands) || !Array.isArray(start.readPaths)
      || !start.commands.every((entry) => typeof entry === 'string' && entry.length > 0)
      || !start.readPaths.every((entry) => typeof entry === 'string' && entry.length > 0)) {
    throw new ResumeIndexError('Resume index has invalid required fields.', 'invalid_index');
  }

  requireString(activeTask.id, 'activeTask.id');
  requireString(latest.path, 'latestCompletedEvidence.path');
  requireString(subphase.planPath, 'activeSubphase.planPath');
  requireString(subphase.prerequisiteEvidencePath, 'activeSubphase.prerequisiteEvidencePath');
  if (subphase.phase === 'V1') requireString(subphase.integrationEvidencePath, 'activeSubphase.integrationEvidencePath');
  if (subphase.status === 'checkpointed_for_next_session') {
    requireString(subphase.checkpointPath, 'activeSubphase.checkpointPath');
    requireString(subphase.kickoffPath, 'activeSubphase.kickoffPath');
  }
  requireString(next.path, 'nextScheduledTask.path');
  requireString(audit.path, 'sessionMetadataAudit.path');
  requireString(classScope.path, 'teacherConfirmedNextClassScope.path');
  requireString(cutover.path, 'operatingCutoverState.path');
  requireString(cutover.status, 'operatingCutoverState.status');
  for (const [index, boundary] of value.pendingBoundaries.entries()) {
    if (!isRecord(boundary)) throw new ResumeIndexError(`Invalid pending boundary ${index}.`, 'invalid_index');
    requireString(boundary.id, `pendingBoundaries[${index}].id`);
    requireString(boundary.status, `pendingBoundaries[${index}].status`);
    requireString(boundary.detail, `pendingBoundaries[${index}].detail`);
  }

  return value as unknown as CurrentState;
}

export function referencedPaths(state: CurrentState): string[] {
  return [...new Set([
    state.latestCompletedEvidence.path,
    state.activeSubphase.planPath,
    state.activeSubphase.prerequisiteEvidencePath,
    ...(state.activeSubphase.integrationEvidencePath ? [state.activeSubphase.integrationEvidencePath] : []),
    ...(state.activeSubphase.checkpointPath ? [state.activeSubphase.checkpointPath] : []),
    ...(state.activeSubphase.kickoffPath ? [state.activeSubphase.kickoffPath] : []),
    state.nextScheduledTask.path,
    state.sessionMetadataAudit.path,
    state.teacherConfirmedNextClassScope.path,
    state.operatingCutoverState.path,
    ...state.nextSessionStart.readPaths,
  ])];
}

export function validateCurrentState(
  value: unknown,
  workspaceRoot: string,
  fileExists: (path: string) => boolean = existsSync,
  todayKst: string = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
  readText: (path: string) => string = (path) => readFileSync(path, 'utf8'),
): CurrentState {
  const state = validateShape(value);
  if (!isDate(todayKst) || state.asOf > todayKst
      || state.latestCompletedEvidence.completedOn > state.asOf
      || state.nextScheduledTask.scheduledFor < todayKst) {
    throw new ResumeIndexError('Current-state index is outside its dated validity window.', 'stale_index');
  }
  const root = resolve(workspaceRoot);
  for (const reference of referencedPaths(state)) {
    const normalized = reference.replaceAll('\\', '/');
    const segments = normalized.split('/');
    const target = resolve(root, normalized);
    const rel = relative(root, target);
    if (isAbsolute(normalized) || segments.includes('..') || rel === '..'
        || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ResumeIndexError('Resume index contains an unsafe path reference.', 'unsafe_reference', reference);
    }
    if (!fileExists(target)) {
      throw new ResumeIndexError('Resume index references a missing file.', 'missing_reference', reference);
    }
  }
  const load = (reference: string): Record<string, unknown> => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readText(resolve(root, reference)));
    } catch {
      throw new ResumeIndexError('Resume index points to an unreadable or malformed artifact.', 'invalid_index', reference);
    }
    if (!isRecord(parsed)) {
      throw new ResumeIndexError('Resume index points to a non-object artifact.', 'invalid_index', reference);
    }
    return parsed;
  };
  const handoff = load(state.latestCompletedEvidence.path);
  if (typeof handoff.status !== 'string' || !/(^completed$|_completed(?:_|$))/.test(handoff.status)
      || handoff.activeTaskContinues !== state.activeTask.id
      || !Array.isArray(handoff.verifiedLocalWork) || !isRecord(handoff.validation)) {
    throw new ResumeIndexError('Latest completed evidence is not a completed handoff for the active task.', 'invalid_index', state.latestCompletedEvidence.path);
  }
  const plan = load(state.activeSubphase.planPath);
  const prerequisite = load(state.activeSubphase.prerequisiteEvidencePath);
  const expectedPlanStatus = state.activeSubphase.phase === 'I1'
    ? 'approved_i1_in_progress'
    : state.activeSubphase.status === 'checkpointed_for_next_session'
      ? 'completed_with_deferred_boundaries' : 'v1_session_reload_pending';
  const expectedDependency = state.activeSubphase.phase === 'I1' ? 'E1' : 'I1';
  if (plan.status !== expectedPlanStatus
      || plan.e1Findings !== state.activeSubphase.prerequisiteEvidencePath
      || !Array.isArray(plan.phases)
      || !plan.phases.some((phase) => isRecord(phase) && phase.id === state.activeSubphase.phase
          && Array.isArray(phase.dependsOn) && phase.dependsOn.includes(expectedDependency))
      || prerequisite.phase !== 'E1_consolidated_root_reviewed'
      || !isRecord(prerequisite.readOnlyEvaluations)
      || !Object.values(prerequisite.readOnlyEvaluations).every((result) => result === 'complete')) {
    throw new ResumeIndexError('Active subphase disagrees with the approved plan or prerequisite evidence.', 'invalid_index', state.activeSubphase.planPath);
  }
  if (state.activeSubphase.phase === 'V1') {
    const integrationPath = state.activeSubphase.integrationEvidencePath!;
    const integration = load(integrationPath);
    if (plan.v1Scorecard !== integrationPath
        || integration.phase !== 'V1_local_complete_session_reload_pending'
        || !isRecord(integration.nativeTools)
        || integration.nativeTools.currentSessionCallable !== false) {
      throw new ResumeIndexError('Reload-pending subphase lacks local V1 evidence.', 'invalid_index', integrationPath);
    }
  }
  if (state.activeSubphase.status === 'checkpointed_for_next_session') {
    try {
      const checkpointPath = state.activeSubphase.checkpointPath!;
      const kickoffPath = state.activeSubphase.kickoffPath!;
      const pair = validateCheckpointPair(load(checkpointPath), load(kickoffPath));
      if (plan.exposureCheckpoint !== checkpointPath || plan.nextKickoff !== kickoffPath
          || state.latestCompletedEvidence.path !== checkpointPath
          || state.nextScheduledTask.path !== kickoffPath
          || state.nextScheduledTask.scheduledFor !== pair.kickoff.scheduledFor) {
        throw new Error('checkpoint_index_drift');
      }
    } catch {
      throw new ResumeIndexError('Checkpoint and next-session kickoff disagree with the index.',
        'invalid_index', state.activeSubphase.checkpointPath);
    }
  }
  return state;
}

function parseArgs(args: string[]): { json: boolean; help: boolean } {
  const options = { json: false, help: false };
  for (const arg of args) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new ResumeIndexError(`Unknown option: ${arg}`, 'invalid_index');
  }
  return options;
}

export function runResumeCli(args = process.argv.slice(2)): number {
  let options: { json: boolean; help: boolean };
  try {
    options = parseArgs(args);
  } catch (error) {
    if (error instanceof ResumeIndexError) {
      console.error(JSON.stringify({ ok: false, code: error.code, error: error.message }));
      return 2;
    }
    throw error;
  }
  if (options.help) {
    console.log('Usage: bun run harness/resume.ts [--json]');
    console.log('Validates handoffs/current-state.json and its referenced files, then prints a compact resume summary.');
    return 0;
  }

  const workspaceRoot = resolve(import.meta.dir, '..');
  const indexPath = resolve(workspaceRoot, 'handoffs/current-state.json');
  try {
    const source = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown;
    const state = validateCurrentState(source, workspaceRoot);
    const scope = validatePilotScope(JSON.parse(readFileSync(resolve(workspaceRoot, state.teacherConfirmedNextClassScope.path), 'utf8')) as unknown);
    if (scope.date !== state.teacherConfirmedNextClassScope.date
        || JSON.stringify(scope.teacherConfirmedGroupIds) !== JSON.stringify(state.teacherConfirmedNextClassScope.groupIds)) {
      throw new ResumeIndexError('Teacher-confirmed scope disagrees with the current-state index.', 'invalid_index');
    }
    const summary = {
      ok: true,
      asOf: state.asOf,
      activeTask: state.activeTask,
      latestCompletedEvidence: state.latestCompletedEvidence,
      activeSubphase: state.activeSubphase,
      nextScheduledTask: state.nextScheduledTask,
      pendingBoundaries: state.pendingBoundaries.map(({ id, status }) => ({ id, status })),
      sessionMetadataAudit: state.sessionMetadataAudit,
      teacherConfirmedNextClassScope: state.teacherConfirmedNextClassScope,
      teacherConfirmedFacts: pilotBrief(scope),
      operatingCutoverState: state.operatingCutoverState,
      nextSessionStart: state.nextSessionStart,
    };
    if (options.json) console.log(JSON.stringify(summary));
    else {
      console.log(`As of ${state.asOf}: ${state.activeTask.id} (${state.activeTask.status})`);
      console.log(`Completed: ${state.latestCompletedEvidence.path}`);
      console.log(`Subphase: ${state.activeSubphase.phase} (${state.activeSubphase.status})`);
      console.log(`Scheduled: ${state.nextScheduledTask.scheduledFor} (${state.nextScheduledTask.status})`);
      console.log(`Pending boundaries: ${state.pendingBoundaries.map(({ id, status }) => `${id}=${status}`).join(', ')}`);
      console.log(`Audit: ${state.sessionMetadataAudit.path}`);
      console.log(`Class scope: ${state.teacherConfirmedNextClassScope.path}`);
      console.log(`Operating cutover: ${state.operatingCutoverState.path}`);
      console.log('Start commands:');
      for (const command of state.nextSessionStart.commands) console.log(`  ${command}`);
    }
    return 0;
  } catch (error) {
    if (error instanceof ResumeIndexError) {
      const payload = { ok: false, code: error.code, error: error.message, ...(error.reference ? { reference: error.reference } : {}) };
      console.error(JSON.stringify(payload));
      return 1;
    }
    if (error instanceof SyntaxError) {
      console.error(JSON.stringify({ ok: false, code: 'invalid_index', error: 'Resume index is not valid JSON.' }));
      return 1;
    }
    console.error(JSON.stringify({ ok: false, code: 'invalid_index', error: 'Resume index could not be read.' }));
    return 1;
  }
}

if (import.meta.main) process.exit(runResumeCli());
