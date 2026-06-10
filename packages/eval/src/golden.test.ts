// SPDX-License-Identifier: Apache-2.0
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadGolden, loadCorpus } from './golden';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'eval-golden-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadGolden', () => {
  it('parses a well-formed jsonl file', async () => {
    const path = join(dir, 'golden.jsonl');
    await writeFile(
      path,
      [
        JSON.stringify({
          id: 'q-1',
          documentId: 'doc-a',
          question: 'why?',
          expectedChunkIds: ['c-1'],
          answerContains: ['because'],
        }),
        '',
        JSON.stringify({
          id: 'q-2',
          documentId: 'doc-b',
          question: 'how?',
          expectedChunkIds: ['c-2'],
          answerContains: ['like-so'],
        }),
      ].join('\n'),
      'utf8',
    );
    const golden = await loadGolden(path);
    expect(golden).toHaveLength(2);
    expect(golden[0]!.id).toBe('q-1');
  });

  it('reports the line number for invalid JSON', async () => {
    const path = join(dir, 'broken.jsonl');
    await writeFile(path, '{ not json', 'utf8');
    await expect(loadGolden(path)).rejects.toThrow(/:1:/);
  });

  it('rejects entries missing required fields', async () => {
    const path = join(dir, 'missing.jsonl');
    await writeFile(
      path,
      JSON.stringify({ id: 'q-1', documentId: 'doc-a', question: 'why?', expectedChunkIds: [], answerContains: ['x'] }),
      'utf8',
    );
    await expect(loadGolden(path)).rejects.toThrow(/expectedChunkIds/);
  });
});

describe('loadCorpus', () => {
  it('parses a well-formed corpus.json', async () => {
    const path = join(dir, 'corpus.json');
    await writeFile(
      path,
      JSON.stringify({
        documents: [{ id: 'd', title: 't', pages: ['p1'], chunkSlugs: ['s'] }],
      }),
      'utf8',
    );
    const corpus = await loadCorpus(path);
    expect(corpus.documents).toHaveLength(1);
  });

  it('rejects a corpus without a documents array', async () => {
    const path = join(dir, 'broken.json');
    await writeFile(path, JSON.stringify({}), 'utf8');
    await expect(loadCorpus(path)).rejects.toThrow(/documents/);
  });
});
