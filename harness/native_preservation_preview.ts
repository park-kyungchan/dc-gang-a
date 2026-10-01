#!/usr/bin/env bun
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildNativePreservationPreview } from '../src/sheets/nativePreservationPreview';

// Fixed authorized sanitized receipt only; no network, auth discovery, arbitrary path, or raw response.
if (process.argv.length !== 2) throw new Error('native_preview_accepts_no_arguments');
const root = resolve(import.meta.dir, '..');
const bytes = readFileSync(resolve(root, '../sheet-native-preservation-repeat-receipts-2026-10-01.jsonl'));
const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const summaries = bytes.toString('utf8').trim().split('\n').map(line => JSON.parse(line) as unknown)
  .filter((value: any) => value?.receipt === 'read_summary');
if (summaries.length !== 1) throw new Error('native_preview_requires_one_summary');
const preview = buildNativePreservationPreview(summaries[0], hash);
const path = 'docs/main-sheet-native-preservation-preview.json';
writeFileSync(resolve(root, path), JSON.stringify(preview, null, 2) + '\n');
console.log(JSON.stringify({ path, status: preview.status, coordinateChecks: preview.machineCheckedCoordinateExpectations.shifts,
  liveApiRequests: 0, cellReads: 0, productionWrites: 0 }));
