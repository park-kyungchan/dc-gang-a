#!/usr/bin/env bun
import { resolve } from 'node:path';
const patterns: Record<string,RegExp> = {
  private_key: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  github_token: /gh[pousr]_[A-Za-z0-9]{20,}/,
  openai_key: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/,
  google_api_key: /AIza[0-9A-Za-z_-]{30,}/,
  aws_access_key: /AKIA[A-Z0-9]{16}/,
  literal_session: /JSESSIONID\s*[=:]\s*[A-Za-z0-9._%-]{16,}/,
  phone_number: /(?<!\d)010[- ]?\d{4}[- ]?\d{4}(?!\d)/,
};
export function scanPublicationText(path: string, text: string): string[] {
  if (/^(?:config|data|\.codex|\.playwright-mcp|scratch|work)\//.test(path)
    || /^lms-automation\/(?:data|config|\.git.backup)\//.test(path)
    || ['docs/decision_ledger.json','spt/.openai/hosting.json'].includes(path)
    || /(?:^|\/)(?:\.env(?:\.|$)|credentials[^/]*\.json|token[^/]*\.json)/.test(path)) return ['protected_path'];
  return Object.entries(patterns).filter(([,p]) => p.test(text)).map(([name]) => name);
}
function git(root: string, args: string[]): string {
  const p = Bun.spawnSync({ cmd: ['git', ...args], cwd: root, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error('git_source_read_failed');
  return new TextDecoder().decode(p.stdout);
}
export function auditPublication(root: string, range?: string) {
  if (range && !/^[A-Za-z0-9_./-]+\.\.\.[A-Za-z0-9_./-]+$/.test(range)) throw new Error('invalid_git_range');
  const paths = git(root, ['diff', ...(range ? [range] : ['--cached']), '--name-only','-z','--diff-filter=ACMR']).split('\0').filter(Boolean);
  const findings: Array<{ path: string; rules: string[] }> = []; let bytes = 0;
  for (const path of paths) {
    const content = git(root, ['show', range ? 'HEAD:' + path : ':' + path]);
    bytes += Buffer.byteLength(content);
    const rules = scanPublicationText(path, content);
    if (rules.length) findings.push({ path, rules });
  }
  return { ok: !findings.length, files: paths.length, bytes, findings,
    limit: 'Credential-pattern and protected-path guard; exact source diff still requires review.' };
}
if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (!(args.length === 1 && args[0] === '--staged') && !(args.length === 2 && args[0] === '--range')) throw new Error('use_staged_or_range');
    const r = auditPublication(resolve(import.meta.dir, '../..'), args[0] === '--range' ? args[1] : undefined);
    console.log(JSON.stringify(r)); process.exitCode = r.ok ? 0 : 1;
  } catch { console.error(JSON.stringify({ ok: false, reason: 'publication_audit_failed' })); process.exitCode = 1; }
}
