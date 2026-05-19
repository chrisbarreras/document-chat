// SPDX-License-Identifier: Apache-2.0
import { test, expect } from '@playwright/test';

test('homepage renders the document-chat heading', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'document-chat' })).toBeVisible();
});
