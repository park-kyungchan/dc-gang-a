#!/usr/bin/env bun
/** Offline metadata only; no student lookup, login, HTTP client, or request builder. */
import { endpointOutputMetrics, queryEndpoints, type EndpointQuery } from '../src/lms/endpointCatalog';

export function endpointCli(args: string[]): unknown {
  const query: EndpointQuery = {};
  const seen = new Set<string>();
  let metrics = false;
  const valued = ['--id', '--operation', '--family', '--origin', '--effect', '--projection', '--limit'];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (seen.has(arg)) throw new Error('duplicate_flag');
    seen.add(arg);
    if (arg === '--callable-only') { query.callableOnly = true; continue; }
    if (arg === '--metrics') { metrics = true; continue; }
    if (!valued.includes(arg)) throw new Error('unsupported_flag');
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error('missing_flag_value');
    if (arg === '--id') query.id = value;
    if (arg === '--operation') query.operation = value;
    if (arg === '--family') query.family = value;
    if (arg === '--origin') query.origin = value as EndpointQuery['origin'];
    if (arg === '--effect') query.effect = value as EndpointQuery['effect'];
    if (arg === '--projection') query.projection = value as EndpointQuery['projection'];
    if (arg === '--limit') query.limit = /^\d+$/.test(value) ? Number(value) : NaN;
  }
  // Validate even when metrics selects its own projections.
  const result = queryEndpoints(query);
  return metrics ? { result, metrics: endpointOutputMetrics(query) } : result;
}

if (import.meta.main) {
  try { process.stdout.write(JSON.stringify(endpointCli(process.argv.slice(2))) + '\n'); }
  catch (error) {
    const code = error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'endpoint_catalog_failed';
    process.stderr.write(JSON.stringify({ ok: false, code }) + '\n');
    process.exitCode = 1;
  }
}
