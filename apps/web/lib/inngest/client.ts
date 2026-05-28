// SPDX-License-Identifier: Apache-2.0
import { Inngest } from 'inngest';

/**
 * The Inngest app id. Surfaced in the Inngest dashboard and used by the dev
 * server to discover the local Next.js handler at `/api/inngest`.
 */
export const INNGEST_APP_ID = 'document-chat';

/**
 * Event names emitted by this app. Adding an event here is the type-only
 * source of truth; the payload type lives next to its sender.
 */
export const EVENT_DOCUMENT_UPLOADED = 'document.uploaded' as const;

/**
 * Payload for the first event in the ingestion pipeline. Emitted by
 * `POST /api/documents` once the storage object is verified and the
 * `documents` row exists in `pending` state. Consumed by `extractDocument`,
 * which downloads the object, extracts text + `page_count` via unpdf, and
 * transitions the row to `chunking` (the next chunk in the pipeline owns
 * the rest of the state machine).
 */
export interface DocumentUploadedData {
  document_id: string;
  workspace_id: string;
  storage_object_key: string;
}

/**
 * Singleton Inngest client. In production, `INNGEST_EVENT_KEY` /
 * `INNGEST_SIGNING_KEY` are read from env by the SDK; in local dev the
 * Inngest CLI runs an unauthenticated dev server and ignores them.
 *
 * Event payloads are typed at the call site (see `sendDocumentUploaded`)
 * rather than via a global schema registry — keeps the client free of
 * SDK-version-specific generics.
 */
export const inngest = new Inngest({ id: INNGEST_APP_ID });

/**
 * Type-safe sender for `document.uploaded`. Wraps `inngest.send` so callers
 * cannot accidentally drift the event name or payload shape.
 */
export async function sendDocumentUploaded(data: DocumentUploadedData): Promise<void> {
  await inngest.send({ name: EVENT_DOCUMENT_UPLOADED, data });
}
