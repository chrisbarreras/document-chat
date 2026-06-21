// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { extractCitations, stripCitationMarkers } from './citations';

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const C = '33333333-3333-3333-3333-333333333333';

describe('stripCitationMarkers', () => {
  it('removes all markers and collapses the doubled spaces they leave', () => {
    expect(stripCitationMarkers(`Asphalt cures in 24h [${A}] before sealing [${B}].`)).toBe(
      'Asphalt cures in 24h before sealing.',
    );
  });

  it('leaves marker-free prose untouched', () => {
    expect(stripCitationMarkers('No markers here.')).toBe('No markers here.');
  });
});

describe('extractCitations', () => {
  it('returns the content unchanged when there are no markers', () => {
    const out = extractCitations('Plain text with no marker.', [A]);
    expect(out.cleanedContent).toBe('Plain text with no marker.');
    expect(out.citations).toEqual([]);
  });

  it('keeps valid markers and lists distinct citations in first-seen order', () => {
    const content = `Per [${A}], the answer is X. And [${B}] supports this. Also [${A}] again.`;
    const out = extractCitations(content, [A, B, C]);
    expect(out.cleanedContent).toBe(content);
    expect(out.citations).toHaveLength(2);
    expect(out.citations[0]).toEqual({ chunkId: A, index: 0 });
    expect(out.citations[1]).toEqual({ chunkId: B, index: 1 });
  });

  it('strips markers that point at chunks the retrieval set did not surface', () => {
    const content = `Per [${A}], yes. But [${C}] is fake.`;
    const out = extractCitations(content, [A, B]);
    expect(out.cleanedContent).toBe(`Per [${A}], yes. But  is fake.`);
    expect(out.citations).toEqual([{ chunkId: A, index: 0 }]);
  });

  it('normalizes the marker chunk_id to lowercase', () => {
    const upper = A.toUpperCase();
    const out = extractCitations(`see [${upper}]`, [A]);
    expect(out.cleanedContent).toBe(`see [${A}]`);
    expect(out.citations).toEqual([{ chunkId: A, index: 0 }]);
  });

  it('handles a marker at the very start or end of the content', () => {
    const out = extractCitations(`[${A}] start, end [${A}]`, [A]);
    expect(out.cleanedContent).toBe(`[${A}] start, end [${A}]`);
    expect(out.citations).toEqual([{ chunkId: A, index: 0 }]);
  });
});
