import { isAbsolute, relative, resolve, sep } from 'node:path';
export interface CloudEnvironment {
  schemaVersion: 1; experience: 'codex_cloud_current'; reviewedOn: string;
  repository: 'park-kyungchan/dc-gang-a';
  runtime: { bun: string; typescript: string; python: 'exception_only_not_installed' };
  installScript: string; startSkill: string; sourceCheckpoint: string; checkpointValidThrough: string;
  network: { preset: 'Package managers'; additionalDomains: string[]; academyAccess: 'not_configured' };
  services: string[]; requiredSecrets: string[];
  documentation: Array<{ url: string; finding: string }>;
  setupPrompt: string; continuationPrompt: string;
}
export function safeProjectPath(root: string, reference: string): string {
  if (!reference || isAbsolute(reference) || reference.includes('\\') || reference.split('/').includes('..')) throw new Error('unsafe_project_reference');
  const target = resolve(root, reference), rel = relative(resolve(root), target);
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new Error('unsafe_project_reference');
  return target;
}
export function validateCloudEnvironment(raw: unknown): CloudEnvironment {
  const c = raw as CloudEnvironment | null;
  if (!c || c.schemaVersion !== 1 || c.experience !== 'codex_cloud_current' || c.repository !== 'park-kyungchan/dc-gang-a'
    || c.runtime?.bun !== '1.4.2' || c.runtime.typescript !== '7.0.2' || c.runtime.python !== 'exception_only_not_installed'
    || c.installScript !== 'bun run cloud:install' || c.startSkill !== '.agents/skills/codex-cloud-start/SKILL.md'
    || c.sourceCheckpoint !== 'handoffs/current-state.json' || c.checkpointValidThrough !== '2026-09-30'
    || c.network?.preset !== 'Package managers' || c.network.academyAccess !== 'not_configured'
    || !Array.isArray(c.network.additionalDomains)
    || c.network.additionalDomains.some(d => !['developers.openai.com','learn.chatgpt.com','bun.com','bun.sh'].includes(d))
    || !Array.isArray(c.services) || c.services.length || !Array.isArray(c.requiredSecrets) || c.requiredSecrets.length
    || !c.setupPrompt || !c.continuationPrompt || !Array.isArray(c.documentation) || !c.documentation.length) throw new Error('invalid_cloud_environment');
  for (const source of c.documentation) {
    const u = new URL(source.url);
    if (u.protocol !== 'https:' || !['learn.chatgpt.com','developers.openai.com'].includes(u.hostname)
      || u.username || u.password || !source.finding) throw new Error('invalid_official_source');
  }
  return c;
}
