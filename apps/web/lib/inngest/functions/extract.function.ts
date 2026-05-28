// SPDX-License-Identifier: Apache-2.0
//
// Inngest wrapper around the pure ingestion routines (extract → chunk →
// embed). Kept separate from the pure modules so unit tests can import them
// without pulling the `server-only`-guarded admin Supabase client or the
// fetch-based OpenAI embeddings client.
//
// One Inngest function with three durable steps. Each `step.run` checkpoints
// its return value, so a failure inside `embed` retries embedding only — it
// does not re-download the PDF or re-chunk. The single-function design also
// keeps the size of every event payload tiny (`document.uploaded` only); the
// large intermediate values (per-page text, chunk records) live inside the
// step memo, not in events.
import { embedTexts } from '../../embeddings/openai';
import { inngest, EVENT_DOCUMENT_UPLOADED, type DocumentUploadedData } from '../client';
import { downloadDocumentObject, patchDocumentRow, replaceDocumentChunks } from '../storage';
import { runChunking } from './chunk';
import { runEmbedding } from './embed';
import { extractPdfPages, runExtraction } from './extract';

export const extractDocumentFunction = inngest.createFunction(
  {
    id: 'extract-document',
    retries: 3,
    triggers: [{ event: EVENT_DOCUMENT_UPLOADED }],
  },
  async ({ event, step }) => {
    const data = event.data as DocumentUploadedData;

    const extraction = await step.run('extract', () =>
      runExtraction(
        {
          download: downloadDocumentObject,
          extract: extractPdfPages,
          setState: patchDocumentRow,
        },
        data,
      ),
    );

    const chunks = await step.run('chunk', () => runChunking(extraction));

    return step.run('embed', () =>
      runEmbedding(
        {
          embed: (inputs) => embedTexts(inputs),
          storeChunks: replaceDocumentChunks,
          setState: patchDocumentRow,
        },
        data.document_id,
        chunks,
      ),
    );
  },
);
