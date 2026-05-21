import type { Page } from '@playwright/test';

/**
 * Page object for the login page (/auth/login).
 * Encapsulates selectors and actions for auth flows.
 */
export class LoginPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/auth/login');
  }

  async fillEmail(email: string): Promise<void> {
    await this.page.getByLabel('Email').fill(email);
  }

  async fillPassword(password: string): Promise<void> {
    await this.page.getByLabel('Password').fill(password);
  }

  async submit(): Promise<void> {
    await this.page.getByRole('button', { name: /sign in/i }).click();
  }

  async waitForDashboard(): Promise<void> {
    await this.page.waitForURL('**/planner', { timeout: 15_000 });
  }
}
