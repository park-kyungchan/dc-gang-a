/** Official REST read contracts only. Authorization and token acquisition belong to the caller.
 * No credentials are discovered, persisted, logged, or refreshed by this module.
 * Sources and backend/UI boundaries: docs/backend-tooling-contract.json.
 */
export interface SheetRange {
  tabTitle: string;
  firstRow: number;
  lastRow: number;
  firstColumn: number;
  lastColumn: number;
}
export type GoogleReadTarget =
  | { kind: 'drive_metadata'; fileId: string }
  | { kind: 'sheet_metadata'; spreadsheetId: string }
  | { kind: 'sheet_values'; spreadsheetId: string; range: SheetRange };
export type SheetValue = string | number | boolean;
export interface SheetValues { range: string; majorDimension: 'ROWS'; values: SheetValue[][] }
export type GoogleReadTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_CELLS = 5_000;
const DRIVE_FIELDS = 'id,name,mimeType,modifiedTime,version,shared,trashed';
const SHEET_FIELDS = 'spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),protectedRanges(protectedRangeId,range,warningOnly,requestingUserCanEdit))';

function fail(code: string): never { throw new Error(code); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('google_read_schema_invalid');
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== 'string') fail('google_read_schema_invalid');
  return value;
}
function natural(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('google_read_schema_invalid');
  return value as number;
}
function optionalBoolean(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') fail('google_read_schema_invalid');
  return value as boolean | undefined;
}
function id(value: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value)) fail('google_read_id_invalid');
  return value;
}
function columnLabel(column: number): string {
  let result = '';
  for (let n = column; n > 0; n = Math.floor((n - 1) / 26)) result = String.fromCharCode(65 + (n - 1) % 26) + result;
  return result;
}
export function boundedA1Range(range: SheetRange): string {
  if (typeof range.tabTitle !== 'string' || !range.tabTitle.trim() || range.tabTitle.length > 100
    || /[\x00-\x1f\x7f]/.test(range.tabTitle)) fail('google_read_tab_invalid');
  for (const value of [range.firstRow, range.lastRow, range.firstColumn, range.lastColumn]) {
    if (!Number.isSafeInteger(value) || value < 1) fail('google_read_range_invalid');
  }
  if (range.lastRow < range.firstRow || range.lastColumn < range.firstColumn
    || range.lastRow > 10_000_000 || range.lastColumn > 18_278
    || (range.lastRow - range.firstRow + 1) * (range.lastColumn - range.firstColumn + 1) > MAX_CELLS) {
    fail('google_read_range_invalid');
  }
  return `'${range.tabTitle.replaceAll("'", "''")}'!${columnLabel(range.firstColumn)}${range.firstRow}:${columnLabel(range.lastColumn)}${range.lastRow}`;
}
function targetUrl(target: GoogleReadTarget): URL {
  if (target.kind === 'drive_metadata') {
    const url = new URL(`https://www.googleapis.com/drive/v3/files/${id(target.fileId)}`);
    url.searchParams.set('fields', DRIVE_FIELDS);
    url.searchParams.set('supportsAllDrives', 'true');
    return url;
  }
  if (target.kind !== 'sheet_metadata' && target.kind !== 'sheet_values') fail('google_read_kind_invalid');
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${id(target.spreadsheetId)}`);
  if (target.kind === 'sheet_metadata') {
    url.searchParams.set('fields', SHEET_FIELDS);
    url.searchParams.set('includeGridData', 'false');
  } else {
    url.pathname += `/values/${encodeURIComponent(boundedA1Range(target.range))}`;
    url.searchParams.set('majorDimension', 'ROWS');
    url.searchParams.set('valueRenderOption', 'UNFORMATTED_VALUE');
    url.searchParams.set('dateTimeRenderOption', 'SERIAL_NUMBER');
  }
  return url;
}
async function boundedJson(response: Response): Promise<unknown> {
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => {});
    fail(`google_read_http_${response.status}`);
  }
  if (response.redirected || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    await response.body?.cancel().catch(() => {});
    fail('google_read_response_invalid');
  }
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    await response.body?.cancel().catch(() => {});
    fail('google_read_response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) fail('google_read_response_empty');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        fail('google_read_response_too_large');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail('google_read_json_invalid'); }
}
function normalizedA1(value: string): string {
  const separator = value.lastIndexOf('!');
  if (separator < 1) fail('google_read_range_mismatch');
  let title = value.slice(0, separator);
  if (title.startsWith("'") && title.endsWith("'")) title = title.slice(1, -1).replaceAll("''", "'");
  const cells = value.slice(separator + 1);
  return `${JSON.stringify(title)}!${/^[A-Z]+[1-9]\d*$/.test(cells) ? `${cells}:${cells}` : cells}`;
}
export function validateSheetValues(value: unknown, requested: SheetRange): SheetValues {
  const row = record(value);
  const expected = boundedA1Range(requested);
  if (normalizedA1(string(row.range)) !== normalizedA1(expected) || row.majorDimension !== 'ROWS') fail('google_read_range_mismatch');
  const values = row.values === undefined ? [] : row.values;
  if (!Array.isArray(values) || values.length > requested.lastRow - requested.firstRow + 1) fail('google_read_schema_invalid');
  const result: SheetValue[][] = values.map(cells => {
    if (!Array.isArray(cells) || cells.length > requested.lastColumn - requested.firstColumn + 1) fail('google_read_schema_invalid');
    return cells.map(cell => {
      if (typeof cell !== 'string' && typeof cell !== 'boolean' && !(typeof cell === 'number' && Number.isFinite(cell))) fail('google_read_schema_invalid');
      return cell as SheetValue;
    });
  });
  return { range: expected, majorDimension: 'ROWS', values: result };
}
function validateDriveMetadata(value: unknown, fileId: string) {
  const row = record(value);
  if (row.id !== fileId) fail('google_read_target_mismatch');
  return { id: fileId, name: string(row.name), mimeType: string(row.mimeType),
    modifiedTime: row.modifiedTime === undefined ? undefined : string(row.modifiedTime),
    version: row.version === undefined ? undefined : string(row.version),
    shared: optionalBoolean(row.shared), trashed: optionalBoolean(row.trashed) };
}
function validateSheetMetadata(value: unknown, spreadsheetId: string) {
  const row = record(value);
  if (row.spreadsheetId !== spreadsheetId) fail('google_read_target_mismatch');
  const properties = record(row.properties);
  if (!Array.isArray(row.sheets)) fail('google_read_schema_invalid');
  return { spreadsheetId, properties: { title: string(properties.title), timeZone: string(properties.timeZone) },
    sheets: row.sheets.map(sheet => {
      const item = record(sheet);
      const props = record(item.properties);
      const sheetId = natural(props.sheetId);
      const grid = props.gridProperties === undefined ? undefined : record(props.gridProperties);
      const protections = item.protectedRanges === undefined ? [] : item.protectedRanges;
      if (!Array.isArray(protections)) fail('google_read_schema_invalid');
      return { properties: { sheetId, title: string(props.title),
        gridProperties: grid === undefined ? undefined : { rowCount: natural(grid.rowCount), columnCount: natural(grid.columnCount) } },
      protectedRanges: protections.map(protection => {
        const p = record(protection);
        const range = p.range === undefined ? undefined : record(p.range);
        // Named/table-based protection can omit a GridRange. Preserve that as unknown.
        let parsedRange: Record<string, number> | undefined;
        if (range !== undefined) {
          parsedRange = { sheetId: range.sheetId === undefined ? 0 : natural(range.sheetId) };
          if (parsedRange.sheetId !== sheetId) fail('google_read_protection_target_mismatch');
          for (const key of ['startRowIndex','endRowIndex','startColumnIndex','endColumnIndex']) {
            if (range[key] !== undefined) parsedRange[key] = natural(range[key]);
          }
        }
        return { protectedRangeId: natural(p.protectedRangeId), range: parsedRange,
          warningOnly: optionalBoolean(p.warningOnly), requestingUserCanEdit: optionalBoolean(p.requestingUserCanEdit) };
      }) };
    }) };
}

export function createGoogleReadAdapter(options: {
  /** Exact current-task targets approved outside this module; never an all-files grant. */
  allowedReads: readonly GoogleReadTarget[];
  /** An independently authorized in-memory provider. This module never invokes gcloud or reads auth files. */
  accessToken: () => Promise<string>;
  fetchImpl?: GoogleReadTransport;
}) {
  // Materialize permissions now so later caller mutation cannot widen the allowlist.
  const allowed = new Set(options.allowedReads.map(target => targetUrl(target).href));
  const fetchImpl = options.fetchImpl ?? fetch;
  async function read(target: GoogleReadTarget): Promise<unknown> {
    const url = targetUrl(target);
    if (!allowed.has(url.href)) fail('google_read_target_not_authorized');
    let token: string;
    try { token = await options.accessToken(); } catch { fail('google_read_authorization_unavailable'); }
    if (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token)) fail('google_read_authorization_invalid');
    let response: Response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'manual', credentials: 'omit',
        signal: AbortSignal.timeout(15_000), headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    } catch { fail('google_read_transport_failed'); }
    try { return await boundedJson(response); }
    catch (error) {
      if (error instanceof Error && /^google_read_[a-z0-9_]+$/.test(error.message)) throw error;
      fail('google_read_transport_failed');
    }
  }
  return {
    async driveMetadata(fileId: string) { return validateDriveMetadata(await read({ kind: 'drive_metadata', fileId }), fileId); },
    async sheetMetadata(spreadsheetId: string) { return validateSheetMetadata(await read({ kind: 'sheet_metadata', spreadsheetId }), spreadsheetId); },
    async sheetValues(spreadsheetId: string, range: SheetRange) {
      // Snapshot before awaiting the token/network to bind validation to the exact request.
      const boundRange = { ...range };
      return validateSheetValues(await read({ kind: 'sheet_values', spreadsheetId, range: boundRange }), boundRange);
    },
  };
}
