// SPDX-License-Identifier: Apache-2.0
import { test, expect } from '@playwright/test';

test('unauthenticated /chats redirects to /login', async ({ page }) => {
  await page.goto('/chats');
  await expect(page).toHaveURL(/\/login/);
});

test('unauthenticated /chats/some-id redirects to /login', async ({ page }) => {
  await page.goto('/chats/00000000-0000-0000-0000-000000000001');
  await expect(page).toHaveURL(/\/login/);
});
