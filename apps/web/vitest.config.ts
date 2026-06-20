// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Transform JSX in *.test.tsx (component tests) with the automatic runtime —
  // tsconfig uses jsx:"preserve" for Next, which esbuild would otherwise leave
  // untransformed.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['app/**/*.test.ts', 'app/**/*.test.tsx', 'lib/**/*.test.ts'],
    exclude: ['e2e/**', 'node_modules/**', '.next/**', '**/*.integration.test.ts'],
  },
});
