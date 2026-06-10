#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Post-deploy smoke test. Probes /api/health and /api/version on a deployed
// URL, asserts the contract-level shape (status: "ok", a present
// spec_version, and — when the deployment runs on Vercel —
// `environment ∈ {"prod","preview"}` plus a non-empty `git_sha`). Exits
// non-zero on the first failure so a CI workflow can gate promotion or
// page on-call.
//
// Pure Node, no deps. Run with:
//   node scripts/smoke.mjs --base-url https://<deployment>.vercel.app
// or in CI with `SMOKE_BASE_URL` set in the environment.

const ALLOWED_ENVS = new Set(['prod', 'preview', 'dev', 'test']);
const DEFAULT_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const out = {
    baseUrl: process.env.SMOKE_BASE_URL ?? null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    expectEnv: null,
    requireGitSha: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    switch (a) {
      case '--base-url':
        out.baseUrl = argv[++i];
        break;
      case '--timeout':
        out.timeoutMs = Number(argv[++i]);
        break;
      case '--expect-env':
        out.expectEnv = argv[++i];
        break;
      case '--require-git-sha':
        out.requireGitSha = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        console.error(`unknown flag: ${a}`);
        printHelp();
        process.exit(2);
    }
  }
  if (!out.baseUrl) {
    console.error('error: --base-url is required (or set SMOKE_BASE_URL)');
    printHelp();
    process.exit(2);
  }
  // Strip a trailing slash so we can append paths without doubling up.
  out.baseUrl = out.baseUrl.replace(/\/+$/, '');
  return out;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/smoke.mjs [options]',
      '',
      '  --base-url <url>        Deployment URL to probe (or set SMOKE_BASE_URL).',
      '  --timeout <ms>          Per-request timeout (default 10000).',
      '  --expect-env <env>      Require /version to report this environment.',
      '  --require-git-sha       Fail if /version does not include git_sha.',
      '  -h, --help              Show this help.',
    ].join('\n'),
  );
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${url} returned HTTP ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function probeHealth(baseUrl, timeoutMs) {
  const url = `${baseUrl}/api/health`;
  const body = await fetchJson(url, timeoutMs);
  if (body.status !== 'ok') {
    throw new Error(`${url}: status="${body.status}" (expected "ok")`);
  }
  if (typeof body.version !== 'string' || body.version.length === 0) {
    throw new Error(`${url}: missing version`);
  }
  return body;
}

async function probeVersion(baseUrl, timeoutMs, options) {
  const url = `${baseUrl}/api/version`;
  const body = await fetchJson(url, timeoutMs);
  for (const field of ['api_version', 'spec_version', 'environment']) {
    if (typeof body[field] !== 'string' || body[field].length === 0) {
      throw new Error(`${url}: missing ${field}`);
    }
  }
  if (!ALLOWED_ENVS.has(body.environment)) {
    throw new Error(
      `${url}: environment="${body.environment}" not in {${[...ALLOWED_ENVS].join(', ')}}`,
    );
  }
  if (options.expectEnv && body.environment !== options.expectEnv) {
    throw new Error(
      `${url}: environment="${body.environment}" (expected "${options.expectEnv}")`,
    );
  }
  if (options.requireGitSha) {
    if (typeof body.git_sha !== 'string' || body.git_sha.length === 0) {
      throw new Error(`${url}: missing git_sha`);
    }
  }
  return body;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`smoke: probing ${args.baseUrl}`);
  const health = await probeHealth(args.baseUrl, args.timeoutMs);
  console.log(`  /api/health → ok (version=${health.version})`);
  const version = await probeVersion(args.baseUrl, args.timeoutMs, {
    expectEnv: args.expectEnv,
    requireGitSha: args.requireGitSha,
  });
  console.log(
    `  /api/version → environment=${version.environment} spec=${version.spec_version}` +
      (version.git_sha ? ` git=${version.git_sha.slice(0, 7)}` : ''),
  );
  console.log('smoke: pass');
}

main().catch((err) => {
  console.error(`smoke: fail — ${err.message}`);
  process.exit(1);
});
