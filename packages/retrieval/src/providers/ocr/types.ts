// SPDX-License-Identifier: Apache-2.0
//
// OCR provider abstraction. OCR is a *fallback* in the ingestion pipeline:
// it runs only when a PDF yields no embedded text (a scanned / photocopied
// document whose pages are images). Keeping it behind a small interface means
// the engine is a one-line swap — Claude vision today, a dedicated OCR API
// (e.g. Mistral) later — without touching the extract step.

/** Result of transcribing a scanned PDF. */
export interface OcrResult {
  /**
   * Transcribed text, one entry per source page in reading order. The
   * ingestion chunker attributes chunks to pages by array index, so providers
   * should preserve page boundaries (blank pages included) where possible.
   */
  pages: string[];
}

export interface OcrOptions {
  /** Inject a fetch (e.g. a test stub). Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** API key override. Provider decides which env var it falls back to. */
  apiKey?: string;
  /** Model / engine override. Defaults are provider-specific. */
  model?: string;
  /** Cap on transcription output tokens (token-billed providers). */
  maxTokens?: number;
  /** AbortSignal so a cancelled ingestion run can abort the request. */
  signal?: AbortSignal;
}

export interface OcrProvider {
  /** Stable identifier; matches the `OCR_PROVIDER` env value that selects it. */
  readonly name: string;
  /**
   * Transcribe a scanned / image PDF to per-page text. Implementations throw
   * on transport / auth / refusal errors; the caller marks the document
   * `failed` with the thrown message.
   */
  ocrPdf(pdf: Uint8Array, options?: OcrOptions): Promise<OcrResult>;
}
