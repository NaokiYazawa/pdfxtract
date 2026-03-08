# pdfxtract

A lightweight CLI to recursively extract text from PDF files in a directory.

## Usage

```bash
npx pdfxtract <directory> [options]
```

## Options

| Option | Description |
| --- | --- |
| `-o, --output <dir>` | Output directory (preserves subdirectory structure) |
| `--overwrite` | Overwrite existing TXT files |
| `-v, --verbose` | Show detailed output |
| `-h, --help` | Show help |

## Examples

```bash
# Convert all PDFs in place
npx pdfxtract ./pdfs

# Output to a separate directory
npx pdfxtract ./pdfs -o ./output

# Overwrite existing files with verbose logging
npx pdfxtract ./pdfs -o ./output --overwrite -v
```

## Requirements

Node.js >= 20.0.0

## License

MIT
