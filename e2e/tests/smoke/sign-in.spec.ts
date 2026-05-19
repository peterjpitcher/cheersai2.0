import { test, expect } from '../../fixtures/auth.fixture';
import { LoginPage } from '../../fixtures/page-objects/login.page';

test.describe('Sign In @smoke', () => {
  test('owner can sign in and reach planner', async ({ page }) => {
    const loginPage = new LoginPage(page);
    await loginPage.goto();

    // Verify sign-in page loads
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();

    // Sign in with test credentials
    await loginPage.fillEmail(process.env.E2E_TEST_EMAIL!);
    await loginPage.fillPassword(process.env.E2E_TEST_PASSWORD!);
    await loginPage.submit();
    await loginPage.waitForDashboard();

    // Verify landed on planner
    await expect(page).toHaveURL(/planner/);
    await expect(page.getByRole('heading', { name: /planner/i })).toBeVisible();
  });

  test('unauthenticated user is redirected to sign-in', async ({ page }) => {
    await page.goto('/planner');
    await expect(page).toHaveURL(/sign-in/);
  });
});
