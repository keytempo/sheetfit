import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addGenerated,
  addFiles,
  open,
  reporter,
  setAllCopies,
  waitForSettled,
  watchWorkers,
} from './harness.mjs'

/*
 * The packing time limit and Continue. Short limits are used throughout (one second, the smallest
 * allowed); the default of three seconds is checked from what the app sends to the worker.
 */
const t = reporter('Packing time limit and Continue')
const work = mkdtempSync(join(tmpdir(), 'sheetfit-limit-'))

const SIZES = [
  [1600, 1200],
  [1200, 1600],
  [1920, 1080],
  [1000, 1000],
  [1500, 2100],
  [2100, 1500],
  [1280, 960],
  [960, 1280],
  [1800, 1200],
  [1100, 1650],
]
const heavy = SIZES.map(([width, height], i) => ({ width, height, name: `h${i}.jpg` }))

const sent = (page) => page.evaluate(() => window.__packing.sent)
const received = (page) => page.evaluate(() => window.__packing.received)
const runs = async (page) => (await sent(page)).filter((m) => m.type === 'run')
const continues = async (page) => (await sent(page)).filter((m) => m.type === 'continue')
const statusText = async (page) => (await page.locator('[role=status]').allInnerTexts()).join(' | ')
const continueButton = (page) =>
  page.getByRole('button', { name: 'Continue searching for a tighter layout' })
const field = (page) => page.getByLabel('Packing time limit in seconds')
const rowCount = (page) => page.locator('[data-image-row]').count()
const waitForRows = (page, n) =>
  page.waitForFunction((n) => document.querySelectorAll('[data-image-row]').length === n, n, {
    timeout: 60000,
  })
const limitReached = (page, timeout = 60000) =>
  page.getByText('Time limit reached').waitFor({ timeout })
const bestSheets = async (page, id) =>
  Math.min(
    ...(await received(page))
      .filter((m) => m.id === id && m.layout)
      .map((m) => m.layout.sheets.length),
  )

async function openOptions(page) {
  await page.click('#print-options-button')
  await page.getByRole('dialog', { name: 'Print options' }).waitFor()
}
async function closeOptions(page) {
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Print options' }).waitFor({ state: 'detached' })
}
/** Types a time limit in the Print options and leaves the field. */
async function setLimit(page, text) {
  await openOptions(page)
  await field(page).fill(String(text))
  await field(page).blur()
  const value = await field(page).inputValue()
  await closeOptions(page)
  return value
}

async function heavyScene({ limit = 1, ...options } = {}) {
  const app = await open({ init: watchWorkers(), ...options })
  const { page } = app
  await setLimit(page, limit)
  await addGenerated(page, heavy)
  await waitForRows(page, heavy.length)
  await setAllCopies(page, 40)
  return app
}

async function main() {
  // ---- 1. The control.
  {
    const app = await open({ init: watchWorkers() })
    const { page } = app
    await openOptions(page)
    const layoutSection = page
      .locator('[data-slot=accordion-item]')
      .filter({ hasText: 'Layout' })
      .first()
    t.check(
      'the control is in the Layout section, labelled',
      (await layoutSection.getByText('Packing time limit').count()) > 0 &&
        (await field(page).count()) === 1,
    )
    t.check(
      'it shows 3 s by default, the budget the app has always used',
      (await field(page).inputValue()) === '3',
    )
    t.check(
      'with a short helper line saying what a longer limit costs and buys',
      /Longer can save paper but makes you wait/.test(await layoutSection.innerText()),
    )
    t.check(
      'and an info tip',
      (await page.getByRole('button', { name: 'About Packing time limit' }).count()) === 1,
    )

    for (const [typed, shown, why] of [
      ['0', '1', 'below the least'],
      ['9999', '600', 'above the most'],
      ['45', '45', 'a valid value'],
    ]) {
      await field(page).fill(typed)
      await field(page).blur()
      t.check(`${typed} (${why}) ends as ${shown}`, (await field(page).inputValue()) === shown)
    }
    await field(page).press('ArrowUp')
    t.check('the arrow keys step by one second', (await field(page).inputValue()) === '46')

    // Strict order has nothing to search.
    await page.getByRole('radio', { name: 'Strict order' }).click()
    t.check(
      'with Strict order the field is disabled and says why',
      (await field(page).isDisabled()) &&
        /Not used with Strict order/.test(await layoutSection.innerText()),
    )
    await page.getByRole('radio', { name: 'Optimize packing' }).click()
    t.check('and enabled again with Optimize packing', await field(page).isEnabled())
    await closeOptions(page)

    // It is stored with the other options and survives a reload.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sheetfit:v1')))
    t.check(
      'it is stored with the other options',
      JSON.stringify(stored).includes('"timeLimit":46'),
    )
    await page.reload()
    await openOptions(page)
    t.check('and is back after a reload', (await field(page).inputValue()) === '46')
    await closeOptions(page)

    // Reset to defaults is options only, and the time limit is an option.
    await openOptions(page)
    await page.getByRole('button', { name: 'Reset to defaults' }).click()
    const confirm = page.getByRole('alertdialog')
    if (await confirm.count()) await confirm.getByRole('button', { name: /Reset/ }).click()
    await page.waitForTimeout(300)
    t.check('Reset to defaults puts it back to 3 s', (await field(page).inputValue()) === '3')
    await closeOptions(page)
    await app.close()
  }

  // ---- 2. Options saved before the field existed.
  {
    const older = { state: { options: { sheetSize: 'a3', margin: 8 } }, version: 1 }
    const app = await open({ storage: JSON.stringify(older) })
    const { page } = app
    await openOptions(page)
    const text = await page.getByRole('dialog', { name: 'Print options' }).innerText()
    t.check(
      'options saved before the time limit existed still load: A3 and an 8 mm margin',
      /A3/.test(text) &&
        (await page.locator('input[aria-label="Page margin"]').inputValue()) === '8',
      text.slice(0, 80),
    )
    t.check('and get the default time limit of 3 s', (await field(page).inputValue()) === '3')
    await closeOptions(page)
    await app.close()
  }

  // ---- 3. What the app sends to the worker, and the time-limit state.
  {
    const app = await heavyScene()
    const { page } = app
    await limitReached(page)
    const first = (await runs(page)).at(-1)
    t.check(
      'a run is sent with the limit in milliseconds',
      first.budgetMs === 1000,
      `${first.budgetMs}`,
    )
    t.check(
      'when the time is up the status says so, with Continue',
      (await statusText(page)).includes('Time limit reached') &&
        (await continueButton(page).count()) === 1,
    )
    t.check('Best found is not shown beside it', !(await statusText(page)).includes('Best found'))
    t.check(
      'the worker said the run stopped at the time limit',
      (await received(page)).some(
        (m) => m.type === 'done' && m.id === first.id && m.stopped === 'time-limit',
      ),
    )
    const bestBefore = await bestSheets(page, first.id)

    // Export uses the layout on screen.
    await page.waitForTimeout(700)
    const onScreen = await page.locator('[data-sheet-page]').count()
    await page.click('[aria-label="Download PDF"]')
    await page.getByText('Your PDF is ready').waitFor({ timeout: 120000 })
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.getByRole('dialog').getByRole('button', { name: 'Download PDF' }).click(),
    ])
    const path = join(work, 'limit.pdf')
    await file.saveAs(path)
    const pages = Number(
      /Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [path], { encoding: 'utf8' }))?.[1],
    )
    t.check(
      'the PDF has exactly the sheets on screen',
      pages === onScreen,
      `${pages} pages, ${onScreen} sheets`,
    )
    await page.getByRole('button', { name: 'Done' }).click()
    await page.waitForTimeout(400)

    // ---- 4. Continue.
    const pieces = await page.locator('[data-piece]').count()
    await continueButton(page).click()
    t.check(
      'pressing Continue sends a continue for that run, with the limit',
      await (async () => {
        const [c] = await continues(page)
        return c && c.from === first.id && c.budgetMs === 1000
      })(),
    )
    t.check(
      'the status is Optimizing… again and Continue is gone',
      (await page.getByText('Optimizing…').isVisible()) &&
        (await continueButton(page).count()) === 0,
    )
    t.check(
      'the keyboard focus is on the sheets, not lost',
      await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Sheets'),
    )
    await limitReached(page)
    const [c1] = await continues(page)
    const best1 = await bestSheets(page, c1.id)
    t.check(
      'it ran for the limit and stopped there again',
      (await received(page)).some(
        (m) => m.type === 'done' && m.id === c1.id && m.stopped === 'time-limit',
      ),
    )
    t.check(
      'Continue never worsens the layout (sheets)',
      best1 <= bestBefore,
      `${best1} <= ${bestBefore}`,
    )
    t.check('and no copy is lost', (await page.locator('[data-piece]').count()) === pieces)
    t.check(
      'the worker never sent a starting layout for the continued run',
      !(await received(page)).some((m) => m.id === c1.id && m.type === 'first'),
    )

    // Again, and again.
    await continueButton(page).click()
    await limitReached(page)
    const cs = await continues(page)
    t.check(
      'it can be used repeatedly, each time from the run before',
      cs.length === 2 && cs[1].from === cs[0].id,
    )
    const secondRun = (await received(page)).filter((m) => m.id === cs[1].id && m.layout)
    t.check(
      'and still never worsens (no layout it reports has more sheets than the best before)',
      secondRun.every((m) => m.layout.sheets.length <= best1),
      `${secondRun.length} improvements reported`,
    )

    // ---- 5. Keyboard.
    await continueButton(page).focus()
    await page.keyboard.press('Enter')
    t.check('Continue works from the keyboard', (await continues(page)).length === 3)
    await limitReached(page)

    // ---- 6. A change during a resumed run starts a fresh run and nothing stale appears.
    const before = (await runs(page)).length
    await continueButton(page).click()
    await page.getByText('Optimizing…').waitFor()
    const resumedId = (await continues(page)).at(-1).id
    await page
      .locator('[data-image-row]')
      .first()
      .getByRole('button', { name: 'More copies' })
      .click()
    await page.waitForTimeout(150)
    t.check(
      'Continue disappears while the new inputs have no layout yet',
      (await continueButton(page).count()) === 0,
    )
    await limitReached(page)
    const after = await runs(page)
    t.check(
      'a fresh run was started, with the limit',
      after.length === before + 1 && after.at(-1).budgetMs === 1000,
    )
    t.check(
      'nothing from the resumed run was shown after it was cancelled',
      await (async () => {
        const all = await received(page)
        const freshId = after.at(-1).id
        const startOfFresh = all.findIndex((m) => m.id === freshId)
        return !all.slice(startOfFresh).some((m) => m.id === resumedId && m.type !== 'done')
      })(),
    )
    t.check(
      'and the layout offered for Continue is the new one',
      (await continueButton(page).count()) === 1 &&
        (await page.locator('[data-piece]').count()) === pieces + 1,
    )
    await app.close()
  }

  // ---- 7. Changing the limit applies from the next run, and starts none.
  {
    const app = await heavyScene()
    const { page } = app
    await limitReached(page)
    const before = (await runs(page)).length
    await setLimit(page, 2)
    await page.waitForTimeout(400)
    t.check('changing the limit starts no new search', (await runs(page)).length === before)
    t.check(
      'and leaves the stopped layout and its Continue alone',
      (await continueButton(page).count()) === 1,
    )
    await continueButton(page).click()
    const c = (await continues(page)).at(-1)
    t.check('Continue uses the limit as it is now', c.budgetMs === 2000, `${c.budgetMs}`)
    await page
      .locator('[data-image-row]')
      .first()
      .getByRole('button', { name: 'More copies' })
      .click()
    await page.waitForTimeout(300)
    t.check('so does the next fresh run', (await runs(page)).at(-1).budgetMs === 2000)
    await app.close()
  }

  // ---- 8. No Continue when it would not help.
  {
    const app = await open({ init: watchWorkers() })
    const { page } = app
    await addFiles(page, ['photo.jpg', 'opaque.png', 'gray.jpg'])
    await waitForRows(page, 3)
    await waitForSettled(page)
    t.check(
      'a layout proven optimal says Optimal and offers no Continue',
      /Optimal/.test(await statusText(page)) && (await continueButton(page).count()) === 0,
      await statusText(page),
    )
    await app.close()

    const strict = await heavyScene()
    await openOptions(strict.page)
    await strict.page.getByRole('radio', { name: 'Strict order' }).click()
    await closeOptions(strict.page)
    await waitForSettled(strict.page)
    await strict.page.waitForTimeout(500)
    t.check(
      'Strict order offers no Continue',
      (await continueButton(strict.page).count()) === 0 &&
        !(await statusText(strict.page)).includes('Time limit'),
    )
    await strict.close()
  }

  // ---- 9. Presets leave the limit alone, and the limit leaves "Modified" alone.
  {
    const app = await open({ dev: true })
    const { page } = app
    await openOptions(page)
    await field(page).fill('77')
    await field(page).blur()
    await closeOptions(page)
    await page.evaluate(async () => {
      const { saveCurrentSettings } = await import('/src/features/presets/actions.ts')
      saveCurrentSettings('Labels')
    })
    const preset = await page.evaluate(() => {
      const raw = Object.entries(localStorage).find(([key]) => key.startsWith('sheetfit:presets'))
      return raw ? raw[1] : ''
    })
    t.check(
      'a saved preset does not contain the time limit',
      preset.length > 0 && !preset.includes('timeLimit') && !preset.includes('77'),
    )
    await openOptions(page)
    await field(page).fill('5')
    await field(page).blur()
    await closeOptions(page)
    const label = await page.locator('#presets-button').getAttribute('aria-label')
    t.check(
      'changing the time limit does not make the active preset "Modified"',
      /Presets: Labels/.test(label ?? '') && !/Modified/.test(label ?? ''),
      label ?? '',
    )
    await page.evaluate(async () => {
      const { applyPreset } = await import('/src/features/presets/actions.ts')
      const { presetBook } = await import('/src/store/presets.ts')
      applyPreset(presetBook.store.getState().presets[0].id)
    })
    await openOptions(page)
    t.check(
      'and applying a preset leaves the time limit as it was',
      (await field(page).inputValue()) === '5',
    )
    await closeOptions(page)
    await app.close()
  }

  t.done()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
