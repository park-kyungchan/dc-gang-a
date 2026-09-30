import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type TocSection = {
  readonly heading: string;
  readonly printedPage: number | null;
  readonly samplePage: number;
  readonly sourceImageSha256: string;
};

export type BookCatalogRecord = {
  readonly code: string;
  readonly series: "가우스" | "다빈치";
  readonly grade: string;
  readonly term: number;
  readonly volume: number;
  readonly sample_pdf: {
    readonly filename: string | null;
    readonly catalog_route_id: string;
    readonly read_route_id: string | null;
    readonly link_observed: boolean;
    readonly content_observed: boolean;
    readonly observed_at_utc?: string;
    readonly bytes?: number;
    readonly sha256?: string;
  };
  readonly toc: {
    readonly status: "pdf_unavailable" | "image_reviewed";
    readonly sections: readonly TocSection[];
    readonly verified_page_images: readonly string[];
    readonly source_pdf_page_number?: number;
    readonly printed_page_number_kind?: "book_page_not_pdf_page";
  };
  readonly assignment_binding: "unverified" | "user_supplied_book_code_only";
};

type Catalog = { schema_version: 1; books: BookCatalogRecord[] };
const path = resolve(import.meta.dir, "../../research/textbooks/book-catalog.json");

export function getBookCatalog(): readonly BookCatalogRecord[] {
  const catalog = JSON.parse(readFileSync(path, "utf8")) as Catalog;
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.books)) throw new Error("invalid_book_catalog");
  const seen = new Set<string>();
  for (const book of catalog.books) {
    if (typeof book.code !== "string" || seen.has(book.code)
      || !["가우스", "다빈치"].includes(book.series)
      || !Number.isInteger(book.term) || !Number.isInteger(book.volume)
      || !book.toc || !Array.isArray(book.toc.sections)
      || !["pdf_unavailable", "image_reviewed"].includes(book.toc.status)
      || (book.toc.status === "pdf_unavailable" && book.toc.sections.length !== 0)
      || (book.toc.status === "image_reviewed" && (
        !book.sample_pdf.content_observed
        || !/^[a-f0-9]{64}$/.test(book.sample_pdf.sha256 ?? "")
        || typeof book.toc.source_pdf_page_number !== "number"
        || !Number.isInteger(book.toc.source_pdf_page_number)
        || book.toc.printed_page_number_kind !== "book_page_not_pdf_page"
        || book.toc.sections.length === 0
        || book.toc.sections.some((section) =>
          typeof section.heading !== "string" || !section.heading
          || typeof section.printedPage !== "number"
          || !Number.isInteger(section.printedPage) || section.printedPage < 1
          || section.samplePage !== book.toc.source_pdf_page_number
          || !/^[a-f0-9]{64}$/.test(section.sourceImageSha256))))) {
      throw new Error("invalid_book_catalog");
    }
    seen.add(book.code);
  }
  return catalog.books;
}

export function getBook(code: string): BookCatalogRecord {
  const matches = getBookCatalog().filter((book) => book.code === code);
  if (matches.length !== 1) throw new Error(`book_code_unverified:${code}`);
  return matches[0];
}
