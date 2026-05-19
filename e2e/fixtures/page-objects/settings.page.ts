import type { Page } from '@playwright/test';

/**
 * Page object for the settings page (/settings).
 * Encapsulates brand voice and preferences selectors.
 */
export class SettingsPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/settings');
  }

  async updateBrandVoice(tone: string): Promise<void> {
    await this.page.getByLabel(/tone|brand voice/i).fill(tone);
  }

  async save(): Promise<void> {
    await this.page.getByRole('button', { name: /save/i }).click();
  }

  async waitForSaveConfirmation(): Promise<void> {
    await this.page.getByText(/saved|updated/i).waitFor({ timeout: 5_000 });
  }
}
