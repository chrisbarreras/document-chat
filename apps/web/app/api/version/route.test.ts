// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, afterEach } from 'vitest';
import { GET } from './route';
import { createSchemaValidator } from '@document-chat/contracts/test-utils';
import { SPEC_VERSION } from '@document-chat/contracts';

const validator = await createSchemaValidator();

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('GET /version', () => {
  it('returns 200 with a VersionResponse-shaped body', async () => {
    const res = await GET(new Request('http://localhost/api/version'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = await res.json();
    const result = validator.validate('VersionResponse', body);
    expect(result.valid, JSON.stringify(result.errors)).toBe(true);
  });

  it('reports spec_version matching SPEC_VERSION constant', async () => {
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.spec_version).toBe(SPEC_VERSION);
  });

  it('reports a semver-shaped api_version', async () => {
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.api_version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('environment="dev" when VERCEL_ENV is unset', async () => {
    delete process.env.VERCEL_ENV;
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.environment).toBe('dev');
  });

  it('environment="preview" when VERCEL_ENV=preview', async () => {
    process.env.VERCEL_ENV = 'preview';
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.environment).toBe('preview');
  });

  it('environment="prod" when VERCEL_ENV=production', async () => {
    process.env.VERCEL_ENV = 'production';
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.environment).toBe('prod');
  });

  it('includes git_sha when GIT_SHA env is set', async () => {
    process.env.GIT_SHA = 'abc1234';
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.git_sha).toBe('abc1234');
  });

  it('omits git_sha when GIT_SHA env is unset', async () => {
    delete process.env.GIT_SHA;
    const body = await (await GET(new Request('http://x/api/version'))).json();
    expect(body.git_sha).toBeUndefined();
  });
});
