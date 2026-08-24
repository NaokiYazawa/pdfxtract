import { readFile, writeFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

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

export async function convertPdf(
  pdfPath: string,
  txtPath: string,
): Promise<void> {
  const buffer = await readFile(pdfPath);
  const pdf = await getDocumentProxy(new Uint8Array(buffer), {
    verbosity: VERBOSITY_ERRORS,
  });
  try {
    const { text } = await extractText(pdf, { mergePages: true });
    await writeFile(txtPath, dehyphenate(text), "utf-8");
  } finally {
    await pdf.loadingTask.destroy();
  }
}
