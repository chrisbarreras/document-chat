// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow } from '../../../../../lib/documents-store';
import { listDocumentChunks } from '../../../../../lib/chunks-store';
import { toContractChunk } from '../../../../../lib/chunks';
import { problemResponse, unauthorized } from '../../../../../lib/problem';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../../../../../lib/documents';

type PaginatedChunks = components['schemas']['PaginatedChunks'];

type Params = { params: Promise<{ document_id: string }> };

function badRequest(detail: string): NextResponse {
  return problemResponse({ status: 400, code: 'request.invalid', title: 'Bad Request', detail });
}

// GET /documents/{id}/chunks — paginated chunk list for debug / eval.
export async function GET(request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to list chunks.');

  const { document_id } = await params;
  // Existence + ownership check via RLS — null when not owned.
  const document = await getDocumentRow(document_id);
  if (!document) {
    return problemResponse({ status: 404, code: 'document.not_found', title: 'Not Found' });
  }

  const url = new URL(request.url);
  const params_ = url.searchParams;

  let limit = DEFAULT_PAGE_LIMIT;
  const limitRaw = params_.get('limit');
  if (limitRaw !== null) {
    const n = Number(limitRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_LIMIT) {
      return badRequest(`limit must be an integer between 1 and ${MAX_PAGE_LIMIT}.`);
    }
    limit = n;
  }

  const cursor = params_.get('cursor') ?? undefined;

  const { items, nextCursor } = await listDocumentChunks({
    documentId: document_id,
    ...(cursor ? { cursor } : {}),
    limit,
  });

  const body: PaginatedChunks = {
    items: items.map(toContractChunk),
    page: { limit, next_cursor: nextCursor },
  };
  return NextResponse.json(body);
}
