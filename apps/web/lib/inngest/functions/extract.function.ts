// SPDX-License-Identifier: Apache-2.0
//
// Inngest wrapper around the pure `runExtraction` routine. Kept separate from
// extract.ts so unit tests can import the pure function without pulling in
// the `server-only`-guarded admin Supabase client.
import { inngest, EVENT_DOCUMENT_UPLOADED, type DocumentUploadedData } from '../client';
import { downloadDocumentObject, patchDocumentRow } from '../storage';
import { extractPdfPages, runExtraction } from './extract';

/**
 * Subscribes to `document.uploaded` and runs the extraction step inside a
 * single retryable Inngest step. Later chunks (chunking, embedding) chain
 * additional `step.run` calls onto this function.
 */
export const extractDocumentFunction = inngest.createFunction(
  {
    id: 'extract-document',
    retries: 3,
    triggers: [{ event: EVENT_DOCUMENT_UPLOADED }],
  },
  async ({ event, step }) => {
    return step.run('extract', () =>
      runExtraction(
        {
          download: downloadDocumentObject,
          extract: extractPdfPages,
          setState: patchDocumentRow,
        },
        event.data as DocumentUploadedData,
      ),
    );
  },
);
