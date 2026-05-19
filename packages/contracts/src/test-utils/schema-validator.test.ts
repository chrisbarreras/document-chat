// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createSchemaValidator } from './schema-validator';

describe('createSchemaValidator', () => {
  it('validates a well-formed HealthResponse', async () => {
    const validator = await createSchemaValidator();
    const result = validator.validate('HealthResponse', {
      status: 'ok',
      version: '0.1.0',
      checks: [],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toBeNull();
  });

  it('rejects a HealthResponse missing required fields', async () => {
    const validator = await createSchemaValidator();
    const result = validator.validate('HealthResponse', { status: 'ok' });
    expect(result.valid).toBe(false);
    expect(result.errors).not.toBeNull();
  });

  it('rejects a HealthResponse with an invalid status enum', async () => {
    const validator = await createSchemaValidator();
    const result = validator.validate('HealthResponse', {
      status: 'unknown',
      version: '0.1.0',
      checks: [],
    });
    expect(result.valid).toBe(false);
  });

  it('throws when asked for an unknown schema', async () => {
    const validator = await createSchemaValidator();
    expect(() => validator.validate('NoSuchSchema', {})).toThrow(/Unknown schema/);
  });
});
