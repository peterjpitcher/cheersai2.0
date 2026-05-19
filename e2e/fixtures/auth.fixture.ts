import { test as base, type Page } from '@playwright/test';

/**
 * Shared auth fixture providing an authenticated page session.
 * Uses password fallback auth (simpler than email interception for E2E).
 * Requires E2E_TEST_EMAIL and E2E_TEST_PASSWORD environment variables.
 */
export const test = base.extend<{ authedPage: Page }>({
  authedPage: async ({ page }, use) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    if (!email || !password) {
      throw new Error('E2E_TEST_EMAIL and E2E_TEST_PASSWORD must be set');
    }

    await page.goto('/auth/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await page.waitForURL('**/planner', { timeout: 15_000 });

    // eslint-disable-next-line react-hooks/rules-of-hooks -- Playwright fixture `use`, not React hook
    await use(page);
  },
});

export { expect } from '@playwright/test';
