// SPDX-License-Identifier: Apache-2.0
//
// Pure chunking step — pages -> TextChunks via `packages/retrieval`. No
// Supabase/Inngest imports; the wrapping Inngest step lives in
// extract.function.ts.
import { chunkPages, type TextChunk } from '@document-chat/retrieval';
import type { ExtractionResult } from './extract';

/**
 * Wrap the retrieval-package `chunkPages` so the ingestion pipeline can call
 * it without re-implementing the page mapping. Pages from unpdf are 1-indexed
 * and contiguous, which is what `chunkPages` expects.
 */
export function runChunking(result: ExtractionResult): TextChunk[] {
  const pages = result.pages.map((text, i) => ({ page: i + 1, text }));
  return chunkPages(pages);
}
