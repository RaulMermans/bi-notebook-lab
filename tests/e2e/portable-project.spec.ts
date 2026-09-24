import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

/**
 * Journey D — Portable Project (Sprint 16 brief Part G §39). Exports the
 * active project, mutates the workspace (adds a measure that must NOT
 * survive), then imports the original bundle back and asserts the mutation
 * is gone and the original state is restored — proving import genuinely
 * replaces the workspace rather than merging into it (brief §6), not just
 * that a file downloaded.
 */
test.describe('Journey D — Portable Project', () => {
  test('export a project, mutate the workspace, import the export back, original state restored', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => consoleErrors.push(err.message))

    await page.goto('/')
    await page.locator('.practice-project-card', { hasText: 'DAX Playground' }).click()
    await expect(page.getByRole('heading', { name: 'Retail Model' })).toBeVisible()

    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export project' }).click()])
    const filePath = await download.path()
    expect(filePath).toBeTruthy()

    const bundle = JSON.parse(readFileSync(filePath!, 'utf-8'))
    expect(bundle.format).toBe('bi-notebook-lab-project')
    expect(bundle.schemaVersion).toBe(1)
    expect(bundle.notebook.title).toBe('DAX Playground')
    expect(Array.isArray(bundle.models)).toBe(true)
    expect(bundle.models.length).toBeGreaterThan(0)

    // Mutate the workspace after exporting — this measure must not survive the import below.
    await page.getByRole('button', { name: '+ New measure' }).click()
    const selects = page.locator('.create-calculated-column-panel select')
    await selects.nth(0).selectOption({ label: 'Retail Model' })
    await selects.nth(1).selectOption({ label: 'Sales' })
    await page.getByPlaceholder('Measure name (e.g. Total Revenue)').fill('Should Not Persist')
    await page.locator('.expression-editor__textarea').fill('SUM(Sales[Quantity])')
    await page.getByRole('button', { name: 'Create' }).click()
    await expect(page.getByRole('heading', { name: 'Should Not Persist' })).toBeVisible()

    page.on('dialog', (dialog) => dialog.accept())
    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import project' }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles(filePath!)

    await expect(page.locator('.project-file-actions__notice')).toHaveText('Project imported.')
    await expect(page.getByRole('heading', { name: 'DAX Playground', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Retail Model' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Should Not Persist' })).toHaveCount(0)

    expect(consoleErrors, `Unexpected console/page errors: ${consoleErrors.join('\n')}`).toEqual([])
  })
})
