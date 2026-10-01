import { describe, expect, it } from 'bun:test';
import { boundedA1Range, createGoogleReadAdapter, validateSheetValues, type GoogleReadTarget, type GoogleReadTransport, type SheetRange } from '../../src/backend/googleReadAdapter';

const range: SheetRange = { tabTitle: 'Synthetic Main', firstRow: 1, lastRow: 2, firstColumn: 1, lastColumn: 3 };
const fileId = 'synthetic-file-id';
function makeAdapter(body: unknown, target: GoogleReadTarget, status = 200) {
  const requests: Array<{ url: URL; init: RequestInit | undefined }> = [];
  let authorizations = 0;
  const adapter = createGoogleReadAdapter({ allowedReads: [target],
    accessToken: async () => { authorizations++; return 'synthetic-placeholder'; },
    fetchImpl: (async (input, init) => {
      requests.push({ url: new URL(String(input)), init });
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as GoogleReadTransport });
  return { adapter, requests, authorizations: () => authorizations };
}

describe('Google REST exact-target read adapter (all requests mocked)', () => {
  it('quotes sheet titles and rejects unbounded, oversized, or malformed ranges', () => {
    expect(boundedA1Range({ ...range, tabTitle: "Teacher's Main", firstColumn: 26, lastColumn: 28 }))
      .toBe("'Teacher''s Main'!Z1:AB2");
    for (const changed of [{ firstRow: 0 }, { lastRow: 100_000 }, { lastColumn: 20_000 }, { lastRow: 1.5 }, { tabTitle: 'bad\nname' }, { firstColumn: 4 }]) {
      expect(() => boundedA1Range({ ...range, ...changed })).toThrow();
    }
  });
  it('uses fixed Google origin, exact bounded range, GET, manual redirects, and no body', async () => {
    const result = makeAdapter({ range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS', values: [['a', 1, false], ['b']] },
      { kind: 'sheet_values', spreadsheetId: fileId, range });
    const values = await result.adapter.sheetValues(fileId, range);
    expect(values.values).toEqual([['a', 1, false], ['b']]);
    expect(result.requests).toHaveLength(1);
    const { url, init } = result.requests[0]!;
    expect(url.origin).toBe('https://sheets.googleapis.com');
    expect(decodeURIComponent(url.pathname)).toEndWith("/values/'Synthetic Main'!A1:C2");
    expect(url.searchParams.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    expect(init?.method).toBe('GET'); expect(init?.redirect).toBe('manual');
    expect(init?.credentials).toBe('omit'); expect(init?.body).toBeUndefined();
  });
  it('refuses other targets before acquiring any credential or making a request', async () => {
    const result = makeAdapter({}, { kind: 'drive_metadata', fileId });
    await expect(result.adapter.driveMetadata('another-file')).rejects.toThrow('target_not_authorized');
    await expect(result.adapter.driveMetadata('../file')).rejects.toThrow('id_invalid');
    await expect(result.adapter.sheetMetadata(fileId)).rejects.toThrow('target_not_authorized');
    expect(result.authorizations()).toBe(0); expect(result.requests).toHaveLength(0);
  });
  it('copies the allowed target and in-flight range to prevent caller mutation', async () => {
    const changing = { ...range };
    const allowed: GoogleReadTarget[] = [{ kind: 'sheet_values', spreadsheetId: fileId, range: changing }];
    const adapter = createGoogleReadAdapter({ allowedReads: allowed, accessToken: async () => {
      changing.lastRow = 20; return 'synthetic-placeholder';
    }, fetchImpl: (async () => Response.json({ range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS' })) as GoogleReadTransport });
    expect((await adapter.sheetValues(fileId, changing)).values).toEqual([]);
    await expect(adapter.sheetValues(fileId, changing)).rejects.toThrow('target_not_authorized');
  });
  it('validates response target, shape, scalar cells, and bounds', () => {
    expect(validateSheetValues({ range: 'Main!A1:C2', majorDimension: 'ROWS' }, { ...range, tabTitle: 'Main' }).values).toEqual([]);
    expect(validateSheetValues({ range: 'Main!A1', majorDimension: 'ROWS', values: [['one']] },
      { ...range, tabTitle: 'Main', lastRow: 1, lastColumn: 1 }).values).toEqual([['one']]);
    for (const data of [
      { range: "'Other'!A1:C2", majorDimension: 'ROWS' },
      { range: "'Synthetic Main'!A1:C2", majorDimension: 'COLUMNS' },
      { range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS', values: [[{}]] },
      { range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS', values: null },
      { range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS', values: [[1, 2, 3, 4]] },
      { range: "'Synthetic Main'!A1:C2", majorDimension: 'ROWS', values: [[1], [2], [3]] },
    ]) expect(() => validateSheetValues(data, range)).toThrow();
  });
  it('reads Drive metadata with a minimal fixed field mask and rejects target mismatch', async () => {
    const result = makeAdapter({ id: fileId, name: 'Synthetic workbook', mimeType: 'application/vnd.google-apps.spreadsheet', shared: false, ignored: 'excluded' },
      { kind: 'drive_metadata', fileId });
    const metadata = await result.adapter.driveMetadata(fileId);
    expect(metadata).not.toHaveProperty('ignored');
    expect(result.requests[0]!.url.origin).toBe('https://www.googleapis.com');
    expect(result.requests[0]!.url.searchParams.get('fields')).not.toContain('*');
    expect(result.requests[0]!.url.searchParams.has('alt')).toBe(false);
    const wrong = makeAdapter({ id: 'another-file', name: 'x', mimeType: 'x' }, { kind: 'drive_metadata', fileId });
    await expect(wrong.adapter.driveMetadata(fileId)).rejects.toThrow('target_mismatch');
  });
  it('reads metadata/protections without grid cells, editor identities, or implied write permission', async () => {
    const result = makeAdapter({ spreadsheetId: fileId, properties: { title: 'Synthetic workbook', timeZone: 'Asia/Seoul' },
      sheets: [{ properties: { sheetId: 0, title: 'Main', gridProperties: { rowCount: 100, columnCount: 26 } },
        protectedRanges: [{ protectedRangeId: 1, range: { sheetId: 0, startRowIndex: 0, endRowIndex: 2 }, warningOnly: true }] }] },
      { kind: 'sheet_metadata', spreadsheetId: fileId });
    const metadata = await result.adapter.sheetMetadata(fileId);
    expect(metadata.sheets[0]!.protectedRanges[0]!.requestingUserCanEdit).toBeUndefined();
    const url = result.requests[0]!.url;
    expect(url.searchParams.get('includeGridData')).toBe('false');
    expect(url.searchParams.get('fields')).not.toContain('editors');
    expect(url.searchParams.get('fields')).not.toContain('rowData');
  });
  it('rejects redirects, HTTP errors, HTML, invalid JSON, and oversized responses without echoing data', async () => {
    for (const status of [302, 401, 403, 429, 500]) {
      const result = makeAdapter({ error: 'private-response-details' }, { kind: 'drive_metadata', fileId }, status);
      await expect(result.adapter.driveMetadata(fileId)).rejects.toThrow(`google_read_http_${status}`);
      expect(result.requests).toHaveLength(1);
    }
    const cases = [
      new Response('<secret>private-response-details</secret>', { headers: { 'content-type': 'text/html' } }),
      new Response('private-response-details', { headers: { 'content-type': 'application/json' } }),
      new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '999999999' } }),
      new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    ];
    for (const response of cases) {
      const adapter = createGoogleReadAdapter({ allowedReads: [{ kind: 'drive_metadata', fileId }], accessToken: async () => 'synthetic-placeholder',
        fetchImpl: (async () => response) as GoogleReadTransport });
      try { await adapter.driveMetadata(fileId); throw new Error('expected rejection'); }
      catch (error) { expect((error as Error).message).toStartWith('google_read_'); expect((error as Error).message).not.toContain('private-response-details'); }
    }
  });
  it('redacts token-provider and network exception content', async () => {
    for (const stage of ['token', 'network']) {
      const adapter = createGoogleReadAdapter({ allowedReads: [{ kind: 'drive_metadata', fileId }], accessToken: async () => {
        if (stage === 'token') throw new Error('private-credential-value'); return 'synthetic-placeholder';
      }, fetchImpl: (async () => { throw new Error('private-credential-value'); }) as GoogleReadTransport });
      try { await adapter.driveMetadata(fileId); throw new Error('expected rejection'); }
      catch (error) { expect((error as Error).message).toStartWith('google_read_'); expect((error as Error).message).not.toContain('private-credential-value'); }
    }
  });
});
