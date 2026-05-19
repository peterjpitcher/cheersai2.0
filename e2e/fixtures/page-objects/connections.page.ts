import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the social connections page (/connections).
 * Encapsulates OAuth connect buttons and connection card selectors.
 */
export class ConnectionsPage {
  readonly connectButtons: Locator;

  constructor(private page: Page) {
    this.connectButtons = page.getByRole('button', { name: /connect/i });
  }

  async goto(): Promise<void> {
    await this.page.goto('/connections');
  }

  async getConnectionCount(): Promise<number> {
    return this.page.locator('[data-testid="connection-card"]').count();
  }

  async clickConnect(provider: string): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(`connect.*${provider}`, 'i') }).click();
  }
}
