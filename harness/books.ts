#!/usr/bin/env bun
import { getBook, getBookCatalog } from "../src/textbooks/bookCatalog";

function main(args = process.argv.slice(2)): number {
  const index = args.indexOf("--code");
  const code = index >= 0 ? args[index + 1] : undefined;
  const requireToc = args.includes("--require-toc");
  if (args.some((arg, i) => arg.startsWith("--") && !["--code", "--require-toc", "--json"].includes(arg))
    || (index >= 0 && (!code || code.startsWith("--")))) {
    process.stderr.write(JSON.stringify({ status: "blocked", reason: "invalid_arguments" }) + "\n");
    return 1;
  }
  try {
    const books = code ? [getBook(code)] : getBookCatalog();
    if (requireToc && books.some((book) => book.toc.status !== "image_reviewed")) {
      process.stderr.write(JSON.stringify({ status: "blocked", reason: "toc_unverified", codes: books.filter((book) => book.toc.status !== "image_reviewed").map((book) => book.code) }) + "\n");
      return 1;
    }
    process.stdout.write(JSON.stringify({ total: books.length, books }, null, 2) + "\n");
    return 0;
  } catch {
    process.stderr.write(JSON.stringify({ status: "blocked", reason: "unknown_book_code" }) + "\n");
    return 1;
  }
}

if (import.meta.main) process.exit(main());
