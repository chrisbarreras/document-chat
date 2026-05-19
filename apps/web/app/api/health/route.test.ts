// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { GET } from './route';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';

const validator = await createSchemaValidator();

describe('GET /health', () => {
  it('returns 200 with a HealthResponse-shaped body', async () => {
    const res = await GET(new Request('http://localhost/api/health'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = await res.json();
    const result = validator.validate('HealthResponse', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('reports status="ok" and an empty checks array in Tier 0', async () => {
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.checks).toEqual([]);
  });

  it('reports a semver-shaped version', async () => {
    const res = await GET(new Request('http://localhost/api/health'));
    const body = await res.json();
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
