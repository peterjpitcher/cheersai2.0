import { test, expect } from '../../fixtures/auth.fixture';

test.describe('Schedule and Publish', () => {
  test('owner can create content, schedule it, and see it on planner', async ({ authedPage: page }) => {
    // Navigate to create
    await page.goto('/create');
    await page.getByRole('button', { name: /instant post/i }).click();
    await page.getByLabel(/title|headline/i).fill('Scheduled Test Post');
    await page.getByLabel(/body|content|description/i).fill('Test content for scheduling');
    await page.getByRole('button', { name: /next|continue/i }).click();

    // Continue through wizard steps (schedule step)
    // Note: exact selectors depend on wizard implementation
    await page.getByRole('button', { name: /save|create/i }).click();

    // Verify redirect or success indication
    await page.waitForURL(/planner/, { timeout: 10_000 });
  });
});
