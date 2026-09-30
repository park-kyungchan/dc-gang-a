import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { discoverSamplePdfUrl, resolveGaussSamplePdfUrl, type GaussSamplePdfFilename } from "../src/lms/textbookSamplePdf";

const allowed = new Set<GaussSamplePdfFilename>([
  "g7_gauss_sample_1_1.pdf",
  "g7_gauss_sample_2_3.pdf",
]);
const maxBytes = 40_000_000;

async function main(): Promise<void> {
  const arg = process.argv[2];
  const isBook = arg === "--book" && process.argv.length === 4;
  if (!isBook && (!arg || !allowed.has(arg as GaussSamplePdfFilename) || process.argv.length !== 3)) {
    throw new Error("unreviewed_sample_filename");
  }
  const url = isBook
    ? await discoverSamplePdfUrl(process.argv[3], (await Bun.stdin.text()).trim())
    : resolveGaussSamplePdfUrl(arg as GaussSamplePdfFilename);
  const filename = new URL(url).pathname.split("/").at(-1)!;
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
    headers: { Accept: "application/pdf" },
  });
  if (response.status !== 200) throw new Error(`unexpected_http_status_${response.status}`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/pdf") throw new Error("unexpected_content_type");
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new Error("sample_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("invalid_pdf_response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("sample_too_large");
    }
    chunks.push(value);
  }
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (buffer.byteLength > maxBytes || new TextDecoder().decode(buffer.subarray(0, 5)) !== "%PDF-") {
    throw new Error("invalid_pdf_response");
  }
  const dir = resolve(import.meta.dir, "../scratch/gauss-samples");
  await mkdir(dir, { recursive: true });
  const output = resolve(dir, filename);
  await Bun.write(output, buffer);
  process.stdout.write(JSON.stringify({ filename, bytes: buffer.byteLength, output }) + "\n");
}

try {
  await main();
} catch (error: unknown) {
  const reason = error instanceof TypeError
    ? "network_unavailable"
    : error instanceof Error && /^(unreviewed_sample_filename|unexpected_http_status_\d+|unexpected_content_type|sample_too_large|invalid_pdf_response|sample_pdf_[a-z_]+)$/.test(error.message)
      ? error.message
      : "sample_fetch_failed";
  process.stderr.write(JSON.stringify({ status: "blocked", reason }) + "\n");
  process.exitCode = 1;
}
