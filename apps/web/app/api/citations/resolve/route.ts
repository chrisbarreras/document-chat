// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../lib/auth';
import { fetchChunksForCitations } from '../../../../lib/chunks-store';
import { toContractCitation, unavailableCitation } from '../../../../lib/chunks';
import { problemResponse, unauthorized } from '../../../../lib/problem';

type ResolveCitationsRequest = components['schemas']['ResolveCitationsRequest'];
type ResolveCitationsResponse = components['schemas']['ResolveCitationsResponse'];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIN_IDS = 1;
const MAX_IDS = 200;

// POST /citations:resolve — batch-resolve chunk ids to full citation objects.
// Rewritten from /api/citations:resolve in next.config.mjs (Windows path
// safety; the spec uses Google AIP-136 colon syntax).
export async function POST(request: Request): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to resolve citations.');

  let body: ResolveCitationsRequest;
  try {
    body = (await request.json()) as ResolveCitationsRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  const ids = body?.chunk_ids;
  if (!Array.isArray(ids) || ids.length < MIN_IDS || ids.length > MAX_IDS) {
    return problemResponse({
      status: 400,
      code: 'request.invalid',
      title: 'Bad Request',
      detail: `chunk_ids must be an array of ${MIN_IDS}-${MAX_IDS} UUIDs.`,
    });
  }
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      return problemResponse({
        status: 400,
        code: 'request.invalid',
        title: 'Bad Request',
        detail: 'Every chunk_id must be a UUID.',
      });
    }
  }

  // Preserve request order + de-dupe lookups (resolve once per unique id but
  // emit one citation per requested entry).
  const uniqueIds = Array.from(new Set(ids));
  const { chunks, documents } = await fetchChunksForCitations(uniqueIds);
  const chunkById = new Map(chunks.map((c) => [c.id, c] as const));

  const response: ResolveCitationsResponse = {
    citations: ids.map((id) => {
      const chunk = chunkById.get(id);
      if (!chunk) return unavailableCitation(id, 'Source chunk no longer available.');
      const doc = documents.get(chunk.document_id);
      if (!doc) return unavailableCitation(id, 'Source document no longer available.');
      return toContractCitation(chunk, doc);
    }),
  };
  return NextResponse.json(response);
}
