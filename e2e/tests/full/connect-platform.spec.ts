import { test, expect } from '../../fixtures/auth.fixture';
import { ConnectionsPage } from '../../fixtures/page-objects/connections.page';

test.describe('Connect Platform', () => {
  test('owner can view connections page and see connect buttons', async ({ authedPage: page }) => {
    const connections = new ConnectionsPage(page);
    await connections.goto();

    // Verify connections page loads
    await expect(page.getByRole('heading', { name: /connection/i })).toBeVisible();

    // Verify connect buttons are present for at least one platform
    // Note: actual OAuth flow cannot be tested without real credentials
    // This test verifies the UI loads and is functional
    await expect(connections.connectButtons.first()).toBeVisible();
  });
});
