// SPDX-License-Identifier: Apache-2.0
//
// Shared types for the eval harness. Kept dep-free so the metric functions,
// the runner, the canned-mode self-test, and the live `apps/eval-cli` all
// agree on the data shape.

/**
 * A single Q/A entry from `golden.jsonl`. The expected-answer assertion is a
 * list of *substrings* that must appear (case-insensitive) in the assistant's
 * cleaned reply — keeps the eval robust to phrasing while still catching
 * meaningfully wrong answers.
 */
export interface GoldenEntry {
  /** Stable id; used in CLI output and CI logs. */
  id: string;
  /** Fixture document the question is grounded in (matches `corpus.json`). */
  documentId: string;
  /** User question. */
  question: string;
  /** Chunk ids the correct retrieval set MUST include. */
  expectedChunkIds: string[];
  /** Case-insensitive substrings the assistant reply MUST contain. */
  answerContains: string[];
}

/**
 * Result of running one entry through the harness. The fields are flat on
 * purpose so the CLI can JSON-encode the array directly for CI artifact
 * upload.
 */
export interface EvalCaseResult {
  id: string;
  question: string;
  /** Chunks the retrieval step returned, in score order (top-K). */
  retrievedChunkIds: string[];
  /** Chunks the assistant actually cited (post-strip — REQ-1.5.4 invariants). */
  citedChunkIds: string[];
  /** Assistant reply, with hallucinated markers already stripped. */
  answer: string;
  /** Per-case metric scores. */
  citationPrecisionAtK: number;
  citationRecallAtK: number;
  answerContainsScore: number;
  passed: boolean;
}

export interface EvalSummary {
  cases: EvalCaseResult[];
  /** Mean citation_precision@k across cases. */
  citationPrecisionAtK: number;
  /** Mean citation_recall@k across cases. */
  citationRecallAtK: number;
  /** Mean answer-contains score across cases. */
  answerContains: number;
  /** Fraction of cases that fully passed (all three metrics above threshold). */
  passRate: number;
  /** Did the run clear `threshold`? Mirrors `passRate >= threshold`. */
  passed: boolean;
}

/**
 * A chat-API client the runner uses. Real mode wires this to
 * `POST /chats/{id}/messages` with SSE accumulation; mock mode reads from a
 * canned transcript table. Either way, the runner consumes a single
 * promise-returning function and stays agnostic about wire details.
 */
export type ChatClient = (input: ChatTurnInput) => Promise<ChatTurnOutput>;

export interface ChatTurnInput {
  question: string;
  /** Document scope — runner only retrieves within this document for now. */
  documentId: string;
  topK: number;
}

export interface ChatTurnOutput {
  /** Chunks returned by retrieval, in score order. */
  retrievedChunkIds: string[];
  /** Chunks the assistant actually cited (post-strip). */
  citedChunkIds: string[];
  /** Final assistant reply, hallucinated markers already stripped. */
  answer: string;
}
