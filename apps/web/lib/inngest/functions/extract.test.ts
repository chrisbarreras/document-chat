// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import {
  extractPdfPages,
  runExtraction,
  NoExtractableTextError,
  type ExtractionDeps,
} from './extract';

const DOCUMENT_ID = '22222222-2222-2222-2222-222222222222';
const WORKSPACE_ID = '00000000-0000-0000-0000-0000000000aa';
const OBJECT_KEY = `${WORKSPACE_ID}/upload.pdf`;
const HELLO_PDF = new Uint8Array(readFileSync(join(__dirname, '../../../test/fixtures/hello.pdf')));

const event = {
  document_id: DOCUMENT_ID,
  workspace_id: WORKSPACE_ID,
  storage_object_key: OBJECT_KEY,
};

function makeDeps(overrides: Partial<ExtractionDeps> = {}): ExtractionDeps {
  return {
    download: vi.fn().mockResolvedValue(HELLO_PDF),
    extract: vi.fn().mockResolvedValue({ pages: ['Hello World'], pageCount: 1 }),
    transition: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('extractPdfPages', () => {
  it('extracts text and page count from a real PDF', async () => {
    const result = await extractPdfPages(HELLO_PDF);
    expect(result.pageCount).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]).toContain('Hello World');
  });
});

describe('runExtraction', () => {
  it('transitions extracting → chunking on success and persists page_count', async () => {
    const deps = makeDeps();
    const result = await runExtraction(deps, event);

    expect(result.pageCount).toBe(1);
    expect(deps.download).toHaveBeenCalledWith(OBJECT_KEY);
    expect(deps.transition).toHaveBeenNthCalledWith(1, DOCUMENT_ID, 'extracting', {
      ingestionError: null,
    });
    expect(deps.transition).toHaveBeenNthCalledWith(2, DOCUMENT_ID, 'chunking', {
      pageCount: 1,
    });
  });

  it('marks the row failed with the error message and rethrows on download failure', async () => {
    const deps = makeDeps({
      download: vi.fn().mockRejectedValue(new Error('object missing')),
    });

    await expect(runExtraction(deps, event)).rejects.toThrow('object missing');
    expect(deps.transition).toHaveBeenLastCalledWith(DOCUMENT_ID, 'failed', {
      ingestionError: 'object missing',
    });
  });

  it('marks failed on extractor error', async () => {
    const deps = makeDeps({
      extract: vi.fn().mockRejectedValue(new Error('corrupt PDF')),
    });

    await expect(runExtraction(deps, event)).rejects.toThrow('corrupt PDF');
    expect(deps.transition).toHaveBeenLastCalledWith(DOCUMENT_ID, 'failed', {
      ingestionError: 'corrupt PDF',
    });
  });

  it('fails loud with NoExtractableTextError when the PDF has no text (scanned/image)', async () => {
    const deps = makeDeps({
      extract: vi.fn().mockResolvedValue({ pages: ['  ', '\n\t'], pageCount: 2 }),
    });

    await expect(runExtraction(deps, event)).rejects.toBeInstanceOf(NoExtractableTextError);
    // Never advances to chunking; lands `failed` with a clear reason.
    expect(deps.transition).not.toHaveBeenCalledWith(DOCUMENT_ID, 'chunking', expect.anything());
    expect(deps.transition).toHaveBeenLastCalledWith(
      DOCUMENT_ID,
      'failed',
      expect.objectContaining({ ingestionError: expect.stringMatching(/no extractable text/i) }),
    );
  });
});
