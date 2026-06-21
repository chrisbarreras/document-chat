// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { getOcrProvider } from './index';

describe('getOcrProvider', () => {
  it('selects the Claude provider by name', () => {
    expect(getOcrProvider('claude')?.name).toBe('claude');
  });

  it('defaults to Mistral when OCR_PROVIDER is unset', () => {
    const prev = process.env.OCR_PROVIDER;
    delete process.env.OCR_PROVIDER;
    try {
      expect(getOcrProvider()?.name).toBe('mistral');
    } finally {
      if (prev !== undefined) process.env.OCR_PROVIDER = prev;
    }
  });

  it('returns null when OCR is disabled', () => {
    expect(getOcrProvider('none')).toBeNull();
    expect(getOcrProvider('off')).toBeNull();
    expect(getOcrProvider('disabled')).toBeNull();
  });

  it('selects the Mistral provider by name', () => {
    expect(getOcrProvider('mistral')?.name).toBe('mistral');
  });

  it('throws for an unknown provider', () => {
    expect(() => getOcrProvider('bogus')).toThrow(/unknown/i);
  });
});
