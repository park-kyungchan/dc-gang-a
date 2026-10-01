import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkpointFreshness, integrationRoutingSummary, validateWorkflowCheckpoint, workflowContext, workflowSummary } from '../../harness/workflow_checkpoint';

function fixture(): any {
  return {
    schemaVersion: 1, kind: 'user_owned_workflow_checkpoint', observedAtUtc: '2026-10-01T03:39:30Z',
    source: 'reviewed_owner_report', outcome: 'academy_read_to_teacher_reviewed_main_sheet',
    activeStep: { owner: 'gcp_access', action: 'verify_scoped_resource_access' },
    milestones: [
      { id: 'dependency_gate', stage: 'substrate', state: 'reported_verified' },
      { id: 'read_adapter', stage: 'substrate', state: 'reported_verified' },
      { id: 'sign_in', stage: 'live_access', state: 'reported_verified' },
      { id: 'project_identity', stage: 'live_access', state: 'reported_verified' },
      { id: 'resource_scope', stage: 'live_access', state: 'unknown' },
      { id: 'sheet_preview', stage: 'user_outcome', state: 'not_started' },
    ],
    contextMetrics: { status: 'unavailable', usedTokens: null, maximumTokens: null },
    permissions: { grantsAccess: false, grantsProductionWrites: false, changesManagedRuntime: false },
  };
}

describe('user-owned workflow checkpoint', () => {
  test('current project snapshot follows the contract', () => {
    const value = JSON.parse(readFileSync(resolve(import.meta.dir, '../../handoffs/workflow-current-state.json'), 'utf8'));
    expect(validateWorkflowCheckpoint(value).kind).toBe('user_owned_workflow_checkpoint');
  });
  test('validates sanitized metadata without promoting an owner report', () => {
    const checkpoint = validateWorkflowCheckpoint(fixture());
    const summary = workflowSummary(checkpoint, new Date('2026-10-01T04:00:00Z'));
    expect(summary.evidenceCounts.find(row => row.stage === 'live_access')).toEqual({
      stage: 'live_access', verified: 0, reportedVerified: 2, incomplete: 1,
    });
    expect(summary.authorizesProductionEffects).toBe(false);
    expect(summary.establishesCurrentResourceAccess).toBe(false);
    expect(summary.executesNextStep).toBe(false);
  });
  test('does not equate passing substrate with user outcome', () => {
    const value = fixture();
    for (const milestone of value.milestones) if (milestone.stage === 'substrate') milestone.state = 'verified';
    const summary = workflowSummary(validateWorkflowCheckpoint(value));
    expect(summary.evidenceCounts.find(row => row.stage === 'substrate')?.verified).toBe(2);
    expect(summary.evidenceCounts.find(row => row.stage === 'user_outcome')?.verified).toBe(0);
  });
  test('rejects guessed context metrics', () => {
    const value = fixture(); value.contextMetrics.usedTokens = 100;
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.contextMetrics.usedTokens = null; value.contextMetrics.maximumTokens = 128000;
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });
  test('rejects credential fields, commands, and permission grants', () => {
    for (const field of ['accessToken', 'authorizationCode', 'commands']) {
      const value = fixture(); value[field] = 'synthetic-forbidden-field';
      expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    }
    const value = fixture(); value.permissions.grantsProductionWrites = true;
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });
  test('rejects arbitrary next actions and unknown owners', () => {
    const value = fixture(); value.activeStep.action = 'execute_arbitrary_shell';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.activeStep.action = 'verify_scoped_resource_access'; value.activeStep.owner = 'unknown';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });
  test('rejects duplicate milestones and extra nested fields', () => {
    const value = fixture(); value.milestones.push({ ...value.milestones[0] });
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.milestones.pop(); value.activeStep.processHandle = 123;
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });
  test('labels stale and future snapshots without inventing current authority', () => {
    const checkpoint = validateWorkflowCheckpoint(fixture());
    expect(checkpointFreshness(checkpoint, new Date('2026-10-01T04:00:00Z'))).toBe('same_utc_day_revalidate_at_transition');
    expect(checkpointFreshness(checkpoint, new Date('2026-10-02T04:00:00Z'))).toBe('historical_revalidate_before_continuing');
    expect(checkpointFreshness(checkpoint, new Date('2026-10-01T03:00:00Z'))).toBe('future_dated');
  });
  test('rejects malformed timestamps without echoing raw input', () => {
    const value = fixture(); value.observedAtUtc = '2026-02-30T03:39:30Z';
    expect(() => validateWorkflowCheckpoint(value)).toThrow(/^invalid_workflow_checkpoint$/);
  });
  test('verified receipt source requires a sanitized bounded evidence reference', () => {
    const value = fixture(); value.source = 'verified_sanitized_receipt';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.evidenceReferences = [{ fileName: 'example-receipt.jsonl', location: 'workspace_parent',
      sha256: 'a'.repeat(64), kind: 'sanitized_live_metadata_receipt' }];
    expect(validateWorkflowCheckpoint(value).source).toBe('verified_sanitized_receipt');
    value.evidenceReferences[0].fileName = '../private.json';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });
  test('registry points to one checkpoint and one operational baseline', () => {
    const value = JSON.parse(readFileSync(resolve(import.meta.dir, '../../docs/workflow-integration-registry.json'), 'utf8'));
    const summary = integrationRoutingSummary(value);
    expect(summary.operationalProjectId).toBe('ganga-daechi-260927-p0723');
    expect(summary.secondaryProjectRole).toBe('unresolved');
    expect(summary.physicalCloudChangesAuthorized).toBe(false);
    value.projects[1].role = 'operational_baseline';
    expect(() => integrationRoutingSummary(value)).toThrow('invalid_integration_registry');
  });
  test('registry rejects alternate state pointers and physical change grants', () => {
    const value = JSON.parse(readFileSync(resolve(import.meta.dir, '../../docs/workflow-integration-registry.json'), 'utf8'));
    value.canonicalCheckpoint = '../outside.json';
    expect(() => integrationRoutingSummary(value)).toThrow('invalid_integration_registry');
    value.canonicalCheckpoint = 'handoffs/workflow-current-state.json'; value.projects[0].physicalChangeAuthorized = true;
    expect(() => integrationRoutingSummary(value)).toThrow('invalid_integration_registry');
  });
});

function engineeringFixture(): any {
  return {
    schemaVersion: 1, updatedAtUtc: '2026-10-01T04:00:00Z', objective: 'Improve the confirmed development loop.',
    priorityOrder: ['development_test_feedback', 'continuity_lead_governance', 'google_api_integration'],
    ambiguityPolicy: 'interview_before_dependent_implementation',
    modelPreference: { preferredFamilies: ['gpt-6.1', 'gpt-6'], selection: 'inherit_host_supported', activeModel: null, activeContextCapacity: null },
    confirmedDecisions: [{ id: 'confirmed_scope', statement: 'Use focused synthetic checks.', source: 'user_interview' }],
    assumptions: [],
    pendingInterview: [{ id: 'google_scope', question: 'Which exact Google resource and operation should be used?', dependentWork: 'google_api_operation', state: 'awaiting_answer' }],
    dispatch: [{ id: 'lead_assignment', owner: 'lead', mode: 'edit', ownedPaths: ['harness/workflow_checkpoint.ts'],
      objective: 'Maintain the workflow context.', validationRefs: ['tests/harness/workflowCheckpoint.test.ts'], outputContract: 'changed_paths_and_validation_evidence' }],
    nextSteps: [
      { id: 'validate_confirmed_scope', owner: 'lead', action: 'validate_confirmed_changes', referencePaths: ['tests/harness/workflowCheckpoint.test.ts'], dependsOnQuestionIds: [] },
      { id: 'plan_google_scope', owner: 'lead', action: 'plan_google_api_scope', referencePaths: ['docs/workflow-integration-registry.json'], dependsOnQuestionIds: ['google_scope'] },
    ],
    runtimeBoundary: { nativeHooks: 'not_installed', automaticPerTurnInjection: 'not_installed_by_project', dispatchExecution: 'host_tools_only', executesNextStep: false, changesManagedRuntime: false },
  };
}

function withEngineering(): any {
  return { ...fixture(), engineeringContext: engineeringFixture() };
}

describe('Lead continuity context', () => {
  test('accepts changed unique priority orders without rewriting historical decisions', () => {
    const value = withEngineering();
    value.engineeringContext.priorityOrder = ['continuity_lead_governance', 'development_test_feedback', 'google_api_integration'];
    const before = structuredClone(value.engineeringContext.confirmedDecisions);
    const context = workflowContext(validateWorkflowCheckpoint(value));
    expect(context.engineeringContext?.priorityOrder).toEqual(value.engineeringContext.priorityOrder);
    expect(context.engineeringContext?.confirmedDecisions).toEqual(before);
    for (const order of [
      ['continuity_lead_governance', 'continuity_lead_governance', 'google_api_integration'],
      ['development_test_feedback', 'google_api_integration'],
      ['development_test_feedback', 'continuity_lead_governance', 'invented_priority'],
    ]) {
      value.engineeringContext.priorityOrder = order;
      expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    }
  });

  test('retains up to 24 decisions and explicit historical source references without dropping evidence', () => {
    const value = withEngineering();
    for (let index = 1; index < 24; index++) value.engineeringContext.confirmedDecisions.push({
      id: 'decision_' + index, statement: 'Synthetic confirmed decision ' + index + '.', source: 'user_interview',
    });
    value.engineeringContext.historicalDecisionReferences = ['docs/CODEX_CONTEXT.md'];
    const context = workflowContext(validateWorkflowCheckpoint(value));
    expect(context.engineeringContext?.confirmedDecisions).toHaveLength(24);
    expect(context.engineeringContext?.historicalDecisionReferences).toEqual(['docs/CODEX_CONTEXT.md']);
    value.engineeringContext.confirmedDecisions.push({ id: 'decision_overflow', statement: 'Synthetic overflow.', source: 'user_interview' });
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.confirmedDecisions.pop();
    value.engineeringContext.historicalDecisionReferences = ['../untrusted.json'];
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('preserves backward compatibility and dated operational evidence', () => {
    const base = fixture();
    expect(workflowContext(validateWorkflowCheckpoint(base)).engineeringContextPresent).toBe(false);
    const extended = validateWorkflowCheckpoint({ ...base, engineeringContext: engineeringFixture() });
    const { engineeringContext: _, ...operational } = extended;
    expect(operational).toEqual(base);
  });

  test('keeps pending interview dependencies blocked while independent validation proceeds', () => {
    const output = workflowContext(validateWorkflowCheckpoint(withEngineering()), new Date('2026-10-01T05:00:00Z'));
    expect(output.nextEngineeringSteps.map(step => step.status)).toEqual(['ready_for_confirmed_scope', 'awaiting_interview']);
    expect(output.unresolvedAssumptionsAuthorizeImplementation).toBe(false);
    expect(output.executesNextStep).toBe(false);
    expect(output.authorizesProductionEffects).toBe(false);
    expect(output.nativeHooksInstalled).toBe(false);
    expect(output.automaticPerTurnInjectionInstalled).toBe(false);
    expect(output.contextMetrics).toEqual({ status: 'unavailable', usedTokens: null, maximumTokens: null });
  });

  test('an explicit recorded answer resolves the same dependency without reasking', () => {
    const value = withEngineering();
    value.engineeringContext.pendingInterview = [];
    value.engineeringContext.confirmedDecisions.push({ id: 'google_scope', statement: 'Use the named development resource.', source: 'user_interview' });
    const output = workflowContext(validateWorkflowCheckpoint(value));
    expect(output.nextEngineeringSteps[1]?.status).toBe('ready_for_confirmed_scope');
    expect(output.engineeringContext?.pendingInterview).toEqual([]);
  });

  test('rejects a confirmed answer remaining pending or an assumption substituted for an answer', () => {
    const value = withEngineering();
    value.engineeringContext.confirmedDecisions.push({ id: 'google_scope', statement: 'Already answered.', source: 'user_interview' });
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.confirmedDecisions.pop();
    value.engineeringContext.pendingInterview = [];
    value.engineeringContext.assumptions.push({ id: 'google_scope', statement: 'An unresolved guess.', needsInterview: true });
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('requires unresolved assumptions to retain interview status', () => {
    const value = withEngineering();
    value.engineeringContext.assumptions.push({ id: 'unresolved_assumption', statement: 'An unresolved guess.', needsInterview: false });
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('rejects conflicting editor ownership including directories and case aliases', () => {
    for (const ownedPaths of [['harness'], ['harness/workflow_checkpoint.ts'], ['HARNESS/WORKFLOW_CHECKPOINT.TS']]) {
      const value = withEngineering();
      value.engineeringContext.dispatch.push({ ...value.engineeringContext.dispatch[0], id: 'other_assignment', owner: 'other_subagent', ownedPaths });
      expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    }
  });

  test('allows bounded overlapping read-only review and disjoint editors', () => {
    const value = withEngineering();
    value.engineeringContext.dispatch.push({ ...value.engineeringContext.dispatch[0], id: 'review_assignment', owner: 'review_subagent', mode: 'read_only', ownedPaths: ['harness'] });
    value.engineeringContext.dispatch.push({ ...value.engineeringContext.dispatch[0], id: 'other_assignment', owner: 'other_subagent', ownedPaths: ['docs/workflow-routing.json'] });
    expect(validateWorkflowCheckpoint(value).engineeringContext?.dispatch).toHaveLength(3);
  });

  test('rejects escaping and ambiguous paths in ownership, validation, and next-step references', () => {
    for (const path of ['../outside.ts', '/tmp/outside.ts', 'C:/outside.ts', 'harness\\outside.ts', 'harness/../outside.ts', 'harness//file.ts', 'harness/./file.ts']) {
      for (const field of ['ownedPaths', 'validationRefs', 'referencePaths']) {
        const value = withEngineering();
        const target = field === 'referencePaths' ? value.engineeringContext.nextSteps[0] : value.engineeringContext.dispatch[0];
        target[field] = [path];
        expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
      }
    }
  });

  test('rejects undeclared owners and unknown interview dependencies', () => {
    const value = withEngineering();
    value.engineeringContext.nextSteps[0].owner = 'undeclared_subagent';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.nextSteps[0].owner = 'lead';
    value.engineeringContext.nextSteps[1].dependsOnQuestionIds = ['unasked_or_missing_question'];
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.nextSteps[1].dependsOnQuestionIds = [];
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('rejects fabricated native hooks, automatic execution and model capacity', () => {
    for (const [field, fabricated] of [['nativeHooks', 'installed'], ['automaticPerTurnInjection', 'installed'], ['executesNextStep', true], ['changesManagedRuntime', true]] as const) {
      const value = withEngineering(); value.engineeringContext.runtimeBoundary[field] = fabricated;
      expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    }
    for (const [field, fabricated] of [['activeModel', 'gpt-6.1'], ['activeContextCapacity', 1050000]] as const) {
      const value = withEngineering(); value.engineeringContext.modelPreference[field] = fabricated;
      expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    }
  });

  test('records requested compaction settings without converting them into active capacity', () => {
    const value = withEngineering();
    value.engineeringContext.modelPreference.configurationRequest = { contextWindow: 1050000, autoCompactionRatio: 0.75, autoCompactTokenLimit: 787500, application: 'unverified_by_project_metadata' };
    const output = workflowContext(validateWorkflowCheckpoint(value));
    expect(output.engineeringContext?.modelPreference.activeContextCapacity).toBeNull();
    expect(output.contextMetrics.maximumTokens).toBeNull();
    value.engineeringContext.modelPreference.configurationRequest.autoCompactTokenLimit = 872000;
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.modelPreference.configurationRequest.autoCompactTokenLimit = 787500;
    value.engineeringContext.modelPreference.configurationRequest.application = 'repo_file_verified_effective_runtime_unverified';
    expect(workflowContext(validateWorkflowCheckpoint(value)).engineeringContext?.modelPreference.activeContextCapacity).toBeNull();
    value.engineeringContext.modelPreference.configurationRequest.application = 'active';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('rejects oversized, extra-field and credential-shaped context without printing values', () => {
    const value = withEngineering();
    value.engineeringContext.objective = 'x'.repeat(641);
    expect(() => validateWorkflowCheckpoint(value)).toThrow(/^invalid_workflow_checkpoint$/);
    value.engineeringContext.objective = 'Synthetic development scope.';
    value.engineeringContext.confirmedDecisions[0].statement = 'ghp_' + 'x'.repeat(25);
    expect(() => validateWorkflowCheckpoint(value)).toThrow(/^invalid_workflow_checkpoint$/);
    value.engineeringContext.confirmedDecisions[0].statement = 'Use focused checks.';
    value.engineeringContext.accessToken = 'synthetic_forbidden_field';
    expect(() => validateWorkflowCheckpoint(value)).toThrow(/^invalid_workflow_checkpoint$/);
  });

  test('checks engineering chronology separately from preserved operational chronology', () => {
    const value = withEngineering();
    expect(workflowContext(validateWorkflowCheckpoint(value), new Date('2026-10-01T03:50:00Z')).engineeringFreshness).toBe('future_dated');
    value.engineeringContext.updatedAtUtc = '2026-02-30T03:39:30Z';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('keeps unavailable runtime networking as a blocker and rejects cancelled local-host work', () => {
    const value = withEngineering();
    value.engineeringContext.blockedActions = [{ id: 'cloud_runtime_documentation', action: 'research_cloud_runtime',
      prerequisite: 'runtime_network_update', reason: 'Official documentation egress remains unavailable.', state: 'blocked' }];
    expect(workflowContext(validateWorkflowCheckpoint(value)).engineeringContext?.blockedActions?.[0]?.state).toBe('blocked');
    value.engineeringContext.blockedActions[0].state = 'approved';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
    value.engineeringContext.blockedActions[0].state = 'blocked';
    value.engineeringContext.blockedActions[0].action = 'verify_windows_global_configuration';
    value.engineeringContext.blockedActions[0].prerequisite = 'connected_windows_host';
    expect(() => validateWorkflowCheckpoint(value)).toThrow('invalid_workflow_checkpoint');
  });

  test('briefing consumers cannot mutate the checkpoint engineering context', () => {
    const value = validateWorkflowCheckpoint(withEngineering());
    const output = workflowContext(value);
    output.engineeringContext!.confirmedDecisions[0]!.statement = 'Consumer edit.';
    expect(value.engineeringContext!.confirmedDecisions[0]!.statement).toBe('Use focused synthetic checks.');
  });

  test('actual context CLI reads its fixed checkpoint from another working directory and leaves it unchanged', () => {
    const root = resolve(import.meta.dir, '../..');
    const path = resolve(root, 'handoffs/workflow-current-state.json');
    const before = readFileSync(path, 'utf8');
    const result = Bun.spawnSync({ cmd: [process.execPath, resolve(root, 'harness/workflow_checkpoint.ts'), 'context'], cwd: '/tmp', stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(new TextDecoder().decode(result.stdout));
    expect(output.canonicalCheckpoint).toBe('handoffs/workflow-current-state.json');
    expect(output.engineeringContextPresent).toBe(true);
    expect(output.engineeringContext.modelPreference.activeModel).toBeNull();
    expect(output.executesNextStep).toBe(false);
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
