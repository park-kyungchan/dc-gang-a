/** Deployed-source observations only. Never a transport, roster, effect or permission proof. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface BackendSourceDeclaration {
  functionName: string;
  line: number;
  selectorTokens: string[];
  servletDeclarations: string[];
  methodDeclarations: Array<'GET' | 'POST'>;
  formSubmitted: boolean;
  windowOpened: boolean;
  invoked: false;
  semanticEffectVerified: false;
}
export interface BackendSourceStructure {
  sourceRef: string;
  documentPath: string;
  observedAt: string;
  state: 'source_structure_only';
  forms: Array<{ name: string | null; id: string | null; method: 'GET' | 'POST' | null;
    actionPath: string | null; actionMeaning: string; fieldNames: string[] }>;
  inputNames: string[];
  selectorLiteralTokens: string[];
  servletPaths: string[];
  requestDeclarations: BackendSourceDeclaration[];
  recordScopeVerified: false;
  paginationComplete: false;
  rawValuesEmitted: false;
}
const relativeSource = 'docs/academy-backend-source-survey-2026-10-02.json';
const sourcePath = resolve(import.meta.dir, '../..', relativeSource);
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const names = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 256
  && value.every(item => typeof item === 'string' && /^[A-Za-z_$][A-Za-z0-9_.$-]{0,95}$/.test(item) && !/[0-9]{6,}/.test(item));
const servletPaths = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128
  && value.every(item => typeof item === 'string' && /^(?:\/servlet\/)?controller\.[A-Za-z0-9_.]+Servlet$/.test(item));
function fail(): never { throw new Error('invalid_backend_source_evidence'); }
function declarations(value: unknown): BackendSourceDeclaration[] {
  if (!Array.isArray(value) || value.length > 256) fail();
  for (const row of value) {
    if (!object(row) || !names([row.functionName]) || !Number.isSafeInteger(row.line) || (row.line as number) < 1
      || !names(row.selectorTokens) || !servletPaths(row.servletDeclarations)
      || !Array.isArray(row.methodDeclarations) || !row.methodDeclarations.every(method => method === 'GET' || method === 'POST')
      || typeof row.formSubmitted !== 'boolean' || typeof row.windowOpened !== 'boolean'
      || row.invoked !== false || row.semanticEffectVerified !== false) fail();
  }
  // Project known fields explicitly; a metadata spread must not carry future raw data.
  return value.map(row => ({ functionName: row.functionName, line: row.line,
    selectorTokens: [...row.selectorTokens], servletDeclarations: [...row.servletDeclarations], methodDeclarations: [...row.methodDeclarations],
    formSubmitted: row.formSubmitted, windowOpened: row.windowOpened, invoked: false, semanticEffectVerified: false }));
}

export function parseBackendSourceEvidence(input: unknown): Map<string, BackendSourceStructure> {
  if (!object(input) || input.schemaVersion !== 1 || input.kind !== 'sanitized_deployed_backend_source_survey'
    || input.origin !== 'https://dc.gang-a.kr' || input.fullBackendAcceptance !== false || input.productionEffectsAuthorized !== false
    || !object(input.collection) || input.collection.formsSubmitted !== false || input.collection.discoveredOperationsInvoked !== false
    || input.collection.rawBodiesPersisted !== false || input.collection.studentValuesPersisted !== false
    || !object(input.summary) || !Array.isArray(input.documents) || input.documents.length > 128
    || input.summary.requestedFixedDocuments !== input.documents.length || input.summary.observedFixedDocuments !== input.documents.length) fail();
  const shared = input.sharedRequestDeclarations;
  if (!Array.isArray(shared) || shared.length > 128) fail();
  const documentIds = new Set(input.documents.map(doc => object(doc) ? doc.id : null));
  for (const row of shared) {
    if (!object(row) || !Array.isArray(row.documentIds) || row.documentIds.length < 2
      || new Set(row.documentIds).size !== row.documentIds.length
      || !row.documentIds.every(id => typeof id === 'string' && documentIds.has(id))) fail();
  }
  declarations(shared);
  const result = new Map<string, BackendSourceStructure>();
  for (const doc of input.documents) {
    if (!object(doc) || typeof doc.id !== 'string' || !/^[a-z][a-z0-9_]{1,63}$/.test(doc.id) || result.has(doc.id)
      || typeof doc.path !== 'string' || !/^\/servlet\/controller\.[A-Za-z0-9_.]+Servlet$/.test(doc.path)
      || doc.status !== 200 || doc.state !== 'source_structure_only' || typeof doc.observedAt !== 'string' || !Number.isFinite(Date.parse(doc.observedAt))
      || doc.recordScopeVerified !== false || doc.paginationComplete !== false || doc.rawValuesEmitted !== false || doc.rawBodyPersisted !== false
      || !names(doc.inputNames) || !names(doc.selectorLiteralTokens) || !servletPaths(doc.servletPaths)
      || !Array.isArray(doc.forms) || !Array.isArray(doc.requestDeclarations)) fail();
    const forms: BackendSourceStructure['forms'] = [];
    for (const form of doc.forms) {
      if (!object(form) || !(form.name === null || names([form.name])) || !(form.id === null || names([form.id]))
        || !(form.method === null || form.method === 'GET' || form.method === 'POST')
        || !(form.actionPath === null || (typeof form.actionPath === 'string' && /^\/servlet\/controller\.[A-Za-z0-9_.]+Servlet$/.test(form.actionPath)))
        || form.actionMeaning !== 'literal_attribute_only_not_runtime_handler_destination' || !names(form.fieldNames)) fail();
      forms.push({ name: form.name as string | null, id: form.id as string | null, method: form.method as 'GET' | 'POST' | null,
        actionPath: form.actionPath as string | null, actionMeaning: form.actionMeaning as string, fieldNames: [...form.fieldNames] });
    }
    const repeated = shared.filter(row => object(row) && Array.isArray(row.documentIds) && row.documentIds.includes(doc.id));
    const controls = declarations([...doc.requestDeclarations as unknown[], ...repeated]);
    result.set(doc.id, { sourceRef: `${relativeSource}#documents/${doc.id}`, documentPath: doc.path, observedAt: doc.observedAt,
      state: 'source_structure_only', forms, inputNames: [...doc.inputNames], selectorLiteralTokens: [...doc.selectorLiteralTokens],
      servletPaths: [...doc.servletPaths], requestDeclarations: controls,
      recordScopeVerified: false, paginationComplete: false, rawValuesEmitted: false });
  }
  return result;
}
export function loadBackendSourceEvidence(): Map<string, BackendSourceStructure> {
  const source = readFileSync(sourcePath, 'utf8');
  if (Buffer.byteLength(source) > 262144) fail();
  return parseBackendSourceEvidence(JSON.parse(source));
}
