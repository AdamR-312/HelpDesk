// Extract text from a PDF and write to a .txt file for upload to KV.
// Usage: node scripts/extract-pdf.mjs <input.pdf> [output.txt]

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');

const input = process.argv[2];
const output = process.argv[3] || 'rules.txt';

if (!input) {
  console.error('Usage: node scripts/extract-pdf.mjs <input.pdf> [output.txt]');
  process.exit(1);
}

const buffer = readFileSync(input);
const data = await pdfParse(buffer);

const text = data.text
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+\n/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

writeFileSync(output, text);

const tokensEstimate = Math.ceil(text.length / 4);
console.error(`Extracted ${data.numpages} pages, ${text.length} chars (~${tokensEstimate} tokens) → ${output}`);
