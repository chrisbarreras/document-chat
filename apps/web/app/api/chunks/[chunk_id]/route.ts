// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { getOptionalUser } from '../../../../lib/auth';
import { getChunkRow } from '../../../../lib/chunks-store';
import { toContractChunk } from '../../../../lib/chunks';
import { problemResponse, unauthorized } from '../../../../lib/problem';

type Params = { params: Promise<{ chunk_id: string }> };

// GET /chunks/{id} — resolve a single chunk. RLS hides cross-workspace rows
// as 404 per the contract's NotFound semantics; deletes (chunk gone) return
// 410 to match the spec's `Gone` response.
export async function GET(_request: Request, { params }: Params): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to view chunks.');

  const { chunk_id } = await params;
  const row = await getChunkRow(chunk_id);
  if (!row) {
    return problemResponse({ status: 404, code: 'chunk.not_found', title: 'Not Found' });
  }
  return NextResponse.json(toContractChunk(row));
}
