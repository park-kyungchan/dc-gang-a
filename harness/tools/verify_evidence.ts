#!/usr/bin/env bun
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { safeProjectPath } from '../cloud_environment';
const hash = (x: Uint8Array) => createHash('sha256').update(x).digest('hex');
export function verifyEvidence(root: string) {
  const failures: string[] = [], base = resolve(root, 'research/backend-map');
  const manifest = JSON.parse(readFileSync(resolve(base, 'map-manifest.json'), 'utf8')) as {
    files: Array<{ path: string; bytes: number; sha256: string }>; evidence_summary: { route_registry_entries: number };
  };
  const names = new Set<string>(); let links = 0;
  for (const pin of manifest.files) {
    const path = safeProjectPath(base, pin.path);
    if (names.has(pin.path)) throw new Error('duplicate_evidence_path');
    names.add(pin.path);
    if (!existsSync(path) || realpathSync(path) !== resolve(path)) { failures.push(pin.path + ':missing_or_symlink'); continue; }
    const bytes = readFileSync(path);
    if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) failures.push(pin.path + ':hash_drift');
    if (path.endsWith('.md')) for (const m of bytes.toString('utf8').matchAll(/(?<!!)\[[^\]]+\]\(([^)]+)\)/g)) {
      const ref = m[1]!.split('#')[0]!.split('?')[0]!;
      if (!ref || ref.includes('://') || ref.startsWith('mailto:')) continue;
      if (!existsSync(resolve(base, decodeURIComponent(ref)))) failures.push(pin.path + ':broken_link');
      links++;
    }
  }
  const registry = JSON.parse(readFileSync(resolve(base, 'route-registry.json'), 'utf8')) as { entries: unknown[] };
  if (registry.entries.length !== manifest.evidence_summary.route_registry_entries) failures.push('route_registry:count_drift');
  const imported = JSON.parse(readFileSync(resolve(root, 'docs/source-import-manifest.json'), 'utf8')) as {
    schema_version: number; components: Array<{ name: string; file_count: number; files: Record<string,string> }>;
  };
  if (imported.schema_version !== 1) throw new Error('unsupported_import_manifest');
  let importFiles = 0;
  for (const component of imported.components) {
    if (!['spt','lms-automation'].includes(component.name)) throw new Error('unexpected_source_component');
    const source = safeProjectPath(root, component.name);
    if (Object.keys(component.files).length !== component.file_count) failures.push(component.name + ':count_drift');
    for (const [ref, expected] of Object.entries(component.files)) {
      const path = safeProjectPath(source, ref);
      if (!existsSync(path) || realpathSync(path) !== resolve(path)) failures.push(component.name + '/' + ref + ':missing_or_symlink');
      else if (hash(readFileSync(path)) !== expected) failures.push(component.name + '/' + ref + ':hash_drift');
      importFiles++;
    }
  }
  return { ok: !failures.length, backendFiles: names.size, localLinks: links, canonicalOperations: registry.entries.length, importedSourceFiles: importFiles, failures };
}
if (import.meta.main) {
  try { const result = verifyEvidence(resolve(import.meta.dir, '../..')); console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; }
  catch { console.error(JSON.stringify({ ok: false, reason: 'evidence_validation_failed' })); process.exitCode = 1; }
}
