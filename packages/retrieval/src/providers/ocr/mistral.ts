// SPDX-License-Identifier: Apache-2.0
//
// Mistral OCR provider. A dedicated document-OCR engine (not an LLM chat
// model), so — unlike Claude vision — it has no output content/copyright
// filter that blocks verbatim reproduction of standardized text. That matters
// for this product: real contracts/forms are full of mandated boilerplate
// (e.g. state-issued consumer-protection notices) that Claude's output filter
// refuses to transcribe. Mistral OCR transcribes the whole document, and is
// cheaper per page.
//
// Hand-rolled fetch over POST /v1/ocr (same no-SDK approach as the other
// providers). We send the PDF as a base64 data URI and map each returned
// page's `markdown` to our per-page text array.
import type { OcrOptions, OcrProvider, OcrResult } from './types';

/** Mistral's always-current OCR model alias. */
export const DEFAULT_MISTRAL_OCR_MODEL = 'mistral-ocr-latest';

interface MistralOcrPage {
  index?: number;
  markdown?: string;
}

interface MistralOcrResponse {
  pages?: MistralOcrPage[];
}

function toDataUri(pdf: Uint8Array): string {
  return `data:application/pdf;base64,${Buffer.from(pdf).toString('base64')}`;
}

async function ocrPdf(pdf: Uint8Array, options: OcrOptions = {}): Promise<OcrResult> {
  const apiKey = options.apiKey ?? process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY is required for Mistral OCR');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const model = options.model ?? DEFAULT_MISTRAL_OCR_MODEL;

  const res = await fetchImpl('https://api.mistral.ai/v1/ocr', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      document: { type: 'document_url', document_url: toDataUri(pdf) },
      include_image_base64: false,
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as {
        error?: { message?: string };
        message?: string;
        detail?: unknown;
      };
      const msg =
        errBody.error?.message ??
        errBody.message ??
        (typeof errBody.detail === 'string' ? errBody.detail : undefined);
      if (msg) detail = msg;
    } catch {
      /* fall through with status text */
    }
    throw new Error(`mistral OCR failed: ${detail}`);
  }

  const data = (await res.json()) as MistralOcrResponse;
  // Order by page index; keep one entry per page (blank pages included) so the
  // chunker's page attribution stays aligned with the source.
  const pages = (data.pages ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((p) => (p.markdown ?? '').trim());

  return { pages };
}

export const mistralOcrProvider: OcrProvider = { name: 'mistral', ocrPdf };
