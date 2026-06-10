// SPDX-License-Identifier: Apache-2.0
//
// Thin CLI around `@document-chat/eval`. Two modes:
//
//   --mock        Run the golden set against canned transcripts in
//                 packages/eval/fixtures/mock-transcripts.json. No network,
//                 no API keys; the harness itself is regression-tested in
//                 packages/eval/src/runner.test.ts, and this mode lets CI
//                 re-run the same scoring on PRs.
//   (default)     Run live against `process.env.EVAL_API_BASE_URL` using
//                 a service-role Supabase session. Hits real OpenAI for
//                 query embeddings and real Anthropic for chat completion.
//                 Requires OPENAI_API_KEY + ANTHROPIC_API_KEY +
//                 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY +
//                 EVAL_WORKSPACE_ID + EVAL_DOCUMENT_MAP env vars (see
//                 `live.ts` for the contract). The nightly cron sets these
//                 from GitHub Actions secrets; running this mode locally is
//                 supported but optional.
//
// Exit code is 0 when `summary.passed` is true, 1 otherwise — so CI can
// gate merge on the threshold without parsing JSON.

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  formatSummary,
  loadGolden,
  makeMockClient,
  runEval,
  type ChatClient,
  type MockTranscript,
} from '@document-chat/eval';
import { liveClient, type LiveOptions } from './live.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, '..', '..', '..', 'packages', 'eval', 'fixtures');

interface Args {
  mock: boolean;
  threshold: number;
  topK: number;
  goldenPath: string;
  jsonOutPath: string | null;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    mock: false,
    threshold: 0.9,
    topK: 8,
    goldenPath: join(FIXTURES, 'golden.jsonl'),
    jsonOutPath: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') continue;
    switch (a) {
      case '--mock':
        out.mock = true;
        break;
      case '--threshold':
        out.threshold = Number(argv[++i]);
        break;
      case '--top-k':
        out.topK = Number(argv[++i]);
        break;
      case '--golden':
        out.goldenPath = String(argv[++i]);
        break;
      case '--json-out':
        out.jsonOutPath = String(argv[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (a !== undefined && a.startsWith('--')) {
          console.error(`unknown flag: ${a}`);
          printHelp();
          process.exit(2);
        }
    }
  }
  return out;
}

function printHelp(): void {
  console.log(
    [
      'Usage: eval-cli [options]',
      '',
      '  --mock                Run against canned transcripts (no network).',
      '  --threshold <0..1>    Per-case pass threshold (default 0.9).',
      '  --top-k <n>           Top-K for retrieval (default 8).',
      '  --golden <path>       Override the golden jsonl path.',
      '  --json-out <path>     Write the full summary as JSON to a file.',
      '  -h, --help            Show this help.',
    ].join('\n'),
  );
}

async function loadMockTranscripts(): Promise<MockTranscript[]> {
  const raw = await readFile(join(FIXTURES, 'mock-transcripts.json'), 'utf8');
  const parsed = JSON.parse(raw) as { transcripts: MockTranscript[] };
  return parsed.transcripts;
}

function envOrThrow(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for live mode`);
  return v;
}

async function buildLiveClient(): Promise<ChatClient> {
  const options: LiveOptions = {
    apiBaseUrl: envOrThrow('EVAL_API_BASE_URL'),
    supabaseUrl: envOrThrow('NEXT_PUBLIC_SUPABASE_URL'),
    supabaseServiceKey: envOrThrow('SUPABASE_SERVICE_ROLE_KEY'),
    workspaceId: envOrThrow('EVAL_WORKSPACE_ID'),
    documentMapPath: envOrThrow('EVAL_DOCUMENT_MAP'),
  };
  return liveClient(options);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const golden = await loadGolden(args.goldenPath);

  const client = args.mock
    ? makeMockClient(await loadMockTranscripts(), { strict: true })
    : await buildLiveClient();

  const summary = await runEval(client, golden, {
    threshold: args.threshold,
    topK: args.topK,
    onCase: (c) => {
      const tag = c.passed ? 'PASS' : 'FAIL';
      console.log(
        `${tag} ${c.id} p=${c.citationPrecisionAtK.toFixed(2)} ` +
          `r=${c.citationRecallAtK.toFixed(2)} a=${c.answerContainsScore.toFixed(2)}`,
      );
    },
  });

  console.log('');
  console.log(formatSummary(summary));

  if (args.jsonOutPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(args.jsonOutPath, JSON.stringify(summary, null, 2), 'utf8');
  }

  process.exit(summary.passed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
