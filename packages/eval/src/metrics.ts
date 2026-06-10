// SPDX-License-Identifier: Apache-2.0
//
// Pure metric functions. Each takes plain arrays so the runner, the unit
// tests, and any future visualization can score the same way without going
// through `runCase`.
//
// Definitions (consistent with REQ-1.5.3):
//   citation_precision@k = |expected ∩ cited|  / |cited|
//   citation_recall@k    = |expected ∩ retrieved| / |expected|
//   answer_contains      = fraction of required substrings present (cased
//                          insensitively) in the assistant reply.
//
// `precision` is scored against the citations the assistant ACTUALLY emitted
// — a model that retrieves a perfect set but cites the wrong chunk gets the
// hit it deserves. `recall` is scored against what retrieval surfaced — the
// model can only cite what it sees, so retrieval is the bottleneck.
//
// All three return values in [0, 1]; pass/fail comes from the threshold the
// runner applies.

export function citationPrecisionAtK(expected: string[], cited: string[]): number {
  if (cited.length === 0) return 0;
  const expectedSet = new Set(expected);
  const hits = cited.filter((id) => expectedSet.has(id)).length;
  return hits / cited.length;
}

export function citationRecallAtK(expected: string[], retrieved: string[]): number {
  if (expected.length === 0) return 1;
  const retrievedSet = new Set(retrieved);
  const hits = expected.filter((id) => retrievedSet.has(id)).length;
  return hits / expected.length;
}

export function answerContainsScore(answer: string, required: string[]): number {
  if (required.length === 0) return 1;
  const haystack = answer.toLowerCase();
  const hits = required.filter((s) => haystack.includes(s.toLowerCase())).length;
  return hits / required.length;
}

/**
 * Arithmetic mean of a finite-number array. Empty array → 0 so summary
 * tables stay defined even before any case has run.
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}
