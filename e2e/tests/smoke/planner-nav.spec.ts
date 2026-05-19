import { test, expect } from '../../fixtures/auth.fixture';
import { PlannerPage } from '../../fixtures/page-objects/planner.page';

test.describe('Planner Navigation @smoke', () => {
  test('owner can navigate months on planner calendar', async ({ authedPage: page }) => {
    const planner = new PlannerPage(page);
    await planner.goto();

    // Verify calendar renders
    await expect(page.getByRole('heading', { name: /planner/i })).toBeVisible();

    // Navigate to next month
    await planner.navigateMonth('next');
    await page.waitForTimeout(500); // allow re-render

    // Navigate back
    await planner.navigateMonth('prev');
    await page.waitForTimeout(500);

    // Calendar should still be visible
    await expect(page.getByRole('heading', { name: /planner/i })).toBeVisible();
  });
});
