import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractPdfText, pdfTextArguments } from '../../src/backend/pdfExtraction';

/** A tiny original two-page PDF fixture; no downloaded textbook or student material. */
function syntheticPdf(): string {
  const streams = ['BT /F1 18 Tf 72 720 Td (Synthetic page one) Tj ET', 'BT /F1 18 Tf 72 720 Td (Synthetic page two) Tj ET'];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${streams[0]!.length} >>\nstream\n${streams[0]}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>',
    `<< /Length ${streams[1]!.length} >>\nstream\n${streams[1]}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((body, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return output + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}
test('PDF arguments are local-only, bounded, fixed options, and never a shell string', () => {
  expect(pdfTextArguments('synthetic.pdf', { firstPage: 2, lastPage: 2, mode: 'bbox-layout' })).toContain('-bbox-layout');
  expect(() => pdfTextArguments('https://example.org/test.pdf', { firstPage: 1, lastPage: 1, mode: 'layout' })).toThrow();
  for (const changed of [{ firstPage: 0 }, { lastPage: 30 }, { lastPage: 0 }, { mode: 'unknown' }]) {
    expect(() => pdfTextArguments('synthetic.pdf', { firstPage: 1, lastPage: 1, mode: 'layout', ...changed } as any)).toThrow();
  }
});
const popplerAvailable = Boolean(Bun.which('pdftotext') && Bun.which('pdfinfo'));
test.skipIf(!popplerAvailable)('real installed Poppler extracts bounded synthetic text and bounding boxes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dc-backend-pdf-'));
  try {
    const path = join(directory, 'synthetic.pdf'); await Bun.write(path, syntheticPdf());
    const layout = await extractPdfText(path, { firstPage: 2, lastPage: 2, mode: 'layout' });
    expect(layout.text).toContain('Synthetic page two'); expect(layout.text).not.toContain('page one');
    expect(layout.pdfPageCount).toBe(2); expect(layout.textLayer).toBe('present');
    expect(layout.sha256).toMatch(/^[a-f0-9]{64}$/); expect(layout.toolVersion).toMatch(/^\d+\.\d+/);
    const boxes = await extractPdfText(path, { firstPage: 1, lastPage: 1, mode: 'bbox-layout' });
    expect(boxes.text).toContain('<word'); expect(boxes.text).toContain('xMin='); expect(boxes.sha256).toBe(layout.sha256);
    await expect(extractPdfText(path, { firstPage: 1, lastPage: 3, mode: 'layout' })).rejects.toThrow('page_count_unverified');
    const invalid = join(directory, 'invalid.pdf'); await Bun.write(invalid, 'not a PDF');
    await expect(extractPdfText(invalid, { firstPage: 1, lastPage: 1, mode: 'layout' })).rejects.toThrow('signature_invalid');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
