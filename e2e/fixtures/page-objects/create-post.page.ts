import type { Page } from '@playwright/test';

/**
 * Page object for the create post wizard (/create).
 * Encapsulates multi-step wizard selectors and actions.
 */
export class CreatePostPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/create');
  }

  async selectType(type: string): Promise<void> {
    await this.page.getByRole('button', { name: new RegExp(type, 'i') }).click();
  }

  async fillTitle(title: string): Promise<void> {
    await this.page.getByLabel(/title|headline/i).fill(title);
  }

  async fillBody(body: string): Promise<void> {
    await this.page.getByLabel(/body|content|description/i).fill(body);
  }

  async clickNext(): Promise<void> {
    await this.page.getByRole('button', { name: /next|continue/i }).click();
  }

  async clickSave(): Promise<void> {
    await this.page.getByRole('button', { name: /save|create|submit/i }).click();
  }
}
