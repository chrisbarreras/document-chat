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
import { NonRetriableError } from 'inngest';
import { embedTexts, getOcrProvider } from '@document-chat/retrieval';
import { inngest, EVENT_DOCUMENT_UPLOADED, type DocumentUploadedData } from '../client';
import {
  downloadDocumentObject,
  recordIngestionTransition,
  replaceDocumentChunks,
} from '../storage';
import { runChunking } from './chunk';
import { runEmbedding } from './embed';
import { extractPdfPages, runExtraction, NoExtractableTextError } from './extract';

export const extractDocumentFunction = inngest.createFunction(
  {
    id: 'extract-document',
    retries: 3,
    triggers: [{ event: EVENT_DOCUMENT_UPLOADED }],
  },
  async ({ event, step }) => {
    const data = event.data as DocumentUploadedData;

    // Resolve the OCR fallback engine once per run (env-selected; `null` when
    // OCR is disabled). Reading it here surfaces a misconfigured OCR_PROVIDER
    // loudly at the start of the run rather than mid-step.
    const ocrProvider = getOcrProvider();

    const extraction = await step.run('extract', async () => {
      try {
        return await runExtraction(
          {
            download: downloadDocumentObject,
            extract: extractPdfPages,
            // Omit the key entirely (not `undefined`) when OCR is disabled —
            // `exactOptionalPropertyTypes` distinguishes the two.
            ...(ocrProvider ? { ocr: (pdf: Uint8Array) => ocrProvider.ocrPdf(pdf) } : {}),
            transition: recordIngestionTransition,
          },
          data,
        );
      } catch (err) {
        // A scanned/image PDF (no extractable text) is deterministic — the row
        // is already marked `failed`; don't burn retries on it.
        if (err instanceof NoExtractableTextError) throw new NonRetriableError(err.message);
        throw err;
      }
    });

    const chunks = await step.run('chunk', () => runChunking(extraction));

    return step.run('embed', () =>
      runEmbedding(
        {
          embed: (inputs) => embedTexts(inputs),
          storeChunks: replaceDocumentChunks,
          transition: recordIngestionTransition,
        },
        data.document_id,
        chunks,
      ),
    );
  },
);
