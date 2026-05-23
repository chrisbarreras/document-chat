// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'drizzle-kit';

// NOTE: the authoritative migrations live in ../../supabase/migrations and are
// applied by `supabase db reset` (ADR-0004). This config is NOT the apply
// pipeline — it exists so `drizzle-kit generate` / `drizzle-kit studio` can
// author or diff SQL against the schema during review. Anything it writes to
// ./drizzle is scratch (gitignored).
export default defineConfig({
  dialect: 'postgresql',
  schema: './lib/db/schema.ts',
  out: './drizzle',
});
