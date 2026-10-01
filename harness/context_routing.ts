/** Fixed project-source routing. Hashing a source never establishes that an agent read or understood it. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const contextPurposes = [
  'continuation', 'interview', 'dependencies', 'main_sheet', 'google_integration', 'academy_local', 'spt_mobile',
] as const;
export type ContextPurpose = typeof contextPurposes[number];

// A closed source vocabulary keeps this CLI away from arbitrary files and private academy material.
export const contextSourcePaths = {
  agent_instructions: 'AGENTS.md',
  user_intent: 'docs/CODEX_CONTEXT.md',
  product_direction: 'docs/WHOLE_LENS_DECISION.md',
  engineering_checkpoint: 'handoffs/workflow-current-state.json',
  phase_two_checkpoint: 'handoffs/harness-phase-two-checkpoint-2026-10-01.json',
  routing_contract: 'docs/workflow-routing.json',
  cloud_environment: 'harness/cloud-environment.json',
  cloud_checkpoint: 'handoffs/cloud-current-state.json',
  cloud_start_skill: '.agents/skills/codex-cloud-start/SKILL.md',
  runtime_capabilities: 'harness/runtime-capabilities.json',
  backend_tooling: 'docs/backend-tooling-contract.json',
  package_scripts: 'package.json',
  main_sheet_design: 'docs/main-sheet-design.json',
  main_sheet_live_wiring: 'docs/main-sheet-live-refresh-wiring.json',
  main_sheet_live_input: 'docs/main-sheet-live-input-map-2026-10-01.json',
  native_preservation: 'docs/main-sheet-native-preservation-preview.json',
  learning_domain: 'docs/learning/domain-design.json',
  weekly_audit: 'docs/learning/weekly-audit.json',
  google_api_proposal: 'docs/google-api-enablement-proposal-2026-10-01.json',
  integration_registry: 'docs/workflow-integration-registry.json',
  academy_checkpoint: 'handoffs/current-state.json',
  academy_read_contracts: 'docs/WHOLE_LENS_READ_CONTRACTS.md',
  backend_map: 'research/backend-map/README.md',
  academy_routes: 'research/backend-map/route-registry.json',
  main_sheet_skill: '.agents/skills/park-main-sheet/SKILL.md',
  spt_instructions: 'spt/AGENTS.md',
  source_imports: 'docs/source-import-manifest.json',
  student_database_architecture: 'docs/student-database-architecture-2026-10-01.json',
  preclass_main_sheet_ux: 'docs/preclass-main-sheet-ux-2026-10-01.json',
  phase_two_dependencies: 'review/harness-phase-two-dependencies-2026-10-01.json',
  main_sheet_tab_visibility: 'review/main-sheet-tab-visibility-2026-10-01.json',
} as const;
export type ContextSourceId = keyof typeof contextSourcePaths;
const commonSourceIds: ContextSourceId[] = [
  'agent_instructions', 'user_intent', 'product_direction', 'engineering_checkpoint', 'routing_contract',
];
const entryCommands = [
  'bun run cloud:start', 'bun run workflow:context', 'bun run harness/backend_dependencies.ts doctor',
  'bun run cloud:check', 'bun run harness/resume.ts --json', 'bun run harness roster --json', 'bun run harness routes --json',
] as const;
type Authority = 'native_instructions' | 'durable_intent' | 'current_engineering' | 'scope_contract' | 'dated_evidence' | 'source_reference';
export interface ContextSource {
  id: ContextSourceId;
  path: string;
  authority: Authority;
  role: string;
  declaredAsOf: string | null;
}
export interface ContextReadRouting {
  schemaVersion: 1;
  commonSourceIds: ContextSourceId[];
  sources: ContextSource[];
  purposes: Array<{
    id: ContextPurpose;
    sourceIds: ContextSourceId[];
    entryRule: string;
    commandReferences: string[];
    interviewRule: string;
  }>;
  scopeConflicts: Array<{
    id: string;
    purposes: ContextPurpose[];
    sourceIds: ContextSourceId[];
    topic: string;
    resolutionRule: string;
  }>;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{1,63}$/.test(value);
const boundedText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
  && value.length <= 640 && !/[\u0000-\u001f]/.test(value);
const uniqueStrings = (value: unknown, max: number): value is string[] => Array.isArray(value)
  && value.length <= max && value.every(item => typeof item === 'string') && new Set(value).size === value.length;
function date(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function fail(): never { throw new Error('invalid_context_routing'); }
export function isContextPurpose(value: unknown): value is ContextPurpose {
  return contextPurposes.includes(value as ContextPurpose);
}
export function validateContextReadRouting(value: unknown): ContextReadRouting {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'commonSourceIds', 'sources', 'purposes', 'scopeConflicts'])
    || value.schemaVersion !== 1 || JSON.stringify(value.commonSourceIds) !== JSON.stringify(commonSourceIds)
    || !Array.isArray(value.sources) || value.sources.length < commonSourceIds.length || value.sources.length > 32
    || !Array.isArray(value.purposes) || value.purposes.length !== contextPurposes.length
    || !Array.isArray(value.scopeConflicts) || value.scopeConflicts.length > 8) fail();
  const sourceIds = new Set<string>();
  for (const source of value.sources) {
    if (!object(source) || !exactKeys(source, ['id', 'path', 'authority', 'role', 'declaredAsOf'])
      || typeof source.id !== 'string' || !Object.hasOwn(contextSourcePaths, source.id) || sourceIds.has(source.id)
      || source.path !== contextSourcePaths[source.id as ContextSourceId]
      || !['native_instructions', 'durable_intent', 'current_engineering', 'scope_contract', 'dated_evidence', 'source_reference'].includes(String(source.authority))
      || !boundedText(source.role) || !date(source.declaredAsOf)) fail();
    sourceIds.add(source.id);
  }
  if (!commonSourceIds.every(id => sourceIds.has(id))) fail();
  const refs = (value: unknown, min: number) => uniqueStrings(value, 26) && value.length >= min && value.every(id => sourceIds.has(id));
  const purposes = new Set<string>();
  for (const purpose of value.purposes) {
    if (!object(purpose) || !exactKeys(purpose, ['id', 'sourceIds', 'entryRule', 'commandReferences', 'interviewRule'])
      || !isContextPurpose(purpose.id) || purposes.has(purpose.id) || !refs(purpose.sourceIds, 0)
      || !boundedText(purpose.entryRule) || !boundedText(purpose.interviewRule)
      || !uniqueStrings(purpose.commandReferences, 7)
      || !purpose.commandReferences.every(command => entryCommands.includes(command as typeof entryCommands[number]))) fail();
    purposes.add(purpose.id);
  }
  if (!contextPurposes.every(purpose => purposes.has(purpose))) fail();
  const conflictIds = new Set<string>();
  for (const conflict of value.scopeConflicts) {
    if (!object(conflict) || !exactKeys(conflict, ['id', 'purposes', 'sourceIds', 'topic', 'resolutionRule'])
      || !identifier(conflict.id) || conflictIds.has(conflict.id) || !uniqueStrings(conflict.purposes, contextPurposes.length)
      || conflict.purposes.length === 0 || !conflict.purposes.every(isContextPurpose) || !refs(conflict.sourceIds, 2)
      || !boundedText(conflict.topic) || !boundedText(conflict.resolutionRule)) fail();
    conflictIds.add(conflict.id);
  }
  return value as unknown as ContextReadRouting;
}

type SourceCheck = {
  exists: boolean;
  status: 'verified_file_presence_and_hash' | 'missing' | 'not_regular_file' | 'outside_checkout' | 'unreadable' | 'too_large';
  sha256: string | null;
  readByCommand: boolean;
};
function inspectSource(root: string, path: string): SourceCheck {
  // Paths came from the exact closed vocabulary above, never CLI input or linked document references.
  const target = resolve(root, path);
  let stats;
  try { stats = statSync(target); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return { exists: false, status: missing ? 'missing' : 'unreadable', sha256: null, readByCommand: false };
  }
  if (!stats.isFile()) return { exists: true, status: 'not_regular_file', sha256: null, readByCommand: false };
  try {
    const rel = relative(realpathSync(root), realpathSync(target));
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep)) {
      return { exists: true, status: 'outside_checkout', sha256: null, readByCommand: false };
    }
    if (stats.size > 2 * 1024 * 1024) return { exists: true, status: 'too_large', sha256: null, readByCommand: false };
    const bytes = readFileSync(target);
    return { exists: true, status: 'verified_file_presence_and_hash', sha256: createHash('sha256').update(bytes).digest('hex'), readByCommand: true };
  } catch { return { exists: true, status: 'unreadable', sha256: null, readByCommand: false }; }
}

export function entryReadPlan(root: string, rawRouting: unknown, purpose: ContextPurpose = 'continuation',
  parsedSourceIds: ContextSourceId[] = []) {
  if (!isContextPurpose(purpose)) throw new Error('invalid_context_purpose');
  const routing = validateContextReadRouting(rawRouting);
  const selected = routing.purposes.find(route => route.id === purpose)!;
  const conflicts = routing.scopeConflicts.filter(conflict => conflict.purposes.includes(purpose));
  const ids = [...new Set([...routing.commonSourceIds, ...selected.sourceIds, ...conflicts.flatMap(conflict => conflict.sourceIds)])];
  const requiredReads = ids.map(id => {
    const source = routing.sources.find(source => source.id === id)!;
    const inspected = inspectSource(root, source.path);
    return {
      ...source, ...inspected,
      readOperation: inspected.readByCommand ? parsedSourceIds.includes(id) ? 'parse_and_sha256' : 'sha256_only' : 'not_read',
      sourceBodyEmitted: false,
      parsedMetadataEmitted: inspected.readByCommand && parsedSourceIds.includes(id),
      agentReadEstablished: false,
      dateMeaning: source.authority === 'durable_intent' ? 'durable_intent_not_expired_by_age'
        : 'declared_provenance_not_current_acceptance',
    };
  });
  const failures = requiredReads.filter(source => source.status !== 'verified_file_presence_and_hash')
    .map(source => ({ path: source.path, status: source.status }));
  return {
    schemaVersion: 1,
    purpose,
    ok: failures.length === 0,
    requiredReads,
    sourceFailures: failures,
    sourceRecovery: failures.length ? 'Restore the named project source in the current checkout before continuing this route. Missing documentation is not a reason to ask the user to repeat established product intent.' : null,
    entryRule: selected.entryRule,
    commandReferences: [...selected.commandReferences],
    interviewRule: selected.interviewRule,
    mustReadBeforeInterview: true,
    mustReadBeforeDispatch: true,
    readPlanEstablishesAgentReading: false,
    sourceBodiesEmitted: false,
    linkedReferencesFollowed: false,
    scopeConflicts: structuredClone(conflicts),
    conflictPolicy: 'Resolve by source role, scope and decision provenance; date alone never overrides durable intent or an unresolved requirement.',
    commandReferencesExecuted: false,
    grantsAccess: false,
    authorizesProductionEffects: false,
    automaticPerTurnInjectionInstalled: false,
  };
}
