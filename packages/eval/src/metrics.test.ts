// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  answerContainsScore,
  citationPrecisionAtK,
  citationRecallAtK,
  mean,
} from './metrics';

describe('citationPrecisionAtK', () => {
  it('returns 1 when every cited chunk is expected', () => {
    expect(citationPrecisionAtK(['a', 'b', 'c'], ['a', 'b'])).toBe(1);
  });

  it('returns 0.5 when half of cited chunks are expected', () => {
    expect(citationPrecisionAtK(['a'], ['a', 'b'])).toBe(0.5);
  });

  it('returns 0 when no cited chunks are expected', () => {
    expect(citationPrecisionAtK(['a'], ['x', 'y'])).toBe(0);
  });

  it('returns 0 when nothing was cited', () => {
    // A model that refuses to cite anything earns no precision credit;
    // pairs with recall=0 below.
    expect(citationPrecisionAtK(['a'], [])).toBe(0);
  });

  it('ignores ordering of inputs', () => {
    expect(citationPrecisionAtK(['a', 'b'], ['b', 'a'])).toBe(1);
  });
});

describe('citationRecallAtK', () => {
  it('returns 1 when retrieval covers every expected chunk', () => {
    expect(citationRecallAtK(['a', 'b'], ['b', 'a', 'c'])).toBe(1);
  });

  it('returns 0.5 when retrieval covers half of expected', () => {
    expect(citationRecallAtK(['a', 'b'], ['a', 'x'])).toBe(0.5);
  });

  it('returns 0 when retrieval misses every expected chunk', () => {
    expect(citationRecallAtK(['a'], ['x', 'y'])).toBe(0);
  });

  it('returns 1 vacuously when the case lists no expected chunks', () => {
    expect(citationRecallAtK([], ['x'])).toBe(1);
  });
});

describe('answerContainsScore', () => {
  it('is case-insensitive', () => {
    expect(answerContainsScore('The QUOKKA is a marsupial.', ['quokka', 'marsupial'])).toBe(1);
  });

  it('credits partial matches', () => {
    expect(answerContainsScore('Quokkas live on Rottnest.', ['Rottnest', 'Perth'])).toBe(0.5);
  });

  it('returns 1 vacuously when no substrings are required', () => {
    expect(answerContainsScore('anything', [])).toBe(1);
  });

  it('returns 0 when none of the required substrings appear', () => {
    expect(answerContainsScore('coffee', ['quokka'])).toBe(0);
  });
});

describe('mean', () => {
  it('returns the arithmetic mean', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it('returns 0 for an empty array', () => {
    expect(mean([])).toBe(0);
  });
});
