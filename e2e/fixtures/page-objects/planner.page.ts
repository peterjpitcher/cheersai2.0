import type { Page, Locator } from '@playwright/test';

/**
 * Page object for the planner calendar view (/planner).
 * Encapsulates calendar navigation and content chip selectors.
 */
export class PlannerPage {
  readonly calendar: Locator;
  readonly createButton: Locator;
  readonly attentionBanner: Locator;

  constructor(private page: Page) {
    this.calendar = page.locator('[data-testid="planner-calendar"]');
    this.createButton = page.getByRole('button', { name: /create/i });
    this.attentionBanner = page.getByTestId('attention-needed-banner');
  }

  async goto(month?: string): Promise<void> {
    const url = month ? `/planner?month=${month}` : '/planner';
    await this.page.goto(url);
  }

  async navigateMonth(direction: 'next' | 'prev'): Promise<void> {
    await this.page.getByRole('button', { name: direction === 'next' ? /next/i : /prev/i }).click();
  }

  async getVisibleItems(): Promise<number> {
    return this.page.locator('[data-testid="calendar-cell"] [data-testid="content-chip"]').count();
  }
}
