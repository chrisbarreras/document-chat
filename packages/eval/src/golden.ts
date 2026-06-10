// SPDX-License-Identifier: Apache-2.0
//
// Loader for `golden.jsonl` and the matching fixture corpus. Both files live
// under `packages/eval/fixtures/`:
//
//   corpus.json   — list of synthetic documents { id, title, pages[] }.
//                   The runner ingests these (in mock mode: assigns chunk
//                   ids; in real mode: uploads to the running API).
//   golden.jsonl  — one JSON object per line, matching `GoldenEntry`.
//
// Each entry's `expectedChunkIds` references chunks within the named
// document. Since chunk ids are not stable across runs of the real
// pipeline, the IDs here are SYMBOLIC slugs that the runner maps to actual
// UUIDs at ingestion time (mock mode: assigns them deterministically; real
// mode: reads back the document's chunks and matches by index). See
// `packages/eval/src/runner.ts` for the mapping.

import { readFile } from 'node:fs/promises';
import type { GoldenEntry } from './types';

export interface CorpusDocument {
  id: string;
  title: string;
  pages: string[];
  /**
   * Symbolic slugs for the chunks this document is expected to produce.
   * Index N in this list corresponds to chunk index N at runtime. The
   * golden file uses these slugs in `expectedChunkIds`; the runner
   * resolves them after ingestion.
   */
  chunkSlugs: string[];
}

export interface Corpus {
  documents: CorpusDocument[];
}

export async function loadCorpus(path: string): Promise<Corpus> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Corpus;
  if (!Array.isArray(parsed.documents)) {
    throw new Error(`corpus at ${path}: missing "documents" array`);
  }
  return parsed;
}

export async function loadGolden(path: string): Promise<GoldenEntry[]> {
  const raw = await readFile(path, 'utf8');
  const out: GoldenEntry[] = [];
  for (const [i, line] of raw.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: GoldenEntry;
    try {
      entry = JSON.parse(trimmed) as GoldenEntry;
    } catch (err) {
      throw new Error(`golden at ${path}:${i + 1}: invalid JSON (${(err as Error).message})`);
    }
    validate(entry, i + 1);
    out.push(entry);
  }
  return out;
}

function validate(entry: GoldenEntry, line: number): void {
  const need = ['id', 'documentId', 'question'] as const;
  for (const field of need) {
    if (typeof entry[field] !== 'string' || entry[field].length === 0) {
      throw new Error(`golden line ${line}: missing/empty "${field}"`);
    }
  }
  if (!Array.isArray(entry.expectedChunkIds) || entry.expectedChunkIds.length === 0) {
    throw new Error(`golden line ${line}: "expectedChunkIds" must be a non-empty array`);
  }
  if (!Array.isArray(entry.answerContains) || entry.answerContains.length === 0) {
    throw new Error(`golden line ${line}: "answerContains" must be a non-empty array`);
  }
}
