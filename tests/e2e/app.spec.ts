import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { readdirSync, readFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Minimal typing of the renderer's automation hook (see src/renderer/src/store/controller.ts).
interface TmUiState {
  cam: { validations: { level: string }[]; files: unknown[] } | null
  generating: boolean
  camStale: boolean
  set(patch: { stage: string }): void
}
declare global {
  interface Window {
    __tm?: {
      importDropped(files: { name: string; data: string }[]): Promise<void>
      ui: { getState(): TmUiState }
      regenerate(): Promise<void>
      project: {
        getState(): {
          layers: { id: string }[]
          removeLayer(id: string): void
          steps: { id: string; kind: string }[]
          tools: { id: string; type: string; geometry: { diameter: number } }[]
          upsertStep(step: unknown): void
        }
      }
    }
  }
}

const root = join(__dirname, '../..')
const shots = join(root, 'test-results/e2e')
mkdirSync(shots, { recursive: true })

let app: ElectronApplication
let page: Page

test.beforeAll(async () => {
  const args = [join(root, 'out/main/index.js')]
  if (process.getuid?.() === 0) args.unshift('--no-sandbox')
  app = await electron.launch({ args, env: { ...process.env, NODE_ENV: 'production' } })
  page = await app.firstWindow()
  await page.waitForFunction(() => !!window.__tm)
})

test.afterAll(async () => {
  await app?.close()
})

test('full workflow: import → manufacture → simulate → export', async () => {
  // Board: first import asks for the EDA tool
  const dir = join(root, 'fixtures/boards/demo-kicad')
  const files = readdirSync(dir).map((name) => ({ name, data: readFileSync(join(dir, name), 'utf8') }))
  await page.evaluate((f) => void window.__tm!.importDropped(f), files)
  await page.getByTestId('eda-kicad').click()
  await expect(page.getByTestId('layer-item')).toHaveCount(8)
  await expect(page.getByTestId('file-status')).toContainText('Copper')
  await page.getByTestId('toggle-all-layers').click()
  await page.getByTestId('toggle-all-layers').click()
  await page.screenshot({ path: join(shots, '1-board.png') })

  // Manufacture: recipe + generation
  await page.getByTestId('continue-manufacture').click()
  page.once('dialog', (d) => void d.accept())
  await page.getByTestId('recipe').click()
  await expect(page.getByTestId('step-card').first()).toBeVisible()
  await expect(page.getByTestId('flip-marker').first()).toBeVisible()
  await page.waitForFunction(() => !!window.__tm!.ui.getState().cam && !window.__tm!.ui.getState().generating)
  const errors = await page.evaluate(
    () => window.__tm!.ui.getState().cam!.validations.filter((v) => v.level === 'error').length
  )
  expect(errors).toBe(0)
  await page.screenshot({ path: join(shots, '2-manufacture.png') })

  // Step dialog opens and shows sections
  await page.getByTestId('step-card').first().hover()
  await page.getByTestId('step-edit').first().click()
  await expect(page.getByTestId('step-dialog')).toBeVisible()
  await page.getByTestId('step-cancel').click()

  // Simulation
  await page.getByTestId('continue-simulation').click()
  await expect(page.getByTestId('sim-canvas')).toBeVisible()
  await page.getByTestId('sim-end').click()
  await page.waitForTimeout(1500)
  await page.screenshot({ path: join(shots, '3-simulation.png') })

  // Export
  await page.getByTestId('continue-export').click()
  await page.getByTestId('export-grouping-per-step').click()
  await page.waitForFunction(
    () => !window.__tm!.ui.getState().generating && !window.__tm!.ui.getState().camStale
  )
  const n = await page.evaluate(() => window.__tm!.ui.getState().cam!.files.length)
  await expect(page.getByTestId('export-row')).toHaveCount(n)
  await page.getByTestId('export-grouping-combined').click()
  await expect(page.getByTestId('export-row')).toHaveCount(1)
  await page.screenshot({ path: join(shots, '4-export.png') })
})

test('undo / redo restores a deleted layer', async () => {
  await page.evaluate(() => window.__tm!.ui.getState().set({ stage: 'board' }))
  await expect(page.getByTestId('layer-item').first()).toBeVisible()
  const before = await page.getByTestId('layer-item').count()
  await page.evaluate(() => {
    const p = window.__tm!.project.getState()
    p.removeLayer(p.layers[0].id)
  })
  await expect(page.getByTestId('layer-item')).toHaveCount(before - 1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('layer-item')).toHaveCount(before)
})

test('layer type returns to AUTO, re-import asks to replace, help opens', async () => {
  await page.evaluate(() => window.__tm!.ui.getState().set({ stage: 'board' }))
  const first = page.getByTestId('layer-item').first()
  const typeSelect = first.getByLabel('Layer type')
  const detected = await typeSelect.inputValue()
  await typeSelect.selectOption(detected === 'other' ? 'copper' : 'other')
  await expect(first.getByTestId('layer-auto')).toHaveText(/MANUAL/)
  await typeSelect.selectOption(detected)
  await expect(first.getByTestId('layer-auto')).toHaveText(/AUTO/)

  // Importing a file that is already loaded asks what to do; Replace keeps the layer count.
  const before = await page.getByTestId('layer-item').count()
  const dir = join(root, 'fixtures/boards/demo-kicad')
  const name = readdirSync(dir).find((n) => n.endsWith('-F_Cu.gbr'))!
  const file = [{ name, data: readFileSync(join(dir, name), 'utf8') }]
  await page.evaluate((f) => void window.__tm!.importDropped(f), file)
  await expect(page.getByTestId('dup-list')).toContainText(name)
  await page.getByTestId('dup-replace').click()
  await expect(page.getByTestId('layer-item')).toHaveCount(before)

  // Both sides view and the help dialog
  await page.getByRole('radio', { name: 'Both' }).click()
  await expect(page.getByText('BOTH sides (seen from the top)')).toBeVisible()
  await page.getByTestId('open-help').click()
  await expect(page.getByTestId('help-dialog')).toBeVisible()
  await page.screenshot({ path: join(shots, '5-help.png') })
  await page.keyboard.press('Escape')
})

test('tool picker, and places the tool cannot reach can be shown and ignored', async () => {
  await page.evaluate(() => window.__tm!.ui.getState().set({ stage: 'manufacture' }))
  // the step's tool is chosen in a dialog with recommended / other groups
  await page.getByTestId('step-card').nth(1).hover()
  await page.getByTestId('step-edit').nth(1).click()
  await page.getByTestId('tool-choose').click()
  await expect(page.getByTestId('tool-group-recommended')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('tool-picker')).toBeHidden()
  await page.getByTestId('step-cancel').click()
  await expect(page.getByTestId('step-dialog')).toBeHidden()

  // a 1 mm end mill cannot pass between the demo board's pads
  await page.evaluate(async () => {
    const p = window.__tm!.project.getState()
    const iso = p.steps.find((s) => s.kind === 'isolate')!
    const mill = p.tools.find((t) => t.type === 'flat' && Math.abs(t.geometry.diameter - 1) < 0.01)!
    p.upsertStep({ ...iso, toolId: mill.id })
    await window.__tm!.regenerate()
  })
  await page.getByTestId('step-problems').first().click()
  const rows = page.getByTestId('problem-row')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count()
  expect(before).toBeGreaterThan(1)
  await rows.first().getByTestId('problem-ignore').click()
  await expect(rows).toHaveCount(before - 1)
  // gaps smaller than the setting are no longer reported
  await page.getByTestId('problem-ignore-below').fill('0.95')
  await page.getByTestId('problem-ignore-below').press('Enter')
  await expect.poll(async () => rows.count()).toBeLessThan(before - 1)
  await page.screenshot({ path: join(shots, '6-problems.png') })
})
