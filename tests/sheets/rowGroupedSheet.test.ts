import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { blockLegacyRowGroupedSync } from '../../scripts/sync_row_grouped_main_sheet';
test('legacy fixed-row sync cannot produce an academy write payload', () => {
  expect(() => blockLegacyRowGroupedSync()).toThrow('legacy_row_grouped_sync_unverified');
});
test('legacy live discovery exits before reading credentials or contacting the academy', () => {
  const result = Bun.spawnSync({ cmd: [process.execPath, 'run', resolve(import.meta.dir, '../../scripts/lms_reverse_engineer.ts')], stdout: 'pipe', stderr: 'pipe' });
  expect(result.exitCode).toBe(1);
  expect(new TextDecoder().decode(result.stdout)).toBe('');
  expect(JSON.parse(new TextDecoder().decode(result.stderr)).code).toBe('unverified_live_probe_retired');
});
