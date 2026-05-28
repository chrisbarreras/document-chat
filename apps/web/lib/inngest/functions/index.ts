// SPDX-License-Identifier: Apache-2.0
import { extractDocumentFunction } from './extract.function';

/**
 * Every Inngest function registered on this app. The `/api/inngest` handler
 * imports this list to register them with the Inngest runtime.
 */
export const inngestFunctions = [extractDocumentFunction];
