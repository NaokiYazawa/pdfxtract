import { readFile, writeFile } from "node:fs/promises";
import { extractText, getDocumentProxy } from "unpdf";

const VERBOSITY_ERRORS = 0;

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
    await writeFile(txtPath, text, "utf-8");
  } finally {
    pdf.destroy();
  }
}
