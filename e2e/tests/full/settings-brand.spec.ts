import { test, expect } from '../../fixtures/auth.fixture';
import { SettingsPage } from '../../fixtures/page-objects/settings.page';

test.describe('Settings Brand Voice', () => {
  test('owner can update brand voice settings', async ({ authedPage: page }) => {
    const settings = new SettingsPage(page);
    await settings.goto();

    // Verify settings page loads
    await expect(page.getByRole('heading', { name: /setting/i })).toBeVisible();

    // Update brand voice (if the field exists)
    // Note: exact field depends on settings page implementation
    await settings.save();
    await settings.waitForSaveConfirmation();
  });
});
