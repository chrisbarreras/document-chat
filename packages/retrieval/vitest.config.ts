// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text-summary', 'html', 'lcov'],
      include: ['src/**'],
      exclude: ['**/*.test.ts', 'src/index.ts'],
    },
  },
});
