import { expect, test } from '@playwright/test'

/**
 * Journey A — First-Time Free Lab (Sprint 16 brief Part G §39). Uses the
 * "DAX Playground" practice project rather than "Retail Modeling" — Retail
 * Modeling deliberately starts with an empty, table-less model (the point
 * is to practice building the star schema), so measure creation isn't
 * available until relationships exist. DAX Playground starts from a
 * completed star schema specifically so a learner can create a measure
 * immediately — the more realistic "first successful action" path.
 */
test.describe('Journey A — First-Time Free Lab', () => {
  test('open app, start a practice project, create a measure, evaluate, reload, state persists', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Practice Power BI concepts in your browser' })).toBeVisible()
    await expect(page.locator('.practice-project-card')).toHaveCount(4)

    await page.locator('.practice-project-card', { hasText: 'DAX Playground' }).click()

    await expect(page.getByRole('heading', { name: 'DAX Playground', level: 1 })).toBeVisible()
    await expect(page.locator('.empty-state')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Retail Model' })).toBeVisible()

    await page.getByRole('button', { name: '+ New measure' }).click()
    const selects = page.locator('.create-calculated-column-panel select')
    await selects.nth(0).selectOption({ label: 'Retail Model' })
    await selects.nth(1).selectOption({ label: 'Sales' })
    await page.getByPlaceholder('Measure name (e.g. Total Revenue)').fill('E2E Test Measure')
    await page.locator('.expression-editor__textarea').fill('SUM(Sales[Revenue])')
    await page.getByRole('button', { name: 'Create' }).click()

    await expect(page.getByRole('heading', { name: 'E2E Test Measure' })).toBeVisible()

    await page.reload()

    await expect(page.getByRole('heading', { name: 'DAX Playground', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'E2E Test Measure' })).toBeVisible()

    expect(consoleErrors, `Unexpected console/page errors: ${consoleErrors.join('\n')}`).toEqual([])
  })
})
