// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { chunkText, chunkPages, type TextChunk } from './chunking';

// Build a single paragraph of N short sentences ("Sentence 0. Sentence 1. …").
function sentences(count: number): string {
  return Array.from({ length: count }, (_, i) => `Sentence number ${i}.`).join(' ');
}

function assertRoundTrip(source: string, chunks: TextChunk[]): void {
  for (const chunk of chunks) {
    expect(source.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.text);
    expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
  }
}

describe('chunkText', () => {
  it('returns nothing for empty or whitespace-only input', () => {
    expect(chunkText('')).toEqual([]);
    expect(chunkText('   \n\n  \t ')).toEqual([]);
  });

  it('produces a single chunk for short text, trimmed, with offsets', () => {
    const source = '  Hello world. This is a short document.  ';
    const chunks = chunkText(source);
    expect(chunks).toHaveLength(1);
    const [chunk] = chunks;
    expect(chunk!.index).toBe(0);
    expect(chunk!.pageNumber).toBeNull();
    expect(chunk!.text).toBe('Hello world. This is a short document.');
    expect(chunk!.tokenCount).toBeGreaterThan(0);
    assertRoundTrip(source, chunks);
  });

  it('keeps several small paragraphs under the budget in one chunk', () => {
    const source = 'First paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
    expect(chunkText(source, { maxTokens: 800 })).toHaveLength(1);
  });

  it('splits oversized text into multiple chunks within the token budget', () => {
    const source = sentences(60);
    const maxTokens = 30;
    const chunks = chunkText(source, { maxTokens, overlapRatio: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(maxTokens);
    }
    assertRoundTrip(source, chunks);
    // Indices are sequential.
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('overlaps consecutive chunks when overlapRatio > 0', () => {
    const source = sentences(60);
    const chunks = chunkText(source, { maxTokens: 30, overlapRatio: 0.3 });
    expect(chunks.length).toBeGreaterThan(1);
    // The next chunk starts before the previous one ends (shared context).
    expect(chunks[1]!.charStart).toBeLessThan(chunks[0]!.charEnd);
  });

  it('does not overlap when overlapRatio is 0', () => {
    const source = sentences(60);
    const chunks = chunkText(source, { maxTokens: 30, overlapRatio: 0 });
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]!.charStart).toBeGreaterThanOrEqual(chunks[i - 1]!.charEnd);
    }
  });

  it('hard-splits a single oversized token and still terminates', () => {
    const source = 'x'.repeat(1000);
    const chunks = chunkText(source, { maxTokens: 10, overlapRatio: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    assertRoundTrip(source, chunks);
    // Reassembling the (non-overlapping) chunks reproduces the input.
    expect(chunks.map((c) => c.text).join('')).toBe(source);
  });

  it('accepts an injected token counter', () => {
    const source = sentences(40);
    // Count every character as a token -> far smaller chunks.
    const chunks = chunkText(source, { maxTokens: 50, countTokens: (t) => t.length });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(50);
    }
  });
});

describe('chunkPages', () => {
  it('tags chunks with the page they start on', () => {
    const pages = [
      { page: 1, text: sentences(40) },
      { page: 2, text: sentences(40) },
    ];
    const chunks = chunkPages(pages, { maxTokens: 30, overlapRatio: 0 });
    const pageNumbers = new Set(chunks.map((c) => c.pageNumber));
    expect(pageNumbers.has(1)).toBe(true);
    expect(pageNumbers.has(2)).toBe(true);
  });

  it('preserves offsets into the concatenated document', () => {
    const pages = [
      { page: 1, text: 'Alpha beta gamma.' },
      { page: 2, text: 'Delta epsilon zeta.' },
    ];
    const doc = `${pages[0]!.text}\n\n${pages[1]!.text}`;
    const chunks = chunkPages(pages, { maxTokens: 5, overlapRatio: 0 });
    assertRoundTrip(doc, chunks);
  });
});
