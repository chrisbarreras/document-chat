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
 * Thrown when a document cannot be turned into indexable text: a PDF with no
 * embedded text (scanned/photocopied images) AND either OCR is disabled or the
 * OCR fallback also produced nothing. Terminal and deterministic — the Inngest
 * wrapper converts it to a NonRetriableError so the pipeline fails fast with a
 * clear reason instead of retrying and producing a chunk-less, unsearchable
 * "ready" document.
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
  /**
   * Optional OCR fallback for scanned/image PDFs. Invoked only when `extract`
   * yields no embedded text. Returns transcribed per-page text. When omitted
   * (OCR disabled via `OCR_PROVIDER=none`), a textless PDF fails loud with
   * {@link NoExtractableTextError} instead.
   */
  ocr?: (pdf: Uint8Array) => Promise<{ pages: string[] }>;
  transition: (
    documentId: string,
    toState: IngestionState,
    options?: TransitionOptions,
  ) => Promise<void>;
}

/**
 * Extract text from a freshly uploaded PDF via unpdf. Splits per-page so the
 * downstream chunker can attribute chunks to pages without re-paginating.
 *
 * Pass unpdf a *copy* of the bytes: pdf.js transfers (detaches) the input
 * ArrayBuffer during parsing, which would leave the caller's `pdf` empty. The
 * OCR fallback reuses the same buffer afterwards, so detaching it here sent an
 * empty PDF to the OCR provider ("PDF cannot be empty"). The slice keeps the
 * caller's bytes intact.
 */
export async function extractPdfPages(pdf: Uint8Array): Promise<ExtractionResult> {
  const proxy = await getDocumentProxy(pdf.slice());
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
 *   3. If no embedded text, fall back to OCR (when configured); a scanned PDF
 *      thus still becomes searchable instead of dead-ending.
 *   4. Mark the row `chunking` with `page_count` persisted.
 *   5. On any thrown error: mark the row `failed` with `ingestion_error`
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
    let { pages } = result;
    // unpdf reports the true page count even for image-only PDFs; keep it.
    let { pageCount } = result;

    if (!pages.some((page) => page.trim().length > 0)) {
      // No embedded text — a scanned/image PDF. OCR it if a provider is wired.
      if (!deps.ocr) {
        throw new NoExtractableTextError(
          'No extractable text found and OCR is disabled. This PDF appears to ' +
            'be scanned images; enable OCR (OCR_PROVIDER) or upload a ' +
            'text-based PDF.',
        );
      }
      const ocr = await deps.ocr(pdf);
      pages = ocr.pages;
      if (!pageCount) pageCount = ocr.pages.length;
      if (!pages.some((page) => page.trim().length > 0)) {
        throw new NoExtractableTextError(
          'OCR produced no text for this PDF; it cannot be indexed.',
        );
      }
    }

    await deps.transition(document_id, 'chunking', { pageCount });
    return { pages, pageCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.transition(document_id, 'failed', { ingestionError: message });
    throw err;
  }
}
