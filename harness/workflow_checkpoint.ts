#!/usr/bin/env bun
/** User-owned workflow metadata only. Never a managed-runtime control surface. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { backendDependencyDoctor } from './backend_dependencies';
import { scanPublicationText } from './tools/prepush_audit';

export const workflowActions = [
  'verify_scoped_resource_access', 'request_metadata_token_approval', 'await_metadata_token_approval', 'read_current_sheet_metadata',
  'reconcile_metadata_read_evidence', 'review_native_preservation_gaps',
  'verify_current_academy_scope', 'read_verified_academy_source',
  'prepare_source_backed_sheet_preview', 'request_exact_batch_approval',
  'apply_approved_batch_and_read_back', 'report_verified_result',
] as const;
export type WorkflowAction = typeof workflowActions[number];
type Stage = 'substrate' | 'live_access' | 'user_outcome';
type EvidenceState = 'verified' | 'reported_verified' | 'in_progress' | 'awaiting_approval' | 'unknown' | 'not_started';
export interface EngineeringContext {
  schemaVersion: 1;
  updatedAtUtc: string;
  objective: string;
  priorityOrder: ['development_test_feedback', 'continuity_lead_governance', 'google_api_integration'];
  ambiguityPolicy: 'interview_before_dependent_implementation';
  modelPreference: { preferredFamilies: ['gpt-6.1', 'gpt-6']; selection: 'inherit_host_supported'; activeModel: null; activeContextCapacity: null;
    configurationRequest?: { contextWindow: number; autoCompactionRatio: number; autoCompactTokenLimit: number;
      application: 'unverified_by_project_metadata' | 'repo_file_verified_effective_runtime_unverified' } };
  confirmedDecisions: Array<{ id: string; statement: string; source: 'current_user_request' | 'user_interview' }>;
  assumptions: Array<{ id: string; statement: string; needsInterview: true }>;
  pendingInterview: Array<{ id: string; question: string; dependentWork: string; state: 'not_asked' | 'awaiting_answer' }>;
  dispatch: Array<{ id: string; owner: string; mode: 'read_only' | 'edit'; ownedPaths: string[];
    objective: string; validationRefs: string[]; outputContract: 'changed_paths_and_validation_evidence' }>;
  nextSteps: Array<{ id: string; owner: string; action: 'validate_confirmed_changes' | 'resolve_continuation_source' | 'plan_google_api_scope';
    referencePaths: string[]; dependsOnQuestionIds: string[] }>;
  blockedActions?: Array<{ id: string; action: 'research_cloud_runtime';
    prerequisite: 'runtime_network_update'; reason: string; state: 'blocked' }>;
  runtimeBoundary: { nativeHooks: 'not_installed'; automaticPerTurnInjection: 'not_installed_by_project';
    dispatchExecution: 'host_tools_only'; executesNextStep: false; changesManagedRuntime: false };
}
export interface WorkflowCheckpoint {
  schemaVersion: 1;
  kind: 'user_owned_workflow_checkpoint';
  observedAtUtc: string;
  source: 'reviewed_owner_report' | 'verified_sanitized_receipt';
  outcome: 'academy_read_to_teacher_reviewed_main_sheet';
  activeStep: { owner: 'lead' | 'gcp_access' | 'backend_tooling' | 'workflow_review'; action: WorkflowAction };
  milestones: Array<{ id: string; stage: Stage; state: EvidenceState }>;
  contextMetrics: { status: 'unavailable'; usedTokens: null; maximumTokens: null };
  permissions: { grantsAccess: false; grantsProductionWrites: false; changesManagedRuntime: false };
  evidenceReferences?: Array<{ fileName: string; location: 'workspace_parent' | 'project_docs'; sha256: string;
    kind: 'sanitized_live_metadata_receipt' | 'derived_preservation_preview' }>;
  engineeringContext?: EngineeringContext;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().replace('.000Z', 'Z') === value;
}
function fail(): never { throw new Error('invalid_workflow_checkpoint'); }
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value);
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 640
    && !/[\u0000-\u001f]/.test(value) && scanPublicationText('handoffs/workflow-current-state.json', value).length === 0;
}
/** Metadata paths only: never open a path or execute referenced instructions. */
function projectReference(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 180
    && value.split('/').every(segment => /^[A-Za-z0-9_.-]+$/.test(segment) && !['.', '..'].includes(segment));
}
function references(value: unknown, min = 1): value is string[] {
  return Array.isArray(value) && value.length >= min && value.length <= 12 && value.every(projectReference)
    && new Set(value.map(path => path.toLowerCase())).size === value.length;
}
function validateEngineeringContext(value: unknown): EngineeringContext {
  const keys = ['schemaVersion', 'updatedAtUtc', 'objective', 'priorityOrder', 'ambiguityPolicy',
    'modelPreference', 'confirmedDecisions', 'assumptions', 'pendingInterview', 'dispatch', 'nextSteps', 'runtimeBoundary'];
  if (object(value) && Object.hasOwn(value, 'blockedActions')) keys.push('blockedActions');
  if (!object(value) || !exactKeys(value, keys)
    || value.schemaVersion !== 1 || !timestamp(value.updatedAtUtc) || !text(value.objective)
    || JSON.stringify(value.priorityOrder) !== JSON.stringify(['development_test_feedback', 'continuity_lead_governance', 'google_api_integration'])
    || value.ambiguityPolicy !== 'interview_before_dependent_implementation') fail();
  const model = value.modelPreference, runtime = value.runtimeBoundary;
  const modelKeys = ['preferredFamilies', 'selection', 'activeModel', 'activeContextCapacity'];
  if (object(model) && Object.hasOwn(model, 'configurationRequest')) modelKeys.push('configurationRequest');
  if (!object(model) || !exactKeys(model, modelKeys)
    || JSON.stringify(model.preferredFamilies) !== JSON.stringify(['gpt-6.1', 'gpt-6']) || model.selection !== 'inherit_host_supported'
    || model.activeModel !== null || model.activeContextCapacity !== null
    || !object(runtime) || !exactKeys(runtime, ['nativeHooks', 'automaticPerTurnInjection', 'dispatchExecution', 'executesNextStep', 'changesManagedRuntime'])
    || runtime.nativeHooks !== 'not_installed' || runtime.automaticPerTurnInjection !== 'not_installed_by_project'
    || runtime.dispatchExecution !== 'host_tools_only' || runtime.executesNextStep !== false || runtime.changesManagedRuntime !== false) fail();
  if (Object.hasOwn(model, 'configurationRequest')) {
    const request = model.configurationRequest;
    if (!object(request) || !exactKeys(request, ['contextWindow', 'autoCompactionRatio', 'autoCompactTokenLimit', 'application'])
      || typeof request.contextWindow !== 'number' || !Number.isSafeInteger(request.contextWindow) || request.contextWindow < 1
      || typeof request.autoCompactionRatio !== 'number' || !Number.isFinite(request.autoCompactionRatio)
      || request.autoCompactionRatio <= 0 || request.autoCompactionRatio >= 1
      || request.autoCompactTokenLimit !== Math.floor(request.contextWindow * request.autoCompactionRatio)
      || !['unverified_by_project_metadata', 'repo_file_verified_effective_runtime_unverified'].includes(String(request.application))) fail();
  }
  const ids = new Set<string>();
  const records = (items: unknown, keys: string[], max: number) => {
    if (!Array.isArray(items) || items.length > max) fail();
    for (const item of items) {
      if (!object(item) || !exactKeys(item, keys) || !identifier(item.id) || ids.has(item.id)) fail();
      ids.add(item.id);
    }
    return items as Record<string, unknown>[];
  };
  const facts = records(value.confirmedDecisions, ['id', 'statement', 'source'], 12);
  for (const fact of facts) {
    if (!text(fact.statement) || !['current_user_request', 'user_interview'].includes(String(fact.source))) fail();
  }
  for (const assumption of records(value.assumptions, ['id', 'statement', 'needsInterview'], 6)) {
    if (!text(assumption.statement) || assumption.needsInterview !== true) fail();
  }
  const questions = records(value.pendingInterview, ['id', 'question', 'dependentWork', 'state'], 6);
  for (const question of questions) if (!text(question.question) || !identifier(question.dependentWork)
    || !['not_asked', 'awaiting_answer'].includes(String(question.state))) fail();
  const assignments = records(value.dispatch, ['id', 'owner', 'mode', 'ownedPaths', 'objective', 'validationRefs', 'outputContract'], 7);
  const owners = new Set<string>(['lead']);
  const editPaths: string[] = [];
  for (const assignment of assignments) {
    if (!identifier(assignment.owner) || !['read_only', 'edit'].includes(String(assignment.mode)) || !references(assignment.ownedPaths)
      || !text(assignment.objective) || !references(assignment.validationRefs)
      || assignment.outputContract !== 'changed_paths_and_validation_evidence') fail();
    owners.add(assignment.owner);
    if (assignment.mode === 'edit') for (const path of assignment.ownedPaths) {
      const normalized = path.toLowerCase();
      if (editPaths.some(other => normalized === other || normalized.startsWith(other + '/') || other.startsWith(normalized + '/'))) fail();
      editPaths.push(normalized);
    }
  }
  // An interview dependency may resolve to a recorded answer; unanswered choices remain pending.
  const interviewIds = new Set([...questions.map(question => question.id), ...facts.filter(fact => fact.source === 'user_interview').map(fact => fact.id)]);
  const steps = records(value.nextSteps, ['id', 'owner', 'action', 'referencePaths', 'dependsOnQuestionIds'], 6);
  for (const step of steps) {
    if (!identifier(step.owner) || !owners.has(step.owner) || !['validate_confirmed_changes', 'resolve_continuation_source', 'plan_google_api_scope'].includes(String(step.action))
      || !references(step.referencePaths) || !Array.isArray(step.dependsOnQuestionIds) || step.dependsOnQuestionIds.length > 6
      || new Set(step.dependsOnQuestionIds).size !== step.dependsOnQuestionIds.length
      || !step.dependsOnQuestionIds.every(id => identifier(id) && interviewIds.has(id))) fail();
    if (step.action !== 'validate_confirmed_changes' && step.dependsOnQuestionIds.length === 0) fail();
  }
  if (Object.hasOwn(value, 'blockedActions')) {
    for (const action of records(value.blockedActions, ['id', 'action', 'prerequisite', 'reason', 'state'], 4)) {
      if (!text(action.reason) || action.state !== 'blocked'
        || action.action !== 'research_cloud_runtime' || action.prerequisite !== 'runtime_network_update') fail();
    }
  }
  return value as unknown as EngineeringContext;
}
export function validateWorkflowCheckpoint(value: unknown): WorkflowCheckpoint {
  if (!object(value)) fail();
  const keys = ['schemaVersion', 'kind', 'observedAtUtc', 'source', 'outcome', 'activeStep', 'milestones', 'contextMetrics', 'permissions'];
  if (Object.hasOwn(value, 'evidenceReferences')) keys.push('evidenceReferences');
  if (Object.hasOwn(value, 'engineeringContext')) keys.push('engineeringContext');
  if (!exactKeys(value, keys) || value.schemaVersion !== 1
    || value.kind !== 'user_owned_workflow_checkpoint' || !timestamp(value.observedAtUtc)
    || !['reviewed_owner_report', 'verified_sanitized_receipt'].includes(String(value.source))
    || value.outcome !== 'academy_read_to_teacher_reviewed_main_sheet') fail();
  const step = value.activeStep;
  if (!object(step) || !exactKeys(step, ['owner', 'action'])
    || !['lead', 'gcp_access', 'backend_tooling', 'workflow_review'].includes(String(step.owner))
    || !workflowActions.includes(step.action as WorkflowAction)) fail();
  if (!Array.isArray(value.milestones) || value.milestones.length < 1 || value.milestones.length > 20) fail();
  const ids = new Set<string>();
  for (const milestone of value.milestones) {
    if (!object(milestone) || !exactKeys(milestone, ['id', 'stage', 'state'])
      || typeof milestone.id !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(milestone.id)
      || ids.has(milestone.id) || !['substrate', 'live_access', 'user_outcome'].includes(String(milestone.stage))
      || !['verified', 'reported_verified', 'in_progress', 'awaiting_approval', 'unknown', 'not_started'].includes(String(milestone.state))) fail();
    ids.add(milestone.id);
  }
  const context = value.contextMetrics;
  if (!object(context) || !exactKeys(context, ['status', 'usedTokens', 'maximumTokens'])
    || context.status !== 'unavailable' || context.usedTokens !== null || context.maximumTokens !== null) fail();
  const permissions = value.permissions;
  if (!object(permissions) || !exactKeys(permissions, ['grantsAccess', 'grantsProductionWrites', 'changesManagedRuntime'])
    || permissions.grantsAccess !== false || permissions.grantsProductionWrites !== false
    || permissions.changesManagedRuntime !== false) fail();
  if (Object.hasOwn(value, 'evidenceReferences')) {
    if (!Array.isArray(value.evidenceReferences) || value.evidenceReferences.length > 10) fail();
    for (const reference of value.evidenceReferences) {
      if (!object(reference) || !exactKeys(reference, ['fileName', 'location', 'sha256', 'kind'])
        || typeof reference.fileName !== 'string' || !/^[a-z][a-z0-9_.-]{1,120}\.jsonl?$/.test(reference.fileName)
        || reference.fileName.includes('..') || typeof reference.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256)
        || !['workspace_parent', 'project_docs'].includes(String(reference.location))
        || !['sanitized_live_metadata_receipt', 'derived_preservation_preview'].includes(String(reference.kind))) fail();
    }
  }
  if (value.source === 'verified_sanitized_receipt' && (!Array.isArray(value.evidenceReferences)
    || !value.evidenceReferences.some((reference: any) => reference.kind === 'sanitized_live_metadata_receipt'))) fail();
  if (Object.hasOwn(value, 'engineeringContext')) validateEngineeringContext(value.engineeringContext);
  return value as unknown as WorkflowCheckpoint;
}

/** This is chronology information, never automatic approval or student/date authority. */
export function checkpointFreshness(checkpoint: WorkflowCheckpoint, now: Date) {
  const observed = new Date(checkpoint.observedAtUtc).getTime();
  if (!Number.isFinite(now.getTime()) || observed > now.getTime()) return 'future_dated' as const;
  return checkpoint.observedAtUtc.slice(0, 10) === now.toISOString().slice(0, 10)
    ? 'same_utc_day_revalidate_at_transition' as const : 'historical_revalidate_before_continuing' as const;
}

function historicalPointerDates(base: string) {
  return ['handoffs/current-state.json', 'handoffs/cloud-current-state.json'].map(path => {
    try {
      // Read the declared date only. Never follow commands, nested paths, or prior-session stores.
      const value: unknown = JSON.parse(readFileSync(resolve(base, path), 'utf8'));
      return { path, asOf: object(value) && typeof value.asOf === 'string'
        && /^\d{4}-\d{2}-\d{2}$/.test(value.asOf) ? value.asOf : null };
    } catch { return { path, asOf: null }; }
  });
}

export function integrationRoutingSummary(value: unknown) {
  if (!object(value) || value.schemaVersion !== 1 || value.canonicalCheckpoint !== 'handoffs/workflow-current-state.json'
    || !Array.isArray(value.projects) || value.projects.length !== 2) throw new Error('invalid_integration_registry');
  const operational = value.projects.filter(project => object(project) && project.role === 'operational_baseline');
  const unresolved = value.projects.filter(project => object(project) && project.role === 'role_unresolved_preserve');
  if (operational.length !== 1 || unresolved.length !== 1) throw new Error('invalid_integration_registry');
  for (const project of value.projects) {
    if (!object(project) || typeof project.projectId !== 'string' || !/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project.projectId)
      || project.state !== 'ACTIVE' || project.physicalChangeAuthorized !== false) throw new Error('invalid_integration_registry');
  }
  if (operational[0].projectId === unresolved[0].projectId) throw new Error('invalid_integration_registry');
  return { canonicalCheckpoint: value.canonicalCheckpoint, operationalProjectId: operational[0].projectId as string,
    secondaryProjectId: unresolved[0].projectId as string, secondaryProjectRole: 'unresolved',
    explicitPerActionProjectRequired: true, physicalCloudChangesAuthorized: false };
}

export function workflowSummary(checkpoint: WorkflowCheckpoint, now = new Date()) {
  return {
    schemaVersion: 1, metadataValid: true, observedAtUtc: checkpoint.observedAtUtc,
    freshness: checkpointFreshness(checkpoint, now),
    currentStep: checkpoint.activeStep,
    evidenceCounts: ['substrate', 'live_access', 'user_outcome'].map(stage => ({ stage,
      verified: checkpoint.milestones.filter(m => m.stage === stage && m.state === 'verified').length,
      reportedVerified: checkpoint.milestones.filter(m => m.stage === stage && m.state === 'reported_verified').length,
      incomplete: checkpoint.milestones.filter(m => m.stage === stage && !['verified', 'reported_verified'].includes(m.state)).length,
    })),
    contextMetrics: checkpoint.contextMetrics,
    evidenceReferences: checkpoint.evidenceReferences ?? [],
    deploymentStatus: checkpoint.milestones.some(m => m.id === 'main_sheet_deployment' && m.state === 'not_started')
      ? 'not_deployed' : 'not_established_by_this_summary',
    executesNextStep: false,
    establishesCurrentResourceAccess: false,
    authorizesProductionEffects: false,
  };
}

/** A Lead briefing, not automatic prompt injection, agent dispatch or an approval. */
export function workflowContext(checkpoint: WorkflowCheckpoint, now = new Date()) {
  const validated = validateWorkflowCheckpoint(checkpoint);
  const engineering = validated.engineeringContext ? structuredClone(validated.engineeringContext) : null;
  const pending = new Set(engineering?.pendingInterview.map(question => question.id));
  return {
    ...workflowSummary(validated, now), canonicalCheckpoint: 'handoffs/workflow-current-state.json',
    engineeringContextPresent: engineering !== null, engineeringContext: engineering,
    engineeringFreshness: engineering ? checkpointFreshness({ ...validated, observedAtUtc: engineering.updatedAtUtc }, now) : null,
    nextEngineeringSteps: engineering?.nextSteps.map(step => ({ ...step,
      status: step.dependsOnQuestionIds.some(id => pending.has(id)) ? 'awaiting_interview' : 'ready_for_confirmed_scope' })) ?? [],
    unresolvedAssumptionsAuthorizeImplementation: false,
    nativeHooksInstalled: false, automaticPerTurnInjectionInstalled: false,
    executesNextStep: false, authorizesProductionEffects: false,
  };
}

if (import.meta.main) {
  try {
    const command = process.argv[2] ?? 'status';
    if (process.argv.length > 3 || !['status', 'doctor', 'context'].includes(command)) throw new Error('invalid_command');
    const base = resolve(import.meta.dir, '..');
    const checkpoint = validateWorkflowCheckpoint(JSON.parse(readFileSync(resolve(base, 'handoffs/workflow-current-state.json'), 'utf8')));
    const summary = workflowSummary(checkpoint);
    if (command === 'context') {
      const context = workflowContext(checkpoint);
      console.log(JSON.stringify(context, null, 2));
      process.exitCode = context.freshness === 'future_dated' || context.engineeringFreshness === 'future_dated' ? 1 : 0;
    } else if (command === 'status') {
      console.log(JSON.stringify(summary, null, 2));
      process.exitCode = summary.freshness === 'future_dated' ? 1 : 0;
    } else {
      const dependencies = backendDependencyDoctor(base);
      const integrations = integrationRoutingSummary(JSON.parse(readFileSync(resolve(base, 'docs/workflow-integration-registry.json'), 'utf8')));
      console.log(JSON.stringify({ ...summary, dependencies, integrations, historicalPointers: historicalPointerDates(base),
        fileManager: { thunarExecutablePresent: Bun.which('thunar') !== null, managedRuntimeControl: false },
        checks: ['fixed_project_metadata', 'existing_dependency_doctor', 'file_manager_executable_presence'],
        liveApiRequests: 0, configurationChanges: 0 }, null, 2));
      process.exitCode = dependencies.ok && summary.freshness !== 'future_dated' ? 0 : 1;
    }
  } catch {
    // Do not echo malformed source content or exception bodies into logs.
    console.error(JSON.stringify({ metadataValid: false, reason: 'workflow_check_failed',
      acceptedCommands: ['status', 'doctor', 'context'], rawContentEmitted: false }));
    process.exitCode = 1;
  }
}
