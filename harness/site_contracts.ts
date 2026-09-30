#!/usr/bin/env bun
/** Offline inventory and validation of the canonical /servlet operation map. */
import { getSiteInventory, validateSiteInventory } from '../src/lms/siteReadContracts';

export function main(args = process.argv.slice(2)): number {
  const json = args.includes('--json');
  const validate = args.includes('--validate');
  const gapsOnly = args.includes('--gaps');
  const fixedOnly = args.includes('--fixed-shells');
  const summaryOnly = args.includes('--summary');
  const idIndex = args.indexOf('--id');
  const id = idIndex >= 0 ? args[idIndex + 1] : undefined;
  if (idIndex >= 0 && (!id || id.startsWith('--'))) {
    process.stderr.write('Missing value for --id\n');
    return 1;
  }
  const allowed = new Set(['--json', '--validate', '--gaps', '--fixed-shells', '--summary', '--id']);
  if (args.some(arg => arg.startsWith('--') && !allowed.has(arg))
    || args.some((arg, index) => !arg.startsWith('--') && !(idIndex >= 0 && index === idIndex + 1))) {
    process.stderr.write('Usage: bun run harness/site_contracts.ts [--id ID] [--fixed-shells|--gaps] [--validate] [--summary] [--json]\n');
    return 1;
  }

  const inventory = getSiteInventory();
  const errors = validateSiteInventory(inventory);
  let operations = inventory.servletOperations;
  if (id) operations = operations.filter(op => op.id === id);
  if (id && operations.length !== 1) {
    process.stderr.write(`Unknown /servlet operation ID: ${id}\n`);
    return 1;
  }
  if (fixedOnly) operations = operations.filter(op => op.fixedShellReadCandidate);
  if (gapsOnly) operations = operations.filter(op => op.readState !== 'fixed_page_shell');
  const payload = {
    source: 'research/backend-map/route-registry.json',
    totalServletOperations: inventory.servletOperations.length,
    outsideServlet: inventory.outsideServlet,
    readStateCounts: Object.fromEntries(
      [...new Set(inventory.servletOperations.map(op => op.readState))].sort().map(state => [
        state,
        inventory.servletOperations.filter(op => op.readState === state).length,
      ]),
    ),
    shown: summaryOnly ? 0 : operations.length,
    operations: summaryOnly ? [] : operations,
    validation: { valid: errors.length === 0, errors },
  };
  if (json) process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  else {
    process.stdout.write(`Servlet operations: ${payload.totalServletOperations}; shown: ${payload.shown}; validation: ${errors.length ? 'FAIL' : 'PASS'}\n`);
    for (const op of payload.operations) {
      process.stdout.write(`${op.id}\t${op.method ?? '?'}\t${op.readState}\t${op.routeTemplate}\n`);
    }
    if (errors.length) process.stderr.write(errors.join('\n') + '\n');
  }
  return errors.length ? 1 : 0;
}

if (import.meta.main) process.exit(main());
