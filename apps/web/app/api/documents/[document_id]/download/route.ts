// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import { getOptionalUser } from '../../../../../lib/auth';
import { getDocumentRow, mintDownloadUrl } from '../../../../../lib/documents-store';
import { problemResponse, unauthorized } from '../../../../../lib/problem';

type Params = { params: Promise<{ document_id: string }> };

// Short-lived: the link only needs to survive the immediate redirect.
const SIGNED_URL_TTL_SECONDS = 120;

/**
 * GET /api/documents/{id}/download
 *
 * Redirects to a fresh, short-lived signed Storage URL for the document's PDF.
 * `getDocumentRow` is RLS-scoped, so a caller can only download their own
 * workspace's documents. We always mint a new URL (rather than embedding one in
 * the page) so the link never goes stale.
 */
export async function GET(_request: Request, { params }: Params): Promise<Response> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to download documents.');

  const { document_id } = await params;
  const row = await getDocumentRow(document_id);
  if (!row) {
    return problemResponse({ status: 404, code: 'document.not_found', title: 'Not Found' });
  }

  // Sanitize the title into a safe download filename.
  const safeTitle = (row.title || 'document').replace(/[^\w.\- ]+/g, '_').trim() || 'document';
  const filename = safeTitle.toLowerCase().endsWith('.pdf') ? safeTitle : `${safeTitle}.pdf`;

  const minted = await mintDownloadUrl(row.storage_object_key, SIGNED_URL_TTL_SECONDS, filename);
  if (!minted) {
    return problemResponse({
      status: 502,
      code: 'storage.signed_url_failed',
      title: 'Could not create a download link',
    });
  }

  return NextResponse.redirect(minted.signedUrl, 302);
}
