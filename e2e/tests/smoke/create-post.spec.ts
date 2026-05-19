import { test, expect } from '../../fixtures/auth.fixture';
import { CreatePostPage } from '../../fixtures/page-objects/create-post.page';

test.describe('Create Post @smoke', () => {
  test('owner can create an instant post draft', async ({ authedPage: page }) => {
    const createPage = new CreatePostPage(page);
    await createPage.goto();

    // Select Instant Post type
    await createPage.selectType('instant post');
    // Fill minimal required fields
    await createPage.fillTitle('E2E Test Post');
    await createPage.fillBody('This is an automated test post for CheersAI');
    await createPage.clickNext();

    // Verify progress through wizard (at least reached step 2)
    await expect(page.locator('[data-testid="wizard-step"]')).toBeVisible();
  });
});
