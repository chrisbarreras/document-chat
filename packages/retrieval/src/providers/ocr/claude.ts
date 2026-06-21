// SPDX-License-Identifier: Apache-2.0
//
// Claude-vision OCR provider. Reuses the same hand-rolled `fetch` over
// `POST /v1/messages` as the chat provider (no SDK dep) — here a single
// non-streaming request with a base64 PDF `document` block. Claude's PDF
// support renders each page as an image, so this works on scanned/image PDFs
// that yield no embedded text via unpdf.
//
// Cost note: per page this is pricier than a dedicated OCR API, but it's a
// rare fallback and reuses the Anthropic key already configured for chat
// (no new vendor). Swap to a cheaper engine via `OCR_PROVIDER` if volume grows.
import type { OcrOptions, OcrProvider, OcrResult } from './types';

/** Cheapest vision-capable Claude tier — fine for transcription. */
export const DEFAULT_OCR_MODEL = 'claude-haiku-4-5';

/** Conservative non-streaming output cap (well under the HTTP-timeout zone). */
const DEFAULT_OCR_MAX_TOKENS = 16_384;

// The model emits this between pages so we can rebuild per-page text for chunk
// attribution. Deliberately unlikely to occur in real document content.
const PAGE_SENTINEL = '<<<DOCUMENT_CHAT_PAGE_BREAK>>>';

const OCR_PROMPT =
  'You are an OCR engine. Transcribe ALL text from this PDF exactly as it ' +
  'appears, preserving reading order and line breaks. Do not summarize, ' +
  'explain, translate, or add any commentary — output only the transcribed ' +
  `text. At the end of every page output a line containing exactly ` +
  `${PAGE_SENTINEL} and nothing else (emit it for blank pages too).`;

interface AnthropicTextBlock {
  type: string;
  text?: string;
}

interface AnthropicMessageResponse {
  content?: AnthropicTextBlock[];
  stop_reason?: string | null;
}

function toBase64(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('base64');
}

async function ocrPdf(pdf: Uint8Array, options: OcrOptions = {}): Promise<OcrResult> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is required for Claude OCR');
  }
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const model = options.model ?? process.env.OCR_MODEL ?? DEFAULT_OCR_MODEL;
  const maxTokens = options.maxTokens ?? DEFAULT_OCR_MAX_TOKENS;

  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: toBase64(pdf) },
            },
            { type: 'text', text: OCR_PROMPT },
          ],
        },
      ],
    }),
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      if (errBody.error?.message) detail = errBody.error.message;
    } catch {
      /* fall through with status text */
    }
    throw new Error(`claude OCR failed: ${detail}`);
  }

  const data = (await res.json()) as AnthropicMessageResponse;
  if (data.stop_reason === 'refusal') {
    throw new Error('claude OCR refused to transcribe this document');
  }

  const text = (data.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');

  // Split on the page sentinel; drop only the trailing empty segment after the
  // final sentinel (keep interior blank pages so page numbering stays aligned
  // with the source). If the model emitted no sentinel, return one page.
  const segments = text.split(PAGE_SENTINEL).map((p) => p.trim());
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  const pages = segments.length > 0 ? segments : [text.trim()];

  return { pages };
}

export const claudeOcrProvider: OcrProvider = { name: 'claude', ocrPdf };
