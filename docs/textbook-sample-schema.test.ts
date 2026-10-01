import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import manifestJson from './textbook-sample-manifest.json';
import catalog from './textbook-sample-catalog.json';
import { validateTextbookSampleManifest, type TextbookSampleManifest } from './textbook-sample-schema';

const sample = () => structuredClone(manifestJson) as TextbookSampleManifest;

describe('textbook sample evidence boundaries', () => {
  test('current structural manifest validates', () => {
    expect(validateTextbookSampleManifest(sample())).toEqual([]);
    expect(sample().books).toHaveLength(2);
  });
  test('catalog contains exactly 36 unique observed middle-school URLs', () => {
    expect(catalog.samples).toHaveLength(36);
    expect(new Set(catalog.samples.map((b) => b.sourceUrl)).size).toBe(36);
    expect(catalog.samples.every((b) => /^https:\/\/storage\.studyq\.net\/data\/answer\/mi\/book\/g[7-9]_[a-z]+_sample_[1-2]_[1-4]\.pdf$/.test(b.sourceUrl))).toBe(true);
  });
  test('catalog provenance hash matches committed catalog bytes without PDF access', async () => {
    const bytes = await Bun.file(new URL('./textbook-sample-catalog.json', import.meta.url)).bytes();
    const source = sample().sources.find((s) => s.kind === 'catalog_dom');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source!.sha256!);
  });
  test('cover code is separate from filename-derived normalized key', () => {
    const [a,b] = sample().books;
    expect(a!.academyBookCode.value).toBe('1N82');
    expect(a!.coverIdentity.version.value).toBe('2');
    expect(b!.academyBookCode.value).toBe('1N87');
    expect(b!.coverIdentity.version.value).toBe('1');
    expect(a!.normalizedBookCode.state).toBe('inferred');
  });
  test('TOC beyond sample pages does not become full-book body coverage', () => {
    const m = sample();
    expect(m.books[0]!.pdf.pdfPageCount).toBe(44);
    expect(m.books[1]!.pdf.pdfPageCount).toBe(40);
    expect(m.books[0]!.tocNodes.find((n) => n.level === 'answers')!.printedPages.start.value).toBe(153);
    expect(m.books[1]!.tocNodes.find((n) => n.level === 'answers')!.printedPages.start.value).toBe(181);
    expect(m.books.every((b) => b.coverage.fullBookQuestionInventory === 'unknown')).toBe(true);
  });
  test('unknown evidence cannot carry a guessed edition value', () => {
    const m = sample(); m.books[0]!.edition.state = 'unknown';
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.edition:unknown_has_value');
  });
  test('computed interval end cannot masquerade as observed', () => {
    const m = sample(); m.books[0]!.tocNodes[0]!.printedPages.endInclusive.state = 'observed';
    expect(validateTextbookSampleManifest(m).some((e) => e.endsWith(':inferred_end_mislabeled'))).toBe(true);
  });
  test('printed TOC interval cannot become a PDF interval', () => {
    const m = sample(); m.books[0]!.tocNodes[0]!.printedPages.coordinate = 'pdf_page';
    expect(validateTextbookSampleManifest(m).some((e) => e.endsWith(':mixed_page_coordinates'))).toBe(true);
  });
  test('section observations outside sample fail', () => {
    const m = sample(); m.books[0]!.sectionObservations[0]!.pdfPages = [100];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:invalid_section_pdf_page');
  });
  test('download needs a hash, byte count and actual PDF page count', () => {
    const m = sample(); m.books[0]!.pdf.sha256 = null;
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:invalid_download_provenance');
  });
  test('section and edition observations require resolvable source evidence', () => {
    const m = sample(); m.books[0]!.coverIdentity.version.sourceIds = ['not-observed'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.coverIdentity.version:unknown_source_id');
  });
  test('hierarchy rejects cycles', () => {
    const m = sample(); const [a,b] = m.books[0]!.tocNodes; a!.parentId=b!.id; b!.parentId=a!.id;
    expect(validateTextbookSampleManifest(m).some((e) => e.endsWith(':cyclic_hierarchy'))).toBe(true);
  });
  test('unobserved section stays unknown and item lists stay incomplete', () => {
    for(const b of sample().books) {
      expect(b.coverage.sectionKindsNotYetObserved).toEqual(['실력다지기']);
      expect(b.sectionObservations.every((s) => s.itemInventoryComplete === false && s.observedItemLabels.length === 0)).toBe(true);
    }
  });
  test('a well-formed but unrelated PDF hash fails source binding', () => {
    const m = sample(); m.books[0]!.pdf.sha256 = 'a'.repeat(64);
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:incoherent_pdf_source');
  });
  test('PDF source IDs must resolve to matching public PDF records', () => {
    const m = sample(); m.books[0]!.pdf.sourceIds = ['missing'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.pdf:unknown_source_id');
    m.books[0]!.pdf.sourceIds = ['gauss-1-2-3-pdf'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:incoherent_pdf_source');
  });
  test('a cover source from the other book cannot establish this cover', () => {
    const m = sample(); m.books[0]!.pageObservations[0]!.sourceIds = ['gauss-1-2-3-p1'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.page.1:incoherent_page_source');
  });
  test('same-book source still needs the exact observed PDF page', () => {
    const m = sample(); m.books[0]!.pageObservations[0]!.sourceIds = ['gauss-1-1-1-p10'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.page.1:incoherent_page_source');
  });
  test('observed edition cannot cite a different book', () => {
    const m = sample(); m.books[0]!.edition.sourceIds = ['gauss-1-2-3-p1'];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.edition:cross_book_source');
  });
  test('minor units cannot be children of answers', () => {
    const m = sample(); const nodes = m.books[0]!.tocNodes;
    const minor = nodes.find((n) => n.level === 'minor')!;
    minor.parentId = nodes.find((n) => n.level === 'answers')!.id;
    expect(validateTextbookSampleManifest(m)).toContain(`${minor.id}:invalid_parent_level`);
  });
  test('inferred interval must equal its actual next non-descendant TOC start minus one', () => {
    const m = sample(); m.books[0]!.tocNodes[0]!.printedPages.endInclusive.value = 900;
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1-major-1:incorrect_next_toc_end');
  });
  test('a child range cannot exceed its parent range', () => {
    const m = sample(); const minor = m.books[0]!.tocNodes.find((n) => n.level === 'minor')!;
    minor.printedPages.endInclusive.value = 900;
    expect(validateTextbookSampleManifest(m)).toContain(`${minor.id}:outside_parent_range`);
  });
  test('negative printed section page is invalid', () => {
    const m = sample(); m.books[0]!.sectionObservations[0]!.printedPages.value = [-1];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.section.개념쏙:invalid_evidence_value');
  });
  test('positive printed section page still needs the observed PDF mapping', () => {
    const m = sample(); m.books[0]!.sectionObservations[0]!.printedPages.value = [18];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:section_page_mapping_mismatch');
  });
  test('reviewed body page must exist inside this sample', () => {
    const m = sample(); m.books[0]!.coverage.bodyPdfPagesReviewed = [999];
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:invalid_reviewed_body_page');
  });
  test('cover cannot masquerade as a reviewed body page', () => {
    const m = sample(); m.books[0]!.coverage.bodyPdfPagesReviewed.push(1);
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1:invalid_reviewed_body_page');
  });
  test('unsupported runtime confidence state is rejected', () => {
    const m = sample(); m.books[0]!.edition.state = 'verified' as 'observed';
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.edition:invalid_evidence_state');
  });
  test('runtime evidence value must match its declared domain', () => {
    const m = sample(); m.books[0]!.edition.value = 42 as unknown as string;
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.edition:invalid_evidence_value');
    m.books[0]!.edition.value = '22개정'; m.books[0]!.term.value = 1.5;
    expect(validateTextbookSampleManifest(m)).toContain('gauss-1-1-1.term:invalid_evidence_value');
  });
  test('duplicate book IDs are rejected', () => {
    const m = sample(); m.books[1]!.id = m.books[0]!.id;
    expect(validateTextbookSampleManifest(m)).toContain('duplicate_book_id');
  });
});
