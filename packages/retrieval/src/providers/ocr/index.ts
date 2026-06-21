// SPDX-License-Identifier: Apache-2.0
//
// OCR provider registry. The ingestion pipeline calls `getOcrProvider()` to
// resolve the configured engine; swapping engines is an env change, not a code
// change. Claude is the default; `mistral` is reserved for a future, cheaper
// per-page provider; `none` disables OCR (scanned PDFs then fail loud).
import { claudeOcrProvider } from './claude';
import type { OcrProvider } from './types';

export * from './types';
export { claudeOcrProvider, DEFAULT_OCR_MODEL } from './claude';

/**
 * Resolve the OCR provider named by `OCR_PROVIDER` (default `claude`).
 * Returns `null` when OCR is disabled (`none`/`off`/`disabled`), in which case
 * a textless PDF fails with a clear error instead of being OCR'd.
 *
 * To add Mistral later: implement `mistralOcrProvider` (same `OcrProvider`
 * shape) and return it from the `mistral` case below — no caller changes.
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
      throw new Error(
        'OCR_PROVIDER="mistral" is not implemented yet; use "claude" or "none".',
      );
    default:
      throw new Error(`Unknown OCR_PROVIDER "${name}". Valid values: claude, none.`);
  }
}
