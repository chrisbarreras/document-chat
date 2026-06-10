// SPDX-License-Identifier: Apache-2.0
//
// Self-test for the eval runner. Runs the full golden set against the
// canned mock transcripts so a regression in metrics/runner logic shows up
// here, without needing a network or a live Supabase. This is the same path
// the PR-time `eval.yml` workflow takes (with the same fixtures).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadGolden } from './golden';
import { makeMockClient, type MockTranscript } from './mock-client';
import { formatSummary, runEval } from './runner';

const FIXTURES = join(__dirname, '..', 'fixtures');

interface MockTranscriptFile {
  transcripts: MockTranscript[];
}

function loadTranscripts(): MockTranscript[] {
  const raw = readFileSync(join(FIXTURES, 'mock-transcripts.json'), 'utf8');
  return (JSON.parse(raw) as MockTranscriptFile).transcripts;
}

describe('runner self-test', () => {
  it('scores the canned golden set at 100% across all three metrics', async () => {
    const golden = await loadGolden(join(FIXTURES, 'golden.jsonl'));
    const client = makeMockClient(loadTranscripts(), { strict: true });

    const summary = await runEval(client, golden, { threshold: 0.9 });

    expect(summary.cases).toHaveLength(golden.length);
    expect(summary.citationPrecisionAtK).toBe(1);
    expect(summary.citationRecallAtK).toBe(1);
    expect(summary.answerContains).toBe(1);
    expect(summary.passRate).toBe(1);
    expect(summary.passed).toBe(true);
  });

  it('flags individual cases as failed when the assistant cites the wrong chunk', async () => {
    const golden = await loadGolden(join(FIXTURES, 'golden.jsonl'));
    const transcripts = loadTranscripts().map((t, i) =>
      i === 0 ? { ...t, citedChunkIds: ['unrelated-slug'] } : t,
    );
    const client = makeMockClient(transcripts, { strict: true });

    const summary = await runEval(client, golden, { threshold: 0.9 });

    const first = summary.cases[0]!;
    expect(first.citationPrecisionAtK).toBe(0);
    expect(first.passed).toBe(false);
    expect(summary.passRate).toBeLessThan(1);
  });

  it('overall run fails when too many cases miss the per-case threshold', async () => {
    const golden = await loadGolden(join(FIXTURES, 'golden.jsonl'));
    // Break 5 of 20 cases (25% fail) — pass rate of 75% < 0.9 threshold.
    const transcripts = loadTranscripts().map((t, i) =>
      i < 5 ? { ...t, citedChunkIds: ['unrelated-slug'] } : t,
    );
    const client = makeMockClient(transcripts, { strict: true });

    const summary = await runEval(client, golden, { threshold: 0.9 });

    expect(summary.passRate).toBeCloseTo(0.75, 5);
    expect(summary.passed).toBe(false);
  });

  it('formats a one-line-per-case summary', async () => {
    const golden = await loadGolden(join(FIXTURES, 'golden.jsonl'));
    const client = makeMockClient(loadTranscripts(), { strict: true });

    const summary = await runEval(client, golden);
    const formatted = formatSummary(summary);

    expect(formatted.split('\n').filter((line) => line.startsWith('PASS '))).toHaveLength(golden.length);
    expect(formatted).toMatch(/pass_rate=100\.0%/);
  });
});
