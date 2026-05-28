// SPDX-License-Identifier: Apache-2.0
//
// Pure extraction logic — no Supabase / Inngest SDK imports — so unit tests
// can exercise the state-machine transitions without touching the
// `server-only`-guarded admin client. The Inngest function that wires this
// up to real deps lives in extract.function.ts.
import { extractText, getDocumentProxy } from 'unpdf';
import type { DocumentUploadedData } from '../client';

/**
 * Output of the pure extractor — a per-page text array plus the page count,
 * the only fields persisted by this step. Later steps consume `pages` from
 * the Inngest event chain rather than re-extracting.
 */
export interface ExtractionResult {
  pages: string[];
  pageCount: number;
}

/**
 * Dependencies for the pure extraction routine. Production wires these to
 * the real Supabase + unpdf calls; unit tests provide stubs so the routine
 * can be exercised without touching storage, a real PDF runtime, or the DB.
 */
export interface ExtractionDeps {
  download: (objectKey: string) => Promise<Uint8Array>;
  extract: (pdf: Uint8Array) => Promise<ExtractionResult>;
  setState: (documentId: string, patch: Record<string, unknown>) => Promise<void>;
}

/**
 * Extract text from a freshly uploaded PDF via unpdf. Splits per-page so the
 * downstream chunker can attribute chunks to pages without re-paginating.
 */
export async function extractPdfPages(pdf: Uint8Array): Promise<ExtractionResult> {
  const proxy = await getDocumentProxy(pdf);
  const { text, totalPages } = await extractText(proxy, { mergePages: false });
  // `mergePages: false` always returns string[]; the union in unpdf's d.ts is
  // for the alternative overload.
  const pages = Array.isArray(text) ? text : [text];
  return { pages, pageCount: totalPages };
}

/**
 * Drive a single document through the `extracting → chunking` transition.
 * Pure with respect to its `deps` argument so it's exhaustively unit-testable.
 *
 * Behavior:
 *   1. Mark the row `extracting`.
 *   2. Download the storage object and extract text + page count.
 *   3. Mark the row `chunking` with `page_count` persisted.
 *   4. On any thrown error: mark the row `failed` with `ingestion_error`
 *      set to the error message, then rethrow so Inngest records the
 *      failure and applies the configured retry policy.
 *
 * The returned `ExtractionResult` is what later pipeline steps (chunking,
 * embedding — landing in chunk #12) consume.
 */
export async function runExtraction(
  deps: ExtractionDeps,
  event: DocumentUploadedData,
): Promise<ExtractionResult> {
  const { document_id, storage_object_key } = event;
  try {
    await deps.setState(document_id, { ingestion_state: 'extracting', ingestion_error: null });
    const pdf = await deps.download(storage_object_key);
    const result = await deps.extract(pdf);
    await deps.setState(document_id, {
      ingestion_state: 'chunking',
      page_count: result.pageCount,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.setState(document_id, {
      ingestion_state: 'failed',
      ingestion_error: message,
    });
    throw err;
  }
}

