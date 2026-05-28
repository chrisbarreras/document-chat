// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { runChunking } from './chunk';

describe('runChunking', () => {
  it('returns no chunks for an empty document', () => {
    expect(runChunking({ pages: [], pageCount: 0 })).toEqual([]);
  });

  it('produces at least one chunk and attributes it to a 1-indexed page', () => {
    const pages = [
      'First page paragraph one.\n\nFirst page paragraph two.',
      'Second page only paragraph.',
    ];
    const chunks = runChunking({ pages, pageCount: 2 });
    expect(chunks.length).toBeGreaterThan(0);
    // Page numbers come from `chunkPages` and must be 1-indexed (never 0,
    // never null when extracted from paged input). Cross-page splitting is
    // covered exhaustively in `packages/retrieval/src/chunking.test.ts`.
    for (const chunk of chunks) {
      expect(chunk.pageNumber).toBeGreaterThanOrEqual(1);
    }
  });
});
