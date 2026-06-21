// SPDX-License-Identifier: Apache-2.0
//
// OCR provider registry. The ingestion pipeline calls `getOcrProvider()` to
// resolve the configured engine; swapping engines is an env change, not a code
// change. Claude is the default; `mistral` is reserved for a future, cheaper
// per-page provider; `none` disables OCR (scanned PDFs then fail loud).
import { claudeOcrProvider } from './claude';
import { mistralOcrProvider } from './mistral';
import type { OcrProvider } from './types';

export * from './types';
export { claudeOcrProvider, DEFAULT_OCR_MODEL } from './claude';
export { mistralOcrProvider, DEFAULT_MISTRAL_OCR_MODEL } from './mistral';

/**
 * Resolve the OCR provider named by `OCR_PROVIDER` (default `claude`).
 * Returns `null` when OCR is disabled (`none`/`off`/`disabled`), in which case
 * a textless PDF fails with a clear error instead of being OCR'd.
 *
 * - `claude`  — reuses `ANTHROPIC_API_KEY`; no new vendor, but its output
 *   content filter blocks verbatim reproduction of standardized text
 *   (e.g. boilerplate legal notices common in contracts).
 * - `mistral` — dedicated OCR engine (`MISTRAL_API_KEY`); no such filter and
 *   cheaper per page. Recommended for document/contract corpora.
 */
export function getOcrProvider(name = process.env.OCR_PROVIDER): OcrProvider | null {
  switch ((name ?? 'claude').toLowerCase()) {
    case 'none':
    case 'off':
    case 'disabled':
      return null;
    case '':
    case 'claude':
      return claudeOcrProvider;
    case 'mistral':
      return mistralOcrProvider;
    default:
      throw new Error(`Unknown OCR_PROVIDER "${name}". Valid values: claude, mistral, none.`);
  }
}
