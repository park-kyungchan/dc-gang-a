export interface HermesBackendProfileContract {
  schemaVersion: 1;
  kind: 'repo_profile_contract';
  profile: string;
  repository: string;
  role: 'development_and_operations_lead';
  execution: 'connected_linux_backend';
  client: 'windows_desktop_remote_only';
  continuation: string;
  ontologyOwnership: { common: string; product: 'repository'; automaticCrossProfileSync: false };
  runtime: { bun: string; typescript: string; hermesModelDefault: string; provider: string; reasoning: 'xhigh'; effectiveContextCapacity: null };
  autonomousGit: readonly string[];
  recurringOperations: { mode: 'initial_approved_envelope'; requiredBounds: readonly string[]; activeEnvelopes: readonly never[]; teacherReserved: readonly string[] };
  nativeProse: readonly string[];
  skillSelection: { enabled: readonly string[]; autoLoad: readonly never[]; importPolicy: string };
  pluginSelection: { required: readonly never[]; optional: readonly string[]; excluded: readonly string[] };
  priorities: readonly string[];
  activation: { gatewayStart: false; jobsInstalled: false; workersDispatched: false; accountChanges: false };
  recovery: readonly string[];
}

/** User-approved responsibility and proposed selection; not a native state mirror or permission engine. */
export const hermesBackendProfile = {
  schemaVersion: 1,
  kind: 'repo_profile_contract',
  profile: 'dc-gang-a-dev',
  repository: 'park-kyungchan/dc-gang-a',
  role: 'development_and_operations_lead',
  execution: 'connected_linux_backend',
  client: 'windows_desktop_remote_only',
  continuation: 'handoffs/workflow-current-state.json',
  ontologyOwnership: {
    common: '/opt/data/shared-llm-wiki/concepts/ontology-aip-evals-sdlc-agent-start.md',
    product: 'repository',
    automaticCrossProfileSync: false,
  },
  runtime: { bun: '1.4.2', typescript: '7.0.2', hermesModelDefault: 'gpt-6.1-sol', provider: 'openai-codex', reasoning: 'xhigh', effectiveContextCapacity: null },
  autonomousGit: ['branch', 'worktree', 'commit', 'push', 'pull_request', 'review', 'exact_head_ci', 'merge', 'merge_readback', 'owned_merged_branch_worktree_cleanup'],
  recurringOperations: {
    mode: 'initial_approved_envelope',
    requiredBounds: ['target', 'fields', 'change_rules', 'recovery', 'same_target_readback'],
    activeEnvelopes: [],
    teacherReserved: ['teacher_judgment', 'official_record_finalization', 'final_parent_send'],
  },
  nativeProse: ['SOUL.md', 'memories/USER.md', 'memories/MEMORY.md', 'repo/AGENTS.md', 'selected SKILL.md and references'],
  skillSelection: {
    enabled: ['hermes-agent', 'ontology-start', 'ontology-harness-engineering', 'plan', 'test-driven-development', 'systematic-debugging', 'requesting-code-review', 'github', 'github-auth', 'github-pr-workflow', 'github-code-review', 'github-repo-management', 'cross-session-change-handoff', 'hermes-agent-skill-authoring', 'google-workspace', 'grounded-citations', 'llm-wiki', 'artifact-preview-delivery', 'docx', 'pdf', 'xlsx', 'document-to-action-items', 'dogfood', 'inspecting-hermes-desktop-dom', 'node-inspect-debugger', 'simplify-code', 'spike', 'blocked-page-recovery'],
    autoLoad: [],
    importPolicy: 'Native writers for absent user Skills; retain upstream bundled Skills. Independent copies with source identities, no mutable cross-profile symlinks. Common Wiki has one owner.',
  },
  pluginSelection: {
    required: [],
    optional: ['security-guidance'],
    excluded: ['automatic_context_injection', 'disk-cleanup', 'external_memory_service', 'google_meet', 'unrestricted_worker_launcher', 'SPT-fixed-origin browser-workbench'],
  },
  priorities: ['qualified_profile_runtime_and_reused_continuity', 'verified_git_lifecycle', 'date_first_all_student_preclass_review', 'student_kg_ontology_acceptance_queries_then_provider_comparison'],
  activation: { gatewayStart: false, jobsInstalled: false, workersDispatched: false, accountChanges: false },
  recovery: ['Preserve original Git/history and dated source evidence.', 'Native profile delete is a separately admitted teardown, not an automatic rollback.', 'No force push, main reset, foreign branch deletion or unsafe credential fallback.', 'Read back uncertain external writes before retry; retain their original identities.'],
} as const satisfies HermesBackendProfileContract;
