// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { mistralOcrProvider } from './mistral';

const PDF = new Uint8Array([1, 2, 3, 4]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('mistralOcrProvider', () => {
  it('sends a base64 document_url and maps page markdown (ordered by index)', async () => {
    let capturedUrl: string | URL | undefined;
    let capturedBody: Record<string, any> | undefined;
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init!.body as string);
      // Return out of order to prove we sort by index.
      return jsonResponse({
        pages: [
          { index: 1, markdown: 'Page two text' },
          { index: 0, markdown: 'Page one text' },
        ],
        model: 'mistral-ocr-2505',
      });
    });

    const result = await mistralOcrProvider.ocrPdf(PDF, {
      apiKey: 'sk',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(result.pages).toEqual(['Page one text', 'Page two text']);
    expect(capturedUrl).toBe('https://api.mistral.ai/v1/ocr');
    expect(capturedBody!.model).toBe('mistral-ocr-latest');
    expect(capturedBody!.document.type).toBe('document_url');
    expect(capturedBody!.document.document_url).toBe(
      `data:application/pdf;base64,${Buffer.from(PDF).toString('base64')}`,
    );
    // Auth header carries the bearer token.
    const init = (fetchImpl.mock.calls[0]![1] as RequestInit);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk');
  });

  it('throws with the Mistral error message on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: 'Unauthorized' }, 401));
    await expect(
      mistralOcrProvider.ocrPdf(PDF, { apiKey: 'bad', fetch: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Unauthorized/);
  });

  it('surfaces a validation detail string in the error', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ detail: 'invalid document' }, 422));
    await expect(
      mistralOcrProvider.ocrPdf(PDF, { apiKey: 'sk', fetch: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/invalid document/);
  });

  it('throws when neither apiKey nor MISTRAL_API_KEY is set', async () => {
    const prev = process.env.MISTRAL_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    try {
      await expect(
        mistralOcrProvider.ocrPdf(PDF, { fetch: vi.fn() as unknown as typeof fetch }),
      ).rejects.toThrow(/MISTRAL_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.MISTRAL_API_KEY = prev;
    }
  });
});
