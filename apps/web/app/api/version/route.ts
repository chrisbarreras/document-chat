// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { SPEC_VERSION } from '@document-chat/contracts';
import pkg from '../../../package.json';
import { resolveBuiltAt, resolveEnvironment, resolveGitSha } from '../../../lib/build-info';

export async function GET(_request: Request): Promise<NextResponse> {
  const body: Record<string, unknown> = {
    api_version: pkg.version,
    spec_version: SPEC_VERSION,
    environment: resolveEnvironment(),
  };

  const gitSha = resolveGitSha();
  if (gitSha !== undefined) {
    body.git_sha = gitSha;
  }

  const builtAt = resolveBuiltAt();
  if (builtAt !== undefined) {
    body.built_at = builtAt;
  }

  return NextResponse.json(body);
}
