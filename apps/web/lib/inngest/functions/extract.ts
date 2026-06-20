// SPDX-License-Identifier: Apache-2.0
//
// Pure extraction logic — no Supabase / Inngest SDK imports — so unit tests
// can exercise the state-machine transitions without touching the
// `server-only`-guarded admin client. The Inngest function that wires this
// up to real deps lives in extract.function.ts.
import { extractText, getDocumentProxy } from 'unpdf';
import type { DocumentUploadedData } from '../client';
import type { IngestionState } from '../storage';

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
 * Thrown when a PDF yields no extractable text — almost always a scanned /
 * photocopied document whose pages are images. We don't OCR in Tier 1, so this
 * is a terminal, deterministic failure: the Inngest wrapper converts it to a
 * NonRetriableError so the pipeline fails fast with a clear reason instead of
 * retrying and producing a chunk-less, unsearchable "ready" document.
 */
export class NoExtractableTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NoExtractableTextError';
  }
}

export interface TransitionOptions {
  pageCount?: number | null;
  ingestionError?: string | null;
  errorPayload?: unknown;
}

/**
 * Dependencies for the pure extraction routine. Production wires `transition`
 * to `recordIngestionTransition` so each state change also appends an
 * `ingestion_events` row.
 */
export interface ExtractionDeps {
  download: (objectKey: string) => Promise<Uint8Array>;
  extract: (pdf: Uint8Array) => Promise<ExtractionResult>;
  transition: (
    documentId: string,
    toState: IngestionState,
    options?: TransitionOptions,
  ) => Promise<void>;
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
 *   1. Mark the row `extracting` (clears any prior ingestion_error).
 *   2. Download the storage object and extract text + page count.
 *   3. Mark the row `chunking` with `page_count` persisted.
 *   4. On any thrown error: mark the row `failed` with `ingestion_error`
 *      set to the error message, then rethrow so Inngest records the
 *      failure and applies the configured retry policy.
 */
export async function runExtraction(
  deps: ExtractionDeps,
  event: DocumentUploadedData,
): Promise<ExtractionResult> {
  const { document_id, storage_object_key } = event;
  try {
    await deps.transition(document_id, 'extracting', { ingestionError: null });
    const pdf = await deps.download(storage_object_key);
    const result = await deps.extract(pdf);
    if (!result.pages.some((page) => page.trim().length > 0)) {
      throw new NoExtractableTextError(
        'No extractable text found. This PDF appears to be scanned images; ' +
          'OCR is not supported, so it cannot be indexed.',
      );
    }
    await deps.transition(document_id, 'chunking', { pageCount: result.pageCount });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.transition(document_id, 'failed', { ingestionError: message });
    throw err;
  }
}
