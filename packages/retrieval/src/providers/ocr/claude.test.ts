// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { claudeOcrProvider } from './claude';

const PDF = new Uint8Array([1, 2, 3, 4]);
const PAGE_SENTINEL = '<<<DOCUMENT_CHAT_PAGE_BREAK>>>';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('claudeOcrProvider', () => {
  it('sends the PDF as a base64 document block and splits pages on the sentinel', async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const fetchImpl = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      capturedBody = JSON.parse(init!.body as string);
      return jsonResponse({
        content: [
          {
            type: 'text',
            text: `Page one text\n${PAGE_SENTINEL}\nPage two text\n${PAGE_SENTINEL}\n`,
          },
        ],
        stop_reason: 'end_turn',
      });
    });

    const result = await claudeOcrProvider.ocrPdf(PDF, {
      apiKey: 'sk',
      fetch: fetchImpl as unknown as typeof fetch,
    });

    expect(result.pages).toEqual(['Page one text', 'Page two text']);
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.anthropic.com/v1/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    const content = (capturedBody!.messages as Array<{ content: unknown[] }>)[0]!.content as Array<
      Record<string, any>
    >;
    expect(content[0]!.type).toBe('document');
    expect(content[0]!.source.media_type).toBe('application/pdf');
    expect(content[0]!.source.data).toBe(Buffer.from(PDF).toString('base64'));
    expect(content[1]!.type).toBe('text');
  });

  it('returns a single page when the model emits no sentinel', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ content: [{ type: 'text', text: 'One blob of text' }], stop_reason: 'end_turn' }),
    );
    const result = await claudeOcrProvider.ocrPdf(PDF, {
      apiKey: 'sk',
      fetch: fetchImpl as unknown as typeof fetch,
    });
    expect(result.pages).toEqual(['One blob of text']);
  });

  it('throws on a refusal stop_reason', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ content: [], stop_reason: 'refusal' }));
    await expect(
      claudeOcrProvider.ocrPdf(PDF, { apiKey: 'sk', fetch: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/refus/i);
  });

  it('throws with the Anthropic error message on a non-2xx response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'overloaded' } }, 529));
    await expect(
      claudeOcrProvider.ocrPdf(PDF, { apiKey: 'sk', fetch: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/overloaded/);
  });

  it('throws when neither apiKey nor ANTHROPIC_API_KEY is set', async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      await expect(
        claudeOcrProvider.ocrPdf(PDF, { fetch: vi.fn() as unknown as typeof fetch }),
      ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev;
    }
  });
});
