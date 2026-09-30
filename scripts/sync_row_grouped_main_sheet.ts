/** Historical runner retained as a fail-closed entrypoint; no filesystem or network effects. */
export function blockLegacyRowGroupedSync(): never {
  throw new Error('legacy_row_grouped_sync_unverified_use_one_tab_migration_plan');
}
if (import.meta.main) {
  console.error(JSON.stringify({ ok: false, code: 'legacy_row_grouped_sync_unverified', replacement: 'src/sheets/oneTabGroupedLayout.ts' }));
  process.exitCode = 1;
}
