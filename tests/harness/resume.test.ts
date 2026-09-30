import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ResumeIndexError, validateCurrentState } from '../../harness/resume';

const workspaceRoot = resolve(import.meta.dir, '../..');
const index = JSON.parse(readFileSync(resolve(workspaceRoot, 'handoffs/current-state.json'), 'utf8')) as unknown;

describe('resume index', () => {
  test('accepts the current index when every referenced path exists', () => {
    const state = validateCurrentState(index, workspaceRoot);
    expect(state.activeTask.id).toBe('academy_read_path_completion_and_class_pilot_preparation');
    expect(state.activeSubphase.phase).toBe('V1');
    expect(state.activeSubphase.status).toBe('checkpointed_for_next_session');
    expect(state.activeSubphase.kickoffPath).toBe('handoffs/2026-09-29-next-session-kickoff.json');
    expect(state.nextScheduledTask.status).toBe('scheduled_not_started');
    expect(state.asOf).toBe('2026-09-29');
    expect(state.teacherConfirmedNextClassScope.groupIds).toEqual(['4', '5']);
    expect(state.operatingCutoverState.path).toBe('handoffs/2026-09-29-operating-cutover-resume.json');
  });

  test('fails closed when a referenced file is missing', () => {
    const fakeExists = (path: string) => !path.endsWith('2026-09-30-class-pilot-kickoff.md');
    try {
      validateCurrentState(index, workspaceRoot, fakeExists);
      throw new Error('expected missing reference to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ResumeIndexError);
      expect((error as ResumeIndexError).code).toBe('missing_reference');
      expect((error as ResumeIndexError).reference).toBe('handoffs/2026-09-30-class-pilot-kickoff.md');
    }
  });

  test('rejects marking the future pilot complete', () => {
    const altered = structuredClone(index) as {
      nextScheduledTask: { status: string };
    };
    altered.nextScheduledTask.status = 'completed';
    expect(() => validateCurrentState(altered, workspaceRoot)).toThrow(ResumeIndexError);
  });

  test('rejects references that escape the workspace', () => {
    const altered = structuredClone(index) as {
      latestCompletedEvidence: { path: string };
    };
    altered.latestCompletedEvidence.path = '../outside.md';
    expect(() => validateCurrentState(altered, workspaceRoot)).toThrow(ResumeIndexError);
  });

  test('fails closed after the next scheduled task date passes without a new index', () => {
    expect(() => validateCurrentState(index, workspaceRoot, () => true, '2026-10-01'))
      .toThrowError(new ResumeIndexError('Current-state index is outside its dated validity window.', 'stale_index'));
  });

  test('rejects impossible calendar dates even when their format looks like ISO', () => {
    for (const date of ['2026-02-31', '2026-04-31', '2026-13-01']) {
      const altered = structuredClone(index) as { asOf: string };
      altered.asOf = date;
      expect(() => validateCurrentState(altered, workspaceRoot, () => true, '2026-09-29'))
        .toThrowError(new ResumeIndexError('Unsupported or malformed resume index.', 'invalid_index'));
    }
  });

  test('rejects an in-progress plan posing as completed evidence', () => {
    const altered = structuredClone(index) as { latestCompletedEvidence: { path: string } };
    altered.latestCompletedEvidence.path = 'handoffs/2026-09-29-development-environment-adversarial-eval-plan.json';
    expect(() => validateCurrentState(altered, workspaceRoot, () => true, '2026-09-29'))
      .toThrowError(new ResumeIndexError(
        'Latest completed evidence is not a completed handoff for the active task.',
        'invalid_index', altered.latestCompletedEvidence.path));
  });

  test('rejects subphase drift from the approved plan and consolidated prerequisite', () => {
    const altered = structuredClone(index) as { activeSubphase: {
      phase: string; status: string; prerequisiteEvidencePath: string; integrationEvidencePath: string;
    } };
    altered.activeSubphase.phase = 'I1';
    altered.activeSubphase.status = 'in_progress';
    expect(() => validateCurrentState(altered, workspaceRoot, () => true, '2026-09-29'))
      .toThrow(ResumeIndexError);
    altered.activeSubphase.phase = 'V1';
    altered.activeSubphase.status = 'awaiting_session_reload';
    altered.activeSubphase.prerequisiteEvidencePath = 'handoffs/2026-09-29-meta-and-read-audit-resume.json';
    expect(() => validateCurrentState(altered, workspaceRoot, () => true, '2026-09-29'))
      .toThrow(ResumeIndexError);
    altered.activeSubphase.prerequisiteEvidencePath = 'review/development-environment-e1-findings-2026-09-29.json';
    altered.activeSubphase.integrationEvidencePath = 'handoffs/2026-09-29-meta-and-read-audit-resume.json';
    expect(() => validateCurrentState(altered, workspaceRoot, () => true, '2026-09-29'))
      .toThrow(ResumeIndexError);
  });

  test('rejects a checkpoint that claims exposure without a successful native tool call', () => {
    const readText = (path: string) => {
      const raw = readFileSync(path, 'utf8');
      if (!path.endsWith('native-devtools-exposure-checkpoint.json')) return raw;
      const checkpoint = JSON.parse(raw) as { validation: { nativeDevTools: { listPagesCallSucceeded: boolean } } };
      checkpoint.validation.nativeDevTools.listPagesCallSucceeded = false;
      return JSON.stringify(checkpoint);
    };
    expect(() => validateCurrentState(index, workspaceRoot, undefined, '2026-09-29', readText))
      .toThrow(ResumeIndexError);
  });
});
