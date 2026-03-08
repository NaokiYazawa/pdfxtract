import { mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { convertPdf } from "./converter.js";

const { values, positionals } = parseArgs({
  options: {
    output: { type: "string", short: "o" },
    overwrite: { type: "boolean", default: false },
    verbose: { type: "boolean", short: "v", default: false },
    version: { type: "boolean", short: "V", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

if (values.version) {
  const require = createRequire(import.meta.url);
  const { version } = require("../package.json");
  console.log(`pdfxtract v${version}`);
  process.exit(0);
}

if (values.help || positionals.length === 0) {
  console.log(
    `
Usage: pdfxtract <directory> [options]

Arguments:
  directory          Directory containing PDF files to convert

Options:
  -o, --output <dir> Output directory (preserves subdirectory structure)
  --overwrite        Overwrite existing TXT files
  -v, --verbose      Show detailed output
  -V, --version      Show version number
  -h, --help         Show this help message

Examples:
  npx pdfxtract ./pdfs
  npx pdfxtract ./pdfs -o ./output
  npx pdfxtract ./pdfs -o ./output --overwrite -v
`.trim(),
  );
  process.exit(values.help ? 0 : 1);
}

const inputDir = resolve(positionals[0]);
const outputDir = values.output ? resolve(values.output) : undefined;

try {
  const s = await stat(inputDir);
  if (!s.isDirectory()) {
    console.error(`Error: "${inputDir}" is not a directory.`);
    process.exit(1);
  }
} catch {
  console.error(`Error: "${inputDir}" does not exist.`);
  process.exit(1);
}

const entries = await readdir(inputDir, { recursive: true });
const pdfFiles = entries.filter(
  (entry) => extname(entry).toLowerCase() === ".pdf",
);

if (pdfFiles.length === 0) {
  console.log("No PDF files found.");
  process.exit(0);
}

console.log(`Found ${pdfFiles.length} PDF file(s).`);

let converted = 0;
let skipped = 0;
let failed = 0;

for (const relPath of pdfFiles) {
  const pdfPath = join(inputDir, relPath);
  const txtName = `${basename(relPath, extname(relPath))}.txt`;

  let txtPath: string;
  if (outputDir) {
    const txtDir = join(outputDir, dirname(relPath));
    await mkdir(txtDir, { recursive: true });
    txtPath = join(txtDir, txtName);
  } else {
    txtPath = join(dirname(pdfPath), txtName);
  }

  if (!values.overwrite) {
    try {
      await stat(txtPath);
      if (values.verbose) {
        console.log(`  Skip: ${relPath} (TXT already exists)`);
      }
      skipped++;
      continue;
    } catch {
      // File doesn't exist, proceed
    }
  }

  try {
    await convertPdf(pdfPath, txtPath);
    converted++;
    if (values.verbose) {
      console.log(`  Done: ${relPath} -> ${relative(process.cwd(), txtPath)}`);
    }
  } catch (err) {
    failed++;
    console.error(
      `  Fail: ${relPath} - ${err instanceof Error ? err.message : err}`,
    );
  }
}

console.log(
  `\nComplete: ${converted} converted, ${skipped} skipped, ${failed} failed.`,
);
