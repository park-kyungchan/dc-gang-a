import { expect, test } from "bun:test";
import { getBook, getBookCatalog } from "../../src/textbooks/bookCatalog";

test("sample TOCs retain page provenance while student assignment stays unverified", () => {
  const books = getBookCatalog();
  expect(new Set(books.map((book) => book.code)).size).toBe(books.length);
  expect(getBook("gauss:1-1-1").sample_pdf.filename).toBe("g7_gauss_sample_1_1.pdf");
  expect(getBook("gauss:1-1-1").toc.status).toBe("image_reviewed");
  expect(getBook("gauss:1-1-1").toc.sections.find((section) => section.printedPage === 119)?.heading)
    .toBe("유리수의 계산 / 유리수의 곱셈");
  expect(getBook("gauss:1-1-1").assignment_binding).toBe("unverified");
  expect(getBook("davinci:6-2-1").toc.status).toBe("pdf_unavailable");
  expect(() => getBook("gauss:1-1-9")).toThrow();
});
