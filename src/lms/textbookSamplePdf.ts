import { readFileSync } from 'node:fs';
import { ROUTE_REGISTRY_PATH, assertSafeRead, getRoute } from './lmsRouteRegistry';

export type GaussSamplePdfFilename = 'g7_gauss_sample_1_1.pdf' | 'g7_gauss_sample_2_3.pdf';

const catalogDirectory = 'https://storage.studyq.net/data/answer/mi/book/';
const academyOrigin = 'https://dc.gang-a.kr';
const catalogRouteTemplate = '/servlet/controller.coursemanage.CourseManageServlet?reqCmd=GaStudyAnswer';
const filenamePattern = /^g[7-9]_[a-z]+_sample_[1-2]_[1-9][0-9]*\.pdf$/;
const bookCodePattern = /^([a-z]+):([1-3])-([1-2])-([1-9][0-9]*)$/;
const maxCatalogBytes = 2_000_000;

type SamplePolicy = {
  catalog_route_id: string;
  url_prefix: string;
  filename_pattern: string;
  book_code_pattern: string;
};
type SampleRoute = {
  id?: string;
  allowed_exact_urls?: unknown;
  catalog_scoped_discovery?: SamplePolicy;
};

function sampleRoute(): SampleRoute {
  assertSafeRead('textbook_sample_pdf');
  const registry = JSON.parse(readFileSync(ROUTE_REGISTRY_PATH, 'utf8')) as { entries?: SampleRoute[] };
  const matches = registry.entries?.filter((entry) => entry.id === 'textbook_sample_pdf') ?? [];
  if (matches.length !== 1) throw new Error('sample_pdf_route_unverified');
  return matches[0];
}

/** Preserve the two dated, exact-link resolutions without widening their authority. */
export function resolveGaussSamplePdfUrl(filename: GaussSamplePdfFilename): string {
  if (filename !== 'g7_gauss_sample_1_1.pdf' && filename !== 'g7_gauss_sample_2_3.pdf') {
    throw new Error('unreviewed_sample_filename');
  }
  const route = sampleRoute();
  const expectedUrl = `${catalogDirectory}${filename}`;
  if (!Array.isArray(route.allowed_exact_urls) || !route.allowed_exact_urls.includes(expectedUrl)) {
    throw new Error('sample_pdf_exact_url_unverified');
  }
  return expectedUrl;
}

function checkedPolicy(): SamplePolicy {
  const policy = sampleRoute().catalog_scoped_discovery;
  if (!policy
    || policy.catalog_route_id !== 'textbook_answer_catalog'
    || policy.url_prefix !== catalogDirectory
    || policy.filename_pattern !== filenamePattern.source
    || policy.book_code_pattern !== bookCodePattern.source) {
    throw new Error('sample_pdf_discovery_policy_unverified');
  }
  assertSafeRead(policy.catalog_route_id);
  const catalogRoute = getRoute(policy.catalog_route_id);
  if (catalogRoute.httpMethod !== 'GET' || catalogRoute.routeTemplate !== catalogRouteTemplate) {
    throw new Error('sample_pdf_catalog_route_unverified');
  }
  return policy;
}

function filenameForBookCode(bookCode: string): string {
  const match = bookCode.match(bookCodePattern);
  if (!match) throw new Error('sample_pdf_book_code_unverified');
  const filename = `g${Number(match[2]) + 6}_${match[1]}_sample_${match[3]}_${match[4]}.pdf`;
  if (!filenamePattern.test(filename)) throw new Error('sample_pdf_filename_unverified');
  return filename;
}

async function readCatalogHtml(response: Response): Promise<string> {
  if (response.status !== 200
    || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'text/html') {
    throw new Error('sample_pdf_catalog_response_unverified');
  }
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (!Number.isFinite(declaredLength) || declaredLength > maxCatalogBytes) {
    throw new Error('sample_pdf_catalog_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('sample_pdf_catalog_empty');
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxCatalogBytes) {
      await reader.cancel();
      throw new Error('sample_pdf_catalog_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const html = new TextDecoder().decode(bytes);
  if (/<input\b[^>]*type\s*=\s*["']password["']/i.test(html)) {
    throw new Error('sample_pdf_catalog_authentication_required');
  }
  return html;
}

/** Fetch the fixed authenticated catalog and resolve one matching sample link in memory. */
export async function discoverSamplePdfUrl(
  bookCode: string,
  session: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  checkedPolicy();
  const filename = filenameForBookCode(bookCode);
  if (!/^[A-Fa-f0-9]{32}$/.test(session)) throw new Error('sample_pdf_session_input_invalid');
  const response = await fetchImpl(new URL(catalogRouteTemplate, academyOrigin), {
    method: 'GET',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    headers: { Cookie: `JSESSIONID=${session}`, Accept: 'text/html' },
  });
  const html = await readCatalogHtml(response);
  const expectedUrl = `${catalogDirectory}${filename}`;
  let found = false;
  for (const match of html.matchAll(/fullUrlDownloadFile\s*\(\s*['"]([^'"<>\s]+)['"]\s*\)/g)) {
    const raw = match[1];
    let url: URL;
    try { url = new URL(raw); } catch { continue; }
    if (url.pathname.split('/').at(-1) !== filename) continue;
    if (raw !== expectedUrl) throw new Error('sample_pdf_catalog_link_outside_policy');
    found = true;
  }
  if (!found) throw new Error('sample_pdf_book_link_absent');
  return expectedUrl;
}
