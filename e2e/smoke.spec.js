import { test, expect } from '@playwright/test'

test.describe('smoke', () => {
  test('app loads and viewport is visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 15000 })
    // App is ready when Save button exists (EditorController wired after scene init)
    await expect(page.locator('#btn-save')).toBeVisible({ timeout: 15000 })
    // Canvas is added by Three.js; may take a moment in headless
    const canvas = page.locator('#viewport canvas')
    await expect(canvas).toBeAttached({ timeout: 15000 })
  })
})
