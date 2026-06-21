// SPDX-License-Identifier: Apache-2.0
// Combined unit + integration coverage. Runs both test suites in one pass so
// DB-backed lib/* code isn't reported as 0% (it's only exercised by integration
// tests). Requires local Supabase to be running — see `pnpm coverage`.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: [
      'app/**/*.test.ts',
      'app/**/*.test.tsx',
      'lib/**/*.test.ts',
      '*.test.ts',
      '**/*.integration.test.ts',
    ],
    exclude: ['e2e/**', 'node_modules/**', '.next/**'],
    setupFiles: ['./vitest.integration.setup.ts'],
    // Local Supabase / Docker first-hit latency (matches the integration config).
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['app/**', 'lib/**'],
      exclude: [
        '**/*.test.*',
        '**/*.integration.test.ts',
        // React UI is covered by Playwright e2e, not unit tests — keep it out of
        // the denominator so the % reflects testable logic.
        '**/*.tsx',
        'lib/db/schema.ts', // Drizzle schema — declarative
        'lib/build-info.ts', // build-time constants
        'lib/inngest/functions/index.ts', // barrel
        // Framework wiring / client factories with no branching logic — these
        // are integration/runtime glue, not unit-testable logic.
        'app/api/inngest/route.ts',
        'app/auth/signout/route.ts',
        'lib/inngest/client.ts',
        'lib/inngest/functions/extract.function.ts',
        'lib/supabase/client.ts',
        'lib/supabase/server.ts',
        'lib/chat/runtime.ts',
        'test/**',
        'e2e/**',
      ],
    },
  },
  resolve: {
    alias: {
      // `server-only` is a Next.js bundler guard with no runtime API and is
      // unresolvable under pnpm/Vitest. Map it to an empty module so
      // server-guarded code (e.g. lib/supabase/admin.ts) loads in tests.
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
    },
  },
});
