// SPDX-License-Identifier: Apache-2.0
import { serve } from 'inngest/next';
import { inngest } from '../../../lib/inngest/client';
import { inngestFunctions } from '../../../lib/inngest/functions';

/**
 * Single registration surface for every Inngest function in the app. The
 * Inngest dev server (`npx inngest-cli dev`) discovers this endpoint over
 * HTTP; Inngest Cloud invokes the same handler in production using the
 * `INNGEST_SIGNING_KEY` for request signing.
 *
 * App-Router exports the three HTTP verbs Inngest requires: `GET` for
 * introspection, `POST` for invocations, `PUT` for sync.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
});
