// SPDX-License-Identifier: Apache-2.0
import { defineConfig, devices } from '@playwright/test';

// When E2E_BASE_URL is set (e.g. a Vercel preview URL in the deployment
// workflow), target that deployment and skip the local web server.
// Otherwise boot a local `next start` and test against it.
const remoteBaseURL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: remoteBaseURL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(remoteBaseURL
    ? {}
    : {
        webServer: {
          command: 'npx --no-install next start',
          url: 'http://localhost:3000',
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
