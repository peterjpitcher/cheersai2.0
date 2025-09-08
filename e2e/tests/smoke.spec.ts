import { test, expect } from '@playwright/test'

test('health endpoint responds', async ({ request }) => {
  const res = await request.get('/api/health')
  // Either ok or degraded when no OpenAI configured
  expect([200, 207, 503]).toContain(res.status())
  const json = await res.json()
  expect(json).toHaveProperty('status')
  expect(json).toHaveProperty('timestamp')
})

test('homepage renders marketing content', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/CheersAI/i)
  await expect(page.getByText(/AI-Powered Social Media/i)).toBeVisible()
})

test('quick generate API is protected', async ({ request }) => {
  const res = await request.post('/api/generate/quick', { data: { prompt: 'hello' } })
  expect([401, 400]).toContain(res.status())
})

