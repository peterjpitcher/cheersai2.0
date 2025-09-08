import { test, expect } from '@playwright/test'

test.describe('Marketing pages', () => {
  test('home loads and has CTA', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CheersAI/i)
    await expect(page.getByText(/Start your free 14-day trial/i)).toBeVisible()
  })
  test('pricing loads', async ({ page }) => {
    await page.goto('/pricing')
    await expect(page.getByRole('heading', { name: /Pricing/i })).toBeVisible()
  })
})

test.describe('Calendar page (unauthenticated redirect)', () => {
  test('redirects unauthenticated users to home', async ({ page }) => {
    await page.goto('/calendar')
    await expect(page).toHaveURL(/\/$/)
  })
})

