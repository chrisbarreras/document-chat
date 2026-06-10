// SPDX-License-Identifier: Apache-2.0
//
// Mock chat client backed by a canned transcript table. The PR-time CI
// workflow runs eval in mock mode — no Anthropic, no OpenAI, no network —
// so the harness itself is regression-tested without budget concerns. The
// nightly job uses the real client in `apps/eval-cli/`.
//
// Each transcript pins what retrieval *should* return for that question
// (in real mode this comes from a real embedding + pgvector lookup) and
// what the assistant cites + says. The eval still scores
// precision/recall/contains against the golden expectations — a regression
// here surfaces as a metric drop.

import type { ChatClient, ChatTurnInput, ChatTurnOutput } from './types';

export interface MockTranscript {
  /** The exact `GoldenEntry.question` this transcript answers. */
  question: string;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
  answer: string;
}

export interface MockClientOptions {
  /** Throw rather than return an empty turn if a question has no transcript. */
  strict?: boolean;
}

export function makeMockClient(
  transcripts: MockTranscript[],
  options: MockClientOptions = {},
): ChatClient {
  const byQuestion = new Map(transcripts.map((t) => [t.question, t] as const));

  return async (input: ChatTurnInput): Promise<ChatTurnOutput> => {
    const t = byQuestion.get(input.question);
    if (!t) {
      if (options.strict) {
        throw new Error(`mock client: no transcript for question "${input.question}"`);
      }
      return { retrievedChunkIds: [], citedChunkIds: [], answer: '' };
    }
    return {
      retrievedChunkIds: t.retrievedChunkIds.slice(0, input.topK),
      citedChunkIds: t.citedChunkIds,
      answer: t.answer,
    };
  };
}
