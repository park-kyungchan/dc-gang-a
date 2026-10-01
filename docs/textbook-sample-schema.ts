/** Structural metadata only. Do not store textbook prose, problems, answers or student data. */
export type EvidenceState = 'observed' | 'inferred' | 'unknown';
export interface Evidence<T> {
  state: EvidenceState;
  value: T | null;
  sourceIds: string[];
  note?: string;
}
export interface TextbookSource {
  id: string;
  kind: 'catalog_dom' | 'public_pdf' | 'pdf_page' | 'historical_manifest';
  url: string | null;
  observedAtUtc: string | null;
  localReference: string | null;
  /** Hash of source artifact bytes. For pdf_page, this is the PDF file, not a page render. */
  sha256: string | null;
  /** One-based file page, never a printed page number. */
  pdfPage: number | null;
  method: string;
}
export interface PageInterval {
  coordinate: 'printed_page' | 'pdf_page';
  start: Evidence<number>;
  endInclusive: Evidence<number>;
  /** TOC adjacency gives an inferred end, not body-page coverage. */
  derivation: 'direct_page_observation' | 'toc_start' | 'next_toc_start_minus_one' | 'unknown';
}
export interface TextbookTocNode {
  id: string;
  parentId: string | null;
  level: 'major' | 'middle' | 'minor' | 'assessment' | 'answers';
  order: number;
  /** Marker printed in the TOC, distinct from the normalized node ID/order. */
  printedOrdinal: Evidence<string>;
  title: Evidence<string>;
  printedPages: PageInterval;
}
export interface TextbookPageObservation {
  pdfPage: number;
  printedPage: Evidence<number>;
  kind: 'cover' | 'front_matter' | 'toc' | 'body' | 'answers' | 'unknown';
  sourceIds: string[];
}
export const SECTION_KINDS = ['필수예제', '유형다지기', '실력다지기', '개념쏙', '생각쏙'] as const;
export type SectionKind = typeof SECTION_KINDS[number];
export interface TextbookSectionObservation {
  kind: SectionKind;
  state: 'observed';
  tocNodeId: string | null;
  pdfPages: number[];
  printedPages: Evidence<number[]>;
  sourceIds: string[];
  /** Optional numbered labels only. No copied question text. */
  observedItemLabels: string[];
  itemInventoryComplete: false;
}
export interface TextbookSampleEntry {
  id: string;
  title: Evidence<string>;
  series: Evidence<string>;
  academyBookCode: Evidence<string>;
  /** Filename-derived local key is separate from an academy-assigned book ID. */
  normalizedBookCode: Evidence<string>;
  edition: Evidence<string>;
  grade: Evidence<string>;
  term: Evidence<number>;
  volume: Evidence<number>;
  coverIdentity: {
    printedCourseTitle: Evidence<string>;
    version: Evidence<string>;
    lastRevisionLabel: Evidence<string>;
  };
  pdf: {
    sourceUrl: Evidence<string>;
    filename: string;
    downloadStatus: 'downloaded' | 'blocked' | 'not_attempted';
    downloadedAtUtc: string | null;
    sha256: string | null;
    bytes: number | null;
    pdfPageCount: number | null;
    sourceIds: string[];
  };
  tocNodes: TextbookTocNode[];
  pageObservations: TextbookPageObservation[];
  sectionObservations: TextbookSectionObservation[];
  coverage: {
    scope: 'sample_only';
    bodyPdfPagesReviewed: number[];
    fullBookQuestionInventory: 'unknown';
    studentAssignment: 'unknown';
    sectionKindsNotYetObserved: SectionKind[];
    limitations: string[];
  };
}
export interface TextbookSampleManifest {
  schemaVersion: 1;
  asOfUtc: string;
  status: 'partial' | 'blocked';
  catalog: {
    url: string;
    currentAuthenticatedCatalogObserved: boolean;
    completeness: 'unknown' | 'current_visible_catalog_only';
    blocker: string | null;
  };
  sources: TextbookSource[];
  books: TextbookSampleEntry[];
  boundaries: string[];
}

/**
 * Semantic validator for records already shaped as TextbookSampleManifest.
 * It is not a total parser for arbitrary/missing JSON structures. It does validate
 * runtime evidence enums/value types and rejects contradictory typed records.
 * Hash coherence is checked here; actual source-byte hashes require the caller's
 * file receipt (the portable test checks catalog bytes without private PDF files).
 */
export function validateTextbookSampleManifest(manifest: TextbookSampleManifest): string[] {
  const errors: string[] = [];
  const fail = (path: string, code: string) => errors.push(`${path}:${code}`);
  const positiveInteger = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
  const textValue = (s: unknown): s is string => typeof s === 'string' && s.trim().length > 0;
  const unique = (xs: unknown[]) => new Set(xs).size === xs.length;
  const hash = (s: unknown) => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
  const pageNumber = (n: unknown) => n === null || positiveInteger(n);
  const sourceMap = new Map(manifest.sources.map((s) => [s.id, s]));
  if (manifest.schemaVersion !== 1) errors.push('unsupported_schema_version');
  if (!['partial', 'blocked'].includes(manifest.status)) errors.push('invalid_manifest_status');
  if (sourceMap.size !== manifest.sources.length) errors.push('duplicate_source_id');
  if (!unique(manifest.books.map((b) => b.id))) errors.push('duplicate_book_id');
  for (const source of manifest.sources) {
    if (!['catalog_dom', 'public_pdf', 'pdf_page', 'historical_manifest'].includes(source.kind)) fail(source.id, 'invalid_source_kind');
    if (source.sha256 !== null && !hash(source.sha256)) fail(source.id, 'invalid_source_hash');
    if (source.kind === 'pdf_page' && !positiveInteger(source.pdfPage)) fail(source.id, 'invalid_source_pdf_page');
    if (source.kind !== 'pdf_page' && source.pdfPage !== null) fail(source.id, 'unexpected_source_pdf_page');
  }
  const resolveSources = (ids: string[], path: string): TextbookSource[] => {
    if (!Array.isArray(ids) || ids.some((id) => !textValue(id))) { fail(path, 'invalid_source_ids'); return []; }
    if (!unique(ids)) fail(path, 'duplicate_source_ids');
    if (ids.some((id) => !sourceMap.has(id))) fail(path, 'unknown_source_id');
    return ids.flatMap((id) => sourceMap.has(id) ? [sourceMap.get(id)!] : []);
  };
  const evidence = (value: Evidence<unknown>, path: string, validValue: (v: unknown) => boolean, book?: TextbookSampleEntry) => {
    if (!['observed', 'inferred', 'unknown'].includes(value.state)) fail(path, 'invalid_evidence_state');
    if (value.state === 'unknown' && value.value !== null) fail(path, 'unknown_has_value');
    if (value.state !== 'unknown' && (value.value === null || !value.sourceIds.length)) fail(path, 'missing_evidence');
    if (value.value !== null && !validValue(value.value)) fail(path, 'invalid_evidence_value');
    for (const source of resolveSources(value.sourceIds, path)) {
      if (book && ['public_pdf', 'pdf_page'].includes(source.kind) && (source.url !== book.pdf.sourceUrl.value || source.sha256 !== book.pdf.sha256)) fail(path, 'cross_book_source');
    }
  };
  const inPdf = (p: unknown, book: TextbookSampleEntry) => positiveInteger(p) && positiveInteger(book.pdf.pdfPageCount) && p <= book.pdf.pdfPageCount;
  const pageSources = (ids: string[], pages: number[], book: TextbookSampleEntry, path: string) => {
    const sources = resolveSources(ids, path);
    if (!ids.length || sources.length !== ids.length) fail(path, 'invalid_page_source');
    for (const s of sources) {
      if (s.kind !== 'pdf_page' || s.url !== book.pdf.sourceUrl.value || s.sha256 !== book.pdf.sha256 || !pages.includes(s.pdfPage!)) fail(path, 'incoherent_page_source');
    }
    for (const page of pages) if (!sources.some((s) => s.kind === 'pdf_page' && s.pdfPage === page && s.url === book.pdf.sourceUrl.value && s.sha256 === book.pdf.sha256)) fail(path, 'missing_page_source');
  };
  for (const book of manifest.books) {
    if (!textValue(book.id)) errors.push('invalid_book_id');
    for (const key of ['title', 'series', 'academyBookCode', 'normalizedBookCode', 'edition', 'grade'] as const) evidence(book[key], `${book.id}.${key}`, textValue, book);
    for (const key of ['term', 'volume'] as const) evidence(book[key], `${book.id}.${key}`, positiveInteger, book);
    evidence(book.pdf.sourceUrl, `${book.id}.pdf.sourceUrl`, textValue);
    for (const key of ['printedCourseTitle', 'version', 'lastRevisionLabel'] as const) evidence(book.coverIdentity[key], `${book.id}.coverIdentity.${key}`, textValue, book);
    if (!['downloaded', 'blocked', 'not_attempted'].includes(book.pdf.downloadStatus)) fail(book.id, 'invalid_download_status');
    if (book.pdf.downloadStatus === 'downloaded' && (!hash(book.pdf.sha256) || !positiveInteger(book.pdf.bytes) || !positiveInteger(book.pdf.pdfPageCount))) fail(book.id, 'invalid_download_provenance');
    const pdfSources = resolveSources(book.pdf.sourceIds, `${book.id}.pdf`);
    if (book.pdf.downloadStatus === 'downloaded' && !book.pdf.sourceIds.length) fail(book.id, 'missing_pdf_source');
    for (const source of pdfSources) {
      if (source.kind !== 'public_pdf' || source.url !== book.pdf.sourceUrl.value || source.sha256 !== book.pdf.sha256 || source.pdfPage !== null) fail(book.id, 'incoherent_pdf_source');
    }
    if (book.pdf.sourceUrl.value !== null) {
      try { if (new URL(book.pdf.sourceUrl.value).pathname.split('/').at(-1) !== book.pdf.filename) fail(book.id, 'pdf_filename_url_mismatch'); }
      catch { fail(book.id, 'invalid_pdf_url'); }
    }
    if (book.coverage.scope !== 'sample_only' || book.coverage.fullBookQuestionInventory !== 'unknown' || book.coverage.studentAssignment !== 'unknown') fail(book.id, 'unverified_completeness_or_assignment');
    const nodeMap = new Map(book.tocNodes.map((n) => [n.id, n]));
    if (nodeMap.size !== book.tocNodes.length) fail(book.id, 'duplicate_toc_node_id');
    if (!unique(book.tocNodes.map((n) => n.order))) fail(book.id, 'duplicate_toc_order');
    const validParent: Record<TextbookTocNode['level'], TextbookTocNode['level'] | null> = { major: null, middle: 'major', minor: 'middle', assessment: 'major', answers: null };
    const descendantOf = (candidate: TextbookTocNode, node: TextbookTocNode) => {
      const visited = new Set<string>();
      let ancestor = candidate.parentId;
      while (ancestor !== null && nodeMap.has(ancestor) && !visited.has(ancestor)) {
        if (ancestor === node.id) return true;
        visited.add(ancestor); ancestor = nodeMap.get(ancestor)!.parentId;
      }
      return false;
    };
    for (const node of book.tocNodes) {
      const parent = node.parentId === null ? undefined : nodeMap.get(node.parentId);
      if (node.parentId !== null && (!parent || node.parentId === node.id)) fail(node.id, 'invalid_parent');
      if (!(node.level in validParent)) fail(node.id, 'invalid_toc_level');
      else if (validParent[node.level] === null ? node.parentId !== null : parent?.level !== validParent[node.level]) fail(node.id, 'invalid_parent_level');
      if (!positiveInteger(node.order) || (parent && parent.order >= node.order)) fail(node.id, 'invalid_toc_order');
      const visited = new Set([node.id]);
      let ancestor = node.parentId;
      while (ancestor !== null && nodeMap.has(ancestor)) {
        if (visited.has(ancestor)) { fail(node.id, 'cyclic_hierarchy'); break; }
        visited.add(ancestor); ancestor = nodeMap.get(ancestor)!.parentId;
      }
      evidence(node.title, `${node.id}.title`, textValue, book);
      evidence(node.printedOrdinal, `${node.id}.printedOrdinal`, textValue, book);
      evidence(node.printedPages.start, `${node.id}.start`, positiveInteger, book);
      evidence(node.printedPages.endInclusive, `${node.id}.end`, positiveInteger, book);
      if (node.printedPages.coordinate !== 'printed_page') fail(node.id, 'mixed_page_coordinates');
      const { start, endInclusive, derivation } = node.printedPages;
      if (!['direct_page_observation', 'toc_start', 'next_toc_start_minus_one', 'unknown'].includes(derivation)) fail(node.id, 'invalid_interval_derivation');
      if (!pageNumber(start.value) || !pageNumber(endInclusive.value)) fail(node.id, 'invalid_page');
      if (start.value !== null && endInclusive.value !== null && start.value > endInclusive.value) fail(node.id, 'reversed_page_interval');
      if (parent) {
        const ps = parent.printedPages.start.value, pe = parent.printedPages.endInclusive.value;
        if ((ps !== null && start.value !== null && start.value < ps) || (pe !== null && endInclusive.value !== null && endInclusive.value > pe)) fail(node.id, 'outside_parent_range');
      }
      if (derivation === 'next_toc_start_minus_one') {
        if (endInclusive.state !== 'inferred') fail(node.id, 'inferred_end_mislabeled');
        const next = book.tocNodes.filter((n) => n.order > node.order && !descendantOf(n, node)).sort((a, b) => a.order - b.order)[0];
        if (!positiveInteger(next?.printedPages.start.value) || endInclusive.value !== next.printedPages.start.value - 1) fail(node.id, 'incorrect_next_toc_end');
      }
    }
    const pageMap = new Map(book.pageObservations.map((p) => [p.pdfPage, p]));
    if (pageMap.size !== book.pageObservations.length) fail(book.id, 'duplicate_page_observation');
    for (const page of book.pageObservations) {
      if (!inPdf(page.pdfPage, book)) fail(book.id, 'invalid_pdf_page');
      if (!['cover', 'front_matter', 'toc', 'body', 'answers', 'unknown'].includes(page.kind)) fail(book.id, 'invalid_page_kind');
      evidence(page.printedPage, `${book.id}.page.${page.pdfPage}`, positiveInteger, book);
      if (!pageNumber(page.printedPage.value)) fail(book.id, 'invalid_printed_page');
      pageSources(page.sourceIds, [page.pdfPage], book, `${book.id}.page.${page.pdfPage}`);
      if (page.printedPage.state !== 'unknown') pageSources(page.printedPage.sourceIds, [page.pdfPage], book, `${book.id}.page.${page.pdfPage}.printedPage`);
    }
    if (!unique(book.coverage.bodyPdfPagesReviewed)) fail(book.id, 'duplicate_reviewed_page');
    for (const page of book.coverage.bodyPdfPagesReviewed) {
      if (!inPdf(page, book) || pageMap.get(page)?.kind !== 'body') fail(book.id, 'invalid_reviewed_body_page');
    }
    for (const section of book.sectionObservations) {
      const path = `${book.id}.section.${section.kind}`;
      if (!SECTION_KINDS.includes(section.kind) || section.state !== 'observed' || !section.sourceIds.length || !section.pdfPages.length || section.itemInventoryComplete !== false) fail(book.id, 'invalid_section_observation');
      const node = section.tocNodeId === null ? undefined : nodeMap.get(section.tocNodeId);
      if (section.tocNodeId !== null && (!node || node.level !== 'minor')) fail(book.id, 'invalid_section_node');
      if (!unique(section.pdfPages) || section.pdfPages.some((p) => !inPdf(p, book))) fail(book.id, 'invalid_section_pdf_page');
      if (section.pdfPages.some((p) => pageMap.get(p)?.kind !== 'body' || !book.coverage.bodyPdfPagesReviewed.includes(p))) fail(book.id, 'unreviewed_section_page');
      pageSources(section.sourceIds, section.pdfPages, book, path);
      evidence(section.printedPages, path, (v) => Array.isArray(v) && v.length > 0 && unique(v) && v.every(positiveInteger), book);
      if (section.printedPages.state === 'observed' && Array.isArray(section.printedPages.value)) {
        pageSources(section.printedPages.sourceIds, section.pdfPages, book, `${path}.printedPages`);
        const expected = section.pdfPages.map((p) => pageMap.get(p)?.printedPage);
        if (expected.some((e) => e?.state !== 'observed') || JSON.stringify(expected.map((e) => e?.value)) !== JSON.stringify(section.printedPages.value)) fail(book.id, 'section_page_mapping_mismatch');
      }
      if (node && Array.isArray(section.printedPages.value) && section.printedPages.value.some((p) => (node.printedPages.start.value !== null && p < node.printedPages.start.value) || (node.printedPages.endInclusive.value !== null && p > node.printedPages.endInclusive.value))) fail(book.id, 'section_outside_toc_range');
    }
    const unobserved = SECTION_KINDS.filter((k) => !book.sectionObservations.some((s) => s.kind === k));
    if (!unique(book.coverage.sectionKindsNotYetObserved) || book.coverage.sectionKindsNotYetObserved.some((k) => !SECTION_KINDS.includes(k)) || unobserved.length !== book.coverage.sectionKindsNotYetObserved.length || unobserved.some((k) => !book.coverage.sectionKindsNotYetObserved.includes(k))) fail(book.id, 'inconsistent_unobserved_sections');
  }
  return [...new Set(errors)];
}
