import { readFile, writeFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import { normalizeCharacters } from "./characters.js";
import { orderPageText } from "./reading-order.js";

type PDFDocumentProxy = Awaited<ReturnType<typeof getDocumentProxy>>;

const VERBOSITY_ERRORS = 0;
const LINE_BREAK_HYPHEN = /([A-Za-z]{2,})-\n([A-Za-z]{2,})/g;
const WORD_SEPARATOR = /[^A-Za-z'-]+/;

/**
 * Words the document spells out without crossing a line break. Fragments left
 * by hyphenation are dropped rather than flattened, so they cannot vouch for
 * themselves when `dehyphenate` consults this set.
 */
function buildVocabulary(text: string): Set<string> {
  return new Set(
    text
      .replace(LINE_BREAK_HYPHEN, "\n")
      .split(WORD_SEPARATOR)
      .filter(Boolean)
      .map((word) => word.toLowerCase()),
  );
}

/**
 * PDF.js reports every hyphen as U+002D, so one sitting before a line break is
 * ambiguous: it may be typesetting hyphenation ("prob-\nlem") or part of a real
 * compound ("machine-\nlearning"). Resolve each occurrence against the rest of
 * the document, preferring whichever spelling is attested elsewhere. When
 * neither is, keep the hyphen only if both halves stand alone as words.
 */
function dehyphenate(text: string): string {
  const vocabulary = buildVocabulary(text);

  return text.replace(
    LINE_BREAK_HYPHEN,
    (_match, head: string, tail: string) => {
      const joined = `${head}${tail}`;
      const hyphenated = `${head}-${tail}`;

      if (vocabulary.has(joined.toLowerCase())) return joined;
      if (vocabulary.has(hyphenated.toLowerCase())) return hyphenated;

      const halvesAreWords =
        vocabulary.has(head.toLowerCase()) &&
        vocabulary.has(tail.toLowerCase());
      return halvesAreWords ? hyphenated : joined;
    },
  );
}

async function extractPageText(
  pdf: PDFDocumentProxy,
  pageNumber: number,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const { items } = await page.getTextContent();
  return orderPageText(
    items
      .filter((item) => "str" in item)
      .map((item) => ({ ...item, str: normalizeCharacters(item.str) })),
  );
}

/**
 * Join pages the way unpdf's `extractText(..., { mergePages: true })` does:
 * collapse whitespace but keep line breaks, with at most one blank line.
 */
function mergePages(pages: string[]): string {
  return pages
    .join("\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
}

export async function convertPdf(
  pdfPath: string,
  txtPath: string,
): Promise<void> {
  const buffer = await readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    verbosity: VERBOSITY_ERRORS,
  });
  try {
    const pages = await Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        extractPageText(pdf, i + 1),
      ),
    );
    await writeFile(txtPath, dehyphenate(mergePages(pages)), "utf-8");
  } finally {
    await pdf.loadingTask.destroy();
  }
}
