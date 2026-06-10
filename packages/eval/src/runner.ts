// SPDX-License-Identifier: Apache-2.0
//
// Generic eval runner. Walks the golden set, calls a `ChatClient` for each
// case, and aggregates the three metrics into an `EvalSummary`. The runner
// itself is pure — no Supabase, no Anthropic, no fs writes — so a unit test
// can drive it against canned data, and `apps/eval-cli` can wire real
// network deps without re-implementing the scoring loop.
//
// The runner accepts the case threshold (default 0.9, matching REQ-1.5.3)
// and reports a per-case `passed` plus an overall `passRate`. Any case where
// all three metrics meet or exceed the threshold counts as passed.

import {
  answerContainsScore,
  citationPrecisionAtK,
  citationRecallAtK,
  mean,
} from './metrics';
import type {
  ChatClient,
  EvalCaseResult,
  EvalSummary,
  GoldenEntry,
} from './types';

export interface RunOptions {
  topK?: number;
  /** Per-case pass threshold (default 0.9, matching REQ-1.5.3). */
  threshold?: number;
  /** Optional per-case progress callback (CLI rendering, CI logs). */
  onCase?: (result: EvalCaseResult) => void;
}

const DEFAULT_TOP_K = 8;
const DEFAULT_THRESHOLD = 0.9;

export async function runEval(
  client: ChatClient,
  golden: GoldenEntry[],
  options: RunOptions = {},
): Promise<EvalSummary> {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const cases: EvalCaseResult[] = [];

  for (const entry of golden) {
    const turn = await client({
      question: entry.question,
      documentId: entry.documentId,
      topK,
    });

    const precision = citationPrecisionAtK(entry.expectedChunkIds, turn.citedChunkIds);
    const recall = citationRecallAtK(entry.expectedChunkIds, turn.retrievedChunkIds);
    const contains = answerContainsScore(turn.answer, entry.answerContains);

    const passed = precision >= threshold && recall >= threshold && contains >= threshold;

    const caseResult: EvalCaseResult = {
      id: entry.id,
      question: entry.question,
      retrievedChunkIds: turn.retrievedChunkIds,
      citedChunkIds: turn.citedChunkIds,
      answer: turn.answer,
      citationPrecisionAtK: precision,
      citationRecallAtK: recall,
      answerContainsScore: contains,
      passed,
    };
    cases.push(caseResult);
    options.onCase?.(caseResult);
  }

  const precisionMean = mean(cases.map((c) => c.citationPrecisionAtK));
  const recallMean = mean(cases.map((c) => c.citationRecallAtK));
  const containsMean = mean(cases.map((c) => c.answerContainsScore));
  const passRate = cases.length === 0 ? 0 : cases.filter((c) => c.passed).length / cases.length;

  return {
    cases,
    citationPrecisionAtK: precisionMean,
    citationRecallAtK: recallMean,
    answerContains: containsMean,
    passRate,
    passed: passRate >= threshold,
  };
}

/**
 * Render a compact one-line-per-case summary, suitable for CI log output.
 * Kept here (rather than in the CLI) so the self-test can snapshot it.
 */
export function formatSummary(summary: EvalSummary): string {
  const lines: string[] = [];
  for (const c of summary.cases) {
    const tag = c.passed ? 'PASS' : 'FAIL';
    lines.push(
      `${tag} ${c.id} ` +
        `precision=${c.citationPrecisionAtK.toFixed(2)} ` +
        `recall=${c.citationRecallAtK.toFixed(2)} ` +
        `contains=${c.answerContainsScore.toFixed(2)}`,
    );
  }
  lines.push('');
  lines.push(
    `total: precision=${summary.citationPrecisionAtK.toFixed(3)} ` +
      `recall=${summary.citationRecallAtK.toFixed(3)} ` +
      `contains=${summary.answerContains.toFixed(3)} ` +
      `pass_rate=${(summary.passRate * 100).toFixed(1)}%`,
  );
  return lines.join('\n');
}
