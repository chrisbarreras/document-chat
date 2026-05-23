// SPDX-License-Identifier: Apache-2.0
import { NextResponse } from 'next/server';
import type { components } from '@document-chat/contracts';
import { getOptionalUser } from '../../../../lib/auth';
import { getCurrentWorkspace } from '../../../../lib/workspace';
import { mintUploadUrl } from '../../../../lib/documents-store';
import { problemResponse, unauthorized } from '../../../../lib/problem';
import {
  ALLOWED_CONTENT_TYPES,
  MAX_UPLOAD_BYTES,
  SIGNED_UPLOAD_URL_TTL_SECONDS,
} from '../../../../lib/documents';

type CreateUploadRequest = components['schemas']['CreateUploadRequest'];
type CreateUploadResponse = components['schemas']['CreateUploadResponse'];

function isAllowedType(t: string): boolean {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(t);
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getOptionalUser();
  if (!user) return unauthorized('Sign in to upload.');

  const workspace = await getCurrentWorkspace();
  if (!workspace) {
    return problemResponse({
      status: 500,
      code: 'workspace.not_provisioned',
      title: 'Workspace not provisioned',
    });
  }

  let body: CreateUploadRequest;
  try {
    body = (await request.json()) as CreateUploadRequest;
  } catch {
    return problemResponse({
      status: 400,
      code: 'request.invalid_json',
      title: 'Bad Request',
      detail: 'Request body must be valid JSON.',
    });
  }

  if (!body?.filename || typeof body.size_bytes !== 'number' || !body.content_type) {
    return problemResponse({
      status: 400,
      code: 'request.invalid',
      title: 'Bad Request',
      detail: 'filename, size_bytes, and content_type are required.',
    });
  }
  if (body.size_bytes > MAX_UPLOAD_BYTES) {
    return problemResponse({
      status: 413,
      code: 'document.too_large',
      title: 'Payload Too Large',
      detail: `Files must be ${MAX_UPLOAD_BYTES} bytes or smaller.`,
    });
  }
  if (!isAllowedType(body.content_type)) {
    return problemResponse({
      status: 415,
      code: 'document.unsupported_type',
      title: 'Unsupported Media Type',
      detail: 'Only application/pdf is accepted in Tier 1.',
    });
  }

  const uploadId = crypto.randomUUID();
  const storageObjectKey = `${workspace.id}/${uploadId}.pdf`;

  const minted = await mintUploadUrl(storageObjectKey);
  if (!minted) {
    return problemResponse({
      status: 500,
      code: 'storage.signed_url_failed',
      title: 'Could not create upload URL',
    });
  }

  const response: CreateUploadResponse = {
    upload_id: uploadId,
    signed_url: minted.signedUrl,
    signed_url_expires_at: new Date(Date.now() + SIGNED_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
    storage_object_key: storageObjectKey,
    max_size_bytes: MAX_UPLOAD_BYTES,
  };
  return NextResponse.json(response, { status: 201 });
}
