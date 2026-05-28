// SPDX-License-Identifier: Apache-2.0
// One-shot helper: emits `hello.pdf` next to this script. Tiny single-page
// PDF containing the text "Hello World", used by extract.test.ts to verify
// the unpdf-wrapping extractor against a real PDF without pulling in a
// PDF-generator dependency at runtime.
//
// Run: `node apps/web/test/fixtures/make-hello-pdf.mjs`. Re-run only if the
// fixture is lost; the produced file is the source of truth for the test.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const objects = [
  '<</Type /Catalog /Pages 2 0 R>>',
  '<</Type /Pages /Kids [3 0 R] /Count 1>>',
  '<</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>>',
  '<</Length 44>>\nstream\nBT /F1 24 Tf 72 720 Td (Hello World) Tj ET\nendstream',
  '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica>>',
];

let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const offsets = [0];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});

const xrefStart = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objects.length + 1}\n`;
pdf += '0000000000 65535 f \n';
for (let i = 1; i <= objects.length; i++) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<</Size ${objects.length + 1} /Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

const out = join(dirname(fileURLToPath(import.meta.url)), 'hello.pdf');
writeFileSync(out, Buffer.from(pdf, 'latin1'));
console.log(`Wrote ${out} (${Buffer.byteLength(pdf, 'latin1')} bytes)`);
