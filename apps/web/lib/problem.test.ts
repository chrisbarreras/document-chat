// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import { problemResponse, unauthorized } from './problem';

const validator = await createSchemaValidator();

describe('problemResponse', () => {
  it('produces an application/problem+json body matching the Problem schema', async () => {
    const res = problemResponse({
      status: 422,
      code: 'document.too_large',
      title: 'Payload Too Large',
      detail: 'Max 50 MB.',
    });
    expect(res.status).toBe(422);
    expect(res.headers.get('content-type')).toMatch(/application\/problem\+json/);

    const body = await res.json();
    const result = validator.validate('Problem', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
    expect(body.code).toBe('document.too_large');
    expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('omits detail when not provided', async () => {
    const body = await problemResponse({ status: 500, code: 'x.y', title: 'Oops' }).json();
    expect(body.detail).toBeUndefined();
  });
});

describe('unauthorized', () => {
  it('is a 401 Problem with code auth.unauthorized', async () => {
    const res = unauthorized('Sign in.');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(validator.validate('Problem', body).valid, JSON.stringify(body)).toBe(true);
    expect(body.status).toBe(401);
    expect(body.code).toBe('auth.unauthorized');
  });
});
