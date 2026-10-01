import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

export type PdfTextMode = 'layout' | 'bbox-layout';
export interface PdfPageWindow { firstPage: number; lastPage: number; mode: PdfTextMode }
const MAX_PDF_BYTES = 32 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export function pdfTextArguments(path: string, window: PdfPageWindow): string[] {
  if (!path || /^[a-z][a-z0-9+.-]*:\/\//i.test(path) || path.includes('\0')) throw new Error('pdf_local_file_required');
  if (!Number.isSafeInteger(window.firstPage) || !Number.isSafeInteger(window.lastPage)
    || window.firstPage < 1 || window.lastPage < window.firstPage || window.lastPage - window.firstPage >= 20
    || !['layout', 'bbox-layout'].includes(window.mode)) throw new Error('pdf_page_window_invalid');
  return ['-f', String(window.firstPage), '-l', String(window.lastPage), '-enc', 'UTF-8', `-${window.mode}`, resolve(path), '-'];
}

/** Local approved PDFs only. No download, OCR, installation, source-text logging, or output persistence. */
export async function extractPdfText(path: string, window: PdfPageWindow) {
  const args = pdfTextArguments(path, window);
  const file = Bun.file(resolve(path));
  if (!(await file.exists()) || file.size < 5 || file.size > MAX_PDF_BYTES) throw new Error('pdf_file_size_invalid');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('pdf_signature_invalid');
  const executable = Bun.which('pdftotext');
  const infoExecutable = Bun.which('pdfinfo');
  if (!executable || !infoExecutable) throw new Error('pdf_poppler_unavailable');
  const version = spawnSync(executable, ['-v'], { encoding: 'utf8', timeout: 5_000, maxBuffer: 16_384 });
  const toolVersion = `${version.stdout ?? ''}\n${version.stderr ?? ''}`.match(/pdftotext version ([0-9.]+)/)?.[1];
  if (version.status !== 0 || !toolVersion) throw new Error('pdf_poppler_version_unverified');
  const info = spawnSync(infoExecutable, ['-'], { input: bytes, encoding: 'utf8', timeout: 15_000, maxBuffer: 65_536 });
  const pdfPageCount = Number(info.stdout?.match(/^Pages:\s+(\d+)$/m)?.[1]);
  if (info.error || info.status !== 0 || !Number.isSafeInteger(pdfPageCount) || pdfPageCount < window.lastPage) {
    throw new Error('pdf_page_count_unverified');
  }
  // Feed the exact hashed bytes over stdin, avoiding a file-change race between hash and extraction.
  const output = spawnSync(executable, [...args.slice(0, -2), '-', '-'], {
    input: bytes, encoding: 'utf8', timeout: 15_000, maxBuffer: MAX_OUTPUT_BYTES });
  if (output.error || output.status !== 0) throw new Error('pdf_extraction_failed');
  const text = output.stdout;
  return { sha256: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'), sourceBytes: bytes.byteLength,
    pdfPageCount, pages: { firstPage: window.firstPage, lastPage: window.lastPage }, mode: window.mode, tool: 'pdftotext', toolVersion,
    textLayer: (window.mode === 'bbox-layout' ? /<word\b/.test(text) : Boolean(text.trim())) ? 'present' as const : 'missing_or_blank' as const,
    text,
    limitation: 'PDF-file page coordinates only; text and bounding boxes do not prove printed-page mapping, OCR accuracy, or visual layout acceptance.' };
}
