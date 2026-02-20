import { test, expect } from '@playwright/test'

test.describe('export', () => {
  test('clicking Save opens export modal with bake checkbox', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('#btn-save')).toBeVisible({ timeout: 15000 })

    await page.locator('#btn-save').click()
    await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('#export-bake-csg')).toBeVisible()
  })

  test('export with Bake CSG checked triggers download', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' })
    await expect(page.locator('#viewport')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('#btn-save')).toBeVisible({ timeout: 15000 })

    await page.locator('#btn-save').click()
    await expect(page.locator('#export-modal')).toBeVisible({ timeout: 5000 })

    // Ensure at least one item is selected (default lights are unchecked; scene may have no brushes)
    const listCheckbox = page.locator('#export-list input[type="checkbox"]').first()
    await listCheckbox.waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
    if (await listCheckbox.isVisible()) await listCheckbox.check()

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 })
    await page.locator('#export-bake-csg').check()
    await page.locator('#btn-export-confirm').click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('level.glb')
  })
})
