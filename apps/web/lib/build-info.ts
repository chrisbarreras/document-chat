// SPDX-License-Identifier: Apache-2.0

export type Environment = 'dev' | 'preview' | 'prod';

export function resolveEnvironment(): Environment {
  switch (process.env.VERCEL_ENV) {
    case 'production':
      return 'prod';
    case 'preview':
      return 'preview';
    default:
      return 'dev';
  }
}

export function resolveGitSha(): string | undefined {
  return process.env.GIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined;
}

export function resolveBuiltAt(): string | undefined {
  return process.env.BUILT_AT ?? undefined;
}
